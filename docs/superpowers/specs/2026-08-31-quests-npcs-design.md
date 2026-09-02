# Quests & NPCs — Design

2026-08-31

## Goal

An authored quest campaign delivered by NPCs the player meets out in the world.
Nine hand-written quests arc across the surface regions (moors → fen → mire →
crag) and down the barrow, mixing four objective kinds: kill, collect, reach,
and talk-to. Quest state is per-player, saves with the character, and works
under deterministic lockstep multiplayer.

## Decisions already made

- **Objective kinds (v1):** kill, collect (quest-item drops), reach
  (region/floor), talk-to chains.
- **Structure:** authored campaign, fixed for every seed. No procedural
  bounties in v1.
- **NPC placement:** scattered in the wild at fixed spots per region, plus
  Maren and Sera in camp become quest givers.
- **Dialogue:** short flavored blurbs per quest state (offer / progress /
  done) in a panel with Accept / Turn in buttons. No dialogue trees.
- **Rewards:** gold + XP; bigger turn-ins add a rolled item with guaranteed
  rarity.
- **Multiplayer:** per-player quest state with shared credit — any party
  member's kill in your zone counts toward your kill objectives. Everyone
  accepts and turns in individually.

## Section 1 — Sim data model

### NPC definitions (`sim/npcs.ts`)

A plain typed table keyed by `NpcId` (string literal union):

```ts
interface NpcDef {
  id: NpcId;          // "maren" | "sera" | "fen_hermit" | ...
  name: string;       // "Odd Betha"
  title: string;      // "Hermit of the Redfen"
  area: AreaId;       // surface region she stands in
  pos: Vec;           // fixed spot, seed-independent (like markers today)
  quests: QuestId[];  // offered in order, one at a time
  idle: string[];     // lines when she has nothing for you
}
```

- Wild NPCs stand at fixed positions the way `AreaDef.markers` do, so saved
  characters stay valid across seeds. Region generation carves their spots
  guaranteed-walkable, the same treatment markers get.
- Maren and Sera become NPC defs too (`pos` from their existing `V`/`H`
  markers) and gain quests. Their vendor/healer roles are untouched.

### Quest definitions (`sim/quests.ts`)

One row per quest:

```ts
interface QuestDef {
  id: QuestId;
  giver: NpcId;
  turnIn: NpcId;              // usually the giver; talk-to chains point elsewhere
  name: string;               // "Wights on the Moor"
  requires?: QuestId;         // gate: previous quest in the arc
  objective:
    | { kind: "kill"; typeId: string; count: number; zone?: ZoneId }
    | { kind: "collect"; itemBaseId: string; count: number }
    | { kind: "reach"; area: AreaId }   // or a floor, via zone
    | { kind: "talk"; npc: NpcId };
  dialogue: { offer: string[]; progress: string[]; done: string[] };
  reward: { gold?: number; xp?: number; item?: { baseId: string; rarity: Rarity } };
}
```

### Quest items

- New `quest` slot kind in item bases: no stats, cannot be equipped or sold.
- While a matching collect quest is active, the drop hook adds a chance for
  the quest item on matching kills, rolled from the seeded RNG.

### Player state

On `Player` and in `CharacterSave`:

```ts
quests: Record<QuestId, { stage: "active" | "done"; count: number }>;
// absent key = not started; "done" gates the next quest in the chain
```

Save loading normalizes leniently the way `waypoints` does: unknown quest ids
from other builds are dropped, malformed entries reset.

### World state

- `npcs: Map<number, Npc>` on `ZoneState`, where `Npc = { id, npcId, pos }`.
- Spawned during surface generation from the defs.
- NPCs do not move, fight, or die in v1.

## Section 2 — Inputs, systems, events

### Inputs

- `talkNpc?: number` — entity id; walk over and open dialogue.
- `acceptQuest?: QuestId`
- `turnInQuest?: QuestId`
- Closing the dialogue is client-only; no sim state.

