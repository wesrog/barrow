# Multiplayer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2–4 player drop-in co-op via host-relayed P2P lockstep: a zone-based shared world (camp + persistent floors), personal portal pairs, corpse-run death, split XP, WebRTC gameplay traffic, and a tiny WebSocket signaling server.

**Architecture:** Phase A restructures the pure sim from single-player/single-map to zones + a players map, keeping the game fully playable solo after every task. Phase B adds a pure lockstep protocol layer (`net/`): the host sequences per-tick input frames, every client steps the identical deterministic sim on the identical frame stream. Phase C adds the signaling server (`signal/`) and WebRTC plumbing (`client/net/`). Phase D rewires the client: a net-driver abstraction, multi-hero rendering with zone filtering, and lobby/party HUD.

**Tech Stack:** TypeScript, Bun (tests + signal server), Vite, Three.js, React 19, WebRTC DataChannels, WebSocket.

**Spec:** `docs/superpowers/specs/2026-08-26-multiplayer-design.md`

## Global Constraints

- `sim/` and `net/` are pure: **no imports from three, react, or the DOM — ever**. All randomness through `sim/rng.ts`.
- Fixed 25 Hz tick (`TICK_RATE = 25`). Same seed + same frame stream ⇒ identical state on every client.
- TDD for all `sim/`, `net/`, and `signal/` logic: failing test first. Renderer/HUD verified by playing.
- Test command: `bun test sim client net` (extended to `signal` where noted). Typecheck: `bun run build`.
- Deterministic iteration everywhere: players in ascending `PlayerId` order; zones in `Map` insertion order (identical on all clients because insertion is frame-driven).
- Every task ends with the repo compiling, all tests passing, and the game playable solo.

---

## Phase A — Sim restructure (playable solo throughout)

### Task A1: RNG snapshot support

**Files:**
- Modify: `sim/rng.ts`
- Test: `sim/rng.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Rng.state(): number` — the current mulberry32 internal word. Resuming via `createRng(savedState)` continues the exact stream (mulberry32 advances `s` before producing, so the current `s` is the complete state).

- [ ] **Step 1: Write the failing test** (append to `sim/rng.test.ts`)

```ts
test("state() lets a new rng resume the exact stream", () => {
  const a = createRng(12345);
  for (let i = 0; i < 7; i++) a.next();
  const b = createRng(a.state());
  const tailA = [a.next(), a.int(1, 100), a.next()];
  const tailB = [b.next(), b.int(1, 100), b.next()];
  expect(tailB).toEqual(tailA);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test sim/rng.test.ts`
Expected: FAIL — `a.state is not a function`.

- [ ] **Step 3: Implement**

In `sim/rng.ts`, add `state(): number` to the `Rng` interface (doc: "Internal state word; `createRng(state())` resumes the stream."), and in `createRng` return `{ next, int: ..., state: () => s }`.

- [ ] **Step 4: Run tests** — `bun test sim` — all pass.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "RNG exposes its state word for snapshot/resume"`

---

### Task A2: Zones — camp and persistent floors replace the single map

This is the structural pivot. `GameState` gains `zones`; the `TownState` freeze/restore hack and global `depth` die; stairs and the camp pad become zone travel. The player is still singular (`state.player`) but gains `zoneId`.

**Files:**
- Modify: `sim/state.ts`, `sim/tick.ts`, `sim/zone.ts`, `sim/monsters.ts`, `sim/breakables.ts`, `sim/systems/movement.ts`, `sim/systems/combat.ts`, `sim/systems/inventory.ts`, `sim/systems/skills.ts`, `sim/systems/collision.ts`, `sim/systems/town.ts`, `client/main.tsx`, `client/render/scene.ts` (map references only), `client/ui/MiniMap.tsx`, `client/ui/ZoneBanner.tsx`, `client/save.ts`
- Test: `sim/zone.test.ts` (new cases), all existing sim tests updated mechanically.

**Interfaces:**
- Produces (in `sim/state.ts` unless noted):

```ts
export type ZoneId = "camp" | `floor:${number}`;
export const floorZone = (n: number): ZoneId => `floor:${n}`;
/** camp = 0; floor:N = N. Drives monster/loot scaling exactly as old `depth`. */
export function zoneDepth(id: ZoneId): number;

export interface ZoneState {
  id: ZoneId;
  map: ZoneMap;
  monsters: Map<number, Monster>;
  groundItems: Map<number, GroundItem>;
  goldPiles: Map<number, GoldPile>;
  breakables: Map<number, Breakable>;
  corpses: Corpse[];
}

export interface GameState {
  tick: number;
  rng: Rng;
  zones: Map<ZoneId, ZoneState>;
  shop: ShopEntry[];
  player: Player;            // Player gains zoneId: ZoneId
  events: SimEvent[];
  nextId: number;
}

export function getZone(state: GameState, id: ZoneId): ZoneState;      // throws on missing
export function zoneOf(state: GameState, p: Player): ZoneState;        // getZone(state, p.zoneId)
```

- Produces (in `sim/tick.ts`):

```ts
/** Get-or-generate floor N deterministically from the world rng. */
export function ensureFloor(state: GameState, n: number): ZoneState;
/** Move a player to a zone's spawn; clears path/targets/pendingStrike. */
export function travel(state: GameState, zone: ZoneId): void;   // still single-player; A3 adds the player param
export function createGame(seed: number): GameState;            // no map param: builds camp + floor:1
```

- `spawnMonster(state, zone: ZoneState, typeId, pos, depth)` and `spawnBreakables(state, zone: ZoneState, depth: number)` gain a zone parameter (`sim/monsters.ts`, `sim/breakables.ts`).
- `SimEvent` changes: `descended`/`portal` replaced by `{ type: "traveled"; to: ZoneId }`. Spatial events gain `zone: ZoneId`: `monster_swing`, `monster_windup`, `monster_hit`, `monster_died`, `exploded`, `breakable_broken`, `gold_dropped`, `item_dropped`, `player_swing`, `skill_cast`.
- Camp travel markers: in `sim/zone.ts` `townZone()`, the `P` pad now means "descend to floor:1". Crypt `>` means "descend one floor". `MARKER_TYPES` unchanged.
- Shop rule (deterministic, shared-world ready): `restock(state, byPlayer)` runs when a player **arrives in camp and camp held no other player before the arrival** (single-player: every camp arrival). ilvl from the arriving player's level.

- [ ] **Step 1: Write the failing tests** (new file section in `sim/zone.test.ts`)

```ts
import { createGame, ensureFloor, step, travel } from "../tick";
import { floorZone, getZone, zoneDepth } from "../state";

test("createGame builds camp and floor:1; player starts in camp", () => {
  const g = createGame(1);
  expect([...g.zones.keys()]).toEqual(["camp", "floor:1"]);
  expect(g.player.zoneId).toBe("camp");
  expect(getZone(g, "camp").monsters.size).toBe(0);
  expect(getZone(g, "floor:1").monsters.size).toBeGreaterThan(0);
});

test("ensureFloor generates lazily, deterministically, and only once", () => {
  const g = createGame(7);
  expect(g.zones.has("floor:2")).toBe(false);
  const z = ensureFloor(g, 2);
  expect(ensureFloor(g, 2)).toBe(z); // same instance, not regenerated
  const h = createGame(7);
  step(h, {}); // an unrelated tick must not affect gen determinism given same call order
  expect([...ensureFloor(h, 2).monsters.values()].map((m) => m.pos))
    .toEqual([...z.monsters.values()].map((m) => m.pos));
});

