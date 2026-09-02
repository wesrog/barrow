# Seamless surface: one stitched open world

**Date:** 2026-08-31
**Status:** Approved design, pending implementation plan

## Goal

Walking between the four surface regions (The Wither Moors, The Redfen, The
Gallowmire, The Cragmaw Steps) is truly continuous: the neighbor's terrain is
visible across the border before you cross, position and camera never jump,
there is no fade, and the simulation itself is continuous — monsters chase
across borders, attacks and spells cross them, because there is no border in
the sim at all.

Out of scope (explicitly decided): stairs into the crypt keep the current
fade + scene swap, as do portal and waypoint teleports. Those are inherent
discontinuities; the fade stays as their transition treatment.

## Approach (decided)

**Stitch at generation.** The four regions are generated exactly as today
(same `areaZone`, same rng draw order) but blitted into one large `ZoneMap`
at world creation. The surface becomes a single sim zone. Regions survive as
*data labels over world-space rects* — difficulty, biome, titles, waypoints,
checkpoints — not as zones. Every sim system (AI, combat, collision, pathing,
projectiles, pickup) works across region boundaries with zero cross-zone
logic, because the surface is one map.

Rejected alternatives: per-zone sim with cross-zone plumbing (border bands,
entity mirroring — huge bug surface in every system); dissolving regions
entirely into position-noise difficulty (breaks the registry-as-content-table
convention and save semantics for no present gain).

## Sim design

### Layout, derived from the registry

New `surfaceLayout()`: pure function of `AREAS`. Place `overworld` at the
origin; walk the exit graph; each neighbor sits edge-to-edge with its
reciprocal exits' rows (or columns, for N/S exits) aligned:

- overworld at (0, 0); E exit row 32.
- redfen W exit row 29 → offset (64, +3).
- gallowmire W exit row 45 → offset (144, −13).
- cragmaw W exit row 33 → offset (200, −1).

Offsets are then normalized so the world bounding box starts at (0, 0),
giving a ~272×88 world (~24k cells). The function returns per-area offsets
plus total bounds. Adding a registry row later reshapes the world
automatically — content growth stays rows, not code.

### Stitching at world creation

`ensureSurface(state)` replaces `ensureArea`/`ensureOverworld`:

1. For each area in fixed registry order, run the unchanged
   `areaZone(state.rng, def)` — identical rng stream on every lockstep peer.
2. Blit each region's cells into one big `Uint8Array` at its offset;
   translate markers, spawn, and safe rects into world coordinates.
3. Facing exit channels line up and become real walkable corridors through
   the double rim — the only openings between regions, preserving the
   difficulty-gating geography. Seams elsewhere stay sealed (both rims are
   wall).
4. Spawn monsters and breakables per region during stitching with today's
   leveling rule: region `areaLevel` + distance band from that region's safe
   ground (`bandCap` capped), positions in world coordinates.

`createGame` and `resetRun` generate the whole surface up front. The big
map's `spawn` is the overworld spawn in world coordinates.

### Zone ids and region labels

- ``ZoneId = "surface" | `floor:${number}` ``. `zoneDepth("surface") === 1`.
- `AreaId` remains, as a label only. New helpers in `sim/areas.ts` (or a new
  `sim/surface.ts`):
  - `areaAt(pos: Vec): AreaId` — which region rect contains this world
    position (positions outside any rect resolve to the nearest; in practice
    the walkable landmass is always inside a rect).
  - `worldWaypointPos(area)`, `worldCampRect(area)`, `worldSpawn(area)` —
    registry positions mapped through the layout offset.
- `areaLevelOf` and other difficulty lookups move from zone id to position
  (`areaAt`) or to the monster's own spawn-time level (drops already flow
  from `mlvl`).

### Systems

- **Deleted:** `edgeExitSystem`, `exitEntryPos`, the border teleport. Exits
  in the registry now drive layout only.
- **Safe ground:** `ZoneMap.camp` becomes `camps: Rect[]`; `inCamp` returns
  true inside any of them, so every region's palisade keeps its
  monsters-can't-hit-you protection. Town-specific checks (vendor, healer,
  restock, corpse rescue ring) test the *overworld* camp rect specifically,
  via `worldCampRect("overworld")`.
