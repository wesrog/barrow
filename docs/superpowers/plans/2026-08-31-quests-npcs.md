# Quests & NPCs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An authored 9-quest campaign delivered by NPCs standing in the world — kill, collect, reach, and talk objectives, per-player state that saves with the character, deterministic under lockstep multiplayer.

**Architecture:** NPCs become first-class entities (`ZoneState.npcs`) spawned from a plain data table; quests are rows in a second table. All quest interaction flows through new `PlayerInput` fields; a `questProgressSystem` advances objectives off the existing `SimEvent` stream. The old `vendorTarget`/`healerTarget` booleans fold into one generalized `npcTarget` walk-to. The client renders NPC rigs with overhead quest indicators, opens a DialoguePanel on `npc_talk`, and shows a corner quest tracker.

**Tech Stack:** TypeScript, bun test, Three.js + React (client). Sim stays pure: no three/react/DOM imports under `sim/`, all randomness through `state.rng`.

**Spec:** `docs/superpowers/specs/2026-08-31-quests-npcs-design.md`

## Global Constraints

- `sim/` never imports three, react, or the DOM.
- All randomness through the seeded RNG (`state.rng`); identical draws on every peer.
- TDD: failing test first for every sim change. Run tests with `bun test sim` (or a single file: `bun test sim/quests.test.ts`).
- Type-only circular imports (`import type`) between `sim/npcs.ts`, `sim/quests.ts`, and `sim/state.ts` are fine; value cycles are not.
- Commit after each task. Typecheck with `bun run build` before the final commit of each sim task.
- D2 shapes, our numbers. Nothing copied from Blizzard.

## File Map

- Create: `sim/npcs.ts` (NPC table + entity type), `sim/quests.ts` (quest table + pure helpers), `sim/systems/quests.ts` (inputs + systems), `sim/quests.test.ts`, `sim/npcs.test.ts`, `client/ui/DialoguePanel.tsx`, `client/ui/QuestTracker.tsx`
- Modify: `sim/state.ts`, `sim/tick.ts`, `sim/world.ts`, `sim/systems/town.ts`, `sim/systems/combat.ts`, `sim/systems/movement.ts`, `sim/systems/inventory.ts`, `sim/systems/xp.ts`, `sim/items/bases.ts`, `sim/save.ts`, `sim/town.test.ts`, `client/render/scene.ts`, `client/main.tsx`, `client/ui/MiniMap.tsx`

---

### Task 1: NPC table and world spawning

**Files:**
- Create: `sim/npcs.ts`, `sim/npcs.test.ts`
- Modify: `sim/state.ts` (ZoneState), `sim/world.ts` (ensureSurface)

**Interfaces:**
- Produces: `NpcId`, `NpcDef`, `NPCS: Record<NpcId, NpcDef>`, `isNpcId(s: string): s is NpcId`, `Npc { id: number; npcId: NpcId; pos: Vec }`, `ZoneState.npcs: Map<number, Npc>`.
- NPC def `pos` is **area-local**; the spawned entity `pos` is **world** coordinates (area pos + `surfaceLayout().offsets[area]`), nudged onto walkable ground with `nearestWalkable`.

- [ ] **Step 1: Write the failing test** in `sim/npcs.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createGame } from "./tick";
import { getZone } from "./state";
import { NPCS, isNpcId, type NpcId } from "./npcs";
import { isWalkable } from "./map";
import { areaRect, inRect } from "./surface";

describe("npcs", () => {
  test("every NPC def spawns on the surface, walkable, inside its area", () => {
    const state = createGame(123);
    const surface = getZone(state, "surface");
    const spawned = [...surface.npcs.values()];
    expect(spawned.length).toBe(Object.keys(NPCS).length);
    for (const npc of spawned) {
      const def = NPCS[npc.npcId];
      expect(isWalkable(surface.map, Math.floor(npc.pos.x), Math.floor(npc.pos.y))).toBe(true);
      expect(inRect(areaRect(def.area), npc.pos)).toBe(true);
    }
  });

  test("npc ids validate", () => {
    expect(isNpcId("maren")).toBe(true);
    expect(isNpcId("bogus")).toBe(false);
  });

  test("same seed spawns npcs at identical spots", () => {
    const a = getZone(createGame(7), "surface");
    const b = getZone(createGame(7), "surface");
    expect([...a.npcs.values()]).toEqual([...b.npcs.values()]);
  });
});
```

- [ ] **Step 2: Run** `bun test sim/npcs.test.ts` — expect FAIL (module `./npcs` not found).

- [ ] **Step 3: Implement.** `sim/npcs.ts` (quests lists are filled in Task 8; start them as shown):

```ts
import type { AreaId } from "./areas";
import type { Vec } from "./map";
import type { QuestId } from "./quests";

export type NpcId = "maren" | "sera" | "betha" | "corvin" | "aldous";

/** One NPC as data: content growth is new rows here, not new code. `pos` is
 * area-local (like AreaDef.markers); spawning translates to world coords. */
export interface NpcDef {
  id: NpcId;
  name: string;
  title: string;
  area: AreaId;
  pos: Vec;
  /** Offered in chain order, one at a time. Filled in by the campaign task. */
  quests: QuestId[];
  /** Lines when they have nothing for you. */
  idle: string[];
}

export const NPCS: Record<NpcId, NpcDef> = {
  maren: {
    id: "maren", name: "Maren", title: "Camp Trader", area: "overworld",
    pos: { x: 4.5, y: 29.5 }, // the V marker's spot
    quests: [], idle: ["Buying or selling, it's all the same coin."],
  },
  sera: {
    id: "sera", name: "Sera", title: "Camp Healer", area: "overworld",
    pos: { x: 4.5, y: 35.5 }, // the H marker's spot
    quests: [], idle: ["Hold still. There. Good as dawn."],
  },
  betha: {
    id: "betha", name: "Odd Betha", title: "Hermit of the Redfen", area: "redfen",
    pos: { x: 42.5, y: 22.5 },
    quests: [], idle: ["The fen keeps what it takes."],
  },
  corvin: {
    id: "corvin", name: "Corvin", title: "Last of the Ninth", area: "gallowmire",
    pos: { x: 30.5, y: 22.5 },
    quests: [], idle: ["Keep your voice down. They hear everything here."],
  },
  aldous: {
    id: "aldous", name: "Aldous", title: "Sentinel of the Barrow", area: "overworld",
    pos: { x: 55.5, y: 53.5 }, // beside the barrow mouth ('>' at 58.5,56.5)
    quests: [], idle: ["None who went down have come back up. Yet."],
  },
};

export const NPC_IDS = Object.keys(NPCS) as NpcId[];

export function isNpcId(s: string): s is NpcId {
  return s in NPCS;
}

/** An NPC standing in a zone. Static in v1: no moving, fighting, or dying. */
export interface Npc {
  id: number;
  npcId: NpcId;
  pos: Vec;
}
```

Note: `import type { QuestId } from "./quests"` won't resolve until Task 2 creates the module. For this task only, declare `type QuestId = string` locally with a `// replaced by ./quests in the next task` comment, OR create Task 2's `sim/quests.ts` skeleton first. Prefer the local alias; Task 2 swaps it.

In `sim/state.ts`: add to `ZoneState`:

```ts
import type { Npc } from "./npcs";
// ...
export interface ZoneState {
  // ...existing fields...
  npcs: Map<number, Npc>;
}
```

In `sim/world.ts` `makeZone`: add `npcs: new Map(),` to the literal. In `ensureSurface`, after the breakables loop:

```ts
import { NPCS, NPC_IDS } from "./npcs";
import { nearestWalkable } from "./map";
import { surfaceLayout } from "./surface";
// ...
  // NPCs: fixed spots from the registry, nudged onto this seed's walkable ground.
  const offsets = surfaceLayout().offsets;
  for (const npcId of NPC_IDS) {
    const def = NPCS[npcId];
    const o = offsets[def.area];
    const want = { x: def.pos.x + o.x, y: def.pos.y + o.y };
    const spot = nearestWalkable(zone.map, want) ?? want;
    zone.npcs.set(state.nextId++, { id: state.nextId - 1, npcId, pos: spot });
  }
```