test("deeper floors scale monsters", () => {
  const g = createGame(3);
  const f1 = [...getZone(g, "floor:1").monsters.values()].find((m) => m.typeId === "shambler")!;
  const f3 = [...ensureFloor(g, 3).monsters.values()].find((m) => m.typeId === "shambler")!;
  expect(f3.maxLife).toBeGreaterThan(f1.maxLife);
});

test("standing on the camp pad travels to floor:1; stairs go one deeper", () => {
  const g = createGame(1);
  const pad = getZone(g, "camp").map.markers.find((m) => m.ch === "P")!;
  g.player.pos = { x: pad.x, y: pad.y };
  step(g, {});
  expect(g.player.zoneId).toBe("floor:1");
  expect(g.events.some((e) => e.type === "traveled" && e.to === "floor:1")).toBe(true);
  const stairs = getZone(g, "floor:1").map.markers.find((m) => m.ch === ">")!;
  g.player.pos = { x: stairs.x, y: stairs.y };
  step(g, {});
  expect(g.player.zoneId).toBe("floor:2");
});

test("floors persist: a cleared monster stays dead after leaving and returning", () => {
  const g = createGame(1);
  travel(g, "floor:1");
  const first = [...getZone(g, "floor:1").monsters.keys()][0]!;
  getZone(g, "floor:1").monsters.delete(first);
  const count = getZone(g, "floor:1").monsters.size;
  travel(g, "camp");
  travel(g, "floor:1");
  expect(getZone(g, "floor:1").monsters.size).toBe(count);
});

test("empty zones are frozen: monsters there do not act", () => {
  const g = createGame(1);
  expect(g.player.zoneId).toBe("camp");
  const before = [...getZone(g, "floor:1").monsters.values()].map((m) => ({ ...m.pos }));
  for (let i = 0; i < 200; i++) step(g, {});
  const after = [...getZone(g, "floor:1").monsters.values()].map((m) => ({ ...m.pos }));
  expect(after).toEqual(before);
});

test("zoneDepth", () => {
  expect(zoneDepth("camp")).toBe(0);
  expect(zoneDepth(floorZone(4))).toBe(4);
});
```

- [ ] **Step 2: Run to verify failures** — `bun test sim/zone.test.ts` — FAIL (missing exports).

- [ ] **Step 3: Restructure `sim/state.ts`**

Replace `map`, `depth`, `town`, `monsters`, `corpses`, `groundItems`, `goldPiles`, `breakables` on `GameState` with `zones` per the Interfaces block above; delete `TownState`; add `zoneId: ZoneId` to `Player`; apply the `SimEvent` changes listed above. Add `getZone`/`zoneOf`/`floorZone`/`zoneDepth`.

- [ ] **Step 4: Restructure `sim/tick.ts`**

```ts
function makeZone(state: GameState, id: ZoneId, map: ZoneMap): ZoneState {
  const zone: ZoneState = {
    id, map,
    monsters: new Map(), groundItems: new Map(), goldPiles: new Map(),
    breakables: new Map(), corpses: [],
  };
  state.zones.set(id, zone);
  return zone;
}

export function ensureFloor(state: GameState, n: number): ZoneState {
  const id = floorZone(n);
  const existing = state.zones.get(id);
  if (existing) return existing;
  const zone = makeZone(state, id, cryptZone());
  for (const marker of zone.map.markers) {
    const typeId = MARKER_TYPES[marker.ch];
    if (typeId) spawnMonster(state, zone, typeId, { x: marker.x, y: marker.y }, n);
  }
  spawnBreakables(state, zone, n);
  return zone;
}

