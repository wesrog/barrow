# Barrow

A browser action RPG in the shape of Diablo 2: kill, loot, equip, go deeper. Flat-shaded low-poly isometric WebGL, a deterministic simulation underneath, and co-op over WebRTC. The numbers, the world and the art direction are our own; D2 supplies the system shapes (treasure classes, affix groups with level requirements, rarity tiers, skill trees with synergies).

## Running it

You need [bun](https://bun.sh), and the built art: either fetched from the project's private bucket (see [Assets](#assets)) or built yourself with Blender 5 from the licensed packs.

```
bun install
bun run dev             # fetches the locked asset pack if yours is stale, then http://localhost:5197
```

Building the art from the source packs instead:

```
bun run assets:synty    # convert the Synty packs to GLB kits (Blender)
bun run assets:ui       # copy the UI icon packs
bun run assets:ground   # copy the ground textures
```

Other commands:

| Command | What it does |
|---|---|
| `bun test sim client` | The unit tests. `bun test` adds the net and signal suites. |
| `bun run build` | Typecheck and production build into `dist/`. |
| `bun run signal` | The multiplayer signalling server on `ws://localhost:5200`. |
| `bun run assets:pull` | Fetch the asset pack `assets.lock.json` names, if yours differs. `bun run dev` does this first. |
| `bun run assets:push` | Pack your built assets, upload them, and update `assets.lock.json` to commit. |
| `/viewer.html` on the dev server | The asset viewer: every character with its idle, weapons and attachments to try on, a clip picker, and a tab over all the 2D art. Its grip tuner seats a held weapon by hand (at rest and while shooting), places a weapon's muzzle point, and prints the numbers to paste into the game. |

Without the model kits the game refuses to start and names the missing kit. Without the icon packs and ground textures it falls back to built-in SVG icons and flat ground colours.

## How the game plays

**Start.** The lobby is a night camp with a warrior, a witch and a ranger standing at a fire. Click one to see it perform and read about the class, name it, and forge it. Characters live in the browser's local storage; you can keep several and switch between them.

**The camp.** New characters start in the palisaded camp on the Wither Moors: a trader, a healer, a stash, a waypoint, a jarl's hall, a storehouse, a smithy, a training yard and a shrine. Nothing hostile comes inside.

**The world.** Six regions run east from the camp, each tougher than the last: the Wither Moors, the Redfen, the Gallowmire, the Cragmaw Steps, the Ashfell and the Hollowcrown. Each is an organic landmass grown fresh from the world seed with a hidden waypoint to find, packs of monsters that get harder the farther you range, and landmarks: stone circles, ruins, raider camps, cold camps and old shrines, each with something lairing in it and a chest. Standing torches, braziers and small campfires are scattered over the open ground, sparse enough that the dark stays dark. Every region holds the mouth of a crypt.

**The crypts.** Six dungeons of two to five floors each, from the Barrow Crypt under the moors to the Crown Undercroft. Floors are generated per world: rooms, corridors, big halls with crowds, hidden passages that open when you brush the wall (with a chest waiting mid-run), and set-piece rooms such as a throne room, a gaol, a library and a ritual circle. The bottom floor holds a boss in its vault.

**Fighting.** Left click moves, attacks and interacts. The right mouse button and the q, w, e, r and f keys cast whatever you have bound to those slots. One in five monsters is a champion with a modifier and a guaranteed drop. Breakables and chests hold loot too. Death leaves your worn gear on a corpse where you fell and puts you back in the camp; walk out and reclaim it.

**Classes and skills.** The warrior has Arms, Warcries and Fury; the witch has Fire, Frost and Hexes; the ranger has Archery, Hunting and Survival. Each tree opens at tiers 1, 4, 8, 12, 18 and 24 for six skills a tree, 54 in all, with prerequisites and synergies between them. Every level grants one skill point, ranks go to ten, and a respec refunds everything. Skills marked "coming" in the skill panel are planned but not built yet; no character can put points in them. The warrior starts with a rusted blade; the witch with a bone wand and one rank of Firebolt; the ranger with a light crossbow and one rank of Power Shot.

**The ranger.** Crossbows reach about twelve cells. A bolt flies along the line you aim, not to the spot you clicked, and stops at the first wall or monster in its path or at the end of its reach. Power Shot flies the same way and Multishot fans several bolts around the aim. The archer turns so the crossbow points along the shot and keeps it raised for a few seconds between shots, until you move. Hits land when the bolt arrives, not when it leaves.

**Loot.** Weapons, shields and orbs, helms, chest pieces, boots, rings, amulets and potions, in normal, magic, rare and unique rarities with affixes rolled from level-gated groups. Magic, rare and unique gear worn on the hero carries a faint tint of its rarity colour. Gear wears down and breaks unless repaired. The inventory is a grid with two item sizes (small for potions, rings, amulets and quest items; large for gear), a belt row each for healing and mana potions, a stash in camp, and a trader who buys and sells. Loot on the ground is marked as better, worse or mixed against what you wear before you touch it.

**Quests.** The camp trader and healer, a hermit in the Redfen, a soldier in the Gallowmire and a sentinel at the barrow's mouth give a chain of thirteen quests: culls, fetches, and descents.

**Co-op.** Host a game to get a room code; friends join with it. Everyone runs the same deterministic simulation in lockstep over WebRTC, with a small signalling server to introduce peers.

### Keys

| Key | Action |
|---|---|
| Left mouse | Move, attack, pick up, talk, use stairs and pads |
| Right mouse, q w e r f | Cast the bound skill |
| 1, 2 | Drink a healing or mana potion |
| i | Inventory and character sheet |
| s | Skill trees; with the panel open, a cast key over a learned skill binds it |
| Q | Quest journal |
| t | Town portal |
| v, b | Trade, stash (in camp) |
| n | New game on the same character |
| N | Bury the character and start over |
| Esc | Menu, or close whatever is open |

## How it is built

`sim/` is a pure, deterministic TypeScript simulation and imports nothing from Three, React or the DOM. All randomness flows through a seeded RNG, and `step(state, inputs)` advances the world at a fixed 25 Hz in a fixed system order, so the same seed and the same inputs give the same state on every machine. That is what makes the mechanics unit-testable and lockstep multiplayer possible. Content is data: monsters, items, affixes, treasure classes, skills, quests, dungeons, regions, landmarks and buildings are rows in typed tables.

`client/` renders the state and never mutates it. `client/render/` is the Three.js scene: it interpolates between ticks, drives the character rigs, and dresses the world from row tables (camp props, crypt set pieces, wilderness landmarks) so a new prop is a new row. A lamp pool keeps the cost of dozens of torches and candles at eight point lights. `client/ui/` is the React HUD: globes, belt, hotbar, inventory grid, skill trees, shop, stash, quests, minimap. `client/audio.ts` synthesizes every effect and layers recorded clips over the synths; `client/music.ts` and `client/ambience.ts` are generative.

`net/` and `signal/` carry the lockstep protocol and the signalling server. `scripts/` holds the asset converters. `CLAUDE.md` is the detailed engineering guide: layout, conventions, the asset pipeline's quirks, and how to verify changes.

## Assets

The 3D art is Synty Studios' POLYGON packs (Dungeon Pack, Goblin War Camp, Viking Realm, Alpine Mountain, Goblin Locomotion, and the free Bow and Crossbow pack) and the item icons are Synty's INTERFACE Fantasy Screens and Fantasy Warrior HUD plus AssetSmithy's 608 Fantasy Icons. Their licences forbid redistribution, so neither the sources nor anything converted from them is in this repository: unzip each pack under `assets-src/`, run the three asset commands, and the outputs land in gitignored folders. Only the converter scripts are tracked.

Within the project, the built folders travel through a private S3 bucket instead of git. `assets.lock.json` in git names the current pack by a hash of its contents. `bun run dev` compares it with the pack you have and downloads the new one when the lock moves, so pulling the code brings matching art. If the download fails (no AWS CLI, no credentials), the dev server still starts on whatever art is already there.

- **Fetching:** install the AWS CLI (`brew install awscli`) and store the read-only key you were given as a profile with `aws configure --profile barrow`. Then run the game with that profile, for example `AWS_PROFILE=barrow bun run dev`, or export it in your shell.
- **Publishing new art:** rebuild the folders, run `bun run assets:push`, and commit the updated `assets.lock.json` with the code that needs it.

In the repository: the CC0 KayKit animation suite that the converter retargets onto the Synty skeletons (the Synty packs ship no combat animation), Kenney's CC0 sound packs, and a Pixabay whoosh set, each with its licence beside it.