(Use `const id = state.nextId++;` then `zone.npcs.set(id, { id, npcId, pos: spot });` — clearer than the post-decrement read.)

- [ ] **Step 4: Run** `bun test sim/npcs.test.ts` — expect PASS. Then `bun test sim` — the full sim suite must stay green (`makeZone` literal change touches every zone test).

- [ ] **Step 5: Commit** `git add -A sim && git commit -m "NPCs stand in the world as entities spawned from a data table"`

---

### Task 2: Quest table, player quest log, pure helpers

**Files:**
- Create: `sim/quests.ts`, `sim/quests.test.ts`
- Modify: `sim/npcs.ts` (swap the QuestId alias for the real import), `sim/state.ts` (Player), `sim/tick.ts` (joinPlayer)

**Interfaces:**
- Produces: `QuestId`, `QuestObjective`, `QuestDef`, `QUESTS`, `QUEST_IDS`, `isQuestId`, `QuestProgress { stage: "active" | "done"; count: number }`, `QuestLog = Partial<Record<QuestId, QuestProgress>>`, `Player.quests: QuestLog`.
- Pure helpers consumed by sim systems and the client:
  - `questOffered(p: Player, npcId: NpcId): QuestId | null` — first quest in the NPC's list not yet started whose `requires` is done.
  - `questReadyToTurnIn(p: Player, npcId: NpcId): QuestId | null` — an active quest with `turnIn === npcId` whose objective is met.
  - `questActiveAt(p: Player, npcId: NpcId): QuestId | null` — an active quest given or turned in by this NPC, not yet met (for "in progress" dialogue).
  - `objectiveMet(p: Player, id: QuestId): boolean`
  - `collectCount(p: Player, baseId: string): number` — matching inventory entries (collect progress is derived from the pack, never a counter).
  - `npcIndicator(p: Player, npcId: NpcId): "offer" | "turnin" | "progress" | null`

- [ ] **Step 1: Write the failing test** in `sim/quests.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createGame, joinPlayer } from "./tick";
import {
  QUESTS, isQuestId, questOffered, questReadyToTurnIn, objectiveMet, npcIndicator,
} from "./quests";
import { NPCS } from "./npcs";

const hero = () => joinPlayer(createGame(1), { id: 0 });

describe("quest tables", () => {
  test("every quest's giver and turnIn list it, and requires chains resolve", () => {
    for (const q of Object.values(QUESTS)) {
      expect(NPCS[q.giver].quests).toContain(q.id);
      if (q.requires) expect(isQuestId(q.requires)).toBe(true);
    }
  });

  test("a fresh hero is offered the giver's first quest and no other", () => {
    const p = hero();
    const first = NPCS.maren.quests[0]!;
    expect(questOffered(p, "maren")).toBe(first);
    expect(questOffered(p, "betha")).toBe(null); // gated behind the chain
  });

  test("kill objective: met exactly at the count", () => {
    const p = hero();
    const id = NPCS.maren.quests[0]!; // a kill quest (campaign task guarantees it)
    const need = QUESTS[id].objective.kind === "kill" ? QUESTS[id].objective.count : 0;
    p.quests[id] = { stage: "active", count: need - 1 };
    expect(objectiveMet(p, id)).toBe(false);
    p.quests[id]!.count = need;
    expect(objectiveMet(p, id)).toBe(true);
    expect(questReadyToTurnIn(p, QUESTS[id].turnIn)).toBe(id);
  });

  test("indicator reflects offer, progress, turn-in, and silence", () => {
    const p = hero();
    expect(npcIndicator(p, "maren")).toBe("offer");
    const id = NPCS.maren.quests[0]!;
    p.quests[id] = { stage: "active", count: 0 };
    expect(npcIndicator(p, "maren")).toBe("progress");
    expect(npcIndicator(p, "sera")).toBe(null); // her quest requires maren's
  });
});
```

- [ ] **Step 2: Run** `bun test sim/quests.test.ts` — FAIL (module not found).

- [ ] **Step 3: Implement** `sim/quests.ts`. The full campaign rows land in Task 8; this task ships the engine plus two real starter rows so the tests bite (kill + collect):

```ts
import type { AreaId } from "./areas";
import type { NpcId } from "./npcs";
import type { Rarity } from "./items/generate";
import type { Player, ZoneId } from "./state";
import { zoneDepth } from "./state";
import { NPCS } from "./npcs";

export type QuestId =
  | "moor_wights" | "grave_moss" | "find_redfen"
  | "meet_betha" | "howler_cull" | "fen_hearts"
  | "soldiers_due" | "descend_barrow" | "barrow_lord";

export type QuestObjective =
  | { kind: "kill"; typeId: string; count: number; zone?: ZoneId }
  | { kind: "collect"; itemBaseId: string; count: number; dropFrom: string; chance: number }
  | { kind: "reach"; area?: AreaId; floor?: number }
  | { kind: "talk"; npc: NpcId };

export interface QuestDef {
  id: QuestId;
  giver: NpcId;
  turnIn: NpcId;
  name: string;
  requires?: QuestId;
  objective: QuestObjective;
  dialogue: { offer: string[]; progress: string[]; done: string[] };
  reward: { gold?: number; xp?: number; item?: { baseId: string; rarity: Rarity } };
}

export const QUESTS: Record<QuestId, QuestDef> = {
  moor_wights: {
    id: "moor_wights", giver: "maren", turnIn: "maren", name: "The Restless Dead",
    objective: { kind: "kill", typeId: "shambler", count: 8, zone: "surface" },
    dialogue: {
      offer: ["The dead won't stay put on these moors.", "Put eight of the shamblers down and I'll make it worth your while."],
      progress: ["Still shuffling out there, are they?"],
      done: ["That's eight fewer groans in the night. Here."],
    },
    reward: { gold: 100, xp: 80 },
  },
  grave_moss: {
    id: "grave_moss", giver: "sera", turnIn: "sera", name: "Grave-Moss",
    requires: "moor_wights",
    objective: { kind: "collect", itemBaseId: "grave_moss", count: 5, dropFrom: "shambler", chance: 0.5 },
    dialogue: {
      offer: ["The moss that grows on the walking dead — foul stuff, but it draws fever out.", "Bring me five clumps."],
      progress: ["Check the ones you fell. It grows at the collar."],
      done: ["Five, and still damp. The camp owes you."],
    },
    reward: { gold: 120, xp: 100 },
  },
  // ...remaining seven rows land with the campaign task...
} as Record<QuestId, QuestDef>;

export const QUEST_IDS = Object.keys(QUESTS) as QuestId[];

export function isQuestId(s: string): s is QuestId {
  return s in QUESTS;
}

export interface QuestProgress {
  stage: "active" | "done";
  count: number;
}

export type QuestLog = Partial<Record<QuestId, QuestProgress>>;

/** Matching entries in the pack — collect progress is derived, never counted. */
export function collectCount(p: Player, baseId: string): number {
  return p.inventory.entries.filter((e) => e.item.baseId === baseId).length;
}

export function objectiveMet(p: Player, id: QuestId): boolean {
  const q = QUESTS[id];
  const prog = p.quests[id];
  if (!prog || prog.stage !== "active") return false;
  const o = q.objective;
  switch (o.kind) {
    case "kill": return prog.count >= o.count;
    case "collect": return collectCount(p, o.itemBaseId) >= o.count;
    case "reach":
      if (o.floor !== undefined) return p.zoneId !== "surface" && zoneDepth(p.zoneId) >= o.floor;
      return p.zoneId === "surface" && p.region === o.area;
    case "talk": return prog.count >= 1;
  }
}

export function questOffered(p: Player, npcId: NpcId): QuestId | null {
  for (const id of NPCS[npcId].quests) {
    if (p.quests[id]) continue; // started or done
    const req = QUESTS[id].requires;
    if (req && p.quests[req]?.stage !== "done") return null; // chain waits here
    return id;
  }
  return null;
}

export function questReadyToTurnIn(p: Player, npcId: NpcId): QuestId | null {
  for (const id of QUEST_IDS) {
    if (QUESTS[id].turnIn !== npcId) continue;
    if (p.quests[id]?.stage === "active" && objectiveMet(p, id)) return id;
  }
  return null;
}

export function questActiveAt(p: Player, npcId: NpcId): QuestId | null {
  for (const id of QUEST_IDS) {
    const q = QUESTS[id];
    if (q.giver !== npcId && q.turnIn !== npcId) continue;
    if (p.quests[id]?.stage === "active" && !objectiveMet(p, id)) return id;
  }
  return null;
}

/** What floats over an NPC's head, for this player: ! / ? / grey-? / nothing. */
export function npcIndicator(p: Player, npcId: NpcId): "offer" | "turnin" | "progress" | null {
  if (questReadyToTurnIn(p, npcId)) return "turnin";
  if (questOffered(p, npcId)) return "offer";
  if (questActiveAt(p, npcId)) return "progress";
  return null;
}
```

