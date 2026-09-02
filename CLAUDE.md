# barrow — Claude context

Browser ARPG inspired by Diablo 2's mechanics (own numbers, own look — nothing copied
from Blizzard). Flat-shaded low-poly isometric WebGL, kill → loot → equip core loop.

## Commands

- **Dev:** `bun run dev` (Vite, port 5197)
- **Tests:** `bun test sim client`
- **Typecheck/build:** `bun run build`

## Architecture — the one rule that matters

`sim/` is a pure, deterministic TypeScript simulation. **No imports from three, react,
or the DOM in `sim/` — ever.** All randomness flows through the seeded RNG in
`sim/rng.ts`. Fixed 25 Hz tick: `step(state, inputs)` mutates GameState in a fixed
system order. Same seed + same input script ⇒ identical state (locked by a determinism
test). This is what keeps mechanics unit-testable and leaves the door open for P2P
lockstep multiplayer later.

`client/` renders: Three.js isometric scene interpolating between ticks, plus a React
HUD. The renderer reads sim state; it never reaches into sim internals to mutate.

## Layout

- `sim/` — rng, state, tick, systems/ (movement, ai, combat, death, xp),
  items/ (bases, affixes, treasure, generate), character, skills, map
- `client/render/` — Three.js scene, meshes, input raycast, damage numbers
- `client/ui/` — React HUD (globes, belt, inventory grid, character/skill panels)

## Conventions

- TDD for all sim logic: failing test first, then code. Renderer/HUD verified by playing.
- Item/affix/treasure data are plain typed tables — content growth is rows, not code.
- D2's *system shapes* (treasure classes, affix groups with level reqs, rarity tiers)
  are the blueprint; every number is ours.
