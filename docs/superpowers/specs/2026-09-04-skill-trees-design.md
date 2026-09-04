# Skill Trees — Design

2026-09-04

## Problem

Skills are one flat list per class (`sim/skills.ts`): 7 warrior, 6 witch, each
with a level requirement and at most one prerequisite. There is no
specialization — a witch takes every witch skill in unlock order, and two
witches at level 20 are the same character. Everything is active; there are no
passives. Damage has no element, monsters have no resistances, so nothing in the
world pushes back on one build differently from another. Chill is faked as stun.
The panel is a list grouped by unlock level, not a tree.

## Goal

Rebuild skills as **Diablo 2-shaped trees**: three trees per class, each a
distinct playstyle with its own passives and capstone, gated by tiers and
in-tree prerequisites, with hard-point synergies. Give damage an element and
monsters resistances so the tree you commit to changes which fights are hard.
Add a paid respec so committing is a choice, not a trap. Keep every number ours.

## Non-goals

- Player resistances and item resist / `+skills` affixes (follow-up spec).
- Skill points from quests (follow-up; the economy below assumes one per level).
- Per-tier point caps (D2's "one point per level above the tier") — level
  requirement plus prerequisites is enough gating for a 10-rank cap.
- A generic effect-component engine. Cast handlers stay hand-written per skill.
- Summons / pets.

## D2 reference (what we are borrowing the *shape* of)

- 3 trees × ~10 skills per class; tiers at 1/6/12/18/24/30; prerequisites are
  arrows within a tree; 20 hard points max; ~110 points over a career, so a
  character maxes 4–5 skills.
- Each tree carries a level-1 starter kept relevant by synergy, a utility or
  mobility skill, a passive, a capstone, and a mastery passive.
- 1.10 synergies count hard points only, never item bonuses.
- The Sorceress's trees differ because monsters resist and are immune to
  elements, not because of the spell shapes alone.

## Data model

### Skill rows (`sim/skills.ts`)

```ts
export type Klass = "warrior" | "witch";
export type TreeId = "arms" | "warcries" | "fury" | "fire" | "frost" | "hexes";
export type Tier = 1 | 4 | 8 | 12 | 18 | 24;
export type Element = "physical" | "fire" | "cold" | "shadow";
export type Targeting = "none" | "target" | "point";

export interface TreeDef { id: TreeId; klass: Klass; name: string; blurb: string }

export interface SkillDef {
  id: SkillId;
  name: string;
  klass: Klass;
  tree: TreeId;
  tier: Tier;                       // character level required for the first point
  kind: "active" | "passive";
  targeting: Targeting;             // passives: "none"
  element: Element;                 // passives and buffs: the element they scale, or "physical"
  manaCost: number;                 // passives: 0
  castTicks: number;                // passives: 0
  buffId?: BuffId;                  // actives that apply a timed self/party buff
  prereqs: SkillId[];               // same tree only; every listed skill needs rank ≥ 1
  synergies: { from: SkillId; text: string }[];   // documentation for the panel; math lives in rank functions
  describe: (rank: number) => string;             // panel text with numbers at this rank (rank 0 = "next point gives…")
  /** Row exists, handler does not yet (plan 2). Spending is refused; the panel says "coming". */
  pending?: true;
}

export const MAX_RANK = 10;
export const TIERS: readonly Tier[] = [1, 4, 8, 12, 18, 24];
export const TREES: Record<TreeId, TreeDef>;
export const SKILLS: Record<SkillId, SkillDef>;
export function TREE_SKILLS(tree: TreeId): SkillDef[];   // in tier order, exactly one per tier
export function CLASS_TREES(klass: Klass): TreeDef[];    // three, in display order
```

Invariants, locked by a table test: every tree has exactly six skills, one per
tier; every prerequisite is in the same tree and a lower tier; every synergy
source exists; every skill's `klass` matches its tree's.

Rank scaling stays in named functions (`cleaveMultiplier(rank, warcryRank)`
etc.). `describe` calls those functions so the panel and the sim can never
disagree about a number.

### Point economy

One point per level, `MAX_RANK = 10`, tiers at 1/4/8/12/18/24. A level-30
character has 29 points: three maxed skills or a wider spread. Same maxed-skill
ratio D2 has (≈100 points / 20 cap ≈ 5 skills vs our 29 / 10 ≈ 3).

### Spend rule (`applySpendSkillInput`)

A point goes in when: the skill belongs to the player's class, the player has a
point, `level ≥ tier`, every `prereq` has rank ≥ 1, and rank `< MAX_RANK`.

### Elements and resistances

```ts
// sim/monsters.ts
export interface MonsterType {
  …
  /** Percent resistance per element; missing = 0. 100 = immune. Negative = weakness. */
  resist?: Partial<Record<Element, number>>;
}
export interface Monster { …; resist: Record<Element, number>; }   // copied from type at spawn
```

`hitMonster(state, zone, m, p, amount, element)` becomes the single place
damage is scaled: `dealt = floor(amount × (100 − effectiveResist) / 100)`,
minimum 0. `effectiveResist` = the monster's resist for that element, minus
Cold Mastery's reduction for cold (immunities — 100 or more — are reduced at
one-fifth effectiveness, as in D2, so a maxed Cold Mastery makes an immune
monster barely hittable rather than trivially), plus nothing else. Doom (below)
is applied after resistance as a multiplier on damage taken. Plain weapon
swings are `physical`. The `monster_hit` event gains `element` so the client can
colour damage numbers.

