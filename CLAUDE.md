# barrow — Claude context

Browser ARPG inspired by Diablo 2's mechanics (own numbers, own look — nothing copied
from Blizzard). Flat-shaded low-poly isometric WebGL, kill → loot → equip core loop.

## Commands

- **Dev:** `bun run dev` (Vite, port 5197)
- **Tests:** `bun test sim client`
- **Typecheck/build:** `bun run build`
- **Asset viewer:** `http://localhost:5197/viewer.html` on the dev server (second Vite page):
  every character model in a grid with its idle, pack filters, search, a clip picker for all
  or one figure, speed and pause. Select a figure to hand it any weapon or shield from the
  kits (seated with its rig's grip), dress it in its pack's attachments, fire its attack clips,
  or tick "arm everyone". A URL can open a scene: `?q=Warrior%20Male%2001&sel=viking_realm/
  Warrior_Male_01&r=viking_weapons/Wep_Sword_02&l=viking_weapons/Wep_Shield_Set_01&wear=...
  &clip=...&arm=1`; `window.__viewer` exposes lives, camera and scene for console tuning.
- **UI art:** `bun run assets:ui` copies every PNG of the licensed UI packs unzipped under
  `assets-src/synty/fantasy_screens/`, `assets-src/synty/fantasy_warrior_hud/` and
  `assets-src/assetsmithy/` (the 608 Fantasy Icons set; demo screenshots excepted) into
  `public/icons/packs/` (gitignored) with a version 3 manifest of sets (`fs-`/`fw-`/`as-`
  prefixed by pack) and pieces. Three kinds: `icon` is a white silhouette
  (Clean/Stroke/Underlay), `render` a coloured item icon (the Warrior HUD's `ICON_SM_*` sets
  with `Render`, white `Clean`, `Underlay` and `Side` files; every AssetSmithy icon), `sprite`
  any other coloured art. The viewer's "2D art" tab (`/viewer.html?tab=art&sets=as-weapons`)
  browses it with set filters, tint swatches, variant and size controls. `client/ui/itemIcons.ts`
  maps each item base to a piece (gear on AssetSmithy, potions, rings, amulets, orbs and quest
  items on Warrior HUD renders): renders draw as images with a rarity glow, silhouettes as
  tinted masks, and the game-icons SVGs in git remain the fallback when the manifest is absent.
  `client/ui/ItemSlot.tsx` owns the inventory cell (`CELL`, 56px) and the borderless slate slot
  every grid and the equipped list build from. Items have two footprints (1x1 for potions,
  rings, amulets and quest items, 2x2 for gear), so icons show at exactly two sizes.
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
  family's `RigSpec` maps them to its own names and weapon grip. `models.ts` loads the Synty
  kits (the only models; a missing kit throws with the kit's name and the lobby shows it) and
  normalizes dungeon pieces to the footprints the scene was laid out on. `modelRigs.ts` holds
  the per-monster look table (undead types on the Dungeon Pack rig, raiders on the goblin rig,
  villagers on the human spec) and the hero build: a Viking Realm human (warrior male, leader
  female for the witch) dressed from the Viking weapon, shield, helmet and fur kits. In dev,
  `window.__barrow` exposes game, driver, input, assets. Rig specs list clip candidates in
  order (retargeted KayKit copy first, goblin pack second) so a machine missing a clip kit
  still animates. The hero stands 1.56 units and monster scales keep the heights the game was
  tuned at (Synty humanoids are authored 1.8 tall). `scatter.ts` instances the Viking nature kit over
  open ground (pines, half-buried standing stones, berry bushes, roof-grass tufts as ground
  tufts) in 16-cell chunks for culling, tinted per biome by `foliageTint`/`stoneTint` in
  `biomes.ts`; without the kit the scene keeps its primitive cones and icosahedra.
  `campDressing.ts` is the row table of Viking props around the camp markers (fire pit, awning
  stall, sickbed, banner, rune stone) and inside huts, plus `dressHuts`, which raises log walls
  and corner posts on a hut dweller's wall ring (`hutRing` in `sim/npcs.ts`, shared with the
  zone carver) and hands the scene the cells to leave bare. The primitive campfire and
  dungeon-prop stall remain the fallback. Kit nodes stand at the origin but a few carry a
  translation that centres an offset mesh, so place them inside a wrapper group rather than
  overwriting their position. `gear.ts` is the one path for held and worn kit pieces:
  `heldModel` measures a weapon's authored length axis from its bounds and turns it up +Y
  (Viking swords and knives lie along +Z, nearly everything else +Y), shields get a half turn,
  and `gripInto` seats the wrapper with the rig's grip; `wornPlacement`/`wearPiece` put
  attachments on the bone their name implies, in the bone's frame when authored near the
  origin (helmets, hats, beards, pouches) or through the bone's rest frame when authored in
  place over the T-pose (furs, hoods, long hair, anything above 1.1). Grips were measured on
  the rigs in the viewer: fingers run along the hand bone's X, the knuckle line along Z, Y is
  the palm normal, so a quarter turn about X lays a handle along the knuckles with the blade
  toward the index finger (Synty right hand -Z, left +Z; the UE rig mirrors both). Check any
  new pack's grip in the viewer from the three-quarter "frame" view, not the game camera.
- `client/ui/` — React HUD (globes, belt, inventory grid, character/skill panels)

## Licensed assets (Synty)

- Source zips come from the Synty store downloads ("Source Files"); unzip into
  `assets-src/synty/<pack>/`. The CC0 KayKit GLBs live under `assets-src/kaykit/` (in git,
  the one un-ignored folder there) only as the source of the retargeted clip kits; the game
  no longer loads any KayKit model.
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
  material list names textures on the slot line; 80 shield designs share one texture. Its
  environment splits into `village` (buildings, docks, boats, cliffs), a lean `nature` kit
  (pines, bushes, stones, roof tufts, no pine groups) that the game loads for the outdoor
  scatter, and `structures` (log walls, pillars, fences, doors, steps, roof caps) for pieces
  the game raises on the map itself; the single-material pines run 1.1k to 1.8k triangles,
  fit for thousands of instances. Log walls have an end pivot 1.25 units from centre.
- `goblin_locomotion` is a clip kit: `clips.glb` is a mesh-less goblin rig with one animation
  per clip (Idle_Standing, Walk_F, Run_F, Sprint_F, shuffles, turns, transitions, jump and
  land). Synty's clip skeleton has the same joints as the characters but differently
  oriented joint frames (Unity Humanoid hides that), so the converter calibrates a per-bone
  frame offset between the two T-poses (character bind pose vs clip joint orients) and keys
  world rotations through it; hips carry translation in metres.
- `kaykit_clips` (source `assets-src/kaykit/`): the CC0 KayKit suite (Idle, walks, runs, every 1H/2H/unarmed
  swing, spellcasts, Cheer, Taunt, dodges, jumps, hits, deaths) retargeted onto `goblin_rig`
  and `dungeon_rig` through an explicit bone map (`SYNTY_FROM_KAYKIT`, `UE_FROM_KAYKIT`) with
  rest-direction alignment and hip motion scaled by hip height. KayKit's chibi idle holds the
  arms out, so calm clips get an extra `ARM_RELAX_DEGREES` turn on the upper arms; swings keep
  their arcs. Every Synty character now animates from these; goblins keep the goblin idle and
  gait. Mixamo is no longer required. The KayKit source armature must stay visible during the
  bake: a hidden armature is not evaluated and samples as rest.
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