export function travel(state: GameState, to: ZoneId): void {
  if (to !== "camp") ensureFloor(state, zoneDepth(to));
  const p = state.player;
  const wasCampEmpty = to === "camp"; // A3 refines: no *other* player already in camp
  p.zoneId = to;
  p.pos = { ...getZone(state, to).map.spawn };
  p.path = [];
  p.attackTarget = null; p.pickupTarget = null; p.smashTarget = null;
  p.vendorTarget = false; p.pendingStrike = null;
  if (to === "camp" && wasCampEmpty) restock(state);
  state.events.push({ type: "traveled", to });
}
```

`createGame(seed)`: build `zones: new Map()`, `makeZone(state, "camp", townZone())`, `ensureFloor(state, 1)`, player starts with `zoneId: "camp"`, `pos: {...camp.map.spawn}`. Starting blade unchanged. `descend`/`stairsSystem` become: `>` marker check against `zoneOf(state, p)` and call `travel(state, floorZone(zoneDepth(p.zoneId) + 1))`. Camp pad: fold the old `townPadSystem` into a `travelPadSystem` that checks `P` in camp → `travel(state, "floor:1")`. `resetRun` (input `newGame`): delete every `floor:*` zone from `state.zones`, `ensureFloor(state, 1)`, revive player, `travel(state, "camp")`.

In `step`, run zone-scoped systems only for zones containing a player (single-player: the player's zone). System order per tick is unchanged.

- [ ] **Step 5: Mechanically re-scope every system to the player's zone**

The pattern, worked once (in `sim/systems/movement.ts`):

```ts
export function applyMoveInput(state: GameState, input: PlayerInput): void {
  const dest = input.moveTo;
  if (!dest) return;
  const map = zoneOf(state, state.player).map;   // was: state.map
  ...
}
```

Apply the same substitution everywhere: `state.map` → `zoneOf(state, p).map` (or a `zone` local); `state.monsters` → `zone.monsters`; `state.groundItems`/`goldPiles`/`breakables`/`corpses` → `zone.*`; `state.depth` → `zoneDepth(p.zoneId)` (in `breakables.ts` `smash` and monster spawn scaling). Files: `movement.ts`, `combat.ts` (incl. `monsterAiSystem` and `deathSystem` — both iterate the occupied zone's monsters; death drops go into that zone), `inventory.ts` (`pickupSystem`, `applyDropItemInput`), `skills.ts` (`applyCastInput` targets `zone.monsters`, leap checks `zone.map`), `collision.ts` (player vs their zone's monsters/markers; monster-vs-monster per occupied zone), `breakables.ts` (`spawnBreakables(state, zone, depth)` writes `zone.breakables`; `smash` uses `zoneDepth`), `monsters.ts` (`spawnMonster(state, zone, ...)` writes `zone.monsters`). Push the new `zone: ZoneId` field on every spatial event listed in Interfaces.

- [ ] **Step 6: Rewrite `sim/systems/town.ts`**

Delete `applyTownPortalInput`/`townPadSystem` (portal pairs arrive in A4; until then `t` does nothing — acceptable inter-task state, solo players walk the pad). `restock(state)` as before but exported; vendor logic gates on `state.player.zoneId === "camp"` instead of `state.town !== null`; `applyShopInput` likewise.

- [ ] **Step 7: Update the client compile-sites (minimal, no feature work)**

`client/main.tsx`: `createGame(Date.now() >>> 0)` (no map arg); scene map is `zoneOf(game, game.player).map` — keep the existing "map changed ⇒ rebuild scene" check against that; event switch: replace `descended`/`portal` cases with `traveled` (play `"portal"` sound; close shop when leaving camp). `client/render/scene.ts` + `MiniMap.tsx`: read entities via `zoneOf(game, game.player)` (a `const zone = ...` at the top of `render`/component keeps the diff small). `ZoneBanner.tsx`: name from `zoneDepth(game.player.zoneId)` (`0` ⇒ "The Camp"). `client/save.ts`: `applyCharacter` sets `p.pos = {...zoneOf(state, p).map.spawn}`.

- [ ] **Step 8: Update existing sim tests**

Mechanical: `createGame(seed, map)` call sites → `createGame(seed)` plus `travel(state, "floor:1")` where the test expects to start in the crypt; `state.monsters` etc. → `getZone(state, state.player.zoneId).*`. Town tests: portal-freeze assertions become camp-zone assertions.

- [ ] **Step 9: Run everything** — `bun test sim client && bun run build` — all green. Play a minute solo (`bun run dev`): camp → pad → floor 1 → stairs → floor 2.

- [ ] **Step 10: Commit** — `git commit -am "Zones: camp + persistent floors replace single-map state"`

---

### Task A3: Players map, frames, and per-player systems

**Files:**
- Modify: `sim/state.ts`, `sim/tick.ts`, every file in `sim/systems/`, `sim/breakables.ts`, `client/main.tsx`, `client/save.ts`, `client/render/scene.ts`, `client/ui/*.tsx` (read-sites)
- Test: `sim/tick.test.ts` (multi-player determinism), `sim/multiplayer.test.ts` (new)

**Interfaces:**
- Produces (in `sim/state.ts`):

```ts
export type PlayerId = number; // 0..3, host-assigned
export interface PlayerJoin { id: PlayerId; character?: string /* CharacterSave JSON */ }
export interface Frame {
  tick: number;
  inputs: Partial<Record<PlayerId, PlayerInput>>;
  joins?: PlayerJoin[];
  leaves?: PlayerId[];
}
// GameState: player: Player  →  players: Map<PlayerId, Player>  (Player gains id: PlayerId)
export function playerIds(state: GameState): PlayerId[]; // ascending
```

- Produces (in `sim/tick.ts`):

```ts
export function step(state: GameState, frame: Frame): void;
/** Test/solo convenience: step with one player's input as frame {inputs:{0: input}}. */
export function stepSolo(state: GameState, input: PlayerInput): void;
export function joinPlayer(state: GameState, join: PlayerJoin): Player; // spawns in camp, starter blade or saved character
export function travel(state: GameState, p: Player, to: ZoneId): void;  // gains player param
export function createGame(seed: number): GameState;                    // zero players; callers join
```

- Player-scoped events gain `playerId: PlayerId`: `player_swing`, `player_hit`, `level_up`, `skill_cast`, `potion_drunk`, `traveled`, `shop_opened`, `bought`, `sold`, `repaired`, `gold_picked`, `item_picked`, `inventory_full`, `item_broke`, `item_equipped`, `item_unequipped`. New events: `{ type: "player_joined"; playerId }`, `{ type: "player_left"; playerId }`, `{ type: "player_died"; playerId; zone: ZoneId; pos: Vec }` (used fully in A5).
- Monster AI: `Monster` targeting is "nearest living player in my zone"; `deathSystem` player-damage loops all players in the zone. `Monster.lastHitBy: PlayerId | null` added now (set wherever a player damages a monster), consumed by A6.
- `client/save.ts`: `serializeCharacter(state, playerId)`, `applyCharacter(state, playerId, raw)`.

- [ ] **Step 1: Write the failing tests** (`sim/multiplayer.test.ts`)

```ts
import { createGame, joinPlayer, step, stepSolo, travel } from "../tick";
import { getZone } from "../state";

const join2 = () => {
  const g = createGame(42);
  joinPlayer(g, { id: 0 });
  joinPlayer(g, { id: 1 });
  return g;
};

test("two players join in camp with starter blades", () => {
  const g = join2();
  expect([...g.players.keys()]).toEqual([0, 1]);
  for (const p of g.players.values()) {
    expect(p.zoneId).toBe("camp");
    expect(p.equipment.weapon?.baseId).toBe("rusted_blade");
  }
});

test("joins and leaves ride the frame stream", () => {
  const g = createGame(9);
  step(g, { tick: 0, inputs: {}, joins: [{ id: 0 }] });
  expect(g.players.size).toBe(1);
  expect(g.events.some((e) => e.type === "player_joined" && e.playerId === 0)).toBe(true);
  step(g, { tick: 1, inputs: {}, leaves: [0] });
  expect(g.players.size).toBe(0);
});

test("players move independently in different zones", () => {
  const g = join2();
  const p0 = g.players.get(0)!, p1 = g.players.get(1)!;
  travel(g, p0, "floor:1");
  const before1 = { ...p1.pos };
  step(g, { tick: g.tick, inputs: { 0: { moveTo: { x: p0.pos.x + 2, y: p0.pos.y } } } });
  expect(p0.path.length).toBeGreaterThan(0);
  expect(p1.pos).toEqual(before1);
});

test("monsters target the nearest living player in their zone", () => {
  const g = join2();
  const p0 = g.players.get(0)!, p1 = g.players.get(1)!;
  travel(g, p0, "floor:1");
  travel(g, p1, "floor:1");
  const m = [...getZone(g, "floor:1").monsters.values()][0]!;
  p0.pos = { x: m.pos.x + 1.5, y: m.pos.y };  // p0 closest
  p1.pos = { x: m.pos.x + 5, y: m.pos.y };
  const life0 = p0.life;
  for (let i = 0; i < 300; i++) step(g, { tick: g.tick, inputs: {} });
  expect(p0.life).toBeLessThan(life0);
});