Content: a first pass of resistances on existing monster rows — skeletal
types resist cold and are weak to fire; fen/bog types resist fire; the barrow's
end boss resists shadow; two mid-game types are immune to one element each.
Exact rows are the implementation plan's job; the rule is that every element
has at least one wall and at least one soft target by mid-game.

### Monster debuffs

```ts
export type DebuffKind = "chill" | "weaken" | "slow" | "doom" | "burn" | "bleed";
export interface Debuff { kind: DebuffKind; until: number; power: number; element?: Element; source?: PlayerId }
export interface Monster { …; debuffs: Debuff[] }
```

- `chill`: move and attack speed × (1 − power). Replaces Frost Nova's stun.
- `slow`: same axes as chill, stacks multiplicatively with it (Hex tree).
- `weaken`: damage dealt × (1 − power).
- `doom`: damage taken × (1 + power), after resistance.
- `burn` / `bleed`: `power` damage per tick of `element`, credited to `source`
  for aggro and xp. Bleed is physical, burn is fire; both are resisted.

Re-applying a kind refreshes `until` and takes the higher `power`. A
`debuffSystem` ticks damage-over-time and prunes expired entries each tick,
before monster AI. `stunnedUntil` stays a separate field: stun is binary, not a
scalar.

### Player buffs and passives

```ts
export type BuffId = "warcry" | "focus" | "battleshout" | "frenzy" | "berserk" | "icearmor";
export interface Player { …; buffs: Partial<Record<BuffId, number>> }   // until tick
```

`buffUntil` is removed. Helpers: `hasBuff(state, p, id)`,
`damageMultiplier` (Warcry, Berserk), `spellMultiplier` (Focus). Battle Shout
is a party buff: it lands on every living player in the caster's zone within a
radius.

Passives feed `computeStats(eq, level, klass, skills)`: Weapon Mastery adds
damage % and attack rating, Iron Skin adds defense, Fleetfoot adds move speed,
Fire Mastery adds fire damage %, Warmth adds mana regen (read by
`manaRegenSystem`), Cold Mastery is read by `hitMonster`. Passives have no
hotkey, no cast, no mana.

### Respec

```ts
// PlayerInput
respec?: boolean;
// sim/skills.ts
export function respecCost(level: number): number;   // starts at 15 × level², tunable
```

`applyRespecInput`: player must be in camp and able to pay. Refunds every
rank to `skillPoints`, zeroes `skills`, clears `buffs`, charges gold, emits
`{ type: "respec", playerId, cost }`. Sera's panel (`HealerPanel.tsx`) grows an
"unlearn all skills — N gold" row. The client resets the hotbar on the event.

### Saves

`sim/save.ts` `VERSION` → 2. Loading a v1 save, or any save whose skill ids do
not all exist in the table, keeps the character and refunds all points
(`skillPoints = level − 1`, all ranks 0). No partial migration.

## Tree contents

Names are placeholders. `*` = existing skill moved into its slot.

### Warrior

| Tier | Arms (physical strikes) | Warcries (shouts, toughness) | Fury (mobility, rage) |
|---|---|---|---|
| 1 | Cleave* | Warcry* (damage buff) | Charge* |
| 4 | Crush* | Taunt — pull every monster in a radius onto you | Leap* |
| 8 | Weapon Mastery (passive: damage %, attack rating) | Iron Skin (passive: defense) | Fleetfoot (passive: move speed) |
| 12 | Deathblow* | Battle Shout — party max-life buff | Stomp* |
| 18 | Whirl — spin to a point, hitting everything you pass | Howl — stunning shout in a radius | Frenzy — attack + move speed buff |
| 24 | Rend — heavy strike that leaves a bleed | Rally — capstone shout: stuns, and boosts party damage | Berserk — capstone buff: huge damage, defense 0 while active |

