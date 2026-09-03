# Dungeon Variety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single endless barrow with six finite dungeons (one per surface area), procedurally generated per style, with quest hooks, bottom-floor bosses, and per-dungeon visuals/audio.

**Architecture:** A `DUNGEONS` registry (data rows, like `AREAS`) drives everything: zone ids become `dungeon:${id}:${floor}`, a seeded room-and-corridor generator replaces the fixed `cryptZone()` map, entrances are injected into surface generation from the registry, and the client keys palettes/ambience off each dungeon's style.

**Tech Stack:** TypeScript, bun test, Three.js (client), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-03-dungeon-variety-design.md`

## Global Constraints

- `sim/` never imports three, react, or the DOM. All randomness through the seeded `Rng` (`sim/rng.ts`).
- Tests: `bun test sim client`. Typecheck: `bun run build`. TDD: failing test first for all sim logic.
- **`client/audio.ts` and `client/main.tsx` carry uncommitted user changes. Never revert, checkout, or stash them — edit on top of the working-tree state, and commit only the files each task touches (list them explicitly in `git add`).**
- The determinism contract: same seed + same input script ⇒ identical state. Every world-gen rng draw goes through `state.rng` / the passed `rng`.
- Import direction: `dungeons.ts` may import only `areas.ts`/`map.ts` types. `state.ts` → `dungeons.ts` (type + helper), `surface.ts`/`world.ts`/`tick.ts`/`quests.ts` → `dungeons.ts`. Never `dungeons.ts` → `quests.ts`/`surface.ts`/`state.ts` (avoids cycles).
- Two deliberate spec deviations (approved rationale, note in commit messages): `DungeonDef` drops the `quest?: QuestId` field (quests point at dungeons, not vice versa — kills an import cycle) and drops `boss.name` (champion display names already come from `monsterDisplayName`).

---

### Task 1: Dungeon registry and zone identity helpers

**Files:**
- Create: `sim/dungeons.ts`
- Create: `sim/dungeons.test.ts`
- Modify: `sim/state.ts` (extend `ZoneId`, add helpers; keep `floorZone`/`zoneDepth` working for now)
- Test: `sim/dungeons.test.ts`, `sim/state` assertions live in the same test file

**Interfaces:**
- Consumes: `AreaId` from `sim/areas.ts`, `Vec` from `sim/map.ts`.
- Produces (later tasks rely on these exact names):
  - `type DungeonId = "barrow" | "fen_hollow" | "gallow_vault" | "cragmaw_delve" | "cinder_catacomb" | "crown_undercroft"`
  - `type DungeonStyleId = "barrow_halls" | "root_warren" | "gallow_ossuary" | "cragmaw_gouge" | "ember_catacomb" | "violet_undercroft"`
  - `interface DungeonDef { id; name; area; entrance: Vec; floors; levelBase; style; spawnTable: string[]; boss: { typeId: string; modifier?: ChampionModifier } }`
  - `const DUNGEONS: Record<DungeonId, DungeonDef>`, `const DUNGEON_ORDER: DungeonId[]` (registry insertion order), `function isDungeonId(id: string): id is DungeonId`
  - `interface DungeonStyle { width; height; rooms: { count: number; wMin: number; wMax: number; hMin: number; hMax: number }; corridor: number; erode: number; packs: number }`
  - `const DUNGEON_STYLES: Record<DungeonStyleId, DungeonStyle>`
  - In `sim/state.ts`: `ZoneId` union gains `` `dungeon:${DungeonId}:${number}` ``; `dungeonZoneId(d: DungeonId, floor: number): ZoneId`; `zoneDungeon(id: ZoneId): DungeonId | null`; `zoneFloor(id: ZoneId): number` (floor within its dungeon; 1 for surface and legacy ids).

- [ ] **Step 1: Write the failing test**

```ts
// sim/dungeons.test.ts
import { describe, expect, test } from "bun:test";
import { DUNGEONS, DUNGEON_ORDER, DUNGEON_STYLES, isDungeonId } from "./dungeons";
import { AREAS } from "./areas";
import { MONSTER_TYPES } from "./monsters";
import { MARKER_TYPES } from "./zone";
import { dungeonZoneId, zoneDungeon, zoneFloor } from "./state";