test("contested pickup: lower id wins deterministically", () => {
  const g = join2();
  const p0 = g.players.get(0)!, p1 = g.players.get(1)!;
  travel(g, p0, "floor:1"); travel(g, p1, "floor:1");
  const zone = getZone(g, "floor:1");
  const id = g.nextId++;
  zone.groundItems.set(id, { id, item: { baseId: "rusted_blade", rarity: "normal", name: "Rusted Blade", affixIds: [], mods: [], ilvl: 1 }, pos: { ...p0.pos } });
  p1.pos = { ...p0.pos };
  step(g, { tick: g.tick, inputs: { 0: { pickup: id }, 1: { pickup: id } } });
  expect(zone.groundItems.has(id)).toBe(false);
  expect(g.players.get(0)!.inventory.entries.some((e) => e.id === id)).toBe(true);
  expect(g.players.get(1)!.inventory.entries.some((e) => e.id === id)).toBe(false);
});
```

And in `sim/tick.test.ts`, extend the determinism test:

```ts
test("two-player determinism: same seed + same frames ⇒ identical state", () => {
  const script = (g: GameState) => {
    joinPlayer(g, { id: 0 }); joinPlayer(g, { id: 1 });
    travel(g, g.players.get(0)!, "floor:1");
    travel(g, g.players.get(1)!, "floor:1");
    for (let t = 0; t < 500; t++) {
      const inputs: Frame["inputs"] = {};
      if (t % 7 === 0) inputs[0] = { moveTo: { x: 5 + (t % 20), y: 3 } };
      if (t % 11 === 0) inputs[1] = { moveTo: { x: 30 - (t % 20), y: 15 } };
      if (t === 200) inputs[1] = { cast: { skill: "cleave" } };
      step(g, { tick: g.tick, inputs });
    }
  };
  const a = createGame(1234), b = createGame(1234);
  script(a); script(b);
  expect(JSON.stringify(a, mapReplacer)).toBe(JSON.stringify(b, mapReplacer));
});
// mapReplacer: (k, v) => v instanceof Map ? [...v.entries()] : v instanceof Uint8Array ? [...v] : typeof v === "function" ? undefined : v
```

- [ ] **Step 2: Run to verify failures** — `bun test sim/multiplayer.test.ts` — FAIL.

- [ ] **Step 3: Restructure state + tick**

`state.ts` per Interfaces. `tick.ts`: extract the old inline player construction into `joinPlayer` (parse `join.character` with the logic now in `client/save.ts` — move the pure parts (`CharacterSave` parse/apply) into a new `sim/save.ts` so `sim` doesn't import from `client`; `client/save.ts` keeps only localStorage and re-exports). `step(state, frame)`:

```ts
export function step(state: GameState, frame: Frame): void {
  state.events = [];
  for (const j of frame.joins ?? []) joinPlayer(state, j);
  for (const id of frame.leaves ?? []) {
    if (state.players.delete(id)) state.events.push({ type: "player_left", playerId: id });
  }
  for (const id of playerIds(state)) {
    const input = frame.inputs[id];
    if (!input) continue;
    const p = state.players.get(id)!;
    if (input.newGame) { resetRun(state); break; }
    if (p.dead) continue;
    applyMoveInput(state, p, input);
    // ... every applyXxxInput gains (state, p, input)
  }
  for (const zone of occupiedZones(state)) {
    // per-zone systems, players within iterated ascending:
    manaRegenSystem, playerCombatSystem, pickupSystem, vendorSystem,
    breakSystem, movementSystem, travelPadSystem, stairsSystem,
    monsterAiSystem, collisionSystem, deathSystem
  }
  xpSystem(state);
  durabilitySystem(state);
  state.tick++;
}
export const stepSolo = (state: GameState, input: PlayerInput): void =>
  step(state, { tick: state.tick, inputs: { 0: input } });
```

(`occupiedZones` = zones with ≥1 player, insertion order. Keep the current relative system order; per-player state like `swingCooldown` decrements inside the per-zone player loop exactly once per tick — a player is in exactly one zone.)

- [ ] **Step 4: Thread `p: Player` through every system**

Mechanical pass over `sim/systems/*`, `sim/breakables.ts`: each `applyXxxInput(state, input)` → `(state, p, input)`; each per-player system (`playerCombatSystem`, `pickupSystem`, `breakSystem`, `movementSystem`, `vendorSystem`, `manaRegenSystem`, stairs/pad) loops `for (const id of playerIds(state))` filtered to the zone being processed. `monsterAiSystem`: replace `const p = state.player` with nearest-living-player selection per monster (ties broken by lower id); a zone whose players are all dead idles its monsters as the old `p.dead` branch did. `deathSystem`: explosion damage hits every living player in radius; set `m.lastHitBy` wherever player damage lands (`resolvePlayerStrike`, cleave/crush in `skills.ts`). `xpSystem`: interim — full XP to every player in the kill's zone (A6 replaces with split; keep the test loose on amounts until then). `collisionSystem`: player-vs-player uses the monster-pair "split evenly" logic. `recomputePlayerStats(state, p)`. Add `playerId` (and `zone` where listed) to every event push.

- [ ] **Step 5: Update client + remaining tests**

`client/main.tsx`: `const LOCAL = 0`; create game then `stepSolo`-style frames (`step(game, { tick: game.tick, inputs: { [LOCAL]: pending }, joins: firstTick ? [{ id: LOCAL, character: raw }] : undefined })`); every `game.player` → `game.players.get(LOCAL)!` (a `localPlayer(game)` helper in `client/main.tsx`, exported for UI files); HUD event switch filters player events by `e.playerId === LOCAL`. Same substitution in `scene.ts`, `MiniMap`, `BottomBar`, panels. Old sim tests: `step(g, input)` → `stepSolo(g, input)` after a `joinPlayer(g, { id: 0 })` in setup (add a shared `soloGame(seed)` helper in a new `sim/testutil.ts`).

- [ ] **Step 6: Run everything** — `bun test sim client && bun run build`; play solo. 

- [ ] **Step 7: Commit** — `git commit -am "Players map + input frames: the sim is multiplayer"`

---

### Task A4: Portal pairs

**Files:**
- Modify: `sim/state.ts`, `sim/systems/town.ts`, `sim/tick.ts` (step wiring)
- Test: `sim/portals.test.ts`

**Interfaces:**
- Produces (in `sim/state.ts`):

```ts
export interface Portal {
  id: number;
  owner: PlayerId;
  pos: Vec;
  /** The far end. */
  link: { zone: ZoneId; pos: Vec };
}
// ZoneState gains: portals: Map<number, Portal>
```

- `PlayerInput.townPortal` (unchanged key, `t`) now *casts* a pair; new `PlayerInput.usePortal?: number` (portal id) walks to and rides a portal; `Player.portalTarget: number | null` (walk-to state, like `pickupTarget`).
- Produces (in `sim/systems/town.ts`): `applyCastPortalInput(state, p, input)`, `applyUsePortalInput(state, p, input)`, `portalSystem(state, zone)` (the walk-to-then-teleport system, runs with the other per-zone systems).
- Event: `{ type: "portal_cast"; playerId: PlayerId; zone: ZoneId; pos: Vec }`; riding one emits the existing `traveled`.

- [ ] **Step 1: Write the failing tests** (`sim/portals.test.ts`)

```ts
test("casting in a crypt creates a linked pair; camp end lands near camp spawn", () => {
  const g = soloGame(1);
  const p = g.players.get(0)!;
  travel(g, p, "floor:2");
  stepSolo(g, { townPortal: true });
  const here = [...getZone(g, "floor:2").portals.values()];
  const camp = [...getZone(g, "camp").portals.values()];
  expect(here).toHaveLength(1);
  expect(camp).toHaveLength(1);
  expect(here[0]!.link).toEqual({ zone: "camp", pos: camp[0]!.pos });
  expect(camp[0]!.link).toEqual({ zone: "floor:2", pos: here[0]!.pos });
});

test("recasting replaces the old pair; casting in camp does nothing", () => {
  const g = soloGame(1);
  const p = g.players.get(0)!;
  travel(g, p, "floor:1");
  stepSolo(g, { townPortal: true });
  travel(g, p, "floor:2");
  stepSolo(g, { townPortal: true });
  expect(getZone(g, "floor:1").portals.size).toBe(0);
  expect(getZone(g, "floor:2").portals.size).toBe(1);
  expect(getZone(g, "camp").portals.size).toBe(1);
  travel(g, p, "camp");
  const before = getZone(g, "camp").portals.size;
  stepSolo(g, { townPortal: true });
  expect(getZone(g, "camp").portals.size).toBe(before);
});

