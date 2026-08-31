# Seamless Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the four surface regions into one stitched sim zone so walking between them is fully continuous — terrain, camera, monsters, combat — with no fade, teleport, or scene rebuild.

**Architecture:** A new `sim/surface.ts` derives each region's world offset from the exit graph and blits the four unchanged per-region generators into one ~272×88 `ZoneMap` at world creation. `ZoneId` becomes `"surface" | floor:N`; `AreaId` survives as label rects (difficulty, biome, titles, waypoints, checkpoints) resolved by position. The client renders the whole surface as one scene with per-region tinted statics and position-blended atmosphere.

**Tech Stack:** TypeScript, Bun (tests: `bun test`), Vite, Three.js, React. Sim is pure/deterministic (no three/react/DOM imports, all randomness via `sim/rng.ts`).

**Spec:** `docs/superpowers/specs/2026-08-31-seamless-surface-design.md`

## Global Constraints

- `sim/` never imports three, react, or the DOM; all randomness through the seeded `Rng` passed around from `state.rng`.
- Determinism: same seed + same input script ⇒ identical state. All world generation draws from `state.rng` in a fixed order (registry order). Anything replayed on peers must be a pure function of sim state.
- Fixed 25 Hz tick; systems run in fixed order inside `step`.
- TDD for all sim logic: failing test first. Renderer/HUD verified by playing (no unit tests for `client/render`/`client/ui` beyond what exists).
- `CharacterSave` stays VERSION 1 — `checkpoint`/`waypoints` remain `AreaId`s; no save migration.
- Test commands: `bun test sim client` (per CLAUDE.md); the final task runs `bun test` (includes `net/`) and `bun run build`.
- Commit after every green task. Commit messages in the repo's plain descriptive style.

## File Structure

- **Create** `sim/surface.ts` — layout math, region-label helpers, and the map stitcher. One responsibility: "where is each region in world space, and what does the stitched surface look like."
- **Create** `sim/surface.test.ts` — tests for layout, helpers, stitcher.
- **Modify** `sim/map.ts` — `ZoneMap.camp?: Rect` → `camps: Rect[]`; `inCamp` checks any.
- **Modify** `sim/path.ts` — expansion cap + best-effort partial path in `findPath`.
- **Modify** `sim/state.ts` — `ZoneId` type, `Player.region`, `region_entered` event.
- **Modify** `sim/world.ts` — `ensureSurface` replaces `ensureArea`/`ensureOverworld`.
- **Modify** `sim/zone.ts` — `zoneTitle` → `locationTitle`/`regionTitle`; `areaZone` emits `camps`.
- **Modify** `sim/areas.ts` — delete `areaLevelOf` (replaced by `areaLevelAt` in surface.ts).
- **Modify** `sim/tick.ts` — travel/stairs/waypoints/safe-ground reworked; `edgeExitSystem` deleted; `regionSystem` added.
- **Modify** `sim/systems/town.ts`, `sim/systems/combat.ts`, `sim/save.ts`, `sim/breakables.ts`, `sim/test-helpers.ts` — call-site updates.
- **Modify** `client/render/scene.ts` — surface mode: per-region statics, blended atmosphere, monster-rig windowing, portal tooltip.
- **Modify** `client/main.tsx` — scene wiring, intro/save on `region_entered`, event distance culling, camp checks.
- **Modify** `client/ui/ZoneBanner.tsx`, `BottomBar.tsx`, `PartyStrip.tsx`, `WaypointPanel.tsx`, `MiniMap.tsx` — position-based titles; windowed minimap.

---

### Task 1: `surfaceLayout` and region-label helpers

**Files:**
- Create: `sim/surface.ts`
- Create: `sim/surface.test.ts`

**Interfaces:**
- Consumes: `AREAS`, `waypointPos`, `AreaId` from `sim/areas.ts`; `Vec` from `sim/map.ts`.
- Produces (later tasks rely on these exact names):
  - `AREA_ORDER: AreaId[]` — registry insertion order; the one iteration order for generation and rendering.
  - `interface Rect { x0: number; y0: number; x1: number; y1: number }` (half-open, cells)
  - `interface SurfaceLayout { offsets: Record<AreaId, Vec>; width: number; height: number }`
  - `surfaceLayout(): SurfaceLayout` (memoized)
  - `inRect(r: Rect, pos: Vec): boolean`
  - `areaRect(id: AreaId): Rect` — region bounds in world coords
  - `areaAt(pos: Vec): AreaId` — containing rect, else nearest rect (clamped distance, `AREA_ORDER` tie-break)
  - `worldWaypointPos(id: AreaId): Vec`
  - `worldCampRect(id: AreaId): Rect`
  - `worldAreaSpawn(id: AreaId): Vec`

- [ ] **Step 1: Write the failing tests**

```ts
// sim/surface.test.ts
import { describe, expect, test } from "bun:test";
import {
  AREA_ORDER,
  areaAt,
  areaRect,
  inRect,
  surfaceLayout,
  worldAreaSpawn,
  worldCampRect,
  worldWaypointPos,
} from "./surface";
import { AREAS } from "./areas";

describe("surfaceLayout", () => {
  test("registry order drives iteration", () => {
    expect(AREA_ORDER).toEqual(["overworld", "redfen", "gallowmire", "cragmaw"]);
  });

  test("current registry stitches to the expected offsets and bounds", () => {
    const layout = surfaceLayout();
    expect(layout.offsets.overworld).toEqual({ x: 0, y: 13 });
    expect(layout.offsets.redfen).toEqual({ x: 64, y: 16 });
    expect(layout.offsets.gallowmire).toEqual({ x: 144, y: 0 });
    expect(layout.offsets.cragmaw).toEqual({ x: 200, y: 12 });
    expect(layout.width).toBe(272);
    expect(layout.height).toBe(88);
  });

  test("every exit pair aligns: the reciprocal mouths share a world row", () => {
    const layout = surfaceLayout();
    for (const id of AREA_ORDER) {
      const def = AREAS[id];
      for (const e of def.exits) {
        const back = AREAS[e.to].exits.find((x) => x.to === id)!;
        // E/W exits: `at` is a row; world rows must match.
        expect(e.at + layout.offsets[id]!.y).toBe(back.at + layout.offsets[e.to]!.y);
      }
    }
  });
});

describe("areaAt", () => {
  test("resolves positions inside each region rect", () => {
    for (const id of AREA_ORDER) {
      const r = areaRect(id);
      expect(areaAt({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 })).toBe(id);
    }
  });

  test("the corridor cells split at the rect boundary", () => {
    expect(areaAt({ x: 63.5, y: 45.5 })).toBe("overworld");
    expect(areaAt({ x: 64.5, y: 45.5 })).toBe("redfen");
  });

  test("positions outside every rect resolve to the nearest region", () => {
    // Above redfen's band (redfen spans y 16..72): 11 cells below redfen's rect,
    // far from every other. And off the west edge, overworld is nearest.
    expect(areaAt({ x: 100, y: 5 })).toBe("redfen");
    expect(areaAt({ x: -5, y: 45 })).toBe("overworld");
  });
});

describe("world helpers", () => {
  test("waypoint, camp, and spawn positions carry their region offset", () => {
    expect(worldWaypointPos("overworld")).toEqual({ x: 10.5, y: 48.5 });
    expect(worldWaypointPos("redfen")).toEqual({ x: 70.5, y: 45.5 });
    expect(worldCampRect("overworld")).toEqual({ x0: 2, y0: 39, x1: 13, y1: 52 });
    expect(worldAreaSpawn("overworld")).toEqual({ x: 7.5, y: 45.5 });
    expect(inRect(worldCampRect("overworld"), { x: 7.5, y: 45.5 })).toBe(true);
    expect(inRect(worldCampRect("overworld"), { x: 20, y: 45.5 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test sim/surface.test.ts`