Prerequisites: each tree is a chain by tier except passives, which need only
the tier (Weapon Mastery, Iron Skin, Fleetfoot have no prereqs). Synergies:
Warcry → Cleave (kept); Crush → Deathblow (kept); Leap → Stomp (kept);
Cleave → Whirl; Deathblow → Rend; Warcry → Rally; Charge → Frenzy; Frenzy → Berserk.

### Witch

| Tier | Fire | Frost | Hexes (shadow) |
|---|---|---|---|
| 1 | Firebolt* | Frost Bolt — chilling bolt | Weaken — curse a pack: less damage dealt |
| 4 | Warmth (passive: mana regen) | Frost Nova* (chills, no longer stuns) | Blink* |
| 8 | Fireball* | Ice Armor — defense buff; melee attackers get chilled | Focus* (spell damage buff) |
| 12 | Fire Wall — line of burning ground | Glacial Spike — point blast that freezes (stun) | Slow — curse: move and attack speed |
| 18 | Meteor — delayed point blast, leaves burning ground | Blizzard — point storm over several seconds | Soulchain — Chain Bolt* rebuilt: shadow bolt leaps through three enemies, each hit heals the caster |
| 24 | Fire Mastery (passive: fire damage %) | Cold Mastery (passive: cuts enemy cold resistance) | Doom — capstone curse: damage taken from every element up |

Prerequisites: chains by tier; passives need only the tier. Synergies:
Focus → Firebolt (kept); Firebolt → Fireball (kept); Fireball → Meteor;
Fire Wall → Meteor; Frost Bolt → Glacial Spike; Frost Nova → Blizzard;
Weaken → Slow; Slow → Doom; Doom → Soulchain (drain amount).

Hexes is a support tree by design, like D2's Curses: its only damage is
Soulchain at tier 18, so a Hex witch pairs it with Fire or Frost for kills and
Doom is what makes that pairing stronger than either tree alone.

Hex damage (Soulchain) is `shadow`. Curses are not damage, so they are never
resisted; their durations are shortened on shadow-resistant monsters by the
same percentage instead, so a shadow wall exists for the Hex witch too.

## Panel (`client/ui/SkillPanel.tsx`)

Three columns, one per tree, headed by tree name and blurb. Six rows by tier;
a tier's label shows its level. A connector line runs from each prerequisite to
its dependent. Locked skills are dimmed with the reason (level, prerequisite).
Hover shows `describe(rank)` and `describe(rank + 1)` plus synergy sources.
Spend and hotkey binding work as today; passives show no hotkey chips. The
unspent-point banner and pulse stay. The default hotbar becomes the tier-1
active of each tree plus the tier-4 of the first tree.

## Testing

Sim work is test-first. New or changed tests:

- Table invariants (six per tree, one per tier, prereqs in-tree and lower).
- Spend gating: tier, prereq, class, rank cap; passive rows accept points.
- Resistance math: 0, partial, immune, negative; Cold Mastery on partial and on
  immune; Doom after resistance; plain swings are physical.
- Each debuff kind: application, refresh-takes-higher, expiry, DoT credit to
  source; chill actually slows movement and attack.
- Buffs coexist and expire independently; Battle Shout reaches the party.
- Passives change derived stats and mana regen.
- Respec: refund total, gold charge, camp-only, clears buffs; hotbar reset event.
- Save: v1 load refunds; unknown skill id refunds.
- Determinism test unchanged and green.

Panel and hotbar are verified by playing.

## Phasing

Two implementation plans:

1. **Framework**: rows, trees, tiers, elements, debuffs, buffs map, passives,
   respec, save migration, the new panel; migrate the 13 existing skills into
   their slots; ship all six passives and the spines that prove elements and
   debuffs — Frost Bolt, Weaken, Slow, Soulchain, Doom.
2. **Content**: Whirl, Rend, Taunt, Battle Shout, Howl, Rally, Frenzy, Berserk,
   Fire Wall, Meteor, Ice Armor, Glacial Spike, Blizzard.

The full 36-row table ships in plan 1 so the invariants hold from the start;
plan-2 skills carry `pending: true`, render as "coming", and refuse points until
their handler lands and the flag is removed.