test("any player can ride any portal, both directions", () => {
  const g = createGame(5);
  joinPlayer(g, { id: 0 }); joinPlayer(g, { id: 1 });
  const p0 = g.players.get(0)!, p1 = g.players.get(1)!;
  travel(g, p0, "floor:1");
  stepSolo(g, { townPortal: true }); // p0 casts on floor 1
  const campEnd = [...getZone(g, "camp").portals.values()][0]!;
  p1.pos = { ...campEnd.pos };
  step(g, { tick: g.tick, inputs: { 1: { usePortal: campEnd.id } } });
  // walk-to resolves within a few ticks when already standing on it
  for (let i = 0; i < 5 && p1.zoneId === "camp"; i++) step(g, { tick: g.tick, inputs: {} });
  expect(p1.zoneId).toBe("floor:1");
});
```

- [ ] **Step 2: Run** — FAIL (no `portals` on ZoneState).

- [ ] **Step 3: Implement**

`applyCastPortalInput` (replaces the dead `t` handler): if `p.zoneId === "camp"` or `p.dead`, return; delete both ends of any existing pair with `owner === p.id` (scan zones); create the near end at `p.pos` (snap to `{Math.floor+0.5}` of the standing cell) and the camp end at a free cell adjacent to camp spawn (deterministic scan: spawn cell, then +x, −x, +y, −y offsets, first walkable non-occupied); push `portal_cast`. `applyUsePortalInput`: sets `portalTarget` and clears other targets. `portalSystem`: walk-to like `pickupSystem` (range 0.6); on arrival, `travel(state, p, portal.link.zone)` then set `p.pos = {...portal.link.pos}` (travel resets to spawn; override to the linked end). Riding does **not** consume the portal (persistent gateway; replaced on recast). Clean up a leaver's pair in the `leaves` handling of `step`.

- [ ] **Step 4: Run tests** — `bun test sim` — pass. **Step 5: Commit** — `git commit -am "Portal pairs: persistent two-way town portals anyone can ride"`

---

### Task A5: Death → camp respawn + corpse run

**Files:**
- Modify: `sim/state.ts`, `sim/systems/combat.ts` (deathSystem), `sim/systems/inventory.ts`, `sim/tick.ts`
- Test: `sim/corpse.test.ts`

**Interfaces:**
- Produces (in `sim/state.ts`):

```ts
export interface PlayerCorpse { id: number; playerId: PlayerId; pos: Vec; equipment: Equipment }
// ZoneState gains: playerCorpses: Map<number, PlayerCorpse>
```

- `PlayerInput.reclaim?: number` (corpse id); `Player.reclaimTarget: number | null` (walk-to). Event: `{ type: "corpse_reclaimed"; playerId: PlayerId }`; `player_died` (from A3) now fires here.
- `Player.dead` stays but is only ever true within the death tick — death resolves to an immediate camp respawn, so `p.dead` long-term is no longer a state (the "all dead ⇒ reset" rule is gone; `newGame` remains a manual input).

- [ ] **Step 1: Write the failing tests** (`sim/corpse.test.ts`)

```ts
test("death strips equipment onto a corpse and respawns the player in camp", () => {
  const g = soloGame(1);
  const p = g.players.get(0)!;
  travel(g, p, "floor:1");
  const spot = { ...p.pos };
  p.life = 0;
  stepSolo(g, {});
  expect(p.zoneId).toBe("camp");
  expect(p.life).toBe(p.maxLife);
  expect(p.equipment.weapon).toBeNull();
  const corpses = [...getZone(g, "floor:1").playerCorpses.values()];
  expect(corpses).toHaveLength(1);
  expect(corpses[0]!.playerId).toBe(0);
  expect(corpses[0]!.equipment.weapon?.baseId).toBe("rusted_blade");
  expect(corpses[0]!.pos).toEqual(spot);
  expect(p.gold).toBe(p.gold); // gold, inventory, belt untouched
});

test("reclaiming re-equips everything and removes the corpse", () => {
  const g = soloGame(1);
  const p = g.players.get(0)!;
  travel(g, p, "floor:1");
  p.life = 0;
  stepSolo(g, {});
  travel(g, p, "floor:1");
  const corpse = [...getZone(g, "floor:1").playerCorpses.values()][0]!;
  p.pos = { ...corpse.pos };
  stepSolo(g, { reclaim: corpse.id });
  for (let i = 0; i < 5; i++) stepSolo(g, {});
  expect(p.equipment.weapon?.baseId).toBe("rusted_blade");
  expect(getZone(g, "floor:1").playerCorpses.size).toBe(0);
});

test("dying again merges old corpse gear onto the new corpse", () => {
  // equip a second item (helm) first; die on floor:1, re-equip nothing, die on floor:2
  // assert: single corpse on floor:2 carrying BOTH the blade and the helm slots that were equipped at each death,
  // and floor:1 corpse is gone.
});

test("only the owner can reclaim", () => {
  // p0's corpse; p1 stands on it and sends reclaim -> corpse remains, p1 equipment unchanged.
});
```

(Write the two sketched tests out fully — the merge test equips `cracked_helm` via `placeItem` + `equip` input before the first death.)

- [ ] **Step 2: Run** — FAIL. 

- [ ] **Step 3: Implement**

In `deathSystem`'s player-fell branch: build `PlayerCorpse` from `p.equipment` (only if ≥1 item equipped — a naked death leaves no corpse); merge: if a corpse with `playerId === p.id` exists in any zone, fold its non-null slots into the new corpse (new death's gear wins a slot conflict — can't happen since slots were stripped, but code the loop defensively) and delete it; `recomputePlayerStats`; emit `player_died`; then `travel(state, p, "camp")` + `p.dead = false; p.life = p.maxLife; p.mana = p.maxMana`. `applyReclaimInput` + reclaim walk-to in `pickupSystem`'s pattern (range 1.0, owner check on input *and* on arrival); on arrival copy every non-null slot into `p.equipment` (slots are empty or player re-equipped — re-equipped slots swap into inventory via `placeItem`, overflow falls to ground at the corpse as `groundItems`), `recomputePlayerStats`, emit `corpse_reclaimed`.

- [ ] **Step 4: Run all sim tests; check the old death-screen path** — old tests asserting `p.dead` persistence get updated to the new rule. `client/main.tsx`: remove any "you died — press n" gating tied to `p.dead` (keep `n` as manual fresh-run). 

- [ ] **Step 5: Commit** — `git commit -am "Corpse runs: death strips gear to a corpse and respawns you in camp"`

---

### Task A6: XP split

**Files:**
- Modify: `sim/systems/xp.ts`, `sim/state.ts` (event field)
- Test: `sim/xp.test.ts`

**Interfaces:**
- `monster_died` event gains `killer: PlayerId | null` (from `m.lastHitBy`, set in A3).
- Produces (in `sim/systems/xp.ts`): `XP_SHARE_RADIUS = 10`, `PARTY_BONUS = 0.35`, `xpShares(state, zone, pos, killer): Map<PlayerId, number>`.

- [ ] **Step 1: Write the failing tests** (extend `sim/xp.test.ts`)

```ts
test("solo killer gets full xp", () => { /* one player, kill via monster_died with xp 12 -> +12 */ });

test("two players in range split with party bonus", () => {
  // xp 100, both within radius: each gets floor(100 / 2 * 1.35) = 67
});

test("killer is included even when out of radius; distant non-killers are not", () => {
  // killer 30 cells away, bystander adjacent: both counted (n=2).
  // third player 30 cells away, not killer: excluded.
});

