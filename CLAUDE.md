# barrow — Claude context

Browser ARPG inspired by Diablo 2's mechanics (own numbers, own look — nothing copied
from Blizzard). Flat-shaded low-poly isometric WebGL, kill → loot → equip core loop.

## Commands

- **Dev:** `bun run dev` (Vite, port 5197)
- **Tests:** `bun test sim client`
- **Typecheck/build:** `bun run build`
- **Synty assets:** `bun run assets:synty` (`PACKS=goblin_war_camp KITS=characters` to filter;
  needs Blender 5 at `/Applications/Blender.app`, or set `BLENDER`). Converts
  `assets-src/synty/<pack>/` FBX into GLB kits under `public/models/synty/<pack>/`. Both folders
  are gitignored: the Synty EULA forbids redistributing the source or anything derived from it.
  Only the script is in git.

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

- `sim/` — rng, state, tick, elements (resistances), debuffs, dungeons (registry), dungeon-gen (floor generator),
  systems/ (movement, ai, combat, death, xp),
  items/ (bases, affixes, treasure, generate), character, skills (trees/tiers/rank math), map
- `client/render/` — Three.js scene, meshes, input raycast, damage numbers.
  `rigSpec.ts` is the seam between the scene and any model set: the scene asks rigs for
  semantic clips (`death`, `cast`, `attack2h`...) and bone roles (`handR`, `head`...), and each
  family's `RigSpec` maps them to its own names and weapon grip. `models.ts` loads KayKit plus
  the optional Synty kits and normalizes Synty dungeon pieces to KayKit footprints, so a
  missing kit (fresh clone, CI) falls back to KayKit with no code change. `modelRigs.ts` holds
  the per-monster look tables for both families and both hero builds: a Viking Realm human
  (warrior male, leader female for the witch) dressed from the Viking weapon, shield, and helmet
  kits when they loaded, else the KayKit barbarian with box overlays. Viking swords and knives
  are authored along Z and get a quarter turn before the grip; shields a half turn. In dev,
  `window.__barrow` exposes game, driver, input, assets.
- `client/ui/` — React HUD (globes, belt, inventory grid, character/skill panels)

## Licensed assets (Synty)

- Source zips come from the Synty store downloads ("Source Files"); unzip into
  `assets-src/synty/<pack>/`. KayKit models under `public/models/` are CC0 and stay in git.
- The converter builds one GLB per kit, every piece a top-level node at the origin named by its
  FBX stem minus `SM_`/`SK_Chr_`/`SM_Chr_`, materials shared per texture. Kits ship without
  normals so GLTFLoader flat-shades them. Materials come from each pack's `MaterialList_*.txt`;
  meshes on triplanar or water shaders (Alpine snow, ice, moss) are skipped with a log line.
  Textures are capped at 1024 and palette variants (`_B`, `_C`) fold onto `_A`, so each kit
  carries one copy of each atlas. Alt-colour pieces therefore come out in the base palette.
- `dungeon` (2018 pack): static pieces were authored in metres inside a cm file, so the script
  scales them x100. Characters are the Unreal-flavour FBX: 43 bones, UE mannequin names
  (`root`, `pelvis`, `hand_r`, `head`). Walls 5.24 wide and tall with an end pivot, floor tiles
  5 x 5 with a corner pivot, characters 1.85 tall. The sim cell is 1 unit.
- `goblin_war_camp`: all goblins live in one FBX on one armature; the script splits them into
  one rig per character. Rig is Synty's own, 50 bones, PascalCase (`Root`, `Hips`, `Spine_01`,
  `Neck`, `Head`, `Clavicle_L`, `Shoulder_L`, `Elbow_L`, `Hand_L`). `CharactersBR.fbx` holds
  King_02 and the Troll on a 51-bone variant. The ANIMATION Goblin Locomotion pack targets this rig.
- `alpine_mountain`: trees use one material that the Unity shader splits by vertex colour; the
  script moves faces with blue > 0.5 to a leaf cutout material. Pines are 7 to 17 units tall.
  The Rock_Cliff pieces, snow mounds, moss lumps, and stalactites sit on triplanar or glacier
  shaders and are skipped; rocks, pebbles, bushes, grass, and props convert.
- `viking_realm`: zip has a `SourceFiles/` level (the pack `root`). Ten humans plus 14 skinned
  attachments on the same 50-bone rig as the goblins, split per character like them. Its
  material list names textures on the slot line; 80 shield designs share one texture.
- `goblin_locomotion` is a clip kit: `clips.glb` is a mesh-less goblin rig with one animation
  per clip (Idle_Standing, Walk_F, Run_F, Sprint_F, shuffles, turns, transitions, jump and
  land). Synty's clip skeleton has the same joints as the characters but differently
  oriented joint frames (Unity Humanoid hides that), so the converter calibrates a per-bone
  frame offset between the two T-poses (character bind pose vs clip joint orients) and keys
  world rotations through it; hips carry translation in metres. Verified by rendering the
  warrior mesh on the retargeted rig. Play clips on any goblin or viking character by bone
  name. No attack or death clips: those still come from Mixamo, as do all dungeon-rig clips.
- GLTFLoader makes node names unique per file, so in a kit with many characters the second
  rig's bones load as `Root_1`, `Hips_1`... `instantiateKit` restores the authored names on
  each clone (only names the clips target), otherwise no clip track binds.
- The goblin idles are hunched, so Viking NPCs driven by them crouch a little. A human
  locomotion pack or Mixamo idle fixes that.

## Conventions

- TDD for all sim logic: failing test first, then code. Renderer/HUD verified by playing.
- Item/affix/treasure data are plain typed tables — content growth is rows, not code.
- D2's *system shapes* (treasure classes, affix groups with level reqs, rarity tiers)
  are the blueprint; every number is ours.