- **Stairs:** the surface `>` marker descends to floor 1; floor 1's `<`
  surfaces to `"surface"` beside the barrow mouth (world coordinates).
  Deeper floors unchanged.
- **Waypoints/portals:** travel to an area = set `zoneId: "surface"`, `pos:
  worldWaypointPos(area)`. Still emits `traveled` (the client keys its fade
  off that). Portal links (`{zone, pos}`) work unchanged in world coords.
- **Region tracking:** each player gets a current-region label, recomputed
  cheaply per tick while on the surface (4 rect tests). On change the sim
  emits `region_entered { playerId, area }` — drives the client's intro
  card, checkpoint save, HUD zone title, party strip.
- **Checkpoints/saves:** `CharacterSave` shape unchanged (v1);
  `checkpoint`/`waypoints` are already `AreaId`s. `applyCharacter` seats the
  hero at `zoneId: "surface"`, `pos: worldWaypointPos(checkpoint)`.
- **Pathing cap:** click-to-move now runs on a 24k-cell grid; `pathToward`
  gets a node-expansion cap with walk-toward fallback so a pathological
  search can't stall a tick.

### Accepted costs

- All surface monsters (~235) tick whenever anyone is above ground. Idle
  monsters only cheap-wander, so this is fine at 25 Hz. The
  occupied-zones-only freeze still applies to crypt floors.
- Surface events all share `zone: "surface"`; the client culls by distance
  instead of zone id (see below).

## Client design

### One scene for the whole surface

`createScene` builds surface statics per region: each region rect gets its
own biome-tinted ground plane; rocks/dead pines/trunks/tufts go into
per-biome `InstancedMesh` sets (4 biomes × 4 prop types ≈ 16 instanced draws
for ~14k props). Region borders are rim-wall cells covered in rocks, hiding
the hard ground-plane color change. The existing "map identity changed →
dispose & rebuild + fade" check in `main.tsx` is untouched: the surface map
object is stable while walking, so rebuild+fade now fires only for
surface ↔ crypt transitions.

### Blended atmosphere

Background color, fog near/far, and ambient light become per-frame values:
find the hero's region via `areaAt`; within a ~10-cell band of a region
boundary, smoothstep-lerp between the two biome palettes. Walking the
corridor from moors to fen, the sky warms and the fog closes in gradually.

### Transitions

- Border crossing: `region_entered` → intro card (zone title), checkpoint
  save. No fade, no camera cut.
- Teleports (portal, waypoint, stairs): still emit `traveled` → keep the
  quick fade; stairs additionally rebuild the scene (map changed).

### Event culling

Events carrying a position are ignored beyond ~20 cells from the local hero
(sounds, damage numbers, effects); player-targeted events (e.g.
`player_hit`) cull by that player's distance. Party members fighting three
regions away no longer ding the local speakers.

### MiniMap

The full-surface walls canvas still renders once to an offscreen buffer
(~720×360 px at the existing half scale), but the visible widget crops a
window centered on the player. Marker/blip drawing filters to that radius.

### Trailing edges

- Portal tooltips and the party strip name locations via `areaAt(pos)`
  instead of zone id.
- Verify the moon shadow camera keeps tracking the hero across the large
  world (shadow box is 26 units and must follow).

## Testing

TDD for all sim logic, per house rules:

- `surfaceLayout`: reciprocal exits share an aligned world row/column;
  bounds normalized to origin.
- Stitcher: a walkable corridor exists between each adjacent region pair;
  seams are sealed elsewhere; markers/spawns/camps land at offset positions;
  monster levels follow region + distance band.
- `areaAt` edges (boundary cells, corridor cells).
- `region_entered`: fires exactly on label change, both directions.
- Travel: stairs down/up, waypoint jumps, portals, checkpoint restore,
  corpse rescue to the overworld camp.
- Determinism test updated for the new generation order.

Renderer/HUD changes verified by playing (repo convention).

## Migration

None needed for saves: version stays 1, `checkpoint`/`waypoints` were
already `AreaId`s. Existing characters wake at their checkpoint's waypoint
on the stitched surface.