In `sim/npcs.ts`: replace the temporary `QuestId` alias with `import type { QuestId } from "./quests";` and set `maren.quests = ["moor_wights", "find_redfen"]`, `sera.quests = ["grave_moss"]` (list ids freely — `find_redfen` etc. join the union now even though their rows land in Task 8; **add all nine ids to the `QuestId` union in this task** and keep `QUESTS` partially populated via the `as Record<...>` cast until Task 8 completes it. Tests in this task must only reference the two real rows).

In `sim/state.ts`: add to `Player`:

```ts
import type { QuestLog } from "./quests";
// ...
  /** Per-hero quest log; absent key = never started. Saves with the character. */
  quests: QuestLog;
```

In `sim/tick.ts` `joinPlayer`: add `quests: {},` to the Player literal.

- [ ] **Step 4: Run** `bun test sim/quests.test.ts`, then `bun test sim` — PASS.

- [ ] **Step 5: Commit** `git add -A sim && git commit -m "Quest table, per-player quest log, and pure quest-state helpers"`

---

### Task 3: Generalized NPC walk-to (npcTarget replaces vendorTarget/healerTarget)

**Files:**
- Create: `sim/systems/quests.ts`
- Modify: `sim/state.ts`, `sim/tick.ts`, `sim/systems/town.ts`, `sim/systems/combat.ts`, `sim/systems/movement.ts`, `sim/town.test.ts`

**Interfaces:**
- Consumes: `Npc`, `ZoneState.npcs` (Task 1).
- Produces: `PlayerInput.talkNpc?: number` (npc **entity** id); `Player.npcTarget: number | null`; events `{ type: "npc_talk"; playerId: PlayerId; npcId: NpcId }`; exported `applyTalkNpcInput(state, p, input)` and `npcSystem(state, zone, players)` from `sim/systems/quests.ts`; `NPC_TALK_RANGE = 1.4`.
- **Removes**: `Player.vendorTarget`, `Player.healerTarget`, `PlayerInput.talkVendor`, `PlayerInput.talkHealer`, `applyTalkVendorInput`, `applyTalkHealerInput`, `vendorSystem`, `healerSystem`, and the `shop_opened` / `healer_opened` events. Arrival at Maren keeps restocking nothing (restock is camp-arrival, unchanged); arrival at Sera still fully heals (the `healed` event stays). The client opens shop/healer panels from `npc_talk` (Task 9/10).

- [ ] **Step 1: Write the failing test.** Extend `sim/town.test.ts` (and delete its `talkVendor`/`shop_opened`-flow assertions in the same edit — walk-up-to-shop now goes through `talkNpc`):

```ts
import { NPC_TALK_RANGE, } from "./systems/quests"; // adjust import list as needed

test("clicking an npc walks over and opens talk", () => {
  const state = createGame(5);
  const p = joinPlayer(state, { id: 0 });
  const surface = getZone(state, "surface");
  const maren = [...surface.npcs.values()].find((n) => n.npcId === "maren")!;
  p.pos = { x: maren.pos.x + 3, y: maren.pos.y };
  stepSolo(state, { talkNpc: maren.id });
  // walk until within range (bounded loop so a pathing bug fails, not hangs)
  for (let i = 0; i < 200 && !state.events.some((e) => e.type === "npc_talk"); i++) {
    stepSolo(state, {});
  }
  const talk = state.events.find((e) => e.type === "npc_talk");
  expect(talk).toMatchObject({ playerId: 0, npcId: "maren" });
  expect(Math.hypot(p.pos.x - maren.pos.x, p.pos.y - maren.pos.y)).toBeLessThanOrEqual(NPC_TALK_RANGE + 0.01);
});

test("arriving at sera heals in full", () => {
  const state = createGame(5);
  const p = joinPlayer(state, { id: 0 });
  const surface = getZone(state, "surface");
  const sera = [...surface.npcs.values()].find((n) => n.npcId === "sera")!;
  p.pos = { x: sera.pos.x + 0.5, y: sera.pos.y };
  p.life = 1;
  stepSolo(state, { talkNpc: sera.id });
  stepSolo(state, {});
  expect(p.life).toBe(p.maxLife);
});
```

- [ ] **Step 2: Run** `bun test sim/town.test.ts` — FAIL.

- [ ] **Step 3: Implement.** New `sim/systems/quests.ts`:

```ts
import { NPCS } from "../npcs";
import { findPath, smoothPath } from "../path";
import type { GameState, Player, PlayerInput, ZoneState } from "../state";

/** How close you must stand before an NPC will talk. */
export const NPC_TALK_RANGE = 1.4;

/** Click an NPC: start walking over for a word. */
export function applyTalkNpcInput(state: GameState, p: Player, input: PlayerInput): void {
  if (input.talkNpc === undefined) return;
  const zone = state.zones.get(p.zoneId);
  if (!zone?.npcs.has(input.talkNpc)) return;
  p.npcTarget = input.talkNpc;
  p.attackTarget = null;
  p.pickupTarget = null;
  p.smashTarget = null;
  p.portalTarget = null;
  p.reclaimTarget = null;
  p.path = [];
}

/** Walk toward the targeted NPC; within range, the conversation opens.
 * Sera also mends in full — her trade since the camp's founding. */
export function npcSystem(state: GameState, zone: ZoneState, players: Player[]): void {
  for (const p of players) {
    if (p.npcTarget === null) continue;
    const npc = zone.npcs.get(p.npcTarget);
    if (!npc) { p.npcTarget = null; continue; }
    const d = Math.hypot(p.pos.x - npc.pos.x, p.pos.y - npc.pos.y);
    if (d <= NPC_TALK_RANGE) {
      p.npcTarget = null;
      p.path = [];
      if (npc.npcId === "sera") {
        p.life = p.maxLife;
        p.mana = p.maxMana;
        state.events.push({ type: "healed", playerId: p.id });
      }
      state.events.push({ type: "npc_talk", playerId: p.id, npcId: npc.npcId });
    } else if (p.path.length === 0) {
      const cells = findPath(
        zone.map,
        { x: Math.floor(p.pos.x), y: Math.floor(p.pos.y) },
        { x: Math.floor(npc.pos.x), y: Math.floor(npc.pos.y) },
      );
      if (cells === null) { p.npcTarget = null; continue; }
      p.path = smoothPath(zone.map, p.pos, cells);
      p.path.push({ x: npc.pos.x, y: npc.pos.y });
    }
  }
}
```