Expected: FAIL — module `./surface` not found.

- [ ] **Step 3: Implement `sim/surface.ts`**

```ts
// Where each surface region sits in world space, and helpers that resolve
// world positions back to region labels. Pure functions of the AREAS registry.

import { AREAS, waypointPos, type AreaId } from "./areas";
import type { Vec } from "./map";

/** Registry insertion order — the one iteration order for generation and rendering. */
export const AREA_ORDER = Object.keys(AREAS) as AreaId[];

/** Half-open cell rectangle, world coordinates. */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface SurfaceLayout {
  offsets: Record<AreaId, Vec>;
  width: number;
  height: number;
}

export function inRect(r: Rect, pos: Vec): boolean {
  return pos.x >= r.x0 && pos.x < r.x1 && pos.y >= r.y0 && pos.y < r.y1;
}

let cachedLayout: SurfaceLayout | null = null;

/**
 * Region offsets derived from the exit graph: each neighbor sits edge-to-edge
 * with the reciprocal exits' rows (E/W) or columns (N/S) aligned, then the
 * whole arrangement is shifted so the bounding box starts at (0,0).
 */
export function surfaceLayout(): SurfaceLayout {
  if (cachedLayout) return cachedLayout;
  const raw: Partial<Record<AreaId, Vec>> = { [AREA_ORDER[0]!]: { x: 0, y: 0 } };
  const queue: AreaId[] = [AREA_ORDER[0]!];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const def = AREAS[id];
    const at = raw[id]!;
    for (const e of def.exits) {
      if (raw[e.to]) continue;
      const nDef = AREAS[e.to];
      const back = nDef.exits.find((x) => x.to === id);
      if (!back) throw new Error(`no reciprocal exit: ${id} -> ${e.to}`);
      raw[e.to] =
        e.edge === "E"
          ? { x: at.x + def.width, y: at.y + e.at - back.at }
          : e.edge === "W"
            ? { x: at.x - nDef.width, y: at.y + e.at - back.at }
            : e.edge === "S"
              ? { x: at.x + e.at - back.at, y: at.y + def.height }
              : { x: at.x + e.at - back.at, y: at.y - nDef.height };
      queue.push(e.to);
    }
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of AREA_ORDER) {
    const o = raw[id];
    if (!o) throw new Error(`area unreachable from ${AREA_ORDER[0]}: ${id}`);
    minX = Math.min(minX, o.x);
    minY = Math.min(minY, o.y);
    maxX = Math.max(maxX, o.x + AREAS[id].width);
    maxY = Math.max(maxY, o.y + AREAS[id].height);
  }
  const offsets = {} as Record<AreaId, Vec>;
  for (const id of AREA_ORDER) {
    offsets[id] = { x: raw[id]!.x - minX, y: raw[id]!.y - minY };
  }
  cachedLayout = { offsets, width: maxX - minX, height: maxY - minY };
  return cachedLayout;
}

/** A region's bounds in world coordinates. */
export function areaRect(id: AreaId): Rect {
  const o = surfaceLayout().offsets[id];
  const def = AREAS[id];
  return { x0: o.x, y0: o.y, x1: o.x + def.width, y1: o.y + def.height };
}

/** Which region a world position belongs to: containing rect, else nearest. */
export function areaAt(pos: Vec): AreaId {
  let best: AreaId = AREA_ORDER[0]!;
  let bestDist = Infinity;
  for (const id of AREA_ORDER) {
    const r = areaRect(id);
    if (inRect(r, pos)) return id;
    const dx = Math.max(r.x0 - pos.x, 0, pos.x - r.x1);
    const dy = Math.max(r.y0 - pos.y, 0, pos.y - r.y1);
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = id;
    }
  }
  return best;
}

/** The W pad of an area, in world coordinates — where travel and restores land. */
export function worldWaypointPos(id: AreaId): Vec {
  const o = surfaceLayout().offsets[id];
  const w = waypointPos(id);
  return { x: w.x + o.x, y: w.y + o.y };
}

/** An area's safe-ground rect in world coordinates. */
export function worldCampRect(id: AreaId): Rect {
  const o = surfaceLayout().offsets[id];
  const s = AREAS[id].safe;
  return { x0: s.x0 + o.x, y0: s.y0 + o.y, x1: s.x1 + o.x, y1: s.y1 + o.y };
}

/** An area's arrival spawn in world coordinates. */
export function worldAreaSpawn(id: AreaId): Vec {
  const o = surfaceLayout().offsets[id];
  const s = AREAS[id].spawn;
  return { x: s.x + o.x, y: s.y + o.y };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test sim/surface.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add sim/surface.ts sim/surface.test.ts
git commit -m "Surface layout: region world-offsets derived from the exit graph"
```

---

### Task 2: `ZoneMap.camps` — every region's safe ground protects

**Files:**
- Modify: `sim/map.ts` (ZoneMap, `inCamp`, `mapFromStrings`)
- Modify: `sim/zone.ts:264` (`areaZone` return)
- Test: `sim/collision.test.ts` / wherever `inCamp` behavior is asserted today — plus one new test below. Run the whole sim suite to find `.camp` consumers.

**Interfaces:**
- Produces: `ZoneMap.camps: Rect[]` (empty for crypt maps). `inCamp(map, pos)` returns true inside any rect. The `Rect` shape here is structurally `{x0,y0,x1,y1}`, same as `sim/surface.ts`.

- [ ] **Step 1: Write the failing test**

Add to `sim/surface.test.ts`:

```ts
import { mapFromStrings, inCamp } from "./map";

describe("camps", () => {
  test("inCamp checks every rect in camps", () => {
    const map = mapFromStrings(["....", "....", "....", "...."]);
    map.camps = [
      { x0: 0, y0: 0, x1: 2, y1: 2 },
      { x0: 3, y0: 3, x1: 4, y1: 4 },
    ];
    expect(inCamp(map, { x: 1, y: 1 })).toBe(true);
    expect(inCamp(map, { x: 3.5, y: 3.5 })).toBe(true);
    expect(inCamp(map, { x: 2.5, y: 2.5 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test sim/surface.test.ts`
Expected: FAIL — `camps` does not exist on `ZoneMap` (type error) / `inCamp` reads `.camp`.

- [ ] **Step 3: Implement**

In `sim/map.ts`, replace the `camp` field and `inCamp`:

```ts
export interface ZoneMap {
  width: number;
  height: number;
  /** 1 = walkable floor, 0 = wall. Row-major, y * width + x. */
  cells: Uint8Array;
  spawn: Vec;
  /** Non-floor marker characters (monster spawns etc.), at cell centers. */
  markers: MapMarker[];
  /** Safe-ground rectangles (half-open, in cells). Empty below ground. */
  camps: { x0: number; y0: number; x1: number; y1: number }[];
}

/** Is this position on any of the map's safe camp grounds? */
export function inCamp(map: ZoneMap, pos: Vec): boolean {
  return map.camps.some(
    (c) => pos.x >= c.x0 && pos.x < c.x1 && pos.y >= c.y0 && pos.y < c.y1,
  );
}
```

In `mapFromStrings`, return `camps: []`. In `sim/zone.ts` `areaZone`'s return, change `camp: { ...safe }` to `camps: [{ ...safe }]`.

- [ ] **Step 4: Fix compile fallout and run the sim suite**

Run: `bun test sim client` — fix every `.camp` consumer the compiler/tests surface (expected: only construction sites and tests; `campCorpseSpot` and all systems go through `inCamp` already).

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A sim
git commit -m "ZoneMap holds a list of safe rects, ahead of the stitched surface"
```

---

### Task 3: `stitchSurface` — the composite map

**Files:**
- Modify: `sim/surface.ts`
- Test: `sim/surface.test.ts`

**Interfaces:**
- Consumes: `areaZone`, `MARKER_TYPES` from `sim/zone.ts`; `Rng` from `sim/rng.ts`; Task 1 helpers.
- Produces:
  - `interface SurfaceMonsterSpawn { typeId: string; pos: Vec; level: number }`
  - `stitchSurface(rng: Rng): { map: ZoneMap; monsters: SurfaceMonsterSpawn[] }`
  - The returned map: monster markers stripped (they are spawn-time data in `monsters`); feature markers (`V H F W > <`) kept; `spawn` = overworld's spawn in world coords; `camps` = all four safe rects.

- [ ] **Step 1: Write the failing tests**

Add to `sim/surface.test.ts`:

```ts
import { createRng } from "./rng";
import { stitchSurface } from "./surface";
import { isWalkable } from "./map";