### Walk-to generalization

Replace the `vendorTarget` / `healerTarget` booleans on `Player` with a single
`npcTarget: number | null`. Arriving within `TALK_RANGE` emits
`npc_talk { playerId, npcId }`. Maren's arrival also opens the shop and Sera's
also heals — the sim keeps emitting `shop_opened` / `healed` as today, now
fired on arrival at the corresponding NPC.

### questSystem

New system in the tick order (after death/xp). Each tick it scans the events
emitted so far to advance active quests:

- `monster_died` matching typeId/zone bumps the kill count for **every player
  in that zone** with the quest active (per-player, shared credit).
- `item_picked` of a quest base bumps collect counts.
- `region_entered` / `traveled` satisfies reach objectives.
- `npc_talk` satisfies talk objectives.

Accept validates giver-in-range and prerequisites. Turn-in validates the
objective is complete and the turn-in NPC is in range, then:

- pays gold directly and XP through the normal XP pipeline (level-ups fire),
- removes collected quest items,
- rolls the item reward into the inventory; if full, drops it at the player's
  feet — never lost.

### New events

`npc_talk`, `quest_accepted`, `quest_progress` (emitted only on count
changes), `quest_completed { rewards }` — the client's hooks for panels,
toasts, and audio.

## Section 3 — Client

- **Renderer:** a friendly flat-shaded figure per NPC (distinct silhouette and
  palette, reusing the character-mesh approach) with a floating marker
  reflecting the local player's state: `!` quest available, `?` turn-in ready,
  grey `?` in progress. Clickable via the existing raycast → `talkNpc` input.
- **Dialogue panel** (`client/ui/DialoguePanel.tsx`): opens on your own
  `npc_talk` event. Card with NPC name/title, the state-appropriate blurb, and
  context buttons: Accept / Turn in / (Trade / Heal for Maren and Sera) /
  Leave.
- **Quest tracker:** small HUD corner list of active quests with progress
  ("Bog wights 6/10"), read from player state each frame. `quest_completed`
  gets a toast and a sound.
- **MiniMap:** gold marker for NPCs inside the cropped window.

## Section 4 — Content: the v1 campaign (9 quests)

| # | Region | Giver | Kind | Sketch |
|---|--------|-------|------|--------|
| 1 | Moors | Maren | kill | Slay wights on the moor |
| 2 | Moors | Sera | collect | Grave-moss from zombies/breakables |
| 3 | Moors | Maren | reach | Find the Redfen waypoint; points at the hermit |
| 4 | Redfen | Hermit | talk | Introduce yourself to the hermit |
| 5 | Redfen | Hermit | kill | A kill chain in the fen |
| 6 | Redfen | Hermit | collect | A fetch in the fen |
| 7 | Gallowmire | Lost soldier | kill | Found by exploring the mire (quest 6's done-dialogue points there); avenge his company |
| 8 | Cragmaw | Sentinel | reach | Descend the barrow to floor 3 |
| 9 | Cragmaw | Sentinel | kill | Kill the floor-5 boss; guaranteed-unique reward |

Exact names and dialogue are authored during implementation. Each region NPC
also gets idle flavor lines. All numbers are ours (house rule: D2 shapes,
never D2 numbers).

## Section 5 — Testing

TDD per house rules, all sim-side:

- Accept: giver range, prerequisite gating, no double-accept.
- Each objective kind advancing off synthesized events.
- Shared credit: two players, one zone counts, different zones don't.
- Turn-in: rewards paid, XP through the pipeline, quest items removed, item
  reward drops at feet when inventory is full.
- Save round-trip with quest state; lenient load of unknown ids.
- Determinism test extended with a scripted quest run.

Renderer and HUD verified by playing.

## Out of scope (v1)

Procedural bounties, dialogue trees, moving/killable NPCs, permanent-perk
rewards, quest sharing UI, journal panel beyond the tracker.