describe("dungeon registry", () => {
  test("six dungeons, one per surface area, each area used exactly once", () => {
    expect(DUNGEON_ORDER.length).toBe(6);
    const areas = DUNGEON_ORDER.map((id) => DUNGEONS[id].area);
    expect(new Set(areas).size).toBe(6);
  });

  test("every row is internally valid", () => {
    for (const id of DUNGEON_ORDER) {
      const d = DUNGEONS[id];
      expect(d.id).toBe(id);
      expect(d.floors).toBeGreaterThanOrEqual(1);
      expect(d.floors).toBeLessThanOrEqual(5);
      expect(AREAS[d.area]).toBeDefined();
      expect(DUNGEON_STYLES[d.style]).toBeDefined();
      expect(MONSTER_TYPES[d.boss.typeId]).toBeDefined();
      for (const ch of d.spawnTable) expect(MARKER_TYPES[ch]).toBeDefined();
      // Entrance sits inside its host area's bounds, off the 2-cell rim.
      const a = AREAS[d.area];
      expect(d.entrance.x).toBeGreaterThan(2);
      expect(d.entrance.x).toBeLessThan(a.width - 2);
      expect(d.entrance.y).toBeGreaterThan(2);
      expect(d.entrance.y).toBeLessThan(a.height - 2);
    }
  });

  test("barrow keeps its historic mouth and lord", () => {
    expect(DUNGEONS.barrow.area).toBe("overworld");
    expect(DUNGEONS.barrow.entrance).toEqual({ x: 58.5, y: 56.5 });
    expect(DUNGEONS.barrow.floors).toBe(5);
    expect(DUNGEONS.barrow.boss.typeId).toBe("barrow_lord");
  });

  test("zone id helpers round-trip", () => {
    const id = dungeonZoneId("fen_hollow", 2);
    expect(id).toBe("dungeon:fen_hollow:2");
    expect(zoneDungeon(id)).toBe("fen_hollow");
    expect(zoneFloor(id)).toBe(2);
    expect(zoneDungeon("surface")).toBe(null);
    expect(zoneFloor("surface")).toBe(1);
    expect(isDungeonId("barrow")).toBe(true);
    expect(isDungeonId("surface")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test sim/dungeons.test.ts`
Expected: FAIL — cannot resolve `./dungeons`.

- [ ] **Step 3: Write the registry and helpers**

```ts
// sim/dungeons.ts
import type { AreaId } from "./areas";
import type { Vec } from "./map";
import type { ChampionModifier } from "./monsters";

/** Every crypt in the world. Finite: each has a bottom floor with a boss vault. */
export type DungeonId =
  | "barrow" | "fen_hollow" | "gallow_vault"
  | "cragmaw_delve" | "cinder_catacomb" | "crown_undercroft";

export type DungeonStyleId =
  | "barrow_halls" | "root_warren" | "gallow_ossuary"
  | "cragmaw_gouge" | "ember_catacomb" | "violet_undercroft";

/**
 * One dungeon as data: content growth is new rows here, not new code.
 * `entrance` is in the host area's local cell coordinates (cell centers, .5).
 */
export interface DungeonDef {
  id: DungeonId;
  name: string;
  area: AreaId;
  entrance: Vec;
  floors: number;
  /** Monster level on floor 1; +1 per floor below. */
  levelBase: number;
  style: DungeonStyleId;
  /** Weighted marker chars packs are drawn from (MARKER_TYPES keys). */
  spawnTable: string[];
  /** Bottom-floor vault keeper. No modifier = spawned as-is (the Barrow Lord). */
  boss: { typeId: string; modifier?: ChampionModifier };
}

/** Architectural character: same style ⇒ same generator parameters. */
export interface DungeonStyle {
  width: number;
  height: number;
  rooms: { count: number; wMin: number; wMax: number; hMin: number; hMax: number };
  /** Corridor width in cells (1 or 2). */
  corridor: number;
  /** Probability a wall cell with 3+ floor neighbors erodes to floor, per pass cell. */
  erode: number;
  /** Monster pack budget per floor. */
  packs: number;
}

export const DUNGEON_STYLES: Record<DungeonStyleId, DungeonStyle> = {
  // Clean rectangular halls under the barrow.
  barrow_halls: { width: 44, height: 36, rooms: { count: 9, wMin: 5, wMax: 9, hMin: 4, hMax: 7 }, corridor: 2, erode: 0, packs: 14 },
  // Rooty, eroded warrens under the fen.
  root_warren: { width: 40, height: 34, rooms: { count: 8, wMin: 4, wMax: 7, hMin: 4, hMax: 6 }, corridor: 1, erode: 0.45, packs: 12 },
  // Long narrow ossuary galleries.
  gallow_ossuary: { width: 48, height: 30, rooms: { count: 10, wMin: 6, wMax: 11, hMin: 3, hMax: 5 }, corridor: 1, erode: 0.1, packs: 14 },
  // Jagged gouges through the mountain.
  cragmaw_gouge: { width: 40, height: 40, rooms: { count: 8, wMin: 4, wMax: 6, hMin: 4, hMax: 6 }, corridor: 1, erode: 0.55, packs: 12 },
  // Broad scorched vaults.
  ember_catacomb: { width: 46, height: 38, rooms: { count: 9, wMin: 5, wMax: 10, hMin: 4, hMax: 8 }, corridor: 2, erode: 0.15, packs: 15 },
  // Tall cold halls under the crown.
  violet_undercroft: { width: 44, height: 40, rooms: { count: 9, wMin: 5, wMax: 8, hMin: 5, hMax: 8 }, corridor: 2, erode: 0.05, packs: 15 },
};

export const DUNGEONS: Record<DungeonId, DungeonDef> = {
  barrow: {
    id: "barrow", name: "The Barrow Crypt", area: "overworld",
    entrance: { x: 58.5, y: 56.5 }, floors: 5, levelBase: 1, style: "barrow_halls",
    spawnTable: ["z", "z", "s", "s", "r", "e"],
    boss: { typeId: "barrow_lord" },
  },
  fen_hollow: {
    id: "fen_hollow", name: "Fen Hollow", area: "redfen",
    entrance: { x: 62.5, y: 14.5 }, floors: 2, levelBase: 4, style: "root_warren",
    spawnTable: ["h", "s", "m", "r", "z"],
    boss: { typeId: "bog_maw", modifier: "brutal" },
  },
  gallow_vault: {
    id: "gallow_vault", name: "The Gallow Vault", area: "gallowmire",
    entrance: { x: 42.5, y: 70.5 }, floors: 3, levelBase: 6, style: "gallow_ossuary",
    spawnTable: ["w", "m", "h", "r", "e"],
    boss: { typeId: "cairn_wight", modifier: "stoneskin" },
  },
  cragmaw_delve: {
    id: "cragmaw_delve", name: "Cragmaw Delve", area: "cragmaw",
    entrance: { x: 54.5, y: 16.5 }, floors: 2, levelBase: 8, style: "cragmaw_gouge",
    spawnTable: ["w", "w", "h", "m", "r"],
    boss: { typeId: "cairn_wight", modifier: "swift" },
  },
  cinder_catacomb: {
    id: "cinder_catacomb", name: "The Cinder Catacomb", area: "ashfell",
    entrance: { x: 60.5, y: 48.5 }, floors: 3, levelBase: 10, style: "ember_catacomb",
    spawnTable: ["c", "c", "a", "k", "w"],
    boss: { typeId: "ember_hulk", modifier: "volatile" },
  },
  crown_undercroft: {
    id: "crown_undercroft", name: "The Crown Undercroft", area: "hollowcrown",
    entrance: { x: 52.5, y: 46.5 }, floors: 3, levelBase: 12, style: "violet_undercroft",
    spawnTable: ["v", "n", "a", "c", "k"],
    boss: { typeId: "crown_sentinel", modifier: "brutal" },
  },
};

/** Registry insertion order — the one iteration order for generation. */
export const DUNGEON_ORDER = Object.keys(DUNGEONS) as DungeonId[];

export function isDungeonId(id: string): id is DungeonId {
  return id in DUNGEONS;
}
```

In `sim/state.ts`, change the top of the file (keep `floorZone`/`zoneDepth` for now — they die in Task 4):

```ts
import { isDungeonId, type DungeonId } from "./dungeons";

/** The whole open-air world is one zone; dungeon floors are the rest. */
export type ZoneId = "surface" | `floor:${number}` | `dungeon:${DungeonId}:${number}`;

export const dungeonZoneId = (d: DungeonId, floor: number): ZoneId => `dungeon:${d}:${floor}`;

/** The dungeon a zone belongs to; null on the surface. */
export function zoneDungeon(id: ZoneId): DungeonId | null {
  if (!id.startsWith("dungeon:")) return null;
  const d = id.split(":")[1]!;
  return isDungeonId(d) ? d : null;
}

/** Floor within a dungeon, 1-based; 1 anywhere else. */
export function zoneFloor(id: ZoneId): number {
  if (!id.startsWith("dungeon:")) return 1;
  return Number(id.split(":")[2]);
}
```

Note: `dungeons.ts` imports `ChampionModifier` from `monsters.ts`; `monsters.ts` must not import `dungeons.ts` (it doesn't today — verify with `grep -n "dungeons" sim/monsters.ts`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test sim/dungeons.test.ts && bun run build`
Expected: PASS, clean typecheck (the ZoneId union widening is backward-compatible).

- [ ] **Step 5: Commit**

```bash
git add sim/dungeons.ts sim/dungeons.test.ts sim/state.ts
git commit -m "Add the dungeon registry: six finite crypts as data rows"
```

---

### Task 2: The floor generator

**Files:**
- Create: `sim/dungeon-gen.ts`
- Create: `sim/dungeon-gen.test.ts`

**Interfaces:**
- Consumes: `DungeonDef`, `DUNGEON_STYLES` from Task 1; `Rng` from `sim/rng.ts`; `ZoneMap`, `MapMarker`, `isWalkable` from `sim/map.ts`.
- Produces: `generateDungeonFloor(rng: Rng, def: DungeonDef, floor: number): ZoneMap`. Marker contract: `@`-equivalent is `map.spawn`; `<` always present; `>` present iff `floor < def.floors`; bottom floor has `!` (boss) and `$` (vault chest) markers in the vault room; monster pack markers use `def.spawnTable` chars. `camps` is always `[]`.

- [ ] **Step 1: Write the failing test**

```ts
// sim/dungeon-gen.test.ts
import { describe, expect, test } from "bun:test";
import { createRng } from "./rng";
import { generateDungeonFloor } from "./dungeon-gen";
import { DUNGEONS, DUNGEON_ORDER, DUNGEON_STYLES } from "./dungeons";
import { isWalkable, type ZoneMap } from "./map";

/** Flood-fill from spawn; returns the set of reachable cell keys "x,y". */
function reachableFrom(map: ZoneMap): Set<string> {
  const seen = new Set<string>();
  const queue = [{ x: Math.floor(map.spawn.x), y: Math.floor(map.spawn.y) }];
  seen.add(`${queue[0]!.x},${queue[0]!.y}`);
  while (queue.length > 0) {
    const { x, y } = queue.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const k = `${x + dx},${y + dy}`;
      if (seen.has(k) || !isWalkable(map, x + dx, y + dy)) continue;
      seen.add(k);
      queue.push({ x: x + dx, y: y + dy });
    }
  }
  return seen;
}

describe("generateDungeonFloor", () => {
  test("every floor of every dungeon across seeds: markers present and reachable", () => {
    for (const seed of [1, 7, 1234, 99999]) {
      for (const id of DUNGEON_ORDER) {
        const def = DUNGEONS[id];
        for (let floor = 1; floor <= def.floors; floor++) {
          const map = generateDungeonFloor(createRng(seed), def, floor);
          const style = DUNGEON_STYLES[def.style];
          expect(map.width).toBe(style.width);
          expect(map.height).toBe(style.height);
          const reach = reachableFrom(map);
          const chars = map.markers.map((m) => m.ch);
          expect(chars).toContain("<");
          if (floor < def.floors) {
            expect(chars).toContain(">");
            expect(chars).not.toContain("!");
          } else {
            expect(chars).not.toContain(">");
            expect(chars).toContain("!");
            expect(chars).toContain("$");
          }
          for (const m of map.markers) {
            expect(reach.has(`${Math.floor(m.x)},${Math.floor(m.y)}`)).toBe(true);
          }
          // Spawn is walkable and beside the up-stairs, not on them.
          const up = map.markers.find((m) => m.ch === "<")!;
          expect(isWalkable(map, Math.floor(map.spawn.x), Math.floor(map.spawn.y))).toBe(true);
          expect(Math.hypot(map.spawn.x - up.x, map.spawn.y - up.y)).toBeGreaterThan(0.5);
          expect(Math.hypot(map.spawn.x - up.x, map.spawn.y - up.y)).toBeLessThan(3);
        }
      }
    }
  });

  test("deterministic: same seed, same map", () => {
    const a = generateDungeonFloor(createRng(42), DUNGEONS.barrow, 2);
    const b = generateDungeonFloor(createRng(42), DUNGEONS.barrow, 2);
    expect(a.cells).toEqual(b.cells);
    expect(a.markers).toEqual(b.markers);
  });

  test("pack budget respected and drawn from the spawn table", () => {
    const def = DUNGEONS.barrow;
    const map = generateDungeonFloor(createRng(3), def, 1);
    const packs = map.markers.filter((m) => def.spawnTable.includes(m.ch));
    expect(packs.length).toBeGreaterThan(0);
    expect(packs.length).toBeLessThanOrEqual(DUNGEON_STYLES[def.style].packs);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test sim/dungeon-gen.test.ts`
Expected: FAIL — cannot resolve `./dungeon-gen`.

- [ ] **Step 3: Implement the generator**

```ts
// sim/dungeon-gen.ts
import { DUNGEON_STYLES, type DungeonDef } from "./dungeons";
import type { MapMarker, ZoneMap } from "./map";
import type { Rng } from "./rng";

interface Room { x: number; y: number; w: number; h: number }

const center = (r: Room) => ({ x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) });

/**
 * One dungeon floor: scattered rooms joined by L-corridors, optionally eroded
 * into cave-like warrens. Connectivity is by construction — corridors join
 * every room to the previous one, and erosion only ever turns wall into floor
 * beside existing floor — so no seal pass is needed.
 */
export function generateDungeonFloor(rng: Rng, def: DungeonDef, floor: number): ZoneMap {
  const style = DUNGEON_STYLES[def.style];
  const { width: w, height: h } = style;
  const cells = new Uint8Array(w * h); // all wall
  const idx = (x: number, y: number) => y * w + x;

  // --- Rooms: rejection-scatter non-overlapping rects inside a 2-cell rim ---
  const rooms: Room[] = [];
  for (let tries = 0; rooms.length < style.rooms.count && tries < 400; tries++) {
    const rw = rng.int(style.rooms.wMin, style.rooms.wMax);
    const rh = rng.int(style.rooms.hMin, style.rooms.hMax);
    const rx = rng.int(2, w - rw - 3);
    const ry = rng.int(2, h - rh - 3);
    const r = { x: rx, y: ry, w: rw, h: rh };
    // 1-cell gap between rooms so walls stay readable.
    const clash = rooms.some(
      (o) => rx < o.x + o.w + 1 && o.x < rx + rw + 1 && ry < o.y + o.h + 1 && o.y < ry + rh + 1,
    );
    if (clash) continue;
    rooms.push(r);
    for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) cells[idx(x, y)] = 1;
  }

  // --- Corridors: each room L-joins the previous; the chain connects all ---
  const carve = (x: number, y: number): void => {
    for (let o = 0; o < style.corridor; o++) {
      const yy = Math.min(h - 3, y + o);
      const xx = Math.min(w - 3, x + o);
      cells[idx(x, yy)] = 1;
      cells[idx(xx, y)] = 1;
    }
  };
  for (let i = 1; i < rooms.length; i++) {
    const a = center(rooms[i - 1]!);
    const b = center(rooms[i]!);
    for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) carve(x, a.y);
    for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) carve(b.x, y);
  }

  // --- Erosion: wall beside 3+ floor cells may crumble. Only adds floor
  // touching existing floor, so connectivity is preserved by construction. ---
  if (style.erode > 0) {
    const before = new Uint8Array(cells);
    for (let y = 2; y < h - 2; y++) {
      for (let x = 2; x < w - 2; x++) {
        if (before[idx(x, y)] === 1) continue;
        let floors = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if ((dx !== 0 || dy !== 0) && before[idx(x + dx, y + dy)] === 1) floors++;
          }
        }
        if (floors >= 3 && rng.next() < style.erode) cells[idx(x, y)] = 1;
      }
    }
  }

  // --- Fixed features. Up-stairs in the first room; spawn beside them.
  // Down-stairs (or the boss vault) in the room farthest from the first. ---
  const first = center(rooms[0]!);
  const markers: MapMarker[] = [{ ch: "<", x: first.x + 0.5, y: first.y + 0.5 }];
  const spawn = { x: first.x + 1.5, y: first.y + 0.5 }; // rooms are ≥4 wide, in-bounds
  let far = rooms[rooms.length - 1]!;
  let farDist = -1;
  for (const r of rooms.slice(1)) {
    const c = center(r);
    const d = Math.hypot(c.x - first.x, c.y - first.y);
    if (d > farDist) {
      farDist = d;
      far = r;
    }
  }
  const vault = center(far);
  if (floor < def.floors) {
    markers.push({ ch: ">", x: vault.x + 0.5, y: vault.y + 0.5 });
  } else {
    markers.push({ ch: "!", x: vault.x + 0.5, y: vault.y + 0.5 });
    markers.push({ ch: "$", x: vault.x + 1.5, y: vault.y + 0.5 });
  }

  // --- Monster packs on floor cells, clear of spawn and vault ---
  const taken = new Set<number>(markers.map((m) => idx(Math.floor(m.x), Math.floor(m.y))));
  taken.add(idx(Math.floor(spawn.x), Math.floor(spawn.y)));
  let placed = 0;
  for (let tries = 0; placed < style.packs && tries < 2000; tries++) {
    const x = rng.int(2, w - 3);
    const y = rng.int(2, h - 3);
    const key = idx(x, y);
    if (cells[key] !== 1 || taken.has(key)) continue;
    if (Math.hypot(x + 0.5 - spawn.x, y + 0.5 - spawn.y) < 8) continue;
    if (Math.hypot(x + 0.5 - vault.x, y + 0.5 - vault.y) < 4) continue;
    taken.add(key);
    markers.push({ ch: def.spawnTable[rng.int(0, def.spawnTable.length - 1)]!, x: x + 0.5, y: y + 0.5 });
    placed++;
  }

  return { width: w, height: h, cells, spawn, markers, camps: [] };
}
```

Note for the implementer: `spawn` must land on a floor cell. `first` is a room center and rooms are at least `wMin ≥ 4` wide, so `first.x + 1` is still inside the room. The test asserts this; if a style's rooms shrink below 4 wide later, the test catches it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test sim/dungeon-gen.test.ts`
Expected: PASS. If the reachability assertion trips (a pack marker on an isolated eroded cell can't happen since erosion touches existing floor — but a corridor `carve` clamped at bounds could in principle strand width-2 offsets), fix the generator, not the test.

- [ ] **Step 5: Commit**

```bash
git add sim/dungeon-gen.ts sim/dungeon-gen.test.ts
git commit -m "Seeded room-and-corridor generator for dungeon floors"
```

---

### Task 3: Entrances on the surface, floors in the world

**Files:**
- Modify: `sim/zone.ts` (`areaZone` gains `extraMarkers`; the hardcoded `cryptZone` stays until Task 4)
- Modify: `sim/areas.ts` (remove the `{ ch: ">", x: 58.5, y: 56.5 }` row from `overworld.markers`)
- Modify: `sim/surface.ts` (`stitchSurface` injects entrances; add `worldDungeonEntrance`, `dungeonAtEntrance`)
- Modify: `sim/world.ts` (add `ensureDungeonFloor`; `ensureFloor` stays until Task 4)
- Test: `sim/surface.test.ts` (extend), `sim/dungeons.test.ts` (extend)

**Interfaces:**
- Consumes: `DUNGEONS`, `DUNGEON_ORDER` (Task 1), `generateDungeonFloor` (Task 2).
- Produces:
  - `areaZone(rng: Rng, def: AreaDef, extraMarkers: MapMarker[] = [])` — extras join the anchor/trail/output sets exactly like `def.markers` rows.
  - `worldDungeonEntrance(id: DungeonId): Vec` in `surface.ts` — entrance in world coordinates (area offset + local entrance).
  - `dungeonAtEntrance(pos: Vec): DungeonId | null` in `surface.ts` — the dungeon whose world entrance is within 1 cell of `pos`.
  - `ensureDungeonFloor(state: GameState, d: DungeonId, floor: number): ZoneState` in `world.ts` — get-or-generate; spawns pack monsters at `levelBase + floor - 1`, breakables, and (bottom floor) the boss + vault chest.

- [ ] **Step 1: Write the failing tests**

Append to `sim/surface.test.ts`:

```ts
import { DUNGEONS, DUNGEON_ORDER } from "./dungeons";
import { dungeonAtEntrance, worldDungeonEntrance } from "./surface";
import { createRng } from "./rng";
import { stitchSurface } from "./surface";
import { isWalkable } from "./map";

describe("dungeon entrances on the surface", () => {
  test("every dungeon's '>' marker lands on the stitched map, walkable", () => {
    const { map } = stitchSurface(createRng(11));
    for (const id of DUNGEON_ORDER) {
      const at = worldDungeonEntrance(id);
      const m = map.markers.find(
        (mk) => mk.ch === ">" && Math.hypot(mk.x - at.x, mk.y - at.y) < 0.01,
      );
      expect(m).toBeDefined();
      expect(isWalkable(map, Math.floor(at.x), Math.floor(at.y))).toBe(true);
    }
    // Exactly one '>' per dungeon, no strays.
    expect(map.markers.filter((mk) => mk.ch === ">").length).toBe(DUNGEON_ORDER.length);
  });

  test("dungeonAtEntrance resolves each entrance and nothing else", () => {
    for (const id of DUNGEON_ORDER) {
      expect(dungeonAtEntrance(worldDungeonEntrance(id))).toBe(id);
    }
    expect(dungeonAtEntrance({ x: 1.5, y: 1.5 })).toBe(null);
  });
});
```

Append to `sim/dungeons.test.ts` (`soloGame` from `sim/test-helpers.ts` builds a one-player `GameState`):

```ts
import { ensureDungeonFloor } from "./world";
import { soloGame } from "./test-helpers";

describe("ensureDungeonFloor", () => {
  test("bottom floor holds the boss (champion where modified) and a vault chest", () => {
    const state = soloGame(1);
    const zone = ensureDungeonFloor(state, "fen_hollow", DUNGEONS.fen_hollow.floors);
    const boss = [...zone.monsters.values()].find((m) => m.typeId === "bog_maw" && m.rank === "champion");
    expect(boss).toBeDefined();
    expect(boss!.modifier).toBe("brutal");
    const bossMarker = zone.map.markers.find((m) => m.ch === "!")!;
    expect(Math.hypot(boss!.pos.x - bossMarker.x, boss!.pos.y - bossMarker.y)).toBeLessThan(0.01);
    const chestMarker = zone.map.markers.find((m) => m.ch === "$")!;
    const chest = [...zone.breakables.values()].find(
      (b) => b.kind === "chest" && Math.hypot(b.pos.x - chestMarker.x, b.pos.y - chestMarker.y) < 0.01,
    );
    expect(chest).toBeDefined();
  });

  test("the barrow's lord spawns unmodified on floor 5", () => {
    const state = soloGame(2);
    const zone = ensureDungeonFloor(state, "barrow", 5);
    const lord = [...zone.monsters.values()].find((m) => m.typeId === "barrow_lord");
    expect(lord).toBeDefined();
    expect(lord!.rank).toBeUndefined();
  });

  test("pack monsters scale with levelBase + floor - 1", () => {
    const state = soloGame(3);
    const zone = ensureDungeonFloor(state, "crown_undercroft", 2); // levelBase 12 → level 13
    const pack = [...zone.monsters.values()].find((m) => m.rank !== "champion");
    expect(pack!.mlvl).toBeGreaterThanOrEqual(13);
  });

  test("idempotent: second call returns the same zone", () => {
    const state = soloGame(4);
    const a = ensureDungeonFloor(state, "barrow", 1);
    const b = ensureDungeonFloor(state, "barrow", 1);
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test sim/surface.test.ts sim/dungeons.test.ts`
Expected: FAIL — missing exports.

- [ ] **Step 3: Implement**

`sim/zone.ts` — thread extras through `areaZone`:

```ts
export function areaZone(rng: Rng, def: AreaDef, extraMarkers: MapMarker[] = []): ZoneMap {
```

Inside, three edits (the fixed markers list is used in three roles — anchor clearings, trail targets, output rows):
1. `const fixed = [...def.markers, ...extraMarkers];` right at the top; replace every `def.markers` read in the function body with `fixed` (the `anchors` list, the trail `targets` mapping, and the final `const markers: MapMarker[] = fixed.map((m) => ({ ...m }));`).
2. Nothing else changes — extras consume no rng directly (trail carving and clearings are rng-free), so `rng` draw *sites* are untouched.

`sim/areas.ts` — delete the line `{ ch: ">", x: 58.5, y: 56.5 },` from `overworld.markers`.

`sim/surface.ts`:

```ts
import { DUNGEONS, DUNGEON_ORDER, type DungeonId } from "./dungeons";

/** A dungeon's mouth in world coordinates. */
export function worldDungeonEntrance(id: DungeonId): Vec {
  const d = DUNGEONS[id];
  const o = surfaceLayout().offsets[d.area];
  return { x: d.entrance.x + o.x, y: d.entrance.y + o.y };
}

/** Which dungeon's mouth sits at this world position, if any. */
export function dungeonAtEntrance(pos: Vec): DungeonId | null {
  for (const id of DUNGEON_ORDER) {
    const at = worldDungeonEntrance(id);
    if (Math.hypot(pos.x - at.x, pos.y - at.y) < 1) return id;
  }
  return null;
}
```

In `stitchSurface`, build per-area extras and pass them:

```ts
for (const id of AREA_ORDER) {
  const def = AREAS[id];
  const off = layout.offsets[id];
  const mouths: MapMarker[] = DUNGEON_ORDER
    .filter((d) => DUNGEONS[d].area === id)
    .map((d) => ({ ch: ">", x: DUNGEONS[d].entrance.x, y: DUNGEONS[d].entrance.y }));
  const region = areaZone(rng, def, mouths);
  // ...rest unchanged
```

`sim/world.ts`:

```ts
import { DUNGEONS, type DungeonId } from "./dungeons";
import { generateDungeonFloor } from "./dungeon-gen";
import { upgradeToChampion } from "./monsters"; // already imported: spawnMonster etc.
import { dungeonZoneId } from "./state";

/** Get-or-generate one dungeon floor deterministically from the world rng. */
export function ensureDungeonFloor(state: GameState, d: DungeonId, floor: number): ZoneState {
  const id = dungeonZoneId(d, floor);
  const existing = state.zones.get(id);
  if (existing) return existing;
  const def = DUNGEONS[d];
  const level = def.levelBase + floor - 1;
  const zone = makeZone(state, id, generateDungeonFloor(state.rng, def, floor));
  for (const marker of zone.map.markers) {
    const typeId = MARKER_TYPES[marker.ch];
    if (typeId) {
      spawnMonster(state, zone, typeId, { x: marker.x, y: marker.y }, level);
    } else if (marker.ch === "!") {
      const boss = spawnMonster(state, zone, def.boss.typeId, { x: marker.x, y: marker.y }, level);
      if (def.boss.modifier) upgradeToChampion(boss, def.boss.modifier);
    } else if (marker.ch === "$") {
      const bid = state.nextId++;
      zone.breakables.set(bid, { id: bid, kind: "chest", pos: { x: marker.x, y: marker.y } });
    }
  }
  spawnBreakables(state, zone, level);
  return zone;
}
```

- [ ] **Step 4: Run the full suite**

Run: `bun test sim client && bun run build`
Expected: new tests PASS. Existing surface/overworld tests that counted markers may fail if they assumed one `>` — update any that assert the old single-entrance world (check `sim/overworld.test.ts`, `sim/areas.test.ts`, `sim/reachability.test.ts`). The determinism test must still pass (it locks same-seed reproducibility, and generation is still a pure function of the seed).

- [ ] **Step 5: Commit**

```bash
git add sim/zone.ts sim/areas.ts sim/surface.ts sim/world.ts sim/surface.test.ts sim/dungeons.test.ts
git add -u sim  # any existing test updated for the six-entrance world
git commit -m "Every area gets a crypt mouth; dungeon floors materialize from the registry"
```

---

### Task 4: Switch travel over; retire the endless barrow

This is the cutover: stairs route through the registry, `floor:N` / `floorZone` / `zoneDepth` / `cryptZone` / `zoneName` / `ensureFloor` all die, and every reference migrates.

**Files:**
- Modify: `sim/tick.ts` (stairsSystem, travel, resetRun, re-exports)
- Modify: `sim/state.ts` (drop `floor:${number}` from `ZoneId`; delete `floorZone`, `zoneDepth`)
- Modify: `sim/world.ts` (delete `ensureFloor`)
- Modify: `sim/zone.ts` (delete `cryptZone`, `zoneName`; keep `MARKER_TYPES`, `CAMP_TITLE`, `NPC_CLEARING`, `exitMouth`, `areaZone`, `overworldZone`)
- Modify: `sim/surface.ts` (`areaLevelAt`, `locationTitle`)
- Modify: `sim/quests.ts` (objective `reach` gains `dungeon`; repoint barrow quests — full quest work is Task 5, but these two rows must move now or nothing compiles)
- Modify: `sim/test-helpers.ts` (`createGameOn` re-arms its scratch arena on `dungeon:barrow:1`)
- Modify: every test file that references the old ids (list in Step 4)
- Test: `sim/depth.test.ts` (rewrite as the stairs/travel spec), existing suite

**Interfaces:**
- Consumes: `dungeonZoneId`, `zoneDungeon`, `zoneFloor`, `DUNGEONS`, `dungeonAtEntrance`, `worldDungeonEntrance`, `ensureDungeonFloor`.
- Produces: `travel(state, p, to: ZoneId)` unchanged signature; stairs behavior per spec: surface `>` enters floor 1 of `dungeonAtEntrance(marker pos)`; underground `>` descends within the same dungeon; `<` on floor 1 surfaces the player beside that dungeon's world entrance; bottom floors have no `>` by generation.

- [ ] **Step 1: Write the failing test**

Rewrite `sim/depth.test.ts` (read it first; keep any orthogonal assertions by porting them):

```ts
import { describe, expect, test } from "bun:test";
import { DUNGEONS } from "./dungeons";
import { dungeonZoneId, zoneDungeon, zoneFloor, type GameState } from "./state";
import { worldDungeonEntrance } from "./surface";
import { ensureDungeonFloor, stepSolo, travel } from "./tick";
import { player, playerZone, soloGame } from "./test-helpers";

/** Stand the solo player on this floor's marker and step once. */
function walkOnto(state: GameState, ch: string): void {
  const m = playerZone(state).map.markers.find((mk) => mk.ch === ch)!;
  player(state).pos = { x: m.x, y: m.y };
  stepSolo(state, {});
}

describe("dungeon travel", () => {
  test("standing on a surface mouth enters that dungeon's floor 1", () => {
    const state = soloGame(1);
    const at = worldDungeonEntrance("fen_hollow");
    player(state).pos = { ...at };
    stepSolo(state, {});
    expect(player(state).zoneId).toBe("dungeon:fen_hollow:1");
  });

  test("descending stops at the bottom: bottom floor generates no '>'", () => {
    const state = soloGame(1);
    const zone = ensureDungeonFloor(state, "cragmaw_delve", DUNGEONS.cragmaw_delve.floors);
    expect(zone.map.markers.some((m) => m.ch === ">")).toBe(false);
  });

  test("climbing out of floor 1 lands beside the right entrance", () => {
    const state = soloGame(1);
    travel(state, player(state), dungeonZoneId("cinder_catacomb", 1));
    walkOnto(state, "<");
    expect(player(state).zoneId).toBe("surface");
    const at = worldDungeonEntrance("cinder_catacomb");
    expect(Math.hypot(player(state).pos.x - at.x, player(state).pos.y - at.y)).toBeLessThan(2);
  });

  test("descending '>' below ground goes one floor deeper in the same dungeon", () => {
    const state = soloGame(1);
    travel(state, player(state), dungeonZoneId("barrow", 2));
    walkOnto(state, ">");
    expect(player(state).zoneId).toBe("dungeon:barrow:3");
    expect(zoneDungeon(player(state).zoneId)).toBe("barrow");
    expect(zoneFloor(player(state).zoneId)).toBe(3);
  });
});
```

Port the old file's depth-scaling and newGame assertions on top (barrow floors keep the same numbers: `levelBase` 1 ⇒ floor N = level N; after `newGame: true` expect the player on the surface and `state.zones.has("dungeon:barrow:2")` false — floors now regenerate lazily on entry, so do NOT expect floor 1 to pre-exist).

- [ ] **Step 2: Run to verify failure**

Run: `bun test sim/depth.test.ts`
Expected: FAIL (stairs still route to `floor:1`).

- [ ] **Step 3: Implement the cutover**

`sim/tick.ts` — `stairsSystem` becomes:

```ts
export function stairsSystem(state: GameState, zone: ZoneState, players: Player[]): void {
  for (const p of players) {
    if (p.dead || p.zoneId !== zone.id) continue;
    for (const marker of zone.map.markers) {
      if (marker.ch !== ">" && marker.ch !== "<") continue;
      if (Math.hypot(p.pos.x - marker.x, p.pos.y - marker.y) > 0.5) continue;
      if (marker.ch === ">") {
        if (p.zoneId === "surface") {
          // A crypt mouth: which dungeon's, the registry knows.
          const d = dungeonAtEntrance({ x: marker.x, y: marker.y });
          if (d) travel(state, p, dungeonZoneId(d, 1));
        } else {
          const d = zoneDungeon(p.zoneId)!;
          travel(state, p, dungeonZoneId(d, zoneFloor(p.zoneId) + 1));
        }
      } else {
        if (p.zoneId === "surface") continue; // no climbing out of the open sky
        const d = zoneDungeon(p.zoneId)!;
        const floor = zoneFloor(p.zoneId);
        if (floor <= 1) {
          travel(state, p, "surface");
          // Come out beside the mouth you went down, not on top of it.
          const at = worldDungeonEntrance(d);
          const spot = besideCell(getZone(state, "surface").map, at);
          if (spot) p.pos = spot;
        } else {
          const dest = dungeonZoneId(d, floor - 1);
          travel(state, p, dest);
          const spot = besideMarker(getZone(state, dest).map, ">");
          if (spot) p.pos = spot;
        }
      }
      break;
    }
  }
}
```

Generalize the existing `besideMarker` with a position-based sibling (same file, next to it):

```ts
/** A walkable cell center adjacent to a world position. */
function besideCell(map: ZoneMap, at: Vec): Vec | null {
  const cx = Math.floor(at.x);
  const cy = Math.floor(at.y);
  for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]] as const) {
    if (isWalkable(map, cx + dx, cy + dy)) return { x: cx + dx + 0.5, y: cy + dy + 0.5 };
  }
  return null;
}
```

(`besideMarker` keeps its current body but note: with multiple markers of one char it takes the first `>` — that's correct below ground where each floor has at most one.)

`travel` in `tick.ts`:

```ts
export function travel(state: GameState, p: Player, to: ZoneId): void {
  if (to === "surface") ensureSurface(state);
  else ensureDungeonFloor(state, zoneDungeon(to)!, zoneFloor(to));
  // ...rest unchanged
```

`resetRun` in `tick.ts`: replace `ensureFloor(state, 1);` with nothing (floors regenerate lazily on entry; the surface rebuild stays). Update the re-export line `export { ensureFloor, ensureSurface }` → `export { ensureDungeonFloor, ensureSurface }`.

`sim/state.ts`: `ZoneId` drops `` `floor:${number}` ``; delete `floorZone` and `zoneDepth`.

`sim/world.ts`: delete `ensureFloor` and the now-unused `cryptZone`/`floorZone` imports.

`sim/zone.ts`: delete `cryptZone` and `zoneName`.

`sim/surface.ts`:

```ts
/** THE difficulty lookup: region level on the surface, dungeon band below. */
export function areaLevelAt(zoneId: ZoneId, pos: Vec): number {
  if (zoneId === "surface") return AREAS[areaAt(pos)].areaLevel;
  const d = zoneDungeon(zoneId)!;
  return DUNGEONS[d].levelBase + zoneFloor(zoneId) - 1;
}

/** Display name: the region on the surface, the dungeon's name below. */
export function locationTitle(id: ZoneId, pos: Vec): string {
  if (id === "surface") return AREAS[areaAt(pos)].title;
  return DUNGEONS[zoneDungeon(id)!].name;
}
```

`sim/quests.ts` — minimum to compile (Task 5 does the rest):
- `reach` objective: `{ kind: "reach"; area?: AreaId; dungeon?: DungeonId; floor?: number }`.
- `descend_barrow.objective` → `{ kind: "reach", dungeon: "barrow", floor: 3 }`.
- `barrow_lord.objective.zone` → `"dungeon:barrow:5"`.
- The reach check (currently `zoneDepth(p.zoneId) >= o.floor`) becomes:

```ts
if (o.floor !== undefined) {
  return o.dungeon !== undefined && zoneDungeon(p.zoneId) === o.dungeon && zoneFloor(p.zoneId) >= o.floor;
}
```

Client compile fixes (full polish in Task 7, but the build must stay green):
- `client/ui/ZoneBanner.tsx`: `zoneDepth(zoneId)` → `zoneFloor(zoneId)`; label `depth {depth}` → `floor {floor}`.
- `client/ui/BottomBar.tsx`: `` `depth ${zoneDepth(...)}` `` → `` `floor ${zoneFloor(...)}` ``.
- `client/ui/questText.ts`: floor-kill text `` ` on floor ${zoneDepth(o.zone)}` `` → use `zoneDungeon`/`zoneFloor` + `DUNGEONS[...].name` (`` ` in ${DUNGEONS[zoneDungeon(o.zone)!].name}` ``); reach text `Descend to floor ${o.floor} of the barrow` → `` `Descend to floor ${o.floor} of ${DUNGEONS[o.dungeon!].name}` ``.
- `client/main.tsx` (edit on top of the user's uncommitted changes): the two `zoneDepth` call sites (death toast ~line 383, zone-intro sub ~line 500) → `zoneFloor`, wording `floor N`; the intro `sub` for dungeons should read `` `floor ${zoneFloor(e.to)}` ``.
- `client/ambience.ts` compiles untouched (still keyed `"crypt"` — Task 7 replaces it).

- [ ] **Step 4: Sweep the test files**

Run: `bun test sim client 2>&1 | head -80` and fix every failure. Known references to migrate (from grep): `sim/areas.test.ts`, `sim/breakables.test.ts`, `sim/combat.test.ts`, `sim/collision.test.ts`, `sim/corpse.test.ts`, `sim/depth.test.ts` (rewritten in Step 1), `sim/overworld.test.ts`, `sim/multiplayer.test.ts`, `sim/portals.test.ts`, `sim/quests.test.ts`, `sim/town.test.ts`, `sim/stash.test.ts`, `sim/tick.test.ts`, `sim/surface.test.ts`, `sim/xp.test.ts`, `sim/zone.test.ts`. Migration rules:
- `floorZone(n)` / `"floor:N"` → `dungeonZoneId("barrow", n)` / `"dungeon:barrow:N"` (the barrow is the old descent).
- `ensureFloor(state, n)` → `ensureDungeonFloor(state, "barrow", n)`.
- `zoneDepth(id)` → `zoneFloor(id)`; tests asserting monster scaling by depth still hold (barrow `levelBase` is 1, so barrow floor N ⇒ level N, same numbers as before).
- Tests that stood a player on the old fixed `cryptZone()` layout coordinates must switch to marker-relative placement (find `<`/`>`/pack markers on the generated map) — the fixed layout no longer exists.
- `zoneName(...)` assertions → `DUNGEONS.barrow.name` / `locationTitle`.
- A test entering the barrow via the surface `>` at hardcoded world coordinates should use `worldDungeonEntrance("barrow")`.
- `sim/test-helpers.ts` `createGameOn`: `createGame` no longer pre-builds any floor (resetRun stops calling `ensureFloor`), so build the arena explicitly — `const zone = ensureDungeonFloor(state, "barrow", 1);` then overwrite `zone.map = map`, clear the entity maps as today, respawn from markers, and `travel(state, player(state), dungeonZoneId("barrow", 1))`. Every test riding `createGameOn` then works unchanged.

Then: `bun test sim client && bun run build` — everything green.

- [ ] **Step 5: Commit**

```bash
git add -u sim client
git commit -m "Travel routes through the dungeon registry; the endless barrow is gone"
```

---

### Task 5: Boss-kill quest credit and the two new quest lines

**Files:**
- Modify: `sim/state.ts` (`monster_died` event gains `champion: boolean`)
- Modify: `sim/systems/combat.ts` (emit it, ~line 414)
- Modify: `sim/quests.ts` (kill objective gains `champion?: true`; add `fen_hollow_depths` and `gallow_vault_debt` quests)
- Modify: `sim/systems/quests.ts` (kill credit respects the champion flag)
- Modify: `client/ui/questText.ts` (champion-kill wording)
- Modify: `sim/breakables.ts` (vault chest bonus)
- Test: `sim/quests.test.ts`, `sim/breakables.test.ts`

**Interfaces:**
- Consumes: `zoneDungeon`, `zoneFloor`, `DUNGEONS`, `dungeonZoneId`.
- Produces: `SimEvent` `monster_died` includes `champion: boolean`; `QuestObjective` kill variant is `{ kind: "kill"; typeId: string; count: number; zone?: ZoneId; champion?: true }`; `QuestId` union gains `"fen_hollow_depths" | "gallow_vault_debt"`.

- [ ] **Step 1: Write the failing tests**

In `sim/quests.test.ts` (follow the file's existing helpers for accepting quests and killing monsters):

```ts
test("champion-kill objectives ignore ordinary kills of the same type", () => {
  // player has fen_hollow_depths active, standing in dungeon:fen_hollow:2
  // kill a plain bog_maw → count stays 0
  // kill the champion bog_maw → count becomes 1, objective met
});

test("fen_hollow_depths chains off fen_hearts and gallow_vault_debt off soldiers_due", () => {
  expect(QUESTS.fen_hollow_depths.requires).toBe("fen_hearts");
  expect(QUESTS.fen_hollow_depths.giver).toBe("betha");
  expect(QUESTS.gallow_vault_debt.requires).toBe("soldiers_due");
  expect(QUESTS.gallow_vault_debt.giver).toBe("corvin");
});
```

In `sim/breakables.test.ts`:

```ts
import { chestLevelBonus, breakProp } from "./breakables";
import { ensureDungeonFloor } from "./world";
import { dungeonZoneId } from "./state";
import { soloGame } from "./test-helpers";
import { DUNGEONS } from "./dungeons";

test("chestLevelBonus: +2 on a bottom-floor vault chest, 0 elsewhere", () => {
  const state = soloGame(1);
  const bottom = ensureDungeonFloor(state, "barrow", DUNGEONS.barrow.floors);
  const vault = bottom.map.markers.find((m) => m.ch === "$")!;
  expect(chestLevelBonus(bottom.id, { x: vault.x, y: vault.y }, bottom.map)).toBe(2);
  // Same floor, away from the vault: no bonus.
  expect(chestLevelBonus(bottom.id, bottom.map.spawn, bottom.map)).toBe(0);
  // Not the bottom floor: no bonus even at a chest.
  const mid = ensureDungeonFloor(state, "barrow", 1);
  expect(chestLevelBonus(mid.id, mid.map.spawn, mid.map)).toBe(0);
  // Surface: never.
  expect(chestLevelBonus("surface", { x: 10, y: 10 }, bottom.map)).toBe(0);
});

test("breaking the vault chest drops magic-or-better loot", () => {
  const state = soloGame(1);
  const bottom = ensureDungeonFloor(state, "barrow", DUNGEONS.barrow.floors);
  const vault = bottom.map.markers.find((m) => m.ch === "$")!;
  const chest = [...bottom.breakables.values()].find(
    (b) => b.kind === "chest" && Math.hypot(b.pos.x - vault.x, b.pos.y - vault.y) < 0.5,
  )!;
  breakProp(state, bottom, chest);
  const dropped = [...bottom.groundItems.values()];
  expect(dropped.length).toBeGreaterThan(0);
  expect(["magic", "rare"]).toContain(dropped[0]!.item.rarity);
});
```

(Check `Item`'s rarity values in `sim/items/generate.ts` before asserting — if the union includes tiers above rare, widen the expectation to "not normal".)

- [ ] **Step 2: Run to verify failure**

Run: `bun test sim/quests.test.ts sim/breakables.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`sim/state.ts`: add `champion: boolean` to the `monster_died` event variant.

`sim/systems/combat.ts` at the emit site:

```ts
state.events.push({
  type: "monster_died",
  // ...existing fields...
  champion: m.rank === "champion",
});
```

`sim/quests.ts`:

```ts
| { kind: "kill"; typeId: string; count: number; zone?: ZoneId; champion?: true }
```

New rows (dialogue in the file's voice; adjust freely but keep structure):

```ts
fen_hollow_depths: {
  id: "fen_hollow_depths", giver: "betha", turnIn: "betha", name: "The Hollow Under the Fen",
  requires: "fen_hearts",
  objective: { kind: "kill", typeId: "bog_maw", count: 1, zone: dungeonZoneId("fen_hollow", 2), champion: true },
  dialogue: {
    offer: [
      "There's a hollow under the fen where the maws grow fat and old.",
      "The eldest of them has been dragging travelers down its throat for years. End it.",
    ],
    progress: ["The old maw still gurgles down there. I can hear it through the peat."],
    done: ["So the hollow's gone quiet. Good riddance — take this for the smell alone."],
  },
  reward: { gold: 300, xp: 350, item: { baseId: "hatchet", rarity: "rare" } },
},
gallow_vault_debt: {
  id: "gallow_vault_debt", giver: "corvin", turnIn: "corvin", name: "What the Vault Keeps",
  requires: "soldiers_due",
  objective: { kind: "kill", typeId: "cairn_wight", count: 1, zone: dungeonZoneId("gallow_vault", 3), champion: true },
  dialogue: {
    offer: [
      "They buried the Ninth's paymaster in the vault under the mire, coin and all.",
      "He's still down there, still counting. Settle his ledger.",
    ],
    progress: ["Three floors of bone between you and the paymaster. Keep digging."],
    done: ["The ledger's closed. The Ninth rests a little easier — and so do I."],
  },
  reward: { gold: 400, xp: 450 },
},
```

Pick the reward `baseId` from a weapon that exists in `sim/items/bases` at an appropriate level (verify with grep; `hatchet` is known-good from `howler_cull`).

`sim/systems/quests.ts`, in the kill-credit loop after the `typeId`/`zone` checks:

```ts
if (o.champion && !e.champion) continue;
```

`sim/breakables.ts` — export a pure helper and use it in `breakProp`:

```ts
/** Bottom-floor vault chests roll two levels hot; everything else rolls flat. */
export function chestLevelBonus(zoneId: ZoneId, pos: Vec, map: ZoneMap): number {
  const d = zoneDungeon(zoneId);
  if (d === null || zoneFloor(zoneId) !== DUNGEONS[d].floors) return 0;
  const vault = map.markers.find((m) => m.ch === "$");
  return vault && Math.hypot(pos.x - vault.x, pos.y - vault.y) < 0.5 ? 2 : 0;
}
```

In `breakProp`, chests only: `const depthBonus = areaLevelAt(zone.id, target.pos) - 1 + (target.kind === "chest" ? chestLevelBonus(zone.id, target.pos, zone.map) : 0);`

`client/ui/questText.ts`, kill case: when `o.champion`, prefix "the champion " — e.g. `Slay the champion ${monsterPlural(o.typeId, 1)} in ${DUNGEONS[zoneDungeon(o.zone!)!].name}`.

- [ ] **Step 4: Run the suite**

Run: `bun test sim client && bun run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -u sim client
git commit -m "Quest crypts: champion-kill objectives, Betha and Corvin send you under"
```

---

### Task 6: Per-dungeon look and sound

**Files:**
- Modify: `client/render/biomes.ts` (add `DUNGEON_PALETTES`)
- Modify: `client/render/scene.ts` (`createScene` takes a style; underground palette + dressing weights)
- Modify: `client/ambience.ts` (per-style beds)
- Modify: `client/main.tsx` (pass the style; pick the ambience bed) — **on top of the user's uncommitted edits**
- Test: none automated (renderer/HUD verified by playing, per CLAUDE.md); `bun run build` guards types

**Interfaces:**
- Consumes: `DungeonStyleId`, `DUNGEONS`, `DUNGEON_STYLES`, `zoneDungeon` from sim.
- Produces:
  - `interface DungeonPalette { bg: number; fogNear: number; fogFar: number; ambient: number; ambientIntensity: number; wallTint: number; floorTint: number; dressing: { coffins: number; bones: number; columns: number } }` (dressing values are relative weights, 0 disables)
  - `const DUNGEON_PALETTES: Record<DungeonStyleId, DungeonPalette>`
  - `createScene(mount, map, assets, npcs, onItemClick?, surface = false, dungeonStyle?: DungeonStyleId)`
  - `AmbienceBed = BiomeId | DungeonStyleId` (the `"crypt"` bed is renamed `"barrow_halls"`; the other five styles get their own rows).

- [ ] **Step 1: Palettes**

Add to `client/render/biomes.ts` (import `DungeonStyleId` from `../../sim/dungeons`):

```ts
export interface DungeonPalette {
  bg: number;
  fogNear: number;
  fogFar: number;
  ambient: number;
  ambientIntensity: number;
  wallTint: number;
  floorTint: number;
  /** Relative dressing weights; 0 disables that prop family. */
  dressing: { coffins: number; bones: number; columns: number };
}

export const DUNGEON_PALETTES: Record<DungeonStyleId, DungeonPalette> = {
  // The barrow's original look: dead black, grey stone, coffins everywhere.
  barrow_halls: { bg: 0x0a0a0c, fogNear: 20, fogFar: 40, ambient: 0x6a6a80, ambientIntensity: 0.5, wallTint: 0xffffff, floorTint: 0xffffff, dressing: { coffins: 3, bones: 2, columns: 2 } },
  // Warm rot-brown warrens, close air, root-choked: no coffins down here.
  root_warren: { bg: 0x120e08, fogNear: 14, fogFar: 30, ambient: 0x8a7a52, ambientIntensity: 0.45, wallTint: 0x9a7f5c, floorTint: 0x8a7a5e, dressing: { coffins: 0, bones: 2, columns: 0 } },
  // Cold grey-green ossuary light, bone everywhere, ranks of columns.
  gallow_ossuary: { bg: 0x0c1010, fogNear: 18, fogFar: 38, ambient: 0x7e8f84, ambientIntensity: 0.5, wallTint: 0xaab3a4, floorTint: 0x9aa394, dressing: { coffins: 1, bones: 5, columns: 3 } },
  // Raw slate gouges, thin ochre light, bare rock.
  cragmaw_gouge: { bg: 0x0e0d0b, fogNear: 16, fogFar: 34, ambient: 0x8a8070, ambientIntensity: 0.55, wallTint: 0x8f8474, floorTint: 0x7e7466, dressing: { coffins: 0, bones: 1, columns: 1 } },
  // Ember-lit scorched vaults, warm dark, cracked columns.
  ember_catacomb: { bg: 0x130b08, fogNear: 16, fogFar: 34, ambient: 0xa06848, ambientIntensity: 0.5, wallTint: 0xa07862, floorTint: 0x8a6a56, dressing: { coffins: 1, bones: 2, columns: 3 } },
  // Violet-black cold halls, starlight seeping down.
  violet_undercroft: { bg: 0x0b0912, fogNear: 18, fogFar: 38, ambient: 0x8474a4, ambientIntensity: 0.48, wallTint: 0x9a8fb4, floorTint: 0x847a9e, dressing: { coffins: 2, bones: 1, columns: 4 } },
};
```

- [ ] **Step 2: Scene styling**

`client/render/scene.ts`:
- Signature: add `dungeonStyle?: DungeonStyleId` as the last parameter of `createScene`.
- `const pal = !outdoor ? DUNGEON_PALETTES[dungeonStyle ?? "barrow_halls"] : null;`
- Background/fog: replace the underground literals (`0x0a0a0c`, `Fog(bg, 20, 40)`) with `pal.bg`, `pal.fogNear`, `pal.fogFar`.
- Ambient light: underground branch uses `new THREE.AmbientLight(pal.ambient, pal.ambientIntensity)` instead of the `0x6a6a80, 0.5` literals.
- Tinting walls/floors: `placePiece` returns the clone — after each underground `placePiece(...)` call for wall/floor pieces, tint it. Add a helper next to `placePiece`:

```ts
const tintPiece = (clone: THREE.Group, tint: number): void => {
  if (tint === 0xffffff) return;
  const t = new THREE.Color(tint);
  clone.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
      obj.material = obj.material.clone();
      obj.material.color.multiply(t);
    }
  });
};
```

Apply `tintPiece(placePiece(floorPiece, ...), pal.floorTint)` and `tintPiece(placePiece(piece, ...), pal.wallTint)` in the underground tile loop. (Material clones per piece are fine at these map sizes — 44×36 max; if it ever measures slow, memoize one tinted material per source material, but don't build that now.)
- Dressing weights: the crypt-dressing pass currently hardcodes its prop choice. Weight it: where it picks coffin/bones/column per candidate cell, draw from `pal.dressing` (deterministic from the existing cell `hash` — e.g. `const total = coffins + bones + columns; const roll = h % total;` then walk the weights; skip the cell when `total === 0`).

- [ ] **Step 3: Ambience beds**

`client/ambience.ts`:
- `export type AmbienceBed = BiomeId | DungeonStyleId;` (import `DungeonStyleId` from `../sim/dungeons`).
- Rename the `crypt` row to `barrow_halls` and add five sibling rows to `BEDS`, cloning the crypt spec's shape with varied parameters (deeper/faster drips for `root_warren`, dry hiss for `cragmaw_gouge`, low ember rumble for `ember_catacomb`, sparse high shimmer for `violet_undercroft`, slow bone-dry drips for `gallow_ossuary`). Read the `BedSpec` type in the file and stay within it — these are data rows, not new synth code.

- [ ] **Step 4: Wire main.tsx**

`client/main.tsx` (edit on top of the user's uncommitted changes):
- Both `createScene(...)` call sites: pass the style —

```ts
const me = localPlayer(game);
const style = me.zoneId === "surface" ? undefined : DUNGEONS[zoneDungeon(me.zoneId)!].style;
// ...createScene(mount, map, assets, npcs, onItemClick, me.zoneId === "surface", style)
```

- Ambience selection (~line 673): `setAmbience(me2.zoneId === "surface" ? AREAS[areaAt(me2.pos)].biome : DUNGEONS[zoneDungeon(me2.zoneId)!].style);`

- [ ] **Step 5: Build, run, and verify by playing**

Run: `bun test sim client && bun run build`
Expected: PASS, clean build.

Then start the dev server (use the browser preview tooling, not a raw shell server) on port 5197 and verify: walk to the barrow mouth (unchanged look inside — `barrow_halls` reproduces the old palette), then use dev tooling/waypoints to reach at least one other dungeon (e.g. `fen_hollow`) and confirm: different sky/fog/tint, different dressing mix, ambience changes, banner shows "Fen Hollow" + "floor 1", bottom floor has a champion boss and a chest, and no `>` down-stairs. Screenshot proof for the final report.

- [ ] **Step 6: Commit**

```bash
git add client/render/biomes.ts client/render/scene.ts client/ambience.ts client/main.tsx
git commit -m "Each crypt style gets its own palette, dressing, and ambient bed"
```

---

### Task 7: Full-suite verification and docs

**Files:**
- Modify: `CLAUDE.md` (layout line mentions dungeons if the sim file list is enumerated there — it names `sim/` contents; add `dungeons`, `dungeon-gen`)
- Test: whole suite

- [ ] **Step 1: Full verification**

Run: `bun test sim client && bun run build`
Expected: all green. Also `grep -rn "floor:" sim client --include="*.ts" --include="*.tsx" | grep -v "dungeon:"` — no survivors of the old zone-id scheme (string literal `"floor:"` in ids; CSS/latin uses are fine, read matches before deleting anything).

- [ ] **Step 2: Update CLAUDE.md layout line**

In the Layout section, extend the `sim/` line: `sim/ — rng, state, tick, dungeons, dungeon-gen, systems/ (…), items/ (…), character, skills, map`.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "Note the dungeon modules in the project layout"
```