Mechanical sweep (grep `vendorTarget\|healerTarget\|talkVendor\|talkHealer\|shop_opened\|healer_opened` across `sim/` and fix every site):

- `sim/state.ts`: on `Player`, replace the two booleans with `npcTarget: number | null;` (doc: `/** NPC entity id being walked to for a word, if any. */`). On `PlayerInput`, replace `talkVendor`/`talkHealer` with `/** NPC entity id to walk to and talk with. */ talkNpc?: number;`. Delete the `shop_opened` and `healer_opened` variants from `SimEvent`; add `{ type: "npc_talk"; playerId: PlayerId; npcId: NpcId }` (`import type { NpcId } from "./npcs";`).
- `sim/systems/town.ts`: delete `applyTalkVendorInput`, `applyTalkHealerInput`, `vendorSystem`, `healerSystem`, and `TALK_RANGE`.
- `sim/tick.ts`: `travel()` and `joinPlayer()` — `p.npcTarget = null;` replaces the two boolean resets; input loop swaps `applyTalkVendorInput`/`applyTalkHealerInput` for `applyTalkNpcInput`; zone loop swaps `vendorSystem`/`healerSystem` for `npcSystem(state, zone, acting())` in the same position.
- `sim/systems/combat.ts` `deathSystem` player-fell reset: same swap.
- `sim/systems/movement.ts`: `applyMoveInput` clears targets — swap the booleans for `p.npcTarget = null;`.
- `sim/systems/inventory.ts`: grep hits here too (target-clearing on pickup input); same swap.
- `sim/town.test.ts`: shop tests that walked via `talkVendor` now use `talkNpc` + the maren entity; buying/selling/repair tests are position-based (`onCampGround`) and stand as-is.

