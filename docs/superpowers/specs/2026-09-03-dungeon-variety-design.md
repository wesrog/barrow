# Dungeon Variety — Design

2026-09-03

## Problem

The world has exactly one dungeon: the barrow off the overworld. It is endless,
and every floor is the same handcrafted `cryptZone()` map repeated with only
monster level and a depth-bucket name changing. There is no reason to descend
past the quest floors, and no underground variety anywhere else in the world.

## Goal

Replace the endless barrow with a roster of **finite dungeons**, one per
surface area — some tied to quests, some pure side crypts — each with
procedurally generated floors, a bottom-floor payoff, and its own visual and
audio identity. No endless dungeon remains: every crypt has a bottom.

## Non-goals

- New wall/floor meshes or bespoke boss monster types (side-crypt bosses reuse
  the champion system; the Barrow Lord already exists).
- An endgame endless/rift mode (possible later; out of scope here).
- Quests for every dungeon (three side crypts ship questless).

## Data model

New `sim/dungeons.ts`, a plain typed table in the `AREAS` mold:

```ts
export type DungeonId =
  | "barrow" | "fen_hollow" | "gallow_vault"
  | "cragmaw_delve" | "cinder_catacomb" | "crown_undercroft";

export interface DungeonDef {
  id: DungeonId;
  name: string;                        // "The Barrow Crypt"
  area: AreaId;                        // host surface area
  entrance: { x: number; y: number };  // '>' spot in that area (area-local coords)
  floors: number;                      // finite: 1–5
  levelBase: number;                   // monster level at floor 1, +1 per floor
  style: DungeonStyleId;               // generator params + client palette key
  spawnTable: string[];                // weighted marker chars, like AreaDef
  boss: { typeId: string; modifier?: string; name?: string };
  quest?: QuestId;                     // present on quest crypts only
}
```

### Zone identity

- `ZoneId` becomes `"surface" | \`dungeon:${DungeonId}:${number}\``.
- The `floor:${n}` form, `floorZone(n)`, and the handcrafted `cryptZone()` are
  retired. `zoneDepth(id)` is replaced by `zoneFloor(id)` (floor within its
  dungeon, 1-based) and `zoneDungeon(id)` (the DungeonId, or null on surface).
- Saves need no migration: the save layer already respawns loaded players on
  the surface and regenerates zones from the world rng.

### Stairs and travel

- Standing on `>` on the surface enters floor 1 of the dungeon whose entrance
  that marker belongs to; below ground it descends one floor.
- The bottom floor's map simply contains no `>` — the floor cap is enforced by
  generation, not by a runtime clamp.
- `<` on floor 1 surfaces the player beside that dungeon's entrance in its
  host area (today's behavior, generalized from the single barrow mouth).
- `ensureFloor(state, n)` becomes `ensureDungeonFloor(state, dungeonId, floor)`,
  keyed off the registry, deterministic from the world rng as today.

## Generation

New seeded generator `dungeonZone(rng, style, floor, def)` (new file
`sim/dungeon-gen.ts`):

1. Scatter non-overlapping rectangular rooms within the map bounds.
2. Connect them with L-shaped corridors.
3. Place `@` (spawn) and `<` in one room; `>` in a distinct far room (absent on
   the bottom floor).
4. Scatter monster packs from the dungeon's `spawnTable`, level
   `levelBase + floor - 1`.
5. Reachability-seal exactly as `areaZone` does: flood-fill from spawn, wall
   off unreachable pockets, and assert `<`/`>`/boss vault are reachable.

Style parameters come from a `DUNGEON_STYLES` table: room size range, corridor
width, cave-ness (post-pass jaggedness that erodes room corners for earthen
warrens vs. clean halls), pack budget. Same style ⇒ same architectural
character; different dungeons of one style still differ by seed.

**Bottom floor:** the generator places a boss vault — a larger room containing
the boss (spawned then `upgradeToChampion`'d per the def; the barrow spawns the
existing `barrow_lord` type instead) and a treasure chest (existing breakable
kind, rolling its drop at the floor's monster level + 2).

All randomness flows through the seeded world rng; the determinism test
continues to lock the whole world.

## Content roster

| Dungeon | Area | Floors | Type | Bottom |
|---|---|---|---|---|
| The Barrow Crypt | overworld | 5 | quest (existing chain) | Barrow Lord |
| Fen Hollow | redfen | 2 | quest (new, Betha) | champion bog_maw |
| The Gallow Vault | gallowmire | 3 | quest (new, Corvin) | champion cairn_wight |
| Cragmaw Delve | cragmaw | 2 | side | champion + chest |
| Cinder Catacomb | ashfell | 3 | side | champion + chest |
| Crown Undercroft | hollowcrown | 3 | side | champion + chest |

- `descend_barrow` and `barrow_lord` objectives repoint at `dungeon:barrow:*`;
  the Barrow Lord moves to the barrow's floor-5 vault.
- Two new quests in the existing table style: Betha offers the Fen Hollow
  quest after `fen_hearts`; Corvin offers the Gallow Vault quest after
  `soldiers_due`. Each is a bottom-floor kill objective with dialogue and
  rewards.
- Side crypt entrances are placed markers in their areas — found by exploring,
  no quest pointer.

## Client visuals & audio

- `DUNGEON_PALETTES` keyed by `DungeonStyleId` alongside `BIOME_PALETTES`:
  bg, fog near/far, ambient color/intensity, wall tint, floor tint, and prop
  weights (bones vs. weeds vs. roots vs. ember cracks) over existing dungeon
  assets with tints. No new meshes.
- `buildScene`'s underground branch reads the palette from the zone's dungeon
  style instead of the hardcoded dead-black + stone look.
- `client/ambience.ts` gains a per-style soundscape id, reusing the biome
  ambience machinery.
- UI (`ZoneBanner`, `BottomBar`, quest text, travel toasts) shows
  `"{dungeon name} — Floor N"` from the registry; the depth-bucket
  `zoneName()` is retired.

## Testing

TDD for all sim logic:

- **Generator:** across many seeds — spawn/`<`/`>`/boss vault reachable;
  `>` absent only on the bottom floor; boss and chest present on the bottom
  floor only; packs within budget; maps deterministic per seed.
- **Registry:** entrances land on walkable ground in their host area; quest
  references valid; style/palette keys exist on both sides.
- **Stairs:** entering from each area's `>`, descending to the bottom,
  surfacing beside the right entrance.
- **Quests:** new quest defs progress and complete against their dungeons;
  repointed barrow objectives still complete.
- **Determinism:** the existing whole-world determinism test still passes.

Renderer and HUD verified by playing.