test("players in other zones never share", () => { /* p1 in camp gets 0 */ });

test("null killer (explosion chain): everyone in radius splits", () => {});
```

Each test constructs the state directly and pushes a synthetic `monster_died` event before calling `xpSystem(state)` — that is the system's actual input channel.

- [ ] **Step 2: Run** — FAIL (current interim rule gives full XP to all).

- [ ] **Step 3: Implement**

```ts
function xpShares(state, zoneId, pos, killer) {
  const eligible = playerIds(state).filter((id) => {
    const p = state.players.get(id)!;
    if (p.zoneId !== zoneId) return false;
    if (id === killer) return true;
    return Math.hypot(p.pos.x - pos.x, p.pos.y - pos.y) <= XP_SHARE_RADIUS;
  });
  const n = eligible.length;
  ...each gets Math.floor(xp / n * (1 + PARTY_BONUS * (n - 1)))
}
```

`xpSystem` accumulates per-player gains across the tick's `monster_died` events, then runs the level-up loop per player (emitting `level_up` with `playerId`, `recomputePlayerStats(state, p)`).

- [ ] **Step 4: Run tests, pass.** **Step 5: Commit** — `git commit -am "XP splits among nearby party members with a grouping bonus"`

---

### Task A7: Full-state snapshot codec

**Files:**
- Create: `net/snapshot.ts`
- Test: `net/snapshot.test.ts`
- Modify: `package.json` (test script → `bun test sim client net`)

**Interfaces:**
- Produces:

```ts
/** JSON string of the entire GameState: Maps as entry arrays, Uint8Array cells as number[], rng as its state word. */
export function serializeGame(state: GameState): string;
export function deserializeGame(raw: string): GameState;   // throws on malformed input
```

- Consumes: `Rng.state()` (A1), `createRng`, all `sim/state.ts` types. `net/` imports from `sim/` only.

- [ ] **Step 1: Write the failing test** (`net/snapshot.test.ts`)

```ts
test("snapshot round-trip: the restored game steps identically to the original", () => {
  const g = createGame(777);
  joinPlayer(g, { id: 0 }); joinPlayer(g, { id: 1 });
  travel(g, g.players.get(0)!, "floor:1");
  for (let t = 0; t < 120; t++) {
    step(g, { tick: g.tick, inputs: t % 5 === 0 ? { 0: { moveTo: { x: 4 + t % 10, y: 4 } } } : {} });
  }
  const copy = deserializeGame(serializeGame(g));
  expect(serializeGame(copy)).toBe(serializeGame(g));
  for (let t = 0; t < 120; t++) {
    const f = { tick: g.tick, inputs: t % 3 === 0 ? { 1: { moveTo: { x: 8, y: 2 } } } : {} };
    step(g, structuredClone(f)); step(copy, structuredClone(f));
  }
  expect(serializeGame(copy)).toBe(serializeGame(g));
});

test("deserialize rejects garbage", () => {
  expect(() => deserializeGame("{}")).toThrow();
});
```

- [ ] **Step 2: Run** — FAIL. 

- [ ] **Step 3: Implement**

Encode: walk `GameState` into a plain object — `rng: state.rng.state()`, `zones: [...state.zones.entries()]` with each zone's Maps as entry arrays and `map.cells: Array.from(cells)`, `players: [...entries]`. Decode: rebuild `Uint8Array`, Maps, `createRng(word)`. A single `SNAPSHOT_VERSION = 1` field checked on decode. No per-field schema validation beyond version + presence of `zones`/`players`/`tick` (the transport is a trusted host).

- [ ] **Step 4: Run `bun test net`** — pass. **Step 5: Commit** — `git commit -am "Full GameState snapshot codec for drop-in join"`

---

## Phase B — Lockstep protocol (`net/`, pure logic)

### Task B1: Frame sequencer (host) and message types

**Files:**
- Create: `net/protocol.ts`, `net/sequencer.ts`
- Test: `net/sequencer.test.ts`

**Interfaces:**
- Produces (`net/protocol.ts`):

```ts
export const INPUT_DELAY_TICKS = 2;
export type ClientMsg =
  | { type: "hello"; character?: string }                       // join request (character = CharacterSave JSON)
  | { type: "input"; tick: number; input: PlayerInput; hash?: number };
export type HostMsg =
  | { type: "welcome"; playerId: PlayerId; snapshot: string; snapshotTick: number }
  | { type: "frame"; frame: Frame }
  | { type: "desync"; tick: number; playerId: PlayerId };
```

- Produces (`net/sequencer.ts`):

```ts
/** Pure host-side frame assembly. The caller owns timers and transport. */
export class Sequencer {
  constructor(hostCharacter?: string);          // seats the host as player 0 via a join in frame 0
  /** Seat a new peer: returns their id and the join that will ride the next frame. Throws when full (4). */
  addPeer(character?: string): PlayerId;
  removePeer(id: PlayerId): void;
  /** Record a peer's input for a tick (latest write wins). */
  onInput(id: PlayerId, tick: number, input: PlayerInput, hash?: number): void;
  /** Assemble the frame for the next tick: inputs received so far, else {}. Advances the tick. */
  nextFrame(): Frame;
  /** Hashes reported for a tick; caller compares and emits desync. */
  hashesFor(tick: number): Map<PlayerId, number>;
}
```

- [ ] **Step 1: Write the failing tests** (`net/sequencer.test.ts`)

```ts
test("host is seated as player 0 in frame 0", () => {
  const s = new Sequencer();
  const f0 = s.nextFrame();
  expect(f0.tick).toBe(0);
  expect(f0.joins).toEqual([{ id: 0, character: undefined }]);
});

test("frames carry received inputs and empty-default missing ones", () => {
  const s = new Sequencer();
  s.nextFrame();
  const id = s.addPeer();
  const f1 = s.nextFrame();
  expect(f1.joins).toEqual([{ id, character: undefined }]);
  s.onInput(0, 2, { drink: true });
  const f2 = s.nextFrame();
  expect(f2.inputs[0]).toEqual({ drink: true });
  expect(f2.inputs[id]).toBeUndefined();       // missing = no input, sim treats as {}
});

test("late input for a past tick is dropped; ids are recycled lowest-first; 5th peer throws", () => {
  const s = new Sequencer();
  s.nextFrame();
  s.onInput(0, 0, { drink: true });            // tick 0 already emitted
  const f = s.nextFrame();
  expect(f.inputs[0]).toBeUndefined();
  const a = s.addPeer(), b = s.addPeer(), c = s.addPeer();
  expect([a, b, c]).toEqual([1, 2, 3]);
  expect(() => s.addPeer()).toThrow();
  s.removePeer(2);
  expect(s.nextFrame().leaves).toEqual([2]);
  expect(s.addPeer()).toBe(2);
});