- [ ] **Step 4: Run** `bun test sim && bun run build` — PASS, typecheck clean (client compile errors from removed inputs are fixed in Task 9/10; if `bun run build` fails only in `client/`, patch `client/main.tsx` minimally now: `pending.talkVendor`/`talkHealer` → look up the npc entity id via the picked marker's nearest npc — or simply `delete` those two branches and leave camp interaction keyboard-only until Task 10. Note which you did in the commit message).

- [ ] **Step 5: Commit** `git add -A && git commit -m "One npcTarget walk-to replaces the per-NPC boolean pattern"`

---

### Task 4: Accept and turn-in with rewards

**Files:**
- Modify: `sim/systems/quests.ts`, `sim/systems/xp.ts`, `sim/state.ts`, `sim/tick.ts`
- Test: `sim/quests.test.ts`

**Interfaces:**
- Consumes: `questOffered`, `questReadyToTurnIn`, `objectiveMet`, `collectCount` (Task 2); `NPC_TALK_RANGE` (Task 3).
- Produces: `PlayerInput.acceptQuest?: QuestId`, `PlayerInput.turnInQuest?: QuestId`; events `{ type: "quest_accepted"; playerId: PlayerId; quest: QuestId }` and `{ type: "quest_completed"; playerId: PlayerId; quest: QuestId }`; exported `applyAcceptQuestInput` / `applyTurnInQuestInput`; `grantXp(state, p: Player, amount: number): void` exported from `sim/systems/xp.ts` (the per-player grant + level-up loop extracted from `xpSystem`, which now calls it).

- [ ] **Step 1: Write the failing tests** (append to `sim/quests.test.ts`; use a helper `nearNpc(state, p, npcId)` that finds the surface entity and sets `p.pos` beside it):

```ts
test("accept requires the giver in range and the chain satisfied", () => {
  const state = createGame(2);
  const p = joinPlayer(state, { id: 0 });
  stepSolo(state, { acceptQuest: "moor_wights" }); // far from maren
  expect(p.quests.moor_wights).toBeUndefined();
  nearNpc(state, p, "maren");
  stepSolo(state, { acceptQuest: "grave_moss" }); // wrong npc AND unmet chain
  expect(p.quests.grave_moss).toBeUndefined();
  stepSolo(state, { acceptQuest: "moor_wights" });
  expect(p.quests.moor_wights).toEqual({ stage: "active", count: 0 });
  expect(state.events.some((e) => e.type === "quest_accepted")).toBe(true);
});

test("turn-in pays gold and xp and marks done", () => {
  const state = createGame(2);
  const p = joinPlayer(state, { id: 0 });
  nearNpc(state, p, "maren");
  stepSolo(state, { acceptQuest: "moor_wights" });
  p.quests.moor_wights!.count = 8;
  const gold = p.gold, xp = p.xp;
  stepSolo(state, { turnInQuest: "moor_wights" });
  expect(p.quests.moor_wights!.stage).toBe("done");
  expect(p.gold).toBe(gold + 100);
  expect(p.xp).toBe(xp + 80);
  expect(state.events.some((e) => e.type === "quest_completed")).toBe(true);
  // done means maren offers the next quest, not this one again
  stepSolo(state, { acceptQuest: "moor_wights" });
  expect(p.quests.moor_wights!.stage).toBe("done");
});

test("item rewards land in the pack, or at the feet when it is full", () => {
  const state = createGame(2);
  const p = joinPlayer(state, { id: 0 });
  deliverQuestReward(state, p, { item: { baseId: "hatchet", rarity: "magic" } });
  expect(p.inventory.entries.some((e) => e.item.baseId === "hatchet")).toBe(true);
  // Pack the grid solid with 1x1 potions, then reward again: it hits the floor.
  const potion = () => rollItem(state.rng, "minor_potion", 1, "normal");
  while (placeItem(p.inventory, state.nextId++, potion())) { /* fill every cell */ }
  const groundBefore = getZone(state, "surface").groundItems.size;
  deliverQuestReward(state, p, { item: { baseId: "hatchet", rarity: "magic" } });
  expect(getZone(state, "surface").groundItems.size).toBe(groundBefore + 1);
  expect(state.events.some((e) => e.type === "item_dropped")).toBe(true);
});
```

Also define the shared helper at the top of `sim/quests.test.ts` (Tasks 4, 5, and 8 all use it):

```ts
import { getZone } from "./state";
import { NPCS, type NpcId } from "./npcs";
import type { GameState, Player } from "./state";

/** Stand the player within talk range of an NPC's surface entity. */
function nearNpc(state: GameState, p: Player, npcId: NpcId): void {
  const npc = [...getZone(state, "surface").npcs.values()].find((n) => n.npcId === npcId)!;
  p.zoneId = "surface";
  p.pos = { x: npc.pos.x + 0.5, y: npc.pos.y };
}
```

- [ ] **Step 2: Run** — FAIL (inputs unknown, helper missing).

- [ ] **Step 3: Implement** in `sim/systems/quests.ts`:

```ts
import { QUESTS, questOffered, questReadyToTurnIn, collectCount, type QuestId } from "../quests";
import { grantXp } from "./xp";
import { rollItem } from "../items/generate";
import { placeItem, removeEntry } from "../character";
import { dropSpot } from "./combat"; // export it there if not already exported

/** The npc entity for `npcId` within talk range of p, in p's zone — or null. */
function npcInRange(state: GameState, p: Player, npcId: NpcId): Npc | null {
  const zone = state.zones.get(p.zoneId);
  if (!zone) return null;
  for (const npc of zone.npcs.values()) {
    if (npc.npcId !== npcId) continue;
    if (Math.hypot(p.pos.x - npc.pos.x, p.pos.y - npc.pos.y) <= NPC_TALK_RANGE) return npc;
  }
  return null;
}

export function applyAcceptQuestInput(state: GameState, p: Player, input: PlayerInput): void {
  const id = input.acceptQuest;
  if (!id || !(id in QUESTS)) return;
  const q = QUESTS[id];
  if (questOffered(p, q.giver) !== id) return;
  if (!npcInRange(state, p, q.giver)) return;
  // Introducing yourself to the giver IS the errand — met on the spot.
  const count = q.objective.kind === "talk" && q.objective.npc === q.giver ? 1 : 0;
  p.quests[id] = { stage: "active", count };
  state.events.push({ type: "quest_accepted", playerId: p.id, quest: id });
}

export function deliverQuestReward(
  state: GameState,
  p: Player,
  reward: QuestDef["reward"],
): void {
  if (reward.gold) p.gold += reward.gold;
  if (reward.item) {
    const item = rollItem(state.rng, reward.item.baseId, Math.max(1, p.level), reward.item.rarity);
    if (!placeItem(p.inventory, state.nextId++, item)) {
      const pos = dropSpot(state.rng, state.zones.get(p.zoneId)!.map, p.pos);
      const gid = state.nextId++;
      state.zones.get(p.zoneId)!.groundItems.set(gid, { id: gid, item, pos });
      state.events.push({ type: "item_dropped", id: gid, name: item.name, rarity: item.rarity, pos, zone: p.zoneId });
    }
  }
  if (reward.xp) grantXp(state, p, reward.xp);
}

export function applyTurnInQuestInput(state: GameState, p: Player, input: PlayerInput): void {
  const id = input.turnInQuest;
  if (!id || !(id in QUESTS)) return;
  const q = QUESTS[id];
  if (questReadyToTurnIn(p, q.turnIn) !== id) return;
  if (!npcInRange(state, p, q.turnIn)) return;
  if (q.objective.kind === "collect") {
    // Hand the goods over: remove exactly `count` matching entries.
    let left = q.objective.count;
    for (const e of [...p.inventory.entries]) {
      if (left === 0) break;
      if (e.item.baseId === q.objective.itemBaseId) { removeEntry(p.inventory, e.id); left--; }
    }
  }
  p.quests[id] = { stage: "done", count: p.quests[id]!.count };
  deliverQuestReward(state, p, q.reward);
  state.events.push({ type: "quest_completed", playerId: p.id, quest: id });
}
```

`sim/systems/xp.ts` refactor — extract the body of the per-player grant loop:

```ts
/** Add xp and process level-ups; a new level refills life and mana. */
export function grantXp(state: GameState, p: Player, gained: number): void {
  if (gained <= 0) return;
  p.xp += gained;
  let leveled = false;
  while (p.xp >= xpForLevel(p.level + 1)) {
    p.level++;
    p.skillPoints++;
    leveled = true;
    state.events.push({ type: "level_up", playerId: p.id, level: p.level });
  }
  recomputePlayerStats(state, p);
  if (leveled) { p.life = p.maxLife; p.mana = p.maxMana; }
}
```

`xpSystem`'s final loop becomes `for (const [id, gained] of gains) { const p = state.players.get(id); if (p) grantXp(state, p, gained); }`.

`sim/state.ts`: add the two events and two inputs (typed `QuestId`). `sim/tick.ts`: wire `applyAcceptQuestInput` and `applyTurnInQuestInput` into the input loop after `applyTalkNpcInput`.

Check `dropSpot` in `sim/systems/combat.ts` — if it's module-private, export it.

- [ ] **Step 4: Run** `bun test sim` — PASS.

- [ ] **Step 5: Commit** `git add -A sim && git commit -m "Quests accept and turn in at their NPCs, paying gold, xp, and items"`

---

### Task 5: Objective progress off the event stream

**Files:**
- Modify: `sim/systems/quests.ts`, `sim/state.ts` (quest_progress event), `sim/tick.ts` (wire the system)
- Test: `sim/quests.test.ts`

**Interfaces:**
- Produces: `questProgressSystem(state: GameState): void` — runs in `step()` **after the occupiedZones loop, before `xpSystem`** (kill events from this tick exist; quest XP and kill XP land the same tick). Event `{ type: "quest_progress"; playerId: PlayerId; quest: QuestId; count: number; needed: number }`, emitted only when a count changes.

- [ ] **Step 1: Write the failing tests:**

```ts
import { spawnMonster } from "./monsters";

test("kill quests count party kills in your zone, not elsewhere", () => {
  const state = createGame(3);
  const p0 = joinPlayer(state, { id: 0 });
  const p1 = joinPlayer(state, { id: 1 });
  p0.quests.moor_wights = { stage: "active", count: 0 };
  p1.quests.moor_wights = { stage: "active", count: 0 };
  const surface = getZone(state, "surface");
  const m = spawnMonster(state, surface, "shambler", { x: p0.pos.x + 1, y: p0.pos.y });
  m.life = 0;
  m.lastHitBy = 1; // the OTHER player lands the kill
  p1.zoneId = "floor:1"; // ...but p1 has left the zone: no credit for them
  stepSolo(state, {});
  expect(p0.quests.moor_wights!.count).toBe(1); // in-zone: shared credit
  expect(p1.quests.moor_wights!.count).toBe(0); // out of zone: none
  expect(state.events.some((e) => e.type === "quest_progress" && e.playerId === 0)).toBe(true);
});

test("kill counts cap at the objective and only tick while active", () => {
  const state = createGame(3);
  const p = joinPlayer(state, { id: 0 });
  p.quests.moor_wights = { stage: "active", count: 8 };
  const surface = getZone(state, "surface");
  const m = spawnMonster(state, surface, "shambler", { x: p.pos.x + 1, y: p.pos.y });
  m.life = 0;
  stepSolo(state, {});
  expect(p.quests.moor_wights!.count).toBe(8); // capped, no event
});

test("reach objectives complete from where the player stands", () => {
  const state = createGame(3);
  const p = joinPlayer(state, { id: 0 });
  p.quests.find_redfen = { stage: "active", count: 0 };
  p.region = "redfen"; // as regionSystem would stamp on crossing
  stepSolo(state, {});
  expect(p.quests.find_redfen!.count).toBe(1);
});

test("talk objectives complete on npc_talk", () => {
  const state = createGame(3);
  const p = joinPlayer(state, { id: 0 });
  p.quests.meet_betha = { stage: "active", count: 0 };
  nearNpc(state, p, "betha");
  const betha = [...getZone(state, "surface").npcs.values()].find((n) => n.npcId === "betha")!;
  stepSolo(state, { talkNpc: betha.id });
  stepSolo(state, {});
  expect(p.quests.meet_betha!.count).toBe(1);
});
```

(`find_redfen` and `meet_betha` need rows by now — add their two rows to `QUESTS` in this task if Task 8 hasn't run: `find_redfen` = reach `redfen`, giver/turnIn maren, requires grave_moss; `meet_betha` = talk `betha`, giver/turnIn betha, requires find_redfen. Dialogue one line each; rewards `{ gold: 80, xp: 90 }` / `{ gold: 60, xp: 120 }`. Task 8 polishes wording.)

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** in `sim/systems/quests.ts`:

```ts
import { QUESTS, QUEST_IDS, objectiveMet } from "../quests";
import { allPlayers } from "../state";

/** Advance every player's active objectives off this tick's events and
 * standing state. Runs after the zone systems, before xpSystem. */
export function questProgressSystem(state: GameState): void {
  const bump = (p: Player, id: QuestId, to: number, needed: number) => {
    const prog = p.quests[id]!;
    if (to === prog.count) return;
    prog.count = to;
    state.events.push({ type: "quest_progress", playerId: p.id, quest: id, count: to, needed });
  };
  // Kill credit: every in-zone player with the quest active shares each kill.
  for (const e of state.events) {
    if (e.type === "monster_died") {
      for (const p of allPlayers(state)) {
        if (p.dead || p.zoneId !== e.zone) continue;
        for (const id of QUEST_IDS) {
          const o = QUESTS[id].objective;
          const prog = p.quests[id];
          if (!prog || prog.stage !== "active" || o.kind !== "kill") continue;
          if (o.typeId !== e.typeId) continue;
          if (o.zone !== undefined && o.zone !== e.zone) continue;
          bump(p, id, Math.min(o.count, prog.count + 1), o.count);
        }
      }
    } else if (e.type === "npc_talk") {
      const p = state.players.get(e.playerId);
      if (!p) continue;
      for (const id of QUEST_IDS) {
        const o = QUESTS[id].objective;
        const prog = p.quests[id];
        if (!prog || prog.stage !== "active" || o.kind !== "talk") continue;
        if (o.npc !== e.npcId) continue;
        bump(p, id, 1, 1);
      }
    }
  }
  // Reach: a standing check — no event archaeology, just where they are now.
  for (const p of allPlayers(state)) {
    if (p.dead) continue;
    for (const id of QUEST_IDS) {
      const o = QUESTS[id].objective;
      const prog = p.quests[id];
      if (!prog || prog.stage !== "active" || o.kind !== "reach" || prog.count >= 1) continue;
      if (objectiveMet(p, id)) bump(p, id, 1, 1);
    }
  }
}
```

Note `objectiveMet` for `reach` reads position directly, so the standing check reuses it; `count` is stamped to 1 purely so `quest_progress` fires once and the tracker can show a check.

Wire in `sim/tick.ts` `step()`: `questProgressSystem(state);` on the line before `xpSystem(state);`.

- [ ] **Step 4: Run** `bun test sim` — PASS.

- [ ] **Step 5: Commit** `git add -A sim && git commit -m "Quest objectives advance off the event stream with shared kill credit"`

---

### Task 6: Quest items — the `quest` slot, drops, and guards

**Files:**
- Modify: `sim/items/bases.ts`, `sim/systems/quests.ts` (drop roll), `sim/systems/town.ts` (`itemValue`, sell guard), `sim/systems/inventory.ts` (equip guard, if none exists)
- Test: `sim/quests.test.ts`, `sim/items/items.test.ts`

**Interfaces:**
- Produces: `Slot` union gains `"quest"`; bases `grave_moss` and `fen_heart` (both `w:1,h:1,levelReq:1,slot:"quest"`, names "Grave-Moss" / "Fen Heart"); quest-item drop rolling inside `questProgressSystem`; `itemValue` returns 0 for quest items and `applyShopInput` refuses to sell them; `applyEquipInput` ignores them.

- [ ] **Step 1: Write the failing tests:**

```ts
test("active collect quests make matching kills drop the quest item", () => {
  const state = createGame(4);
  const p = joinPlayer(state, { id: 0 });
  p.quests.grave_moss = { stage: "active", count: 0 };
  const surface = getZone(state, "surface");
  // chance is 0.5 — kill until one drops; bounded so a broken roll fails loudly
  let dropped = false;
  for (let i = 0; i < 40 && !dropped; i++) {
    const m = spawnMonster(state, surface, "shambler", { x: p.pos.x + 2, y: p.pos.y });
    m.life = 0;
    stepSolo(state, {});
    dropped = [...surface.groundItems.values()].some((g) => g.item.baseId === "grave_moss");
  }
  expect(dropped).toBe(true);
});

test("no quest, no moss — and a full collection stops dropping more", () => {
  const state = createGame(4);
  const p = joinPlayer(state, { id: 0 });
  const surface = getZone(state, "surface");
  for (let i = 0; i < 40; i++) {
    const m = spawnMonster(state, surface, "shambler", { x: p.pos.x + 2, y: p.pos.y });
    m.life = 0;
    stepSolo(state, {});
  }
  expect([...surface.groundItems.values()].some((g) => g.item.baseId === "grave_moss")).toBe(false);
});

test("quest items cannot be sold or equipped and are worth nothing", () => {
  const state = createGame(4);
  const p = joinPlayer(state, { id: 0 });
  const item = rollItem(state.rng, "grave_moss", 1, "normal");
  expect(itemValue(item)).toBe(0);
  placeItem(p.inventory, state.nextId++, item);
  const entryId = p.inventory.entries[p.inventory.entries.length - 1]!.id;
  p.pos = { ...getZone(state, "surface").map.spawn }; // on camp ground
  p.wasInCamp = true;
  const before = p.inventory.entries.length;
  stepSolo(state, { sell: entryId });
  expect(p.inventory.entries.length).toBe(before); // still in the pack
  stepSolo(state, { equip: entryId });
  expect(p.inventory.entries.length).toBe(before); // not equipped either
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement.**
- `sim/items/bases.ts`: `export type Slot = ... | "quest";` and two rows:

```ts
  // --- quest items ---
  grave_moss: base({ id: "grave_moss", name: "Grave-Moss", slot: "quest", w: 1, h: 1, levelReq: 1 }),
  fen_heart: base({ id: "fen_heart", name: "Fen Heart", slot: "quest", w: 1, h: 1, levelReq: 1 }),
```

- `sim/systems/quests.ts`, inside `questProgressSystem`'s `monster_died` branch, **before** the per-player kill-credit loop (one roll per kill per quest, identical on every peer):

```ts
      // Collect quests: the sought thing has a chance to be on the corpse
      // whenever anyone in the zone still needs it.
      for (const id of QUEST_IDS) {
        const o = QUESTS[id].objective;
        if (o.kind !== "collect" || o.dropFrom !== e.typeId) continue;
        const wanted = allPlayers(state).some(
          (p) =>
            !p.dead && p.zoneId === e.zone &&
            p.quests[id]?.stage === "active" &&
            collectCount(p, o.itemBaseId) < o.count,
        );
        if (!wanted || state.rng.next() >= o.chance) continue;
        const zone = getZone(state, e.zone);
        const pos = dropSpot(state.rng, zone.map, e.pos);
        const gid = state.nextId++;
        const item = rollItem(state.rng, o.itemBaseId, 1, "normal");
        zone.groundItems.set(gid, { id: gid, item, pos });
        state.events.push({ type: "item_dropped", id: gid, name: item.name, rarity: item.rarity, pos, zone: e.zone });
      }
```

- `sim/systems/town.ts` `itemValue`: `if (base.slot === "quest") return 0;` first line after the base lookup. In `applyShopInput`'s sell branch, look the entry up **before** removing: find it in `p.inventory.entries`, and skip when its base slot is `"quest"` (restructure to find-then-remove).
- `sim/systems/inventory.ts` `applyEquipInput`: confirm how the slot is derived; a `"quest"` slot must never match an `EquipSlot`. If it indexes equipment by `base.slot`, add an explicit guard: quest (and potion, already handled) items don't equip.

- [ ] **Step 4: Run** `bun test sim` — PASS.

- [ ] **Step 5: Commit** `git add -A sim && git commit -m "Quest items: a stat-less slot that drops for seekers and cannot be sold"`

---

### Task 7: Save round-trip

**Files:**
- Modify: `sim/save.ts`
- Test: `sim/save.test.ts` is client-side (`client/save.test.ts`); the sim-level test lives in `sim/quests.test.ts`

**Interfaces:**
- Produces: `CharacterSave.quests?: Record<string, { stage: string; count: number }>` — serialized from `p.quests`, restored leniently: unknown ids dropped, stages other than `"active"`/`"done"` dropped, non-finite counts reset to 0.

- [ ] **Step 1: Write the failing test:**

```ts
import { serializeCharacter, applyCharacter } from "./save";

test("quest progress survives a save round-trip; junk is shed", () => {
  const state = createGame(6);
  const p = joinPlayer(state, { id: 0 });
  p.quests.moor_wights = { stage: "done", count: 8 };
  p.quests.grave_moss = { stage: "active", count: 0 };
  const raw = serializeCharacter(state, 0);
  // splice junk into the payload the way an old build might
  const tampered = JSON.stringify({
    ...JSON.parse(raw),
    quests: {
      ...JSON.parse(raw).quests,
      not_a_quest: { stage: "active", count: 1 },
      moor_wights: { stage: "done", count: 8 },
      grave_moss: { stage: "weird", count: NaN },
    },
  });
  const state2 = createGame(6);
  const p2 = joinPlayer(state2, { id: 0 });
  expect(applyCharacter(state2, 0, tampered)).toBe(true);
  expect(p2.quests.moor_wights).toEqual({ stage: "done", count: 8 });
  expect(p2.quests.grave_moss).toBeUndefined(); // bad stage: dropped, restartable
  expect((p2.quests as Record<string, unknown>).not_a_quest).toBeUndefined();
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** in `sim/save.ts`: add `quests?: Record<string, { stage: string; count: number }>;` to `CharacterSave`; in `serializeCharacter` add `quests: p.quests,` (structurally compatible). In `applyCharacter`, beside the waypoint normalization:

```ts
import { isQuestId, type QuestLog } from "./quests";
// ...
  // Quests are lenient like checkpoints: a garbled log sheds its junk instead
  // of bricking the hero. Pure function of the payload — identical on every peer.
  const quests: QuestLog = {};
  if (save.quests && typeof save.quests === "object") {
    for (const [id, prog] of Object.entries(save.quests)) {
      if (!isQuestId(id)) continue;
      if (prog?.stage !== "active" && prog?.stage !== "done") continue;
      quests[id] = { stage: prog.stage, count: Number.isFinite(prog.count) ? prog.count : 0 };
    }
  }
  p.quests = quests;
```

- [ ] **Step 4: Run** `bun test sim client` — PASS (client save tests exercise the same payloads).

- [ ] **Step 5: Commit** `git add -A sim && git commit -m "Quest logs ride the character save, shedding junk on the way in"`

---

### Task 8: The campaign — all nine rows, NPC dialogue, and an end-to-end walk

**Files:**
- Modify: `sim/quests.ts` (complete `QUESTS`, drop the `as Record` cast), `sim/npcs.ts` (fill every `quests` list, final idle lines)
- Test: `sim/quests.test.ts`

**Interfaces:**
- Consumes: everything above. Produces the final content tables. The chain, in `requires` order:

| id | giver → turnIn | objective | reward |
|----|----|----|----|
| moor_wights | maren | kill 8 `shambler`, zone `surface` | 100g, 80xp |
| grave_moss | sera (req moor_wights) | collect 5 `grave_moss` from `shambler`, chance 0.5 | 120g, 100xp |
| find_redfen | maren (req grave_moss) | reach area `redfen` | 80g, 90xp |
| meet_betha | betha (req find_redfen) | talk `betha` | 60g, 120xp |
| howler_cull | betha (req meet_betha) | kill 10 `fen_howler`, zone `surface` | 200g, 220xp, item `{ baseId: "hatchet", rarity: "magic" }` |
| fen_hearts | betha (req howler_cull) | collect 4 `fen_heart` from `bog_maw`, chance 0.6 | 250g, 280xp |
| soldiers_due | corvin (req fen_hearts) | kill 8 `cairn_wight`, zone `surface` | 350g, 420xp, item `{ baseId: "studded_jerkin", rarity: "rare" }` |
| descend_barrow | aldous (req soldiers_due) | reach floor 3 | 300g, 500xp |
| barrow_lord | aldous (req descend_barrow) | kill 1 `barrow_lord`, zone `floor:5` | 600g, 900xp, item `{ baseId: "grave_scythe", rarity: "unique" }` |

NPC quest lists: maren `["moor_wights", "find_redfen"]`, sera `["grave_moss"]`, betha `["meet_betha", "howler_cull", "fen_hearts"]`, corvin `["soldiers_due"]`, aldous `["descend_barrow", "barrow_lord"]`.

Dialogue: 1–3 `offer` lines, 1 `progress`, 1 `done` per quest, in the game's dour bog-gothic voice (match the existing flavor: "The fen keeps what it takes"). `fen_hearts.done` must point the player at Corvin in the Gallowmire; `descend_barrow.offer` at the barrow mouth. Write them for real — no filler.

- [ ] **Step 1: Write the failing test** — a full-campaign integration walk driven only through inputs and events (no direct `p.quests` writes for the happy path):

```ts
test("the campaign runs start to finish through inputs alone", () => {
  const state = createGame(9);
  const p = joinPlayer(state, { id: 0 });
  const surface = getZone(state, "surface");
  const entity = (npcId: string) => [...surface.npcs.values()].find((n) => n.npcId === npcId)!;
  const talkAt = (npcId: string) => {
    const n = entity(npcId);
    p.pos = { x: n.pos.x + 0.5, y: n.pos.y };
    stepSolo(state, { talkNpc: n.id });
    stepSolo(state, {});
  };
  const killFor = (typeId: string, n: number) => {
    for (let i = 0; i < n; i++) {
      const m = spawnMonster(state, surface, typeId, { x: p.pos.x + 1.5, y: p.pos.y });
      m.life = 0;
      m.lastHitBy = 0;
      stepSolo(state, {});
    }
  };
  const collectAll = (baseId: string, dropFrom: string, need: number) => {
    // kill the source until a quest item drops, walk over, pick it up; repeat.
    for (let guard = 0; guard < 400 && collectCount(p, baseId) < need; guard++) {
      const g = [...surface.groundItems.values()].find((x) => x.item.baseId === baseId);
      if (g) { p.pos = { ...g.pos }; stepSolo(state, { pickup: g.id }); stepSolo(state, {}); }
      else killFor(dropFrom, 1);
    }
    expect(collectCount(p, baseId)).toBe(need); // guard exhausted = real failure
  };
  // ...the real test spells each stage out; sketch:
  talkAt("maren"); stepSolo(state, { acceptQuest: "moor_wights" });
  killFor("shambler", 8);
  talkAt("maren"); stepSolo(state, { turnInQuest: "moor_wights" });
  expect(p.quests.moor_wights?.stage).toBe("done");
  // ...through all nine, ending:
  // aldous → descend_barrow → walk p.zoneId to "floor:3" via travel(state, p, "floor:3")
  // aldous → barrow_lord → ensureFloor(state,5), spawn barrow_lord there with life 0
  expect(p.quests.barrow_lord?.stage).toBe("done");
  expect(p.inventory.entries.some((e) => e.item.rarity === "unique")).toBe(true);
});
```

Write the real test straightline (no clever helpers where they obscure): each collect stage loops kill→scan→walk→pickup with a bounded guard; each reach stage uses `travel(state, p, ...)` (exported from tick) then one `stepSolo`. The test is long; that's fine — it's the campaign's contract.

Also extend the determinism test (find it: `grep -rn "determinism\|same seed" sim/*.test.ts` — likely `sim/multiplayer.test.ts` or `sim/tick.test.ts`): append a scripted segment that accepts a quest, kills a shambler, and turns in, then asserts the two replicas' serialized states still match.

- [ ] **Step 2: Run** — FAIL (missing rows).

- [ ] **Step 3: Implement** the seven remaining `QUESTS` rows per the table, remove the `as Record<QuestId, QuestDef>` cast so the compiler enforces completeness, fill every NPC's `quests` list, and polish all dialogue.

- [ ] **Step 4: Run** `bun test sim` — PASS. Then `bun run build` for the typecheck.

- [ ] **Step 5: Commit** `git add -A sim && git commit -m "The nine-quest campaign: moors to the Barrow Lord"`

---

### Task 9: Renderer — NPC figures, indicators, picking

**Files:**
- Modify: `client/render/scene.ts`, `client/main.tsx` (pick handling), `client/ui/MiniMap.tsx`

**Interfaces:**
- Consumes: `zone.npcs`, `NPCS`, `npcIndicator` (all sim imports — read-only).
- Produces: `scene.pick` gains `{ kind: "npc"; id: number }`; NPC meshes + overhead indicator sprites.

No sim tests here — verify by playing (Step 4). Keep renderer changes read-only against sim state.

- [ ] **Step 1: Render NPC figures.** In `createScene`, the vendor/healer rigs are currently built from the `V`/`H` markers (`scene.ts` ~532–556). Replace that source: build one rig per `zone.npcs` entry instead, keyed by entity id. Reuse the existing `vendorRig`-style humanoid (see `rigs.ts`) with a per-NPC palette — pick distinct cloak tints per `npcId` (a small `Record<NpcId, number>` color table beside the rig code). Keep the V-marker stall props (crates/barrel/chest) and H-marker shrine glow exactly where they are — they're set dressing tied to markers, not to the figures. `createScene` receives the map, not the game; NPCs are static per zone, so pass the npc list in: change `createScene(mount, map, assets, onItemClick, isSurface)` to also take `npcs: Npc[]` (both call sites in `main.tsx` — initial build and the zone-swap rebuild — pass `[...zoneOf(game, localPlayer(game)).npcs.values()]`).

- [ ] **Step 2: Overhead indicators.** Per NPC rig, add a floating quad/sprite ~1.8 units up, textured via a small canvas: `!` in gold `#f0c96a` (offer), `?` in gold (turnin), `?` in grey `#8f8778` (progress), hidden otherwise. In `scene.render(game, ...)`, each frame compute `npcIndicator(localPlayer(game), npcId)` and show/tint accordingly (cache the three textures once; per-frame work is a visibility/material swap, not a redraw).

- [ ] **Step 3: Picking + input.** Add NPC meshes to the raycast set with `{ kind: "npc", id }` userData, replacing the old `vendor`/`healer` pick kinds. In `main.tsx` `aimFromPointer`, replace the `vendor`/`healer` branches with:

```ts
      } else if (picked.kind === "npc") {
        pending.talkNpc = picked.id;
        delete pending.moveTo;
      }
```

In `MiniMap.tsx`, draw each `zone.npcs` entry inside the crop window as a 3px gold `#f0c96a` dot (follow the existing marker-drawing pattern in that file).

- [ ] **Step 4: Verify by playing.** `bun run dev` is already how this repo runs; use the preview flow (launch config, port 5199). Confirm: five figures stand in the world (two in camp, one in fen/mire/and by the barrow mouth); Maren shows `!`; clicking walks you over; the console shows no errors. Screenshot for the record.

- [ ] **Step 5: Commit** `git add -A client && git commit -m "NPCs stand in the scene with quest marks overhead and answer clicks"`

---

### Task 10: DialoguePanel

**Files:**
- Create: `client/ui/DialoguePanel.tsx`
- Modify: `client/main.tsx`

**Interfaces:**
- Consumes: `npc_talk` event; `NPCS`, `QUESTS`, `questOffered`, `questReadyToTurnIn`, `questActiveAt`; `uiInputRef` for `acceptQuest`/`turnInQuest`.
- Produces: `<DialoguePanel game={game} npcId={npcId} onAccept={(q) => ...} onTurnIn={(q) => ...} onTrade={() => ...} onWares={() => ...} onClose={() => ...} />`.

- [ ] **Step 1: Build the panel.** Follow `HealerPanel.tsx`/`ShopPanel.tsx` for chrome (`PanelChrome`), fonts, and the `Reveal` mount. Content logic, all via the sim's pure helpers against `localPlayer(game)`:
  - `turnin` ready → quest name + `dialogue.done` lines + **Complete** button (`onTurnIn`).
  - else `offer` → quest name + `dialogue.offer` lines + **Accept** (`onAccept`).
  - else `progress` → `dialogue.progress` of the active quest.
  - else → a random-free choice: `idle[0]` (deterministic; no Math.random in anything rendered from game state).
  - Maren additionally shows a **Trade** button (`onTrade`); Sera a **Wares** button (`onWares` → the potion HealerPanel). **Leave** closes.

- [ ] **Step 2: Wire main.tsx.** New state `const [dialogueNpc, setDialogueNpc] = useState<NpcId | null>(null);`. In `drainEvents`, replace the deleted `shop_opened`/`healer_opened` cases with:

```ts
            case "npc_talk":
              setDialogueNpc(e.npcId);
              play("potion"); // any soft cue; a dedicated "talk" sound is optional
              break;
```

(local-player-filtered — it's below the `playerId !== localId()` gate). On `traveled`, also `setDialogueNpc(null)`. Escape-close: add `dialogueNpc !== null` into `panelsOpenRef` and clear it in the Escape branch. Render:

```tsx
      <Reveal open={dialogueNpc !== null && gameRef.current !== null}>
        {gameRef.current && dialogueNpc && (
          <DialoguePanel
            game={gameRef.current}
            npcId={dialogueNpc}
            onAccept={(q) => { uiInputRef.current.acceptQuest = q; }}
            onTurnIn={(q) => { uiInputRef.current.turnInQuest = q; }}
            onTrade={() => { setDialogueNpc(null); setShopOpen(true); }}
            onWares={() => { setDialogueNpc(null); setHealerOpen(true); }}
            onClose={() => setDialogueNpc(null)}
          />
        )}
      </Reveal>
```

Keep the ShopPanel/HealerPanel `onCampGround` gating as-is.

- [ ] **Step 3: Verify by playing.** Click Maren → panel opens with the offer, Accept works (tracker in Task 11 will show it; for now check `__barrow.game` in the console: `game.players.get(0).quests`). Kill 8 shamblers, return, Complete pays out with a level-up-style flourish if xp tips it. Trade opens the shop.

- [ ] **Step 4: Commit** `git add -A client && git commit -m "DialoguePanel: quest offers, turn-ins, and trade through one conversation"`

---

### Task 11: Quest tracker, toasts, sounds

**Files:**
- Create: `client/ui/QuestTracker.tsx`
- Modify: `client/main.tsx`

- [ ] **Step 1: Build the tracker.** A slim fixed panel, top-right under the room-code chip (`top: 44, right: 14`, same font stack `ui-monospace`, colors from Toasts/ZoneBanner: `#c9bfa8` on `rgba(12,11,15,.75)`). For each active quest of `localPlayer(game)` (in `QUEST_IDS` order): quest name, then a progress line — kill: `count/needed`; collect: `collectCount(p, baseId)/needed`; reach/talk: the quest's `progress[0]` shortened, or `✓` when `objectiveMet`. Re-renders ride the existing 100ms HUD heartbeat — mount as `{gameRef.current && <QuestTracker game={gameRef.current} />}`.

- [ ] **Step 2: Event flourishes** in `drainEvents` (local player only):

```ts
            case "quest_accepted":
              pushToast(`quest taken: ${QUESTS[e.quest].name}`);
              play("levelup");
              break;
            case "quest_completed":
              scene.addDamageNumber(localPlayer(game).pos, "quest complete!", "#f0c96a");
              pushToast(`quest complete: ${QUESTS[e.quest].name}`);
              play("levelup");
              save(); // a finished quest survives even an immediate crash
              break;
```

(`quest_progress` needs no handler — the tracker reads live state.)

- [ ] **Step 3: Verify by playing** — accept, watch the tracker count kills live, complete, watch it clear.

- [ ] **Step 4: Commit** `git add -A client && git commit -m "Quest tracker and completion flourishes on the HUD"`

---

### Task 12: Full verification pass

- [ ] **Step 1:** `bun test sim client` — everything green.
- [ ] **Step 2:** `bun run build` — typecheck/build clean.
- [ ] **Step 3:** Play the opening arc end-to-end in the dev server (moor_wights → grave_moss → find_redfen at minimum): NPCs visible with correct indicators for a fresh character, dialogue flows, tracker updates, save-and-reload (`beforeunload` autosave + refresh) keeps the log, minimap shows gold dots.
- [ ] **Step 4:** Fix anything found (small fixes inline; anything structural becomes a follow-up task appended here).
- [ ] **Step 5:** Final commit of stragglers; then use superpowers:finishing-a-development-branch if working on a branch.