describe("stitchSurface", () => {
  const { map, monsters } = stitchSurface(createRng(7));

  test("bounds and spawn", () => {
    expect(map.width).toBe(272);
    expect(map.height).toBe(88);
    expect(map.spawn).toEqual({ x: 7.5, y: 45.5 });
    expect(map.camps.length).toBe(4);
  });

  test("the overworld-redfen corridor is open exactly at the exit rows", () => {
    // Both rims meet at x=63|64; the 3-wide channels sit at world rows 44..46.
    for (let y = 0; y < map.height; y++) {
      const open = y >= 44 && y <= 46;
      expect(isWalkable(map, 63, y)).toBe(open);
      expect(isWalkable(map, 64, y)).toBe(open);
    }
  });

  test("the corridor connects: a walkable path of cells crosses the seam", () => {
    // Flood fill from the overworld spawn must reach redfen's waypoint cell.
    const seen = new Set<number>([Math.floor(45.5) * map.width + Math.floor(7.5)]);
    const stack = [{ x: 7, y: 45 }];
    while (stack.length > 0) {
      const { x, y } = stack.pop()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy;
        const k = ny * map.width + nx;
        if (seen.has(k) || !isWalkable(map, nx, ny)) continue;
        seen.add(k);
        stack.push({ x: nx, y: ny });
      }
    }
    expect(seen.has(45 * map.width + 70)).toBe(true); // redfen waypoint cell (70,45)
  });

  test("feature markers land at world offsets; monster markers are stripped", () => {
    expect(map.markers.filter((m) => m.ch === ">").length).toBe(1);
    expect(map.markers.find((m) => m.ch === ">")).toEqual({ ch: ">", x: 58.5, y: 69.5 });
    expect(map.markers.filter((m) => m.ch === "W").length).toBe(4);
    expect(map.markers.some((m) => m.ch === "z" || m.ch === "h")).toBe(false);
  });

  test("monsters spawn inside their region at region-banded levels", () => {
    expect(monsters.length).toBeGreaterThan(150);
    for (const s of monsters) {
      const region = areaAt(s.pos);
      const def = AREAS[region];
      expect(inRect(areaRect(region), s.pos)).toBe(true);
      expect(s.level).toBeGreaterThanOrEqual(def.areaLevel);
      expect(s.level).toBeLessThanOrEqual(def.areaLevel + def.bandCap);
    }
  });

  test("deterministic: same seed, identical cells and spawns", () => {
    const a = stitchSurface(createRng(99));
    const b = stitchSurface(createRng(99));
    expect(Buffer.from(a.map.cells).equals(Buffer.from(b.map.cells))).toBe(true);
    expect(a.monsters).toEqual(b.monsters);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test sim/surface.test.ts`
Expected: FAIL — `stitchSurface` not exported.

- [ ] **Step 3: Implement `stitchSurface`**

Append to `sim/surface.ts` (new imports: `MapMarker`, `ZoneMap` types from `./map`; `Rng` from `./rng`; `areaZone`, `MARKER_TYPES` from `./zone`):

```ts
export interface SurfaceMonsterSpawn {
  typeId: string;
  pos: Vec;
  level: number;
}

/**
 * The whole surface as one map: each region generated by its unchanged
 * per-region generator (drawing from `rng` in AREA_ORDER — the determinism
 * contract), blitted at its layout offset. Monster markers come back as
 * spawn specs with their region-banded levels; feature markers stay on the map.
 */
export function stitchSurface(rng: Rng): { map: ZoneMap; monsters: SurfaceMonsterSpawn[] } {
  const layout = surfaceLayout();
  const cells = new Uint8Array(layout.width * layout.height); // wall until a region lands
  const markers: MapMarker[] = [];
  const camps: Rect[] = [];
  const monsters: SurfaceMonsterSpawn[] = [];
  for (const id of AREA_ORDER) {
    const def = AREAS[id];
    const off = layout.offsets[id];
    const region = areaZone(rng, def);
    for (let y = 0; y < def.height; y++) {
      for (let x = 0; x < def.width; x++) {
        cells[(y + off.y) * layout.width + (x + off.x)] = region.cells[y * def.width + x]!;
      }
    }
    for (const m of region.markers) {
      const typeId = MARKER_TYPES[m.ch];
      if (typeId) {
        // Packs grow tougher the farther from the safe ground they prowl.
        const dist = Math.hypot(m.x - def.spawn.x, m.y - def.spawn.y);
        const level = def.areaLevel + Math.min(def.bandCap, Math.floor(dist / 28));
        monsters.push({ typeId, pos: { x: m.x + off.x, y: m.y + off.y }, level });
      } else {
        markers.push({ ch: m.ch, x: m.x + off.x, y: m.y + off.y });
      }
    }
    for (const c of region.camps) {
      camps.push({ x0: c.x0 + off.x, y0: c.y0 + off.y, x1: c.x1 + off.x, y1: c.y1 + off.y });
    }
  }
  const o = layout.offsets[AREA_ORDER[0]!];
  const s = AREAS[AREA_ORDER[0]!].spawn;
  return {
    map: {
      width: layout.width,
      height: layout.height,
      cells,
      spawn: { x: s.x + o.x, y: s.y + o.y },
      markers,
      camps,
    },
    monsters,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test sim/surface.test.ts`
Expected: PASS. If the corridor test fails on exact rows, debug the layout math before touching the test — the alignment invariant test from Task 1 must agree with it.

- [ ] **Step 5: Commit**

```bash
git add sim/surface.ts sim/surface.test.ts
git commit -m "stitchSurface: four regions composed into one world map"
```

---

### Task 4: `findPath` expansion cap with best-effort partial paths

**Files:**
- Modify: `sim/path.ts:56` (`findPath`)
- Test: existing path tests file if present, else add to `sim/collision.test.ts`'s neighbor or create `sim/path.test.ts`

**Interfaces:**
- Produces: `findPath(map, start, goal, maxExpanded = 6000): Cell[] | null` — unchanged results for reachable goals within budget; when the budget is exhausted, returns the path to the expanded node closest to the goal (heuristic distance) instead of searching forever; still `null` for goals proven unreachable.

- [ ] **Step 1: Write the failing test**

```ts
// sim/path.test.ts
import { describe, expect, test } from "bun:test";
import { findPath } from "./path";
import { mapFromStrings } from "./map";

describe("findPath expansion cap", () => {
  const open = mapFromStrings(Array.from({ length: 20 }, () => ".".repeat(20)));

  test("a tiny budget still yields a partial path toward the goal", () => {
    const path = findPath(open, { x: 0, y: 0 }, { x: 19, y: 19 }, 6);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(0);
    const last = path![path!.length - 1]!;
    // Strictly closer to the goal than the start was.
    expect(Math.hypot(19 - last.x, 19 - last.y)).toBeLessThan(Math.hypot(19, 19));
  });

  test("unreachable goals still return null", () => {
    const walled = mapFromStrings(["...#.", "...#.", "...#."]);
    expect(findPath(walled, { x: 0, y: 0 }, { x: 4, y: 1 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test sim/path.test.ts`
Expected: FAIL — 4th argument ignored, full path returned (length check on partial fails).

- [ ] **Step 3: Implement**

In `findPath`: add the parameter `maxExpanded = 6000`. Track the best node seen so far, and extract a shared reconstruction helper:

```ts
export function findPath(
  map: ZoneMap,
  start: Cell,
  goal: Cell,
  maxExpanded = 6000,
): Cell[] | null {
```

Inside, after `const closed = new Set<number>();` add:

```ts
  // Best-effort fallback: the expanded node nearest the goal, so a capped
  // search still walks toward a far click instead of standing still.
  let bestKey = startKey;
  let bestH = heuristic(start.x, start.y);

  const reconstruct = (fromKey: number): Cell[] => {
    const path: Cell[] = [];
    let k: number | undefined = fromKey;
    while (k !== undefined && k !== startKey) {
      path.push({ x: k % map.width, y: Math.floor(k / map.width) });
      k = cameFrom.get(k);
    }
    path.reverse();
    return path;
  };
```

(Move the `heuristic` definition above this block.) Replace the goal-reached reconstruction body with `return reconstruct(goalKey);`. After `closed.add(current.k);` add:

```ts
    const h = heuristic(current.x, current.y);
    if (h < bestH) {
      bestH = h;
      bestKey = current.k;
    }
    if (closed.size > maxExpanded) {
      return bestKey === startKey ? null : reconstruct(bestKey);
    }
```

- [ ] **Step 4: Run tests**

Run: `bun test sim` (the whole sim suite — pathing is load-bearing everywhere).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sim/path.ts sim/path.test.ts
git commit -m "findPath caps expansion and walks toward far goals"
```

---

### Task 5: The flip — the surface becomes one zone

This is the atomic semantic change: `ZoneId`, world creation, travel, stairs, town, portals, death, saves, and every test that assumed per-area zones. The world cannot be half-stitched, so this task is bigger than the others; work compiler-error-driven after the type change, using the checklist below so nothing is missed.

**Files:**
- Modify: `sim/state.ts:10` (`ZoneId`), `sim/world.ts`, `sim/tick.ts`, `sim/zone.ts:57-64`, `sim/areas.ts:140-143`, `sim/systems/town.ts`, `sim/systems/combat.ts` (death respawn tail only), `sim/save.ts:165-171`, `sim/breakables.ts:29,113`, `sim/test-helpers.ts`
- Test: new cases in `sim/surface.test.ts`; update `sim/areas.test.ts`, `sim/overworld.test.ts`, `sim/waypoints.test.ts`, `sim/portals.test.ts`, `sim/town.test.ts`, `sim/zone.test.ts`, `sim/depth.test.ts`, `sim/multiplayer.test.ts`, `sim/tick.test.ts`, and any other failures `bun test sim` surfaces.

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces:
  - `type ZoneId = "surface" | \`floor:${number}\`` (`sim/state.ts`)
  - `ensureSurface(state: GameState): ZoneState` (`sim/world.ts`; `ensureArea`/`ensureOverworld` deleted)
  - `travel(state, p, to: ZoneId)` — unchanged signature, `"surface"` aware
  - `locationTitle(id: ZoneId, pos: Vec): string` and `regionTitle(area: AreaId): string` (`sim/zone.ts`; `zoneTitle` deleted)
  - `areaLevelAt(zoneId: ZoneId, pos: Vec): number` (`sim/surface.ts`; `areaLevelOf` deleted)
  - `spawnBreakables(state, zone, depth, opts?: { bounds: Rect; avoid: Vec })` (`sim/breakables.ts`)

- [ ] **Step 1: Write the failing behavior tests**

Add to `sim/surface.test.ts` (imports: `soloGame`, `player` from `./test-helpers`; `stepSolo`, `travel`, `resetRun` from `./tick`; `getZone` from `./state`; `worldWaypointPos`, `worldCampRect`, `inRect` from `./surface`):

```ts
describe("one surface zone", () => {
  test("createGame seats the world in a single surface zone", () => {
    const state = soloGame(3);
    expect(state.zones.has("surface")).toBe(true);
    expect(state.zones.has("overworld" as never)).toBe(false);
    expect(player(state).zoneId).toBe("surface");
    expect(player(state).pos).toEqual({ x: 7.5, y: 45.5 });
  });

  test("walking across the corridor changes region, not zone", () => {
    const state = soloGame(3);
    const p = player(state);
    p.pos = { x: 63.5, y: 45.5 };
    stepSolo(state, { moveTo: { x: 65.5, y: 45.5 } });
    for (let i = 0; i < 60; i++) stepSolo(state, {});
    expect(p.zoneId).toBe("surface");
    expect(p.pos.x).toBeGreaterThan(64);
  });

  test("waypoint travel lands on the destination pad, same zone", () => {
    const state = soloGame(3);
    const p = player(state);
    p.waypoints = ["overworld", "redfen"];
    p.pos = { ...worldWaypointPos("overworld") };
    stepSolo(state, { waypointTo: "redfen" });
    expect(p.zoneId).toBe("surface");
    expect(p.pos).toEqual(worldWaypointPos("redfen"));
  });

  test("stairs still swap zones: surface > floor:1 > surface", () => {
    const state = soloGame(3);
    const p = player(state);
    p.pos = { x: 58.5, y: 69.5 }; // the barrow mouth '>'
    stepSolo(state, {});
    expect(p.zoneId).toBe("floor:1");
    const up = getZone(state, "floor:1").map.markers.find((m) => m.ch === "<")!;
    p.pos = { x: up.x, y: up.y };
    stepSolo(state, {});
    expect(p.zoneId).toBe("surface");
  });

  test("entering an outpost's safe ground stamps that region as checkpoint", () => {
    const state = soloGame(3);
    const p = player(state);
    p.pos = { ...worldWaypointPos("redfen") }; // redfen's pad is on its safe ground
    stepSolo(state, {});
    expect(p.checkpoint).toBe("redfen");
  });

  test("resetRun regenerates one surface and reseats everyone at camp", () => {
    const state = soloGame(3);
    resetRun(state);
    expect([...state.zones.keys()].sort()).toEqual(["floor:1", "surface"]);
    expect(player(state).zoneId).toBe("surface");
    expect(inRect(worldCampRect("overworld"), player(state).pos)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test sim/surface.test.ts`
Expected: FAIL — `"surface"` is not a `ZoneId`, `zones.has("surface")` false, etc.

- [ ] **Step 3: Flip the type and world creation**

1. `sim/state.ts:10`: `export type ZoneId = "surface" | \`floor:${number}\`;` — `zoneDepth` needs no change (non-floor already returns 1).
2. `sim/world.ts`: delete `ensureArea`/`ensureOverworld`; replace with:

```ts
import { AREAS } from "./areas";
import { AREA_ORDER, areaRect, stitchSurface, worldAreaSpawn } from "./surface";

/** Get-or-generate the whole stitched surface deterministically from the world rng. */
export function ensureSurface(state: GameState): ZoneState {
  const existing = state.zones.get("surface");
  if (existing) return existing;
  const { map, monsters } = stitchSurface(state.rng);
  const zone = makeZone(state, "surface", map);
  for (const s of monsters) spawnMonster(state, zone, s.typeId, s.pos, s.level);
  for (const id of AREA_ORDER) {
    spawnBreakables(state, zone, AREAS[id].areaLevel, {
      bounds: areaRect(id),
      avoid: worldAreaSpawn(id),
    });
  }
  return zone;
}
```

3. `sim/breakables.ts:29`: signature `spawnBreakables(state, zone, depth, opts?: { bounds: { x0: number; y0: number; x1: number; y1: number }; avoid: Vec })`. Inside `place`, draw `x = rng.int(b.x0 + 1, b.x1 - 2)` / `y = rng.int(b.y0 + 1, b.y1 - 2)` where `b` defaults to the whole map, and the spawn-distance check compares against `opts?.avoid ?? map.spawn`.

- [ ] **Step 4: Rework tick.ts**

Work through `sim/tick.ts` top to bottom:

- `travel` (line 68): `if (to === "surface") ensureSurface(state); else ensureFloor(state, zoneDepth(to));` — rest unchanged.
- `stairsSystem` (line 102): `>` → `travel(state, p, p.zoneId === "surface" ? floorZone(1) : floorZone(zoneDepth(p.zoneId) + 1))`; `<` → `if (p.zoneId === "surface") continue;` then `const dest: ZoneId = depth <= 1 ? "surface" : floorZone(depth - 1);`.
- **Delete** `exitEntryPos` and `edgeExitSystem` (lines 125–158) and their wiring in `step` (line 425); delete the now-unused `exitMouth` import (keep `exitMouth` itself in zone.ts — `areaZone` uses it).
- `safeGroundArrivalSystem` (line 165): guard becomes `if (zone.id !== "surface") return;`; stamp `p.checkpoint = areaAt(p.pos);`; the restock branch becomes:

```ts
      if (p.checkpoint === "overworld") {
        const occupied = allPlayers(state).some(
          (o) => o !== p && o.zoneId === "surface" && o.wasInCamp && areaAt(o.pos) === "overworld",
        );
        if (!occupied) restock(state, p);
      }
```

- `waypointSystem` (line 183): guard `if (zone.id !== "surface") return;`; iterate **all** `W` markers (the stitched map has four):

```ts
export function waypointSystem(state: GameState, zone: ZoneState, players: Player[]): void {
  if (zone.id !== "surface") return;
  for (const w of zone.map.markers) {
    if (w.ch !== "W") continue;
    const area = areaAt({ x: w.x, y: w.y });
    for (const p of players) {
      if (p.dead || Math.hypot(p.pos.x - w.x, p.pos.y - w.y) > 1.2) continue;
      p.checkpoint = area;
      if (!p.waypoints.includes(area)) {
        p.waypoints = [...p.waypoints, area].sort();
        state.events.push({ type: "waypoint_found", playerId: p.id, area });
      }
    }
  }
}
```

- `applyWaypointInput` (line 200): reject when `dest === areaAt(p.pos)` instead of `dest === p.zoneId`; require standing within 1.6 of **any** `W` marker of the surface map; then `travel(state, p, "surface"); p.pos = { ...worldWaypointPos(dest) };`.
- `resetRun` (line 238): `ensureSurface(state)` instead of `ensureOverworld` (keep `ensureFloor(state, 1)`); `travel(state, p, "surface")`.
- `createGame` (line 265): `ensureSurface(state); ensureFloor(state, 1);`.
- `joinPlayer` (line 282): `getZone(state, "surface")`, `zoneId: "surface"`, `waypoints: ["overworld"]`, `checkpoint: "overworld"` (labels unchanged).
- Line 65's re-exports: `export { ensureFloor, ensureSurface } from "./world";`.

- [ ] **Step 5: Rework town, combat, saves, titles, breakable loot**

- `sim/systems/town.ts:25`: `onCampGround` → `p.zoneId === "surface" && inRect(worldCampRect("overworld"), p.pos)` (import from `../surface`). Lines 104/117: `p.zoneId !== "surface"` (the V/H markers exist only in the moors camp, so the walk-to systems self-limit). Line 275: `getZone(state, "surface")`. Line 286: `link: { zone: "surface", pos: campPos }`.
- `sim/systems/combat.ts` death respawn tail (after the `player_died` event, ~line 440): replace the checkpoint respawn's travel + position with `travel(state, p, "surface"); p.pos = { ...worldWaypointPos(p.checkpoint) };` (import `worldWaypointPos` from `../surface`).
- `sim/save.ts:168-170`: replace `ensureArea(state, p.checkpoint)` with `ensureSurface(state)` (import from `./world`), `p.zoneId = "surface"`, `p.pos = { ...worldWaypointPos(p.checkpoint) }` (import from `./surface`). Delete the now-unused `waypointPos` import.
- `sim/zone.ts:57-64`: delete `zoneTitle`; add:

```ts
import { areaAt } from "./surface";
import type { Vec } from "./map";

/** Display name for a location: the region under `pos` on the surface, depth names below. */
export function locationTitle(id: ZoneId, pos: Vec): string {
  if (id === "surface") return AREAS[areaAt(pos)].title;
  return zoneName(zoneDepth(id));
}

/** Display name for a region label. */
export const regionTitle = (area: AreaId): string => AREAS[area].title;
```

  (If this creates an import cycle `zone → surface → zone` — surface.ts imports `areaZone`/`MARKER_TYPES` from zone.ts — move `locationTitle`/`regionTitle` into `sim/surface.ts` instead and update importers; the cycle check is `bun run build`.)
- `sim/areas.ts:140-143`: delete `areaLevelOf`. In `sim/surface.ts` add:

```ts
/** THE difficulty lookup: region level at a surface position, floor number below. */
export function areaLevelAt(zoneId: ZoneId, pos: Vec): number {
  return zoneId === "surface" ? AREAS[areaAt(pos)].areaLevel : zoneDepth(zoneId);
}
```

- `sim/breakables.ts:113`: `const depthBonus = (areaLevelAt(zone.id, target.pos) - 1) * 3;` (adjust to the actual local variable holding the smashed breakable's position at that line).
- `sim/test-helpers.ts`: no signature changes needed (`soloGame`, `createGameOn` are floor-based) — just confirm it compiles.

- [ ] **Step 6: Make the whole sim suite green**

Run: `bun test sim` and fix every failure. Mechanical substitutions for existing tests:

| Old pattern | New pattern |
| --- | --- |
| `travel(state, p, "redfen")` (any area id) | `travel(state, p, "surface"); p.pos = { ...worldWaypointPos("redfen") };` |
| `p.zoneId` expected `"overworld"`/area id | expected `"surface"` (assert region via `areaAt(p.pos)` when the test cares which region) |
| `getZone(state, "overworld")` | `getZone(state, "surface")` |
| `zoneOf(...)` on a surface player | unchanged (now the surface zone) |
| `ensureArea(state, id)` / `ensureOverworld(state)` | `ensureSurface(state)` |
| positions taken from `AREAS[id]` markers/spawn | add the region's offset: `worldWaypointPos(id)`, `worldAreaSpawn(id)`, or `surfaceLayout().offsets[id]` |
| `zoneTitle(id)` | `regionTitle(area)` or `locationTitle(zoneId, pos)` |
| assertions that crossing an exit emits `traveled` | crossing emits nothing; the player simply walks (Task 6 adds `region_entered`) |

Delete tests that only exercised the deleted teleport (`edgeExitSystem` cases in `sim/areas.test.ts`/`overworld.test.ts`); their replacement is the "walking across the corridor" test from Step 1. Keep every behavioral test (waypoints, portals, town, corpse rescue, checkpoint restore) — port them, don't drop them.

Expected: `bun test sim` PASS, and `bun test net` PASS (the lockstep/snapshot tests must survive the new state shape — `camps` and the stitched map serialize as plain data; if `net/snapshot.ts` special-cases fields by name, extend it the same way `cells` is handled).

- [ ] **Step 7: Commit**

```bash
git add -A sim net
git commit -m "The surface is one zone: regions become labels over a stitched world"
```

---

### Task 6: Region tracking and the `region_entered` event

**Files:**
- Modify: `sim/state.ts` (Player field + event), `sim/tick.ts` (system + wiring), `sim/save.ts` (seed region on restore)
- Test: `sim/surface.test.ts`

**Interfaces:**
- Produces:
  - `Player.region: AreaId` — last surface region this player stood in (retained while below ground).
  - `SimEvent` member: `{ type: "region_entered"; playerId: PlayerId; area: AreaId }`
  - `regionSystem(state, zone, players)` in `sim/tick.ts`, wired after `movementSystem`/before `safeGroundArrivalSystem` in `step`'s grounded block.

- [ ] **Step 1: Write the failing tests**

```ts
describe("region_entered", () => {
  test("crossing the corridor emits region_entered exactly once", () => {
    const state = soloGame(3);
    const p = player(state);
    p.pos = { x: 63.5, y: 45.5 };
    p.region = "overworld";
    const areas: string[] = [];
    for (let i = 0; i < 60; i++) {
      stepSolo(state, i === 0 ? { moveTo: { x: 66.5, y: 45.5 } } : {});
      for (const e of state.events) {
        if (e.type === "region_entered") areas.push(e.area);
      }
    }
    expect(areas).toEqual(["redfen"]);
    expect(p.region).toBe("redfen");
  });

  test("no event fires while pacing inside one region", () => {
    const state = soloGame(3);
    for (let i = 0; i < 10; i++) {
      stepSolo(state, {});
      expect(state.events.some((e) => e.type === "region_entered")).toBe(false);
    }
  });

  test("descending keeps the last surface region", () => {
    const state = soloGame(3);
    const p = player(state);
    p.pos = { x: 58.5, y: 69.5 };
    stepSolo(state, {});
    expect(p.zoneId).toBe("floor:1");
    expect(p.region).toBe("overworld");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test sim/surface.test.ts`
Expected: FAIL — `region` missing on Player / no event.

- [ ] **Step 3: Implement**

- `sim/state.ts`: add to `Player` (after `checkpoint`): `/** Last surface region this player stood in; kept while below ground. */ region: AreaId;` and to `SimEvent`: `| { type: "region_entered"; playerId: PlayerId; area: AreaId }`.
- `sim/tick.ts` `joinPlayer`: `region: "overworld",`. `sim/save.ts` `applyCharacter`: `p.region = p.checkpoint;`.
- `sim/tick.ts`, new system next to `safeGroundArrivalSystem`:

```ts
/** Track which region each surface player stands in; announce crossings. */
export function regionSystem(state: GameState, zone: ZoneState, players: Player[]): void {
  if (zone.id !== "surface") return;
  for (const p of players) {
    const r = areaAt(p.pos);
    if (r !== p.region) {
      p.region = r;
      state.events.push({ type: "region_entered", playerId: p.id, area: r });
    }
  }
}
```

- Wire in `step`'s grounded block: `movementSystem(grounded()); regionSystem(state, zone, grounded()); safeGroundArrivalSystem(...)`.

- [ ] **Step 4: Run tests**

Run: `bun test sim net`
Expected: PASS (net snapshot picks up the new plain field automatically).

- [ ] **Step 5: Commit**

```bash
git add sim net
git commit -m "region_entered: the sim announces surface crossings"
```

---

### Task 7: Scene — surface mode with per-region statics and blended atmosphere

Renderer work: no unit tests; verify by typecheck plus playing (Task 10 is the full playtest).

**Files:**
- Modify: `client/render/scene.ts`

**Interfaces:**
- Consumes: `AREA_ORDER`, `areaRect`, `areaAt` from `../../sim/surface`; `AREAS` from `../../sim/areas`; `BIOME_PALETTES` from `./biomes`; `locationTitle` (or its final home from Task 5) for the portal tooltip.
- Produces: `createScene(mount, map, assets, onItemClick?, surface = false)` — the `palette?: BiomePalette` parameter is **replaced** by the boolean; `main.tsx` (Task 8) passes `localPlayer(game).zoneId === "surface"`.

- [ ] **Step 1: Switch the signature and outdoor gate**

`createScene(mount, map, assets, onItemClick?, surface = false)`; `const outdoor = surface;`. Delete the old `palette` parameter and every `palette!.` read — the outdoor branch now resolves palettes per region (Step 2) and atmosphere per frame (Step 3). Initialize background/fog/ambient from the hero's starting region: use `BIOME_PALETTES[AREAS[areaAt(map.spawn)].biome]` as the initial values (the per-frame blend immediately corrects for the real hero position). Keep the crypt (`!outdoor`) branch byte-for-byte.

- [ ] **Step 2: Per-region outdoor statics**

Replace the single ground plane + single instanced pass (scene.ts lines ~300–365) with a loop over regions:

```ts
  } else {
    for (const areaId of AREA_ORDER) {
      const rect = areaRect(areaId);
      const pal = BIOME_PALETTES[AREAS[areaId].biome];
      const rw = rect.x1 - rect.x0;
      const rh = rect.y1 - rect.y0;
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(rw, rh), flatMat(pal.ground, 1));
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(rect.x0 + rw / 2, 0, rect.y0 + rh / 2);
      ground.receiveShadow = true;
      scene.add(ground);

      const rockMats: THREE.Matrix4[] = [];
      const pineMats: THREE.Matrix4[] = [];
      const trunkMats: THREE.Matrix4[] = [];
      const tuftMats: THREE.Matrix4[] = [];
      // ...the existing per-cell loop, verbatim, but over
      //    y in [rect.y0, rect.y1), x in [rect.x0, rect.x1)
      //    (world coords — `hash(x, y)` keys stay world-stable), and the
      //    `border` check against rect edges instead of map edges.
      addInstanced(new THREE.IcosahedronGeometry(0.62, 0), pal.rock, rockMats, true);
      addInstanced(new THREE.ConeGeometry(0.5, 1.7, 5), pal.pine, pineMats, true);
      addInstanced(new THREE.CylinderGeometry(0.08, 0.12, 0.55, 5), pal.trunk, trunkMats, false);
      addInstanced(new THREE.ConeGeometry(0.12, 0.2, 4), pal.tuft, tuftMats, false);
    }
  }
```

Hoist `addInstanced` above the loop (it closes over `scene` only). Everything downstream (stairs, pads, vendor/healer, campfire) already reads world-coordinate markers off the stitched map and needs no change.

- [ ] **Step 3: Per-frame atmosphere blending**

Module-scope inside `createScene` (outdoor only):

```ts
  const BLEND = 10; // cells on each side of a border that participate in the mix
  const bands = AREA_ORDER.map((id) => ({
    rect: areaRect(id),
    pal: BIOME_PALETTES[AREAS[id].biome],
  })).sort((a, b) => a.rect.x0 - b.rect.x0);
  const bgColor = new THREE.Color();
  const ambColor = new THREE.Color();
  const tmpColor = new THREE.Color();

  /** Blend the hero's region palette with a neighbor's near the border. */
  const applyAtmosphere = (x: number, ambient: THREE.AmbientLight) => {
    let i = bands.findIndex((b) => x < b.rect.x1);
    if (i < 0) i = bands.length - 1;
    const cur = bands[i]!;
    let other = cur;
    let t = 0; // 0 = pure current, 0.5 = standing on the border
    if (i > 0 && x - cur.rect.x0 < BLEND) {
      other = bands[i - 1]!;
      t = 0.5 * (1 - (x - cur.rect.x0) / BLEND);
    } else if (i < bands.length - 1 && cur.rect.x1 - x < BLEND) {
      other = bands[i + 1]!;
      t = 0.5 * (1 - (cur.rect.x1 - x) / BLEND);
    }
    bgColor.set(cur.pal.bg).lerp(tmpColor.set(other.pal.bg), t);
    (scene.background as THREE.Color).copy(bgColor);
    const fog = scene.fog as THREE.Fog;
    fog.color.copy(bgColor);
    fog.near = cur.pal.fogNear + (other.pal.fogNear - cur.pal.fogNear) * t;
    fog.far = cur.pal.fogFar + (other.pal.fogFar - cur.pal.fogFar) * t;
    ambColor.set(cur.pal.ambient).lerp(tmpColor.set(other.pal.ambient), t);
    ambient.color.copy(ambColor);
    ambient.intensity =
      cur.pal.ambientIntensity + (other.pal.ambientIntensity - cur.pal.ambientIntensity) * t;
  };
```

Keep a reference to the `AmbientLight` instead of adding it anonymously (line ~114), and in `render()` — next to the existing hero-follow block at ~line 928 (`heroLight.position.set(px, 1.6, py)`) — call `if (outdoor) applyAtmosphere(px, ambient);`. The moon/camera already follow the hero (lines 1169–1172), so shadows track for free.

- [ ] **Step 4: Monster-rig windowing**

~235 skinned rigs is too many to keep alive. In the monster sync block (~line 932–1010): when creating rigs in the `for (const monster of zoneOf(state, me).monsters.values())` loop, `continue` if `Math.hypot(monster.pos.x - me.pos.x, monster.pos.y - me.pos.y) > 28`; in the stale-rig cleanup loop, also drop rigs whose monster is farther than 32 (hysteresis so border-pacing doesn't churn rigs). Apply the same 28-cell window to the minimap-independent corpse spawner if profiling in Task 10 shows churn — otherwise leave corpses alone.

- [ ] **Step 5: Portal tooltip**

Line ~1337: `zoneTitle(portal.link.zone)` → `locationTitle(portal.link.zone, portal.link.pos)`.

- [ ] **Step 6: Typecheck**

Run: `bun run build`
Expected: scene.ts compiles; remaining errors point at `main.tsx`/HUD (Task 8's job — if the build noise obscures scene errors, run `bunx tsc --noEmit client/render/scene.ts` equivalents or just proceed once scene.ts's own errors are gone).

- [ ] **Step 7: Commit**

```bash
git add client/render/scene.ts
git commit -m "Scene: one surface render — per-region statics, blended sky and fog"
```

---

### Task 8: Client shell and HUD — wiring, intro cards, event culling

**Files:**
- Modify: `client/main.tsx`, `client/ui/ZoneBanner.tsx`, `client/ui/BottomBar.tsx`, `client/ui/PartyStrip.tsx`, `client/ui/WaypointPanel.tsx`

**Interfaces:**
- Consumes: `areaAt`, `inRect`, `worldCampRect` from `../sim/surface`; `locationTitle`, `regionTitle`, `CAMP_TITLE` from their Task-5 home; `region_entered` event.

- [ ] **Step 1: main.tsx wiring**

- Delete `zonePalette` (line 38) and the `isAreaId`/`AREAS`/`BIOME_PALETTES` imports it needed. Both `createScene` calls (lines ~115 and ~504) pass `localPlayer(game).zoneId === "surface"` as the last argument.
- `onCampGround` (line 43): `p.zoneId === "surface" && inRect(worldCampRect("overworld"), p.pos)`.
- The scene-rebuild check (line 501) stays exactly as is — the surface map object is stable, so it now fires only for stairs.

- [ ] **Step 2: Event handling in `drainEvents`**

- Distance culling, inserted right after the existing zone filter (line ~363):

```ts
        // One shared surface zone means zone-filtering no longer localizes
        // events; anything with a position that isn't ours gets range-culled.
        const me = localPlayer(game);
        if (
          "pos" in e &&
          !("playerId" in e && e.playerId === localId()) &&
          e.type !== "player_died" &&
          Math.hypot(e.pos.x - me.pos.x, e.pos.y - me.pos.y) > 24
        ) {
          continue;
        }
```

  (`player_died` is exempted so the party toast always shows. Match the surrounding loop's `continue`/`return` style.)
- `traveled` case (line 375): keep `play("portal")` and the panel-closing; close shop/healer on **every** local travel (any travel leaves the camp). Intro card becomes:

```ts
                const title = locationTitle(e.to, localPlayer(game).pos);
                setIntro((prev) =>
                  prev?.title === title
                    ? prev
                    : {
                        seq: nextIntroSeq++,
                        title,
                        sub: e.to === "surface" ? undefined : `depth ${zoneDepth(e.to)}`,
                      },
                );
```

- New `region_entered` case:

```ts
            case "region_entered":
              if (e.playerId === localId()) {
                const title = regionTitle(e.area);
                setIntro((prev) => (prev?.title === title ? prev : { seq: nextIntroSeq++, title }));
                save(); // a border crossing is a moment worth keeping
              }
              break;
```

- `waypoint_found` toast (line 395): `regionTitle(e.area)`.
- `player_died` toast (line ~306): surface branch uses `locationTitle(e.zone, e.pos)`; the `isAreaId(e.zone)` check becomes `e.zone === "surface"`.

- [ ] **Step 3: HUD components**

- `ZoneBanner.tsx`: `underground = zoneId !== "surface"`; `onCampGround = zoneId === "surface" && inRect(worldCampRect("overworld"), p.pos)`; title `onCampGround ? CAMP_TITLE : locationTitle(zoneId, p.pos)`. Drop the `isAreaId`/`inCamp`/`zoneOf` imports it no longer needs.
- `BottomBar.tsx` line 241: same `onCampGround` expression as above. Lines 295–299: `localPlayer(game).zoneId === "surface" ? (inRect(worldCampRect("overworld"), pos) ? "safe ground" : locationTitle("surface", pos).toLowerCase()) : \`depth ${zoneDepth(zoneId)}\``.
- `PartyStrip.tsx` line 56: `locationTitle(p.zoneId, p.pos)` (line 34's `sameZone` comparison by `zoneId` stays — "on the surface together" is the right granularity for the strip's dimming).
- `WaypointPanel.tsx` line 49: `const here = p.zoneId === "surface" && id === areaAt(p.pos);`.

- [ ] **Step 4: Typecheck and test**

Run: `bun run build && bun test client`
Expected: clean build; client tests (save/names/itemCompare/fx) PASS.

- [ ] **Step 5: Commit**

```bash
git add client
git commit -m "Client rides one surface: region cards, range-culled events, position titles"
```

---

### Task 9: MiniMap window

**Files:**
- Modify: `client/ui/MiniMap.tsx`

**Interfaces:**
- Consumes: nothing new — pure canvas change.

- [ ] **Step 1: Implement the crop**

Keep the full-map offscreen walls buffer exactly as built today (at `SCALE = 2` the surface buffer is (272+88)·2 = 720 × 360 px — fine to hold). Present a fixed window:

```ts
  const WINDOW_W = 280;
  const WINDOW_H = 160;
  const windowed = canvasW > WINDOW_W || canvasH > WINDOW_H;
```

The `<canvas>` element's `width`/`height` become `windowed ? WINDOW_W : canvasW` / `windowed ? WINDOW_H : canvasH`. In `draw()`, compute the view origin from the local hero and offset everything by it:

```ts
      const me = localPlayer(game);
      const vx = windowed ? projX(me.pos.x, me.pos.y) - WINDOW_W / 2 : 0;
      const vy = windowed ? projY(me.pos.x, me.pos.y) - WINDOW_H / 2 : 0;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(base, -vx, -vy);
```

Every subsequent blip draw subtracts `vx`/`vy` from its projected coordinates (wrap the two helpers once: `const sx = (x: number, y: number) => projX(x, y) - vx;` etc., and use `sx`/`sy` throughout `draw`). Skip blips landing outside `[−4, WINDOW+4]` in either axis so the loop over ~235 monsters stays cheap and nothing paints under the HUD.

- [ ] **Step 2: Typecheck**

Run: `bun run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add client/ui/MiniMap.tsx
git commit -m "MiniMap crops a window around the hero on big maps"
```

---

### Task 10: Full verification — suite, determinism, playtest

**Files:**
- Possibly modify: whatever the checks below surface.

- [ ] **Step 1: Full test suite and build**

Run: `bun test && bun run build`
Expected: every suite green (sim, client, net), clean build. The multiplayer/determinism tests (`sim/multiplayer.test.ts`, `net/session.test.ts`) are the canary for rng-order mistakes in `stitchSurface` — if they fail, the fix is in generation order, never in the test.

- [ ] **Step 2: Playtest the seams** (use the project's dev server on port 5199 via the browser preview, not Bash)

Walkthrough checklist — each item is a spec acceptance criterion:

1. Spawn in camp: banner "The Camp", vendor/healer/waypoint work, shop restocks.
2. Walk east out of the moors through the corridor into the Redfen: **no fade, no camera cut, no rebuild**; the fen terrain and its monsters are visible across the border before crossing; the sky/fog warm gradually; "The Redfen" card shows.
3. Aggro a fen monster and walk back west: it chases into the moors and keeps fighting. Firebolt/attack targets standing on the far side of the border connect.
4. Waypoint from Redfen back to camp: quick fade, no scene rebuild, position jump lands on the pad.
5. Descend the barrow mouth: fade + scene swap to the crypt; climb back out: fade + swap back, standing beside the mouth.
6. Town portal from the Gallowmire: both ends work; tooltip names the right regions.
7. Die in the Redfen: respawn at checkpoint's pad; corpse reclaim works; toast names the region.
8. Minimap: window follows the hero; blips stay inside the widget.
9. Reload the page: character wakes at its checkpoint region's pad.
10. Watch the FPS meter/devtools while panning across a border — no hitches from rig churn (if there are, tighten the Task 7 Step 4 window radii).

- [ ] **Step 3: Fix anything the playtest surfaces, re-run `bun test`, and commit**

```bash
git add -A
git commit -m "Seamless surface: the moors, fen, mire, and crag are one continuous world"
```