test("hashes are collected per tick", () => {
  const s = new Sequencer();
  s.nextFrame();
  s.onInput(0, 5, {}, 0xabc);
  expect(s.hashesFor(5).get(0)).toBe(0xabc);
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** exactly per the tests (internal: `tick` counter, `pending: Map<tick, Map<id, PlayerInput>>` pruned as frames emit, `seats: Set<PlayerId>`, queued joins/leaves arrays drained into the next frame). **Step 4: `bun test net` pass.** **Step 5: Commit** — `git commit -am "Lockstep sequencer: host-side frame assembly"`

---

### Task B2: Client session (frame buffer) and state hash

**Files:**
- Create: `net/session.ts`, `net/hash.ts`
- Test: `net/session.test.ts`, `net/hash.test.ts`

**Interfaces:**
- Produces (`net/hash.ts`):

```ts
/** Cheap desync tripwire: FNV-1a over tick, each player's (id, zoneId, x, y, life, gold), each zone's monster count. Positions via Math.round(v * 256). */
export function stateHash(state: GameState): number;
export const HASH_EVERY_TICKS = 50;   // ~2 s
```

- Produces (`net/session.ts`):

```ts
/** Client-side lockstep driver: buffers HostMsg frames, steps the sim when the next frame is available. Transport-agnostic. */
export class Session {
  constructor(onSend: (msg: ClientMsg) => void);
  /** Welcome handling: builds state from the snapshot; returns local PlayerId. */
  onHostMsg(msg: HostMsg): void;
  state: GameState | null;               // null until welcome
  localId: PlayerId | null;
  desyncAt: number | null;               // set when a desync msg arrives
  /** Queue local input; sent stamped for currentTick + INPUT_DELAY_TICKS, with a hash every HASH_EVERY_TICKS. */
  sendInput(input: PlayerInput): void;
  /** Step once if the next frame is buffered. Returns whether it stepped. */
  tryStep(): boolean;
  /** How many frames are buffered ahead (render pacing signal). */
  buffered(): number;
}
```

- [ ] **Step 1: Write the failing tests**

`net/hash.test.ts`:

```ts
test("identical states hash identically; a moved player changes the hash", () => {
  const a = createGame(3), b = createGame(3);
  joinPlayer(a, { id: 0 }); joinPlayer(b, { id: 0 });
  expect(stateHash(a)).toBe(stateHash(b));
  a.players.get(0)!.pos.x += 1;
  expect(stateHash(a)).not.toBe(stateHash(b));
});
```

`net/session.test.ts` — drive a `Sequencer` + two `Session`s over in-memory function transports for 200 ticks with scripted inputs; assert (a) both sessions step every tick frames are available, (b) `serializeGame` of both sessions' states are identical at the end, (c) a third session joining at tick 100 via `addPeer` + `welcome{snapshot: serializeGame(hostSession.state), snapshotTick}` converges: after all sessions drain, all three serialize identically. Also: `tryStep` returns false when the buffer is empty; inputs are stamped `currentTick + INPUT_DELAY_TICKS`; a `hash` rides every `HASH_EVERY_TICKS`-th input message.

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** (`frames: Map<tick, Frame>`; `tryStep` looks up `state.tick`, steps, deletes). The host's own client is just another `Session` fed by a loopback transport — no special casing. **Step 4: `bun test net` pass.** **Step 5: Commit** — `git commit -am "Lockstep session: frame buffering, input delay, desync tripwire"`

---

## Phase C — Signaling and WebRTC

### Task C1: Signaling server

**Files:**
- Create: `signal/server.ts`, `signal/README.md`
- Test: `signal/server.test.ts`
- Modify: `package.json` (scripts: `"signal": "bun signal/server.ts"`, test script → `bun test sim client net signal`)

**Interfaces:**
- Protocol (JSON over WebSocket):
  - client→server: `{ type: "host" }` · `{ type: "join"; code: string }` · `{ type: "signal"; to: number; payload: unknown }` (payload = SDP/ICE blob, relayed verbatim)
  - server→client: `{ type: "room"; code: string }` · `{ type: "joined"; peerId: number }` (to host, announcing a joiner) · `{ type: "signal"; from: number; payload: unknown }` · `{ type: "error"; reason: "no-such-room" | "room-closed" }`
- Rooms: 5-char code from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (`Math.random` is fine — server code, not sim). Host socket closes ⇒ room deleted, peers get `room-closed`. `PORT` env, default 5200.

- [ ] **Step 1: Write the failing test** (`signal/server.test.ts` — start the server on an ephemeral port in `beforeAll`, real `WebSocket` clients)

```ts
test("host gets a room code; joiner and host relay signals both ways", async () => {
  const host = await connect();                       // helper: open ws, promisify messages
  host.send({ type: "host" });
  const { code } = await host.next("room");
  const peer = await connect();
  peer.send({ type: "join", code });
  const { peerId } = await host.next("joined");
  peer.send({ type: "signal", to: 0, payload: { sdp: "offer" } });
  expect((await host.next("signal")).payload).toEqual({ sdp: "offer" });
  host.send({ type: "signal", to: peerId, payload: { sdp: "answer" } });
  expect((await peer.next("signal")).payload).toEqual({ sdp: "answer" });
});

test("joining a nonexistent room errors; host disconnect closes the room", async () => { ... });
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** with `Bun.serve({ websocket })`: `rooms: Map<code, { host: ServerWebSocket; peers: Map<number, ServerWebSocket>; nextPeer: number }>`; host is address 0. `signal/README.md`: one paragraph — run locally with `bun run signal`; deploy anywhere that runs Bun/WebSockets (e.g. `fly launch` in `signal/`); client reads the URL from `VITE_SIGNAL_URL` (C2). **Step 4: `bun test signal` pass.** **Step 5: Commit** — `git commit -am "Signaling server: room codes and SDP/ICE relay"`

---

### Task C2: WebRTC plumbing

**Files:**
- Create: `client/net/rtc.ts`
- Test: none automated (browser API); verified end-to-end in D4.

**Interfaces:**
- Produces:

```ts
export interface PeerLink {
  send(msg: object): void;                       // JSON over the DataChannel; chunks >64KB payloads (snapshots) as {type:"chunk", ...} frames reassembled on receive
  onMessage(cb: (msg: any) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}
/** Open a room, resolve links as peers join. */
export function hostGame(signalUrl: string, onPeer: (link: PeerLink) => void): Promise<{ code: string; stop(): void }>;
/** Join a room by code; resolves once the DataChannel to the host is open. */
export function joinGame(signalUrl: string, code: string): Promise<PeerLink>;
```

- ICE: `{ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }`. DataChannel `"game"`, defaults (ordered, reliable). `VITE_SIGNAL_URL` default `ws://localhost:5200`.

- [ ] **Step 1: Implement** the standard perfect-negotiation-lite flow: host creates an `RTCPeerConnection` per `joined` peer, sends the offer via the C1 relay, joiner answers; both trickle ICE through `signal` messages. Chunking: split strings at 60_000 chars into `{ type: "chunk", id, i, n, data }`, reassemble before dispatch.
- [ ] **Step 2: Typecheck** — `bun run build`. Manual smoke happens in D4. 
- [ ] **Step 3: Commit** — `git commit -am "WebRTC host/join plumbing over the signaling relay"`

---

## Phase D — Client

### Task D1: Net driver + main loop rework

**Files:**
- Create: `client/net/driver.ts`
- Modify: `client/main.tsx`
- Test: `client/net/driver.test.ts` (LocalDriver only — the pure one)

**Interfaces:**
- Produces (`client/net/driver.ts`):

```ts
/** What main.tsx talks to; hides solo vs host vs joined. */
export interface NetDriver {
  readonly session: Session;        // from net/session.ts — state, localId, tryStep, buffered
  sendInput(input: PlayerInput): void;
  stop(): void;
}
/** Solo: an in-process Sequencer wired straight into the Session. One frame per requested tick. */
export function localDriver(seed: number, character?: string): NetDriver;
/** Host: Sequencer + rtc.hostGame; emits frames on a 25 Hz interval; serves welcome snapshots. */
export function hostDriver(seed: number, signalUrl: string, character?: string): Promise<{ driver: NetDriver; code: string }>;
/** Joiner: rtc.joinGame; sends hello, awaits welcome. */
export function joinDriver(signalUrl: string, code: string, character?: string): Promise<NetDriver>;
```

- `localDriver` internals double as the reference wiring: `Sequencer` seeded with the character, `nextFrame()` invoked exactly when the main loop wants a tick, fed to `session.onHostMsg({ type: "frame", frame })`. Host/join drivers reuse it with `PeerLink`s attached; host pumps `nextFrame()` on `setInterval(1000 / TICK_RATE)` and answers `hello` with `{ welcome, snapshot: serializeGame(session.state), snapshotTick }` + `sequencer.addPeer`.
- `main.tsx` rework: game creation moves behind a **mode choice** (solo / host / join — UI in D3; until D3, auto-solo). The fixed-timestep loop becomes: accumulate as today; per tick, `driver.sendInput(pending)` then `driver.session.tryStep()`; render interpolates only when a step happened (when starved — waiting on frames — render the last state; when `buffered() > 4`, run extra `tryStep`s per frame to catch up). Event handling filters by `localId` and local zone (`e.playerId === localId` for player events; `e.zone === localPlayer.zoneId` for spatial ones). Character save: on interval + unload, `serializeCharacter(state, localId)` — unchanged shape, still per-browser.

- [ ] **Step 1: Write the failing test** — `localDriver`: 100 requested ticks ⇒ `session.state.tick === 100`, player 0 exists, a `sendInput({ drink: true })` on tick 3 is applied at tick `3 + INPUT_DELAY_TICKS`.
- [ ] **Step 2: Run — FAIL. Implement localDriver + the pure parts of host/join.**
- [ ] **Step 3: Rework `main.tsx`** per above; solo play must feel identical (the 2-tick input delay at 25 Hz = 80 ms; acceptable, matches spec).
- [ ] **Step 4: `bun test sim client net signal && bun run build`; play solo.** 
- [ ] **Step 5: Commit** — `git commit -am "Net drivers: solo/host/join behind one interface; frame-driven main loop"`

---

### Task D2: Renderer — remote heroes, zone filtering, portals, corpses

**Files:**
- Modify: `client/render/scene.ts`, `client/render/rigs.ts` (or `modelRigs.ts`, matching how the hero rig is built today), `client/ui/MiniMap.tsx`

**Interfaces:**
- `createScene(mount, map, assets, onItemClick)` unchanged; `scene.render(game, prevPositions, alpha, localId)` — `prevPositions: Map<PlayerId, Vec>` replaces the single `prevPlayerPos` (main.tsx captures all players' positions pre-step each tick).
- `scene.pick` gains cases: `{ kind: "portal"; id: number }`, `{ kind: "corpse"; id: number }` → main.tsx maps to `usePortal` / `reclaim` inputs.

- [ ] **Step 1: Hero pool** — maintain rigs keyed by `PlayerId` for players whose `zoneId === localPlayer.zoneId`; create/dispose as players enter/leave the zone. Tint: `PLAYER_TINTS = [0xd8cfa8, 0x9ad1f5, 0xa8d8a8, 0xd8a8c8][id]` applied to the rig's primary material. Nameplate: reuse the damage-number sprite path with a persistent sprite ("P2" etc.; real names are out of scope).
- [ ] **Step 2: Zone scoping** — `render`/`updateHover`/`pick` read all entity collections from `getZone(game, localPlayer.zoneId)`; the D1 map-swap rebuild already handles zone changes.
- [ ] **Step 3: Portal + corpse meshes** — portal: a flat glowing ring (torus, emissive `0x7fb8c9`) at each `zone.portals` entry; corpse: reuse the hero mesh laid flat with the owner's tint, only rendered for `zone.playerCorpses`. Both raycastable with ids for `pick`.
- [ ] **Step 4: MiniMap** — draw party members in the local zone as tinted dots.
- [ ] **Step 5: Verify by playing solo** (portals visible and clickable both ends; corpse appears on death, reclaim works by clicking). `bun run build` green. Commit — `git commit -am "Renderer: party heroes, zone-scoped drawing, portal and corpse objects"`

---

### Task D3: HUD — lobby, party strip, toasts

**Files:**
- Create: `client/ui/Lobby.tsx`, `client/ui/PartyStrip.tsx`, `client/ui/Toasts.tsx`
- Modify: `client/main.tsx`

- [ ] **Step 1: Lobby** — pre-game overlay (replaces auto-start): "Play solo" / "Host game" / room-code input + "Join". Host shows the code + copyable `${location.origin}${location.pathname}?join=CODE` link once `hostDriver` resolves; game starts immediately for the host (drop-in means no waiting room). `?join=CODE` in the URL pre-fills and auto-joins. Signal-server failure or `joinGame` rejection renders the error inline with a retry. Styling: match the existing loading-screen monospace look.
- [ ] **Step 2: PartyStrip** — top-left column of party members from `game.players` (skip local): tint swatch, "P{id+1}", life bar (`life/maxLife`), zone label (`zoneName(zoneDepth(zoneId))`, greyed when ≠ local zone). Re-renders off the existing HUD heartbeat.
- [ ] **Step 3: Toasts** — small stack, 4-second fade, fed from events in main.tsx: `player_joined` ("P2 joined"), `player_left`, `player_died` ("P2 fell on floor 3"), `portal_cast`, desync (`session.desyncAt` ⇒ persistent red "desync detected — restart the game"). Host-left (driver `onClose`) ⇒ full-screen "host left" overlay with a reload button.
- [ ] **Step 4: Play solo through the lobby; `bun run build`.** Commit — `git commit -am "HUD: lobby, party strip, and multiplayer toasts"`

---

### Task D4: End-to-end verification

**Files:** none (verification; fix what it finds).

- [ ] **Step 1:** `bun run signal` + `bun run dev`; open two browser windows (one incognito — separate localStorage characters). Host in one; join by code in the other.
- [ ] **Step 2: Verify the checklist:** joiner appears in camp with their saved character · both descend via the pad and see each other move/fight in real time · monsters engage the nearest hero · a kill near both grants split XP (compare character panels) · FFA loot: both click one drop, exactly one gets it · P1 casts a portal, P2 rides it both ways · P2 dies: gear-stripped respawn in camp, corpse visible to P1 but only P2 can reclaim · third window drop-in mid-fight lands in camp with the world mid-state · closing the joiner window toasts "left" for the host; closing the host shows "host left" to joiners · 10 minutes of play with no desync toast.
- [ ] **Step 3:** `bun test sim client net signal && bun run build` one final time.
- [ ] **Step 4: Commit** any fixes — `git commit -am "Multiplayer end-to-end fixes from two-window verification"`

---

## Deliberately deferred (spec-consistent)

Host migration, TURN, desync recovery, corpse-run penalties beyond gear, player names, chat, GitHub Pages signal-URL wiring for the deployed build (needs the C1 server deployed somewhere first — do it when deploying).
