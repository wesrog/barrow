# Skill Trees Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat per-class skill list with three D2-shaped trees per class, elemental damage with monster resistances, a monster debuff model, a player buff map, passives, a paid respec, and a three-column tree panel — migrating the 13 existing skills and shipping the passives plus the Frost and Hex spines.

**Architecture:** `sim/skills.ts` becomes a typed table of 36 rows (tree, tier, kind, element, prereqs, synergies, describe) with rank-math functions beside it; `sim/systems/skills.ts` keeps hand-written cast handlers. Damage funnels through `hitMonster(…, element)` which applies resistance, Cold Mastery, and Doom. Monsters carry a `debuffs` list ticked by a new `debuffSystem`; players carry a `buffs` map. Passives feed `computeStats`. Respec is a sim input handled in camp. The panel renders `CLASS_TREES × TIERS`.

**Tech Stack:** TypeScript, Bun test (`bun test sim client`), Vite + React + Three.js client. No DOM/three imports in `sim/`.

**Spec:** `docs/superpowers/specs/2026-09-04-skill-trees-design.md`

## Global Constraints

- `sim/` never imports three, react, or the DOM. All randomness via `state.rng`.
- TDD for all sim logic: failing test first. Run `bun test sim client` after every task; the determinism tests in `sim/tick.test.ts` must stay green.
- Tiers: `1 | 4 | 8 | 12 | 18 | 24`. `MAX_RANK = 10`. One point per level.
- Elements: `"physical" | "fire" | "cold" | "shadow"`.
- Tree ids: `arms | warcries | fury | fire | frost | hexes`. Exactly six skills per tree, one per tier.
- Plan-2 skills exist as rows with `pending: true` and refuse points.
- Save `VERSION` becomes `2`; v1 saves and saves with unknown skill ids load with a full refund.
- Respec cost starts at `15 × level²`, camp only.
- Commit after every task with a message in the repo's style (short imperative title, body optional) ending in `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File map

- `sim/skills.ts` — types, `TREES`, `SKILLS` (36 rows), `TIERS`, `TREE_SKILLS`, `CLASS_TREES`, rank-math functions, `respecCost`, buff helpers.
- `sim/skills.test.ts` — existing skill tests (updated) plus table invariants, spend gating, respec.
- `sim/elements.ts` (new) — `Element`, `resistedDamage`, `coldMasteryReduction`. Pure math, no state.
- `sim/elements.test.ts` (new).
- `sim/debuffs.ts` (new) — `Debuff`, `DebuffKind`, `applyDebuff`, `slowFactor`, `weakenFactor`, `doomFactor`.
- `sim/debuffs.test.ts` (new).
- `sim/systems/skills.ts` — spend rule, cast handlers, `debuffSystem`, `applyRespecInput`, mana regen with Warmth.
- `sim/systems/combat.ts` — `hitMonster(element)`, monster speed/attack slowed, monster damage weakened.
- `sim/monsters.ts` — `resist` on types and instances, `debuffs` on instances, resistance rows.
- `sim/character.ts` — `computeStats(eq, level, klass, skills)` with passives.
- `sim/state.ts` — `Player.buffs`, `PlayerInput.respec`, events `respec`, `monster_hit.element`.
- `sim/tick.ts` — player init, `debuffSystem` and `applyRespecInput` in order.
- `sim/save.ts` — v2 + refund migration.
- `client/hotbar.ts` — defaults from trees, `resetHotbar`.
- `client/ui/SkillPanel.tsx` — tree panel.
- `client/ui/HealerPanel.tsx` — respec row.
- `client/ui/BottomBar.tsx` — `SKILL_SHORT` for all ids.
- `client/main.tsx`, `client/render/scene.ts` — event colours, sounds, fx for renamed/new ids, hotbar reset on respec.

---

### Task 1: Skill table — new row shape, trees, all 36 rows, invariants

**Files:**
- Modify: `sim/skills.ts`
- Modify: `sim/skills.test.ts`
- Modify: `client/ui/BottomBar.tsx:83-97` (SKILL_SHORT), `client/ui/SkillPanel.tsx` (DESCRIPTIONS), `client/hotbar.ts` (compile only)

**Interfaces:**
- Produces: `TreeId`, `Tier`, `Element`, `SkillKind`, `TreeDef`, `SkillDef` (fields below), `TREES`, `TIERS`, `SKILLS`, `SKILL_IDS`, `TREE_SKILLS(tree)`, `CLASS_TREES(klass)`, `CLASS_SKILLS(klass)` (kept: every skill of the class in tree-then-tier order).

- [ ] **Step 1: Write the failing invariant tests**

Append to `sim/skills.test.ts`:

```ts
import { CLASS_TREES, TIERS, TREES, TREE_SKILLS, SKILL_IDS } from "./skills";

describe("skill table", () => {
  test("every tree has exactly one skill per tier", () => {
    for (const tree of Object.values(TREES)) {
      const rows = TREE_SKILLS(tree.id);
      expect(rows.map((r) => r.tier)).toEqual([...TIERS]);
    }
  });

  test("every class has three trees and eighteen skills", () => {
    for (const klass of ["warrior", "witch"] as const) {
      const trees = CLASS_TREES(klass);
      expect(trees).toHaveLength(3);
      expect(trees.flatMap((t) => TREE_SKILLS(t.id))).toHaveLength(18);
    }
  });

  test("prerequisites are in the same tree at a lower tier", () => {
    for (const id of SKILL_IDS) {
      const def = SKILLS[id];
      for (const pre of def.prereqs) {
        expect(SKILLS[pre].tree).toBe(def.tree);
        expect(SKILLS[pre].tier).toBeLessThan(def.tier);
      }
    }
  });

  test("synergy sources exist and belong to the same class", () => {
    for (const id of SKILL_IDS) {
      const def = SKILLS[id];
      for (const s of def.synergies) {
        expect(SKILLS[s.from]).toBeDefined();
        expect(SKILLS[s.from].klass).toBe(def.klass);
      }
    }
  });

  test("a skill's class matches its tree's class", () => {
    for (const id of SKILL_IDS) expect(SKILLS[id].klass).toBe(TREES[SKILLS[id].tree].klass);
  });

  test("passives cast nothing", () => {
    for (const id of SKILL_IDS) {
      const def = SKILLS[id];
      if (def.kind !== "passive") continue;
      expect(def.manaCost).toBe(0);
      expect(def.castTicks).toBe(0);
      expect(def.targeting).toBe("none");
    }
  });

  test("describe renders numbers at rank 1 and rank 10 for every skill", () => {
    for (const id of SKILL_IDS) {
      expect(SKILLS[id].describe(1)).toMatch(/\d/);
      expect(SKILLS[id].describe(MAX_RANK)).toMatch(/\d/);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test sim/skills.test.ts`
Expected: FAIL — `TREES`, `TIERS`, `CLASS_TREES` not exported.

- [ ] **Step 3: Rewrite `sim/skills.ts` types and table**

Replace the `SkillId` union, `SkillDef`, `SKILLS`, and `CLASS_SKILLS` in `sim/skills.ts` with:

```ts
export type Klass = "warrior" | "witch";
export type TreeId = "arms" | "warcries" | "fury" | "fire" | "frost" | "hexes";
export type Tier = 1 | 4 | 8 | 12 | 18 | 24;
export type Element = "physical" | "fire" | "cold" | "shadow";
export type SkillKind = "active" | "passive";
export type Targeting = "none" | "target" | "point";
export type BuffId = "warcry" | "focus" | "battleshout" | "frenzy" | "berserk" | "icearmor";

export type SkillId =
  // warrior · arms
  | "cleave" | "crush" | "weaponmastery" | "deathblow" | "whirl" | "rend"
  // warrior · warcries
  | "warcry" | "taunt" | "ironskin" | "battleshout" | "howl" | "rally"
  // warrior · fury
  | "charge" | "leap" | "fleetfoot" | "stomp" | "frenzy" | "berserk"
  // witch · fire
  | "firebolt" | "warmth" | "fireball" | "firewall" | "meteor" | "firemastery"
  // witch · frost
  | "frostbolt" | "frostnova" | "icearmor" | "glacialspike" | "blizzard" | "coldmastery"
  // witch · hexes
  | "weaken" | "blink" | "focus" | "slow" | "soulchain" | "doom";

export interface TreeDef { id: TreeId; klass: Klass; name: string; blurb: string }

export interface SkillDef {
  id: SkillId;
  name: string;
  klass: Klass;
  tree: TreeId;
  /** Character level required for the first point. */
  tier: Tier;
  kind: SkillKind;
  targeting: Targeting;
  /** Damage element, or the element a passive/buff scales. */
  element: Element;
  manaCost: number;
  /** Ticks the cast occupies the shared action cooldown — tuned to the animation. */
  castTicks: number;
  /** Timed self/party buff this active applies, if any. */
  buffId?: BuffId;
  /** Same tree, lower tier; each needs rank ≥ 1 before a point goes here. */
  prereqs: SkillId[];
  /** Panel text only — the math lives in the rank functions below. */
  synergies: { from: SkillId; text: string }[];
  /** Panel text with the numbers at this rank. */
  describe: (rank: number) => string;
  /** Row exists, handler does not yet (plan 2): refuses points, shows "coming". */
  pending?: true;
}

export const MAX_RANK = 10;
export const TIERS: readonly Tier[] = [1, 4, 8, 12, 18, 24];
/** Buff duration in ticks for the timed buffs (20 s at 25 Hz). */
export const BUFF_TICKS = 500;

export const TREES: Record<TreeId, TreeDef> = {
  arms: { id: "arms", klass: "warrior", name: "Arms", blurb: "weapon strikes that scale with the blade in your hand" },
  warcries: { id: "warcries", klass: "warrior", name: "Warcries", blurb: "shouts that harden you and rattle the enemy" },
  fury: { id: "fury", klass: "warrior", name: "Fury", blurb: "rushes, leaps, and the rage to close any gap" },
  fire: { id: "fire", klass: "witch", name: "Fire", blurb: "raw burning damage, blast and burn" },
  frost: { id: "frost", klass: "witch", name: "Frost", blurb: "cold that slows, freezes, and shatters" },
  hexes: { id: "hexes", klass: "witch", name: "Hexes", blurb: "curses that soften a pack for whatever kills it" },
};
```

Then the rows. Helper and rows (place after the rank functions so `describe` can call them; TypeScript hoists function declarations, and the rank functions below are all `function` declarations):

```ts
const pct = (x: number) => `${Math.round(x * 100)}%`;
const secs = (ticks: number) => `${(ticks / 25).toFixed(1)}s`;

type RowInput = Omit<SkillDef, "prereqs" | "synergies" | "kind" | "targeting" | "element" | "manaCost" | "castTicks"> &
  Partial<Pick<SkillDef, "prereqs" | "synergies" | "kind" | "targeting" | "element" | "manaCost" | "castTicks">>;

function row(r: RowInput): SkillDef {
  return {
    kind: "active",
    targeting: "none",
    element: "physical",
    manaCost: 0,
    castTicks: 0,
    prereqs: [],
    synergies: [],
    ...r,
  };
}

function passive(r: Omit<RowInput, "kind" | "targeting" | "manaCost" | "castTicks">): SkillDef {
  return row({ ...r, kind: "passive", targeting: "none", manaCost: 0, castTicks: 0 });
}

function pending(r: RowInput): SkillDef {
  return { ...row(r), pending: true };
}

export const SKILLS: Record<SkillId, SkillDef> = {
  // ── warrior · arms ──
  cleave: row({ id: "cleave", name: "Cleave", klass: "warrior", tree: "arms", tier: 1, manaCost: 3, castTicks: 18,
    synergies: [{ from: "warcry", text: "+10% damage per Warcry rank" }],
    describe: (r) => `sweep every enemy within ${CLEAVE_RADIUS} · ${pct(cleaveMultiplier(Math.max(1, r), 0))} weapon damage` }),
  crush: row({ id: "crush", name: "Crush", klass: "warrior", tree: "arms", tier: 4, targeting: "target", manaCost: 4, castTicks: 14,
    prereqs: ["cleave"],
    describe: (r) => `a guaranteed heavy blow · ${pct(crushMultiplier(Math.max(1, r)))} weapon damage` }),
  weaponmastery: passive({ id: "weaponmastery", name: "Weapon Mastery", klass: "warrior", tree: "arms", tier: 8,
    describe: (r) => `+${pct(weaponMasteryDamage(Math.max(1, r)))} weapon damage · +${weaponMasteryAttackRating(Math.max(1, r))} attack rating` }),
  deathblow: row({ id: "deathblow", name: "Deathblow", klass: "warrior", tree: "arms", tier: 12, targeting: "target", manaCost: 8, castTicks: 16,
    prereqs: ["crush"], synergies: [{ from: "crush", text: "+15% damage per Crush rank" }],
    describe: (r) => `one executioner's strike · ${pct(deathblowMultiplier(Math.max(1, r), 0))} weapon damage · never misses` }),
  whirl: pending({ id: "whirl", name: "Whirl", klass: "warrior", tree: "arms", tier: 18, targeting: "point", manaCost: 9, castTicks: 20,
    prereqs: ["deathblow"], synergies: [{ from: "cleave", text: "+8% damage per Cleave rank" }],
    describe: (r) => `spin to a spot, striking everything you pass · ${pct(0.8 + 0.2 * (Math.max(1, r) - 1))} weapon damage per hit` }),
  rend: pending({ id: "rend", name: "Rend", klass: "warrior", tree: "arms", tier: 24, targeting: "target", manaCost: 10, castTicks: 16,
    prereqs: ["whirl"], synergies: [{ from: "deathblow", text: "+10% bleed per Deathblow rank" }],
    describe: (r) => `a heavy strike that leaves a bleed · ${pct(1.5 + 0.3 * (Math.max(1, r) - 1))} weapon damage, then ${2 + Math.max(1, r)} per tick for ${secs(75)}` }),

  // ── warrior · warcries ──
  warcry: row({ id: "warcry", name: "Warcry", klass: "warrior", tree: "warcries", tier: 1, manaCost: 6, castTicks: 15, buffId: "warcry",
    describe: (r) => `battle shout · +${pct(warcryMultiplier(Math.max(1, r)) - 1)} damage for ${secs(BUFF_TICKS)}` }),
  taunt: pending({ id: "taunt", name: "Taunt", klass: "warrior", tree: "warcries", tier: 4, manaCost: 5, castTicks: 14,
    prereqs: ["warcry"],
    describe: (r) => `pull every monster within ${6 + Math.max(1, r)} onto you` }),
  ironskin: passive({ id: "ironskin", name: "Iron Skin", klass: "warrior", tree: "warcries", tier: 8,
    describe: (r) => `+${pct(ironSkinDefense(Math.max(1, r)))} defense` }),
  battleshout: pending({ id: "battleshout", name: "Battle Shout", klass: "warrior", tree: "warcries", tier: 12, manaCost: 8, castTicks: 15, buffId: "battleshout",
    prereqs: ["taunt"],
    describe: (r) => `the party's max life +${pct(0.1 + 0.03 * (Math.max(1, r) - 1))} for ${secs(BUFF_TICKS)}` }),
  howl: pending({ id: "howl", name: "Howl", klass: "warrior", tree: "warcries", tier: 18, manaCost: 9, castTicks: 16,
    prereqs: ["battleshout"],
    describe: (r) => `a shout that stuns everything within ${3} for ${secs(25 + 5 * (Math.max(1, r) - 1))}` }),
  rally: pending({ id: "rally", name: "Rally", klass: "warrior", tree: "warcries", tier: 24, manaCost: 12, castTicks: 18,
    prereqs: ["howl"], synergies: [{ from: "warcry", text: "+3% party damage per Warcry rank" }],
    describe: (r) => `stuns everything near you and lifts the party's damage +${pct(0.2 + 0.04 * (Math.max(1, r) - 1))} for ${secs(BUFF_TICKS)}` }),

  // ── warrior · fury ──
  charge: row({ id: "charge", name: "Charge", klass: "warrior", tree: "fury", tier: 1, targeting: "target", manaCost: 4, castTicks: 16,
    describe: (r) => `rush a distant enemy and ram it · ${pct(chargeMultiplier(Math.max(1, r)))} weapon damage · stuns ${secs(chargeStunTicks(Math.max(1, r)))}` }),
  leap: row({ id: "leap", name: "Leap", klass: "warrior", tree: "fury", tier: 4, targeting: "point", manaCost: 5, castTicks: 20,
    prereqs: ["charge"],
    describe: (r) => `jump up to ${leapRange(Math.max(1, r))} tiles · ${pct(leapMultiplier(Math.max(1, r)))} weapon damage on landing · stuns ${secs(leapStunTicks(Math.max(1, r)))}` }),
  fleetfoot: passive({ id: "fleetfoot", name: "Fleetfoot", klass: "warrior", tree: "fury", tier: 8,
    describe: (r) => `+${pct(fleetfootSpeed(Math.max(1, r)))} move speed` }),
  stomp: row({ id: "stomp", name: "Stomp", klass: "warrior", tree: "fury", tier: 12, manaCost: 7, castTicks: 16,
    prereqs: ["leap"], synergies: [{ from: "leap", text: "+5% damage and longer stun per Leap rank" }],
    describe: (r) => `slam the ground · ${pct(stompMultiplier(Math.max(1, r), 0))} weapon damage around you · stuns ${secs(stompStunTicks(Math.max(1, r), 0))}` }),
  frenzy: pending({ id: "frenzy", name: "Frenzy", klass: "warrior", tree: "fury", tier: 18, manaCost: 8, castTicks: 12, buffId: "frenzy",
    prereqs: ["stomp"], synergies: [{ from: "charge", text: "+2% speed per Charge rank" }],
    describe: (r) => `+${pct(0.15 + 0.03 * (Math.max(1, r) - 1))} attack and move speed for ${secs(BUFF_TICKS)}` }),
  berserk: pending({ id: "berserk", name: "Berserk", klass: "warrior", tree: "fury", tier: 24, manaCost: 12, castTicks: 14, buffId: "berserk",
    prereqs: ["frenzy"], synergies: [{ from: "frenzy", text: "+4% damage per Frenzy rank" }],
    describe: (r) => `+${pct(0.5 + 0.1 * (Math.max(1, r) - 1))} damage, defense drops to 0, for ${secs(BUFF_TICKS)}` }),

  // ── witch · fire ──
  firebolt: row({ id: "firebolt", name: "Firebolt", klass: "witch", tree: "fire", tier: 1, targeting: "target", element: "fire", manaCost: 4, castTicks: 14,
    synergies: [{ from: "focus", text: "+10% damage per Focus rank" }],
    describe: (r) => { const d = fireboltDamage(Math.max(1, r), 0); return `hurl fire at a distant enemy · ${d.min}–${d.max} fire · never misses`; } }),
  warmth: passive({ id: "warmth", name: "Warmth", klass: "witch", tree: "fire", tier: 4,
    describe: (r) => `+${(warmthRegen(Math.max(1, r)) * 25).toFixed(2)} mana per second` }),
  fireball: row({ id: "fireball", name: "Fireball", klass: "witch", tree: "fire", tier: 8, targeting: "point", element: "fire", manaCost: 9, castTicks: 16,
    prereqs: ["firebolt"], synergies: [{ from: "firebolt", text: "+8% damage per Firebolt rank" }],
    describe: (r) => { const d = fireballDamage(Math.max(1, r), 0); return `a blast at the aimed spot · ${d.min}–${d.max} fire to all within ${FIREBALL_RADIUS}`; } }),
  firewall: pending({ id: "firewall", name: "Fire Wall", klass: "witch", tree: "fire", tier: 12, targeting: "point", element: "fire", manaCost: 10, castTicks: 16,
    prereqs: ["fireball"],
    describe: (r) => `a line of burning ground · ${3 + 2 * (Math.max(1, r) - 1)} fire per tick for ${secs(100)}` }),
  meteor: pending({ id: "meteor", name: "Meteor", klass: "witch", tree: "fire", tier: 18, targeting: "point", element: "fire", manaCost: 14, castTicks: 18,
    prereqs: ["firewall"], synergies: [{ from: "fireball", text: "+6% damage per Fireball rank" }, { from: "firewall", text: "+6% burn per Fire Wall rank" }],
    describe: (r) => `a delayed blast that leaves burning ground · ${20 + 10 * (Math.max(1, r) - 1)}–${35 + 14 * (Math.max(1, r) - 1)} fire` }),
  firemastery: passive({ id: "firemastery", name: "Fire Mastery", klass: "witch", tree: "fire", tier: 24, element: "fire",
    describe: (r) => `+${pct(fireMasteryBonus(Math.max(1, r)))} fire damage` }),

  // ── witch · frost ──
  frostbolt: row({ id: "frostbolt", name: "Frost Bolt", klass: "witch", tree: "frost", tier: 1, targeting: "target", element: "cold", manaCost: 4, castTicks: 14,
    describe: (r) => { const d = frostboltDamage(Math.max(1, r)); return `a chilling bolt · ${d.min}–${d.max} cold · chills ${pct(CHILL_POWER)} for ${secs(frostboltChillTicks(Math.max(1, r)))}`; } }),
  frostnova: row({ id: "frostnova", name: "Frost Nova", klass: "witch", tree: "frost", tier: 4, element: "cold", manaCost: 6, castTicks: 15,
    prereqs: ["frostbolt"],
    describe: (r) => { const d = frostnovaDamage(Math.max(1, r)); return `an icy burst around you · ${d.min}–${d.max} cold · chills ${pct(CHILL_POWER)} for ${secs(frostnovaChillTicks(Math.max(1, r)))}`; } }),
  icearmor: pending({ id: "icearmor", name: "Ice Armor", klass: "witch", tree: "frost", tier: 8, element: "cold", manaCost: 7, castTicks: 12, buffId: "icearmor",
    prereqs: ["frostnova"],
    describe: (r) => `+${pct(0.2 + 0.05 * (Math.max(1, r) - 1))} defense and melee attackers are chilled, for ${secs(BUFF_TICKS)}` }),
  glacialspike: pending({ id: "glacialspike", name: "Glacial Spike", klass: "witch", tree: "frost", tier: 12, targeting: "point", element: "cold", manaCost: 10, castTicks: 16,
    prereqs: ["icearmor"], synergies: [{ from: "frostbolt", text: "+8% damage per Frost Bolt rank" }],
    describe: (r) => `a blast that freezes all it touches · ${10 + 5 * (Math.max(1, r) - 1)}–${16 + 8 * (Math.max(1, r) - 1)} cold · stuns ${secs(30 + 5 * (Math.max(1, r) - 1))}` }),
  blizzard: pending({ id: "blizzard", name: "Blizzard", klass: "witch", tree: "frost", tier: 18, targeting: "point", element: "cold", manaCost: 15, castTicks: 18,
    prereqs: ["glacialspike"], synergies: [{ from: "frostnova", text: "+6% damage per Frost Nova rank" }],
    describe: (r) => `a storm over the aimed spot for ${secs(100)} · ${4 + 2 * (Math.max(1, r) - 1)}–${7 + 3 * (Math.max(1, r) - 1)} cold per strike` }),
  coldmastery: passive({ id: "coldmastery", name: "Cold Mastery", klass: "witch", tree: "frost", tier: 24, element: "cold",
    describe: (r) => `enemy cold resistance −${coldMasteryReduction(Math.max(1, r))}% · immunities at one fifth` }),

  // ── witch · hexes ──
  weaken: row({ id: "weaken", name: "Weaken", klass: "witch", tree: "hexes", tier: 1, targeting: "point", element: "shadow", manaCost: 5, castTicks: 14,
    describe: (r) => `curse everything within ${CURSE_RADIUS} of the spot · −${pct(weakenPower(Math.max(1, r)))} damage dealt for ${secs(weakenTicks(Math.max(1, r)))}` }),
  blink: row({ id: "blink", name: "Blink", klass: "witch", tree: "hexes", tier: 4, targeting: "point", element: "shadow", manaCost: 6, castTicks: 16,
    prereqs: ["weaken"],
    describe: () => `step through shadow to a spot you can see, up to ${BLINK_RANGE} tiles` }),
  focus: row({ id: "focus", name: "Focus", klass: "witch", tree: "hexes", tier: 8, element: "shadow", manaCost: 5, castTicks: 12, buffId: "focus",
    prereqs: ["blink"],
    describe: (r) => `gather your will · +${pct(focusMultiplier(Math.max(1, r)) - 1)} spell damage for ${secs(BUFF_TICKS)}` }),
  slow: row({ id: "slow", name: "Slow", klass: "witch", tree: "hexes", tier: 12, targeting: "point", element: "shadow", manaCost: 6, castTicks: 14,
    prereqs: ["focus"], synergies: [{ from: "weaken", text: "+5% duration per Weaken rank" }],
    describe: (r) => `curse everything within ${CURSE_RADIUS} · −${pct(slowPower(Math.max(1, r)))} move and attack speed for ${secs(slowTicks(Math.max(1, r), 0))}` }),
  soulchain: row({ id: "soulchain", name: "Soulchain", klass: "witch", tree: "hexes", tier: 18, element: "shadow", manaCost: 10, castTicks: 15,
    prereqs: ["slow"], synergies: [{ from: "doom", text: "+1.5% life drained per Doom rank" }],
    describe: (r) => { const d = soulchainDamage(Math.max(1, r)); return `shadow leaps through the ${SOULCHAIN_TARGETS} nearest enemies · ${d.min}–${d.max} shadow · heals you ${pct(soulchainDrain(Math.max(1, r), 0))} of damage dealt`; } }),
  doom: row({ id: "doom", name: "Doom", klass: "witch", tree: "hexes", tier: 24, targeting: "point", element: "shadow", manaCost: 10, castTicks: 16,
    prereqs: ["soulchain"], synergies: [{ from: "slow", text: "+5% duration per Slow rank" }],
    describe: (r) => `curse everything within ${CURSE_RADIUS} · +${pct(doomPower(Math.max(1, r)))} damage taken from everything for ${secs(doomTicks(Math.max(1, r), 0))}` }),
};

/** Every skill id, in definition (and therefore save/init) order. */
export const SKILL_IDS = Object.keys(SKILLS) as SkillId[];

const TREE_ORDER: TreeId[] = ["arms", "warcries", "fury", "fire", "frost", "hexes"];

export function CLASS_TREES(klass: Klass): TreeDef[] {
  return TREE_ORDER.map((id) => TREES[id]).filter((t) => t.klass === klass);
}

/** A tree's six skills in tier order. */
export function TREE_SKILLS(tree: TreeId): SkillDef[] {
  return SKILL_IDS.map((id) => SKILLS[id]).filter((d) => d.tree === tree).sort((a, b) => a.tier - b.tier);
}

/** A class's skills, tree by tree, tier by tier. */
export function CLASS_SKILLS(klass: Klass): SkillDef[] {
  return CLASS_TREES(klass).flatMap((t) => TREE_SKILLS(t.id));
}
```

Add the new rank functions and constants next to the existing ones (keep every existing function; remove `buffTicks` from rows; delete `CHAINBOLT_*` and `chainboltDamage` in favour of the Soulchain versions):

```ts
export const CURSE_RADIUS = 2.5;
export const CURSE_RANGE = 10;
export const FROSTBOLT_RANGE = 12;
/** Chill slows move and attack speed by this fraction. */
export const CHILL_POWER = 0.4;
export const SOULCHAIN_RANGE = 8;
export const SOULCHAIN_TARGETS = 3;
/** Second and third soulchain strikes land at this fraction of full damage. */
export const SOULCHAIN_FALLOFF = 0.7;

/** Weapon Mastery: +6% weapon damage per rank. */
export function weaponMasteryDamage(rank: number): number { return 0.06 * rank; }
/** Weapon Mastery: +12 attack rating per rank. */
export function weaponMasteryAttackRating(rank: number): number { return 12 * rank; }
/** Iron Skin: +8% defense per rank. */
export function ironSkinDefense(rank: number): number { return 0.08 * rank; }
/** Fleetfoot: +3% move speed per rank. */
export function fleetfootSpeed(rank: number): number { return 0.03 * rank; }
/** Warmth: +0.01 mana per tick per rank (base regen is 0.05). */
export function warmthRegen(rank: number): number { return 0.01 * rank; }
/** Fire Mastery: +8% fire damage per rank. */
export function fireMasteryBonus(rank: number): number { return 0.08 * rank; }
/** Cold Mastery: enemy cold resistance −8 points per rank. */
export function coldMasteryReduction(rank: number): number { return 8 * rank; }

export function frostboltDamage(rank: number): { min: number; max: number } {
  return { min: 4 + 3 * (rank - 1), max: 7 + 4 * (rank - 1) };
}
export function frostboltChillTicks(rank: number): number { return 30 + 5 * (rank - 1); }

/** Weaken: −20% damage dealt, +3% per extra rank. */
export function weakenPower(rank: number): number { return 0.2 + 0.03 * (rank - 1); }
export function weakenTicks(rank: number): number { return 200 + 25 * (rank - 1); }
/** Slow: −25% move and attack speed, +3% per extra rank. */
export function slowPower(rank: number): number { return 0.25 + 0.03 * (rank - 1); }
/** Slow lasts 6 s, +0.8 s per extra rank, +5% per Weaken rank (synergy). */
export function slowTicks(rank: number, weakenRank: number): number {
  return Math.floor((150 + 20 * (rank - 1)) * (1 + 0.05 * weakenRank));
}
/** Doom: +20% damage taken, +4% per extra rank. */
export function doomPower(rank: number): number { return 0.2 + 0.04 * (rank - 1); }
/** Doom lasts 6 s, +0.6 s per extra rank, +5% per Slow rank (synergy). */
export function doomTicks(rank: number, slowRank: number): number {
  return Math.floor((150 + 15 * (rank - 1)) * (1 + 0.05 * slowRank));
}
/** Soulchain: per-strike shadow damage by rank. */
export function soulchainDamage(rank: number): { min: number; max: number } {
  return { min: 6 + 4 * (rank - 1), max: 11 + 5 * (rank - 1) };
}
/** Soulchain drain: 15% of damage dealt comes back as life, +1.5% per Doom rank (synergy). */
export function soulchainDrain(rank: number, doomRank: number): number {
  return 0.15 + 0.015 * doomRank + 0.01 * (rank - 1);
}

/** Respec price at Sera's: 15 × level². */
export function respecCost(level: number): number { return 15 * level * level; }
```

`damageMultiplier` / `spellMultiplier` still read `p.buffUntil` for now — Task 2 replaces them.

- [ ] **Step 4: Fix the compile fallout**

- `client/ui/BottomBar.tsx` `SKILL_SHORT`: add every new id — `weaponmastery: "wpn"`, `whirl: "whrl"`, `rend: "rend"`, `taunt: "tnt"`, `ironskin: "iron"`, `battleshout: "bsh"`, `howl: "howl"`, `rally: "rly"`, `fleetfoot: "flt"`, `frenzy: "frz"`, `berserk: "bsk"`, `warmth: "wrm"`, `firewall: "wall"`, `meteor: "mtr"`, `firemastery: "fmas"`, `frostbolt: "fbol"`, `icearmor: "iarm"`, `glacialspike: "spk"`, `blizzard: "bliz"`, `coldmastery: "cmas"`, `weaken: "weak"`, `slow: "slow"`, `soulchain: "soul"`, `doom: "doom"`; rename `chainbolt` → `soulchain`; rename firebolt short to `"fire"`.
- `client/ui/SkillPanel.tsx`: delete `DESCRIPTIONS`; render `def.describe(rank)` where it was used. (Task 9 rewrites this file; this step only keeps it compiling.)
- `sim/systems/skills.ts`: rename `chainbolt` case to `soulchain`, `CHAINBOLT_*` → `SOULCHAIN_*`, `chainboltDamage(p.skills.chainbolt, p.skills.fireball)` → `soulchainDamage(p.skills.soulchain)`; `SKILLS.warcry.buffTicks` → `BUFF_TICKS` (same for focus).
- `client/main.tsx:617` and `client/render/scene.ts:1897`: `"chainbolt"` → `"soulchain"`.
- `sim/skills.test.ts`: any test referencing `chainbolt` → `soulchain` with `soulchainDamage(rank)`; the existing prereq test that says Fireball needs Firebolt still holds.

- [ ] **Step 5: Run the full suite and the typecheck**

Run: `bun test sim client && bun run build`
Expected: table tests PASS; some existing spend tests may now fail because level requirements changed (e.g. Crush moved from level 2 to tier 4). Update those tests' `readyPlayer` levels to the new tiers and their prereq expectations (Crush needs Cleave; Leap needs Charge; Frost Nova needs Frost Bolt; Fireball needs Firebolt). Re-run until green.

- [ ] **Step 6: Commit**

```bash
git add sim/skills.ts sim/skills.test.ts sim/systems/skills.ts client/ui/BottomBar.tsx client/ui/SkillPanel.tsx client/main.tsx client/render/scene.ts
git commit -m "Skills become a table of six-per-tree rows across three trees per class"
```

---

### Task 2: Spend rule — tiers, prereq lists, pending rows, passives

**Files:**
- Modify: `sim/systems/skills.ts` (`applySpendSkillInput`)
- Modify: `sim/skills.test.ts`

**Interfaces:**
- Consumes: `SKILLS[id].tier`, `.prereqs`, `.pending`, `.kind`.
- Produces: `canSpendOn(p: Player, id: SkillId): boolean` exported from `sim/systems/skills.ts` (the panel uses it in Task 9).

- [ ] **Step 1: Write the failing tests**

```ts
describe("spend gating by tree", () => {
  test("a tier locks until the character reaches its level", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state, 3, 5);
    stepSolo(state, { spendSkill: "cleave" });
    stepSolo(state, { spendSkill: "crush" }); // tier 4 at level 3
    expect(player(state).skills.crush).toBe(0);
    player(state).level = 4;
    stepSolo(state, { spendSkill: "crush" });
    expect(player(state).skills.crush).toBe(1);
  });

  test("every prerequisite needs a point first", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state, 12, 5);
    stepSolo(state, { spendSkill: "deathblow" }); // needs crush, which needs cleave
    expect(player(state).skills.deathblow).toBe(0);
    stepSolo(state, { spendSkill: "cleave" });
    stepSolo(state, { spendSkill: "crush" });
    stepSolo(state, { spendSkill: "deathblow" });
    expect(player(state).skills.deathblow).toBe(1);
  });

  test("passives take points without needing a prerequisite", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state, 8, 1);
    stepSolo(state, { spendSkill: "weaponmastery" });
    expect(player(state).skills.weaponmastery).toBe(1);
  });

  test("pending rows refuse points", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state, 30, 10);
    for (const id of ["cleave", "crush", "deathblow"] as const) stepSolo(state, { spendSkill: id });
    stepSolo(state, { spendSkill: "whirl" });
    expect(player(state).skills.whirl).toBe(0);
    expect(player(state).skillPoints).toBe(7);
  });

  test("the other class's skills are refused", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state, 10, 1);
    stepSolo(state, { spendSkill: "firebolt" });
    expect(player(state).skills.firebolt).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test sim/skills.test.ts -t "spend gating by tree"`
Expected: FAIL — `def.levelReq`/`def.prereq` are gone so the current rule throws or lets pending rows through.

- [ ] **Step 3: Implement**

In `sim/systems/skills.ts`:

```ts
/** The whole spend gate, shared with the panel so the + button and the sim agree. */
export function canSpendOn(p: Player, id: SkillId): boolean {
  const def = SKILLS[id];
  if (!def || def.klass !== p.klass || def.pending) return false;
  if (p.skillPoints <= 0 || p.level < def.tier) return false;
  if (def.prereqs.some((pre) => p.skills[pre] <= 0)) return false;
  return p.skills[id] < MAX_RANK;
}

export function applySpendSkillInput(state: GameState, p: Player, input: PlayerInput): void {
  const id = input.spendSkill;
  if (!id || !canSpendOn(p, id)) return;
  p.skills[id]++;
  p.skillPoints--;
  recomputePlayerStats(state, p); // passives change derived stats (Task 6)
  state.events.push({ type: "skill_learned", playerId: p.id, skill: id, rank: p.skills[id] });
}
```

Import `recomputePlayerStats` from `./inventory` (check for an import cycle: `inventory.ts` must not import `systems/skills.ts`; it does not today).

- [ ] **Step 4: Run tests**

Run: `bun test sim/skills.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sim/systems/skills.ts sim/skills.test.ts
git commit -m "Skill points respect tiers, prerequisite lists, and pending rows"
```

---

### Task 3: Player buff map replaces `buffUntil`

**Files:**
- Modify: `sim/state.ts:156` (Player), `sim/tick.ts:322` (init), `sim/skills.ts` (helpers), `sim/systems/skills.ts` (warcry/focus cases)
- Modify: `sim/skills.test.ts`
- Grep-and-fix: `grep -rn buffUntil sim client`

**Interfaces:**
- Produces: `Player.buffs: Partial<Record<BuffId, number>>`; `hasBuff(state, p, id): boolean`; `applyBuff(state, p, id, ticks): void` in `sim/skills.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
import { hasBuff } from "./skills";

describe("buffs", () => {
  test("warcry and focus coexist and expire independently", () => {
    const state = createGameOn(1, arena());
    const p = player(state);
    p.buffs.warcry = state.tick + 10;
    p.buffs.focus = state.tick + 20;
    expect(hasBuff(state, p, "warcry")).toBe(true);
    expect(hasBuff(state, p, "focus")).toBe(true);
    for (let i = 0; i < 12; i++) stepSolo(state, {});
    expect(hasBuff(state, p, "warcry")).toBe(false);
    expect(hasBuff(state, p, "focus")).toBe(true);
  });

  test("casting warcry sets the warcry buff for BUFF_TICKS", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state, 1, 1);
    stepSolo(state, { spendSkill: "warcry" });
    const at = state.tick;
    stepSolo(state, { cast: { skill: "warcry" } });
    expect(player(state).buffs.warcry).toBe(at + BUFF_TICKS);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test sim/skills.test.ts -t buffs`
Expected: FAIL — `buffs` undefined.

- [ ] **Step 3: Implement**

`sim/state.ts`: replace `buffUntil: number;` with `/** Timed buffs by id: the tick each one ends. */ buffs: Partial<Record<BuffId, number>>;` and import `BuffId`.
`sim/tick.ts`: `buffUntil: 0` → `buffs: {}`.
`sim/skills.ts`:

```ts
export function hasBuff(state: GameState, p: Player, id: BuffId): boolean {
  return (p.buffs[id] ?? 0) > state.tick;
}

export function applyBuff(state: GameState, p: Player, id: BuffId, ticks: number): void {
  p.buffs[id] = state.tick + ticks;
}

/** Weapon-damage multiplier from a player's active buffs (Warcry). */
export function damageMultiplier(state: GameState, p: Player): number {
  return hasBuff(state, p, "warcry") && p.skills.warcry > 0 ? warcryMultiplier(p.skills.warcry) : 1;
}

/** Spell-damage multiplier from a player's active buffs (Focus). */
export function spellMultiplier(state: GameState, p: Player): number {
  return hasBuff(state, p, "focus") && p.skills.focus > 0 ? focusMultiplier(p.skills.focus) : 1;
}
```

`sim/systems/skills.ts` warcry/focus cases: `applyBuff(state, p, "warcry", BUFF_TICKS)` / `applyBuff(state, p, "focus", BUFF_TICKS)`.
Client: `grep -rn buffUntil client` — the bottom bar or hero rig may show the buff timer; switch it to `p.buffs.warcry ?? p.buffs.focus`.

- [ ] **Step 4: Run tests and typecheck**

Run: `bun test sim client && bun run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A sim client
git commit -m "Players carry a buff map so shouts and spells can overlap"
```

---

### Task 4: Elements and resistances

**Files:**
- Create: `sim/elements.ts`, `sim/elements.test.ts`
- Modify: `sim/monsters.ts` (`MonsterType.resist`, `Monster.resist`, spawn copy, content rows), `sim/systems/combat.ts` (`hitMonster`), `sim/state.ts` (`monster_hit.element`), `sim/systems/skills.ts` (every `hitMonster` call passes an element), `sim/systems/combat.ts` explode damage, `sim/combat.test.ts`
- Modify: `client/main.tsx:433` (damage number colour)

**Interfaces:**
- Produces: `resistedDamage(amount, resist, opts?: { coldMasteryRank?: number; doomPower?: number }): number` in `sim/elements.ts`; `hitMonster(state, zone, m, p, amount, element: Element)`; `Monster.resist: Record<Element, number>`; event `{ type: "monster_hit"; …; element: Element }`.

- [ ] **Step 1: Write the failing math tests** (`sim/elements.test.ts`)

```ts
import { describe, expect, test } from "bun:test";
import { effectiveResist, resistedDamage } from "./elements";

describe("resistance", () => {
  test("no resistance passes damage through", () => expect(resistedDamage(40, 0)).toBe(40));
  test("partial resistance scales down and floors", () => expect(resistedDamage(41, 50)).toBe(20));
  test("immunity zeroes damage", () => expect(resistedDamage(40, 100)).toBe(0));
  test("weakness scales up", () => expect(resistedDamage(40, -50)).toBe(60));
  test("cold mastery subtracts from partial resistance at full strength", () => {
    expect(effectiveResist(50, { coldMasteryReduction: 24 })).toBe(26);
  });
  test("cold mastery bites immunities at one fifth", () => {
    expect(effectiveResist(100, { coldMasteryReduction: 80 })).toBe(84);
  });
  test("resistance never drops below -100 from mastery", () => {
    expect(effectiveResist(0, { coldMasteryReduction: 500 })).toBe(-100);
  });
  test("doom multiplies after resistance", () => {
    expect(resistedDamage(40, 50, { doomPower: 0.5 })).toBe(30);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test sim/elements.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `sim/elements.ts`**

```ts
export type Element = "physical" | "fire" | "cold" | "shadow";
export const ELEMENTS: readonly Element[] = ["physical", "fire", "cold", "shadow"];

/** Immunities (100+) yield to mastery at one fifth: a maxed mastery makes an immune barely hittable. */
const IMMUNE_PIERCE = 0.2;

export function effectiveResist(resist: number, opts: { coldMasteryReduction?: number } = {}): number {
  const reduction = opts.coldMasteryReduction ?? 0;
  const pierced = resist >= 100 ? resist - reduction * IMMUNE_PIERCE : resist - reduction;
  return Math.max(-100, pierced);
}

/** Damage after resistance (percent; 100 = immune, negative = weakness) and Doom. */
export function resistedDamage(
  amount: number,
  resist: number,
  opts: { coldMasteryReduction?: number; doomPower?: number } = {},
): number {
  const r = effectiveResist(resist, opts);
  const afterResist = Math.floor((amount * (100 - r)) / 100);
  return Math.max(0, Math.floor(afterResist * (1 + (opts.doomPower ?? 0))));
}

export function zeroResist(): Record<Element, number> {
  return { physical: 0, fire: 0, cold: 0, shadow: 0 };
}
```

Move the `Element` type out of `sim/skills.ts` and re-export it there: `export type { Element } from "./elements";`.

- [ ] **Step 4: Write the failing sim tests** (`sim/combat.test.ts`)

```ts
describe("elemental hits", () => {
  test("a fire-resistant monster takes reduced fire damage and announces the element", () => {
    const state = createGameOn(1, arena());
    const m = spawnAt(state, "shambler", { x: 3, y: 2 });
    m.resist.fire = 50;
    hitMonster(state, playerZone(state), m, player(state), 20, "fire");
    expect(m.life).toBe(m.maxLife - 10);
    const hit = state.events.find((e) => e.type === "monster_hit");
    expect(hit && hit.type === "monster_hit" ? hit.element : null).toBe("fire");
  });

  test("cold mastery ranks lower the monster's cold resistance", () => {
    const state = createGameOn(1, arena());
    const m = spawnAt(state, "shambler", { x: 3, y: 2 });
    m.resist.cold = 100;
    player(state).skills.coldmastery = 10; // −80, at one fifth against an immunity = −16
    hitMonster(state, playerZone(state), m, player(state), 100, "cold");
    expect(m.life).toBe(m.maxLife - 16);
  });

  test("spawned monsters copy their type's resistances", () => {
    const state = createGameOn(1, arena());
    const m = spawnAt(state, "cairn_wight", { x: 3, y: 2 });
    expect(m.resist.cold).toBeGreaterThan(0);
    expect(m.resist.fire).toBeLessThan(0);
  });
});
```

- [ ] **Step 5: Implement**

`sim/monsters.ts`:
- `MonsterType`: add `/** Percent resistance per element; missing = 0. 100 = immune, negative = weakness. */ resist?: Partial<Record<Element, number>>;`
- `Monster`: add `resist: Record<Element, number>;`
- `spawnMonster`: `resist: { ...zeroResist(), ...(table.resist ?? {}) }` (from the unscaled `table`, resistances do not scale with depth).
- Content rows (the "every element has a wall and a soft target" rule): `shambler` `{ cold: 30 }`; `skitter` `{ shadow: 40 }`; `gravespit` `{ fire: -25, shadow: 40 }`; `tomb_bloat` `{ fire: 100, cold: -30 }` (fire immune — its bloat is gas); `fen_howler` `{ fire: 40 }`; `bog_maw` `{ fire: 60, cold: -20 }`; `cairn_wight` `{ cold: 60, fire: -30 }`; `cinder_shade` `{ fire: 100, cold: -40 }` (fire immune); `ash_revenant` `{ fire: 50, cold: -20 }`; `ember_hulk` `{ fire: 75, cold: -10, physical: 20 }`; `veil_screamer` `{ shadow: 100, physical: -20 }` (shadow immune); `crown_sentinel` `{ physical: 30, cold: 100 }` (cold immune); `barrow_lord` `{ shadow: 50, cold: 25, fire: 25 }`.

`sim/systems/combat.ts`:

```ts
export function hitMonster(
  state: GameState,
  zone: ZoneState,
  m: Monster,
  p: Player,
  amount: number,
  element: Element,
): void {
  const dealt = resistedDamage(amount, m.resist[element], {
    coldMasteryReduction: element === "cold" ? coldMasteryReduction(p.skills.coldmastery) : 0,
    doomPower: doomFactor(m, state.tick) - 1,   // Task 5 adds doomFactor; until then pass 0
  });
  m.life -= dealt;
  m.lastHitBy = p.id;
  … (aggro unchanged) …
  state.events.push({ type: "monster_hit", id: m.id, amount: dealt, element, pos: { ...m.pos }, zone: zone.id });
}
```

For this task use `doomPower: 0`; Task 5 wires Doom. Every existing caller passes an element: warrior skills and plain swings (`playerCombatSystem`) → `"physical"`; firebolt/fireball → `"fire"`; frostnova → `"cold"`; soulchain → `"shadow"`. Explosion damage in `deathSystem` (`other.life -= amount`) stays direct — it is monster-on-monster and unresisted, note it in a comment.

`sim/state.ts`: `monster_hit` gains `element: Element`.

`client/main.tsx:433`: colour by element — `{ physical: "#f4e9c8", fire: "#f08a3c", cold: "#7fc8f5", shadow: "#b07cf0" }[e.element]`.

- [ ] **Step 6: Run everything**

Run: `bun test sim client && bun run build`
Expected: PASS. If the determinism test changes its expected hash/state, that is expected only if resistances altered damage in its scripted fight; confirm both runs still match each other (the test compares two runs, not a stored value).

- [ ] **Step 7: Commit**

```bash
git add -A sim client
git commit -m "Damage carries an element and monsters resist it"
```

---

### Task 5: Monster debuffs — chill, slow, weaken, doom, burn, bleed

**Files:**
- Create: `sim/debuffs.ts`, `sim/debuffs.test.ts`
- Modify: `sim/monsters.ts` (`Monster.debuffs`, spawn), `sim/systems/combat.ts` (speed, swing cadence, damage dealt, doom in `hitMonster`), `sim/systems/skills.ts` (`debuffSystem`, frostnova chills), `sim/tick.ts` (system order), `sim/skills.test.ts`

**Interfaces:**
- Produces: `DebuffKind`, `Debuff`, `applyDebuff(m, d)`, `slowFactor(m, tick)`, `weakenFactor(m, tick)`, `doomFactor(m, tick)` in `sim/debuffs.ts`; `debuffSystem(state, zone)` in `sim/systems/skills.ts`.

- [ ] **Step 1: Write the failing math tests** (`sim/debuffs.test.ts`)

```ts
import { describe, expect, test } from "bun:test";
import { applyDebuff, doomFactor, slowFactor, weakenFactor, type Debuff } from "./debuffs";

const host = () => ({ debuffs: [] as Debuff[] });

describe("debuffs", () => {
  test("chill and slow stack multiplicatively on speed", () => {
    const m = host();
    applyDebuff(m, { kind: "chill", until: 100, power: 0.4 });
    applyDebuff(m, { kind: "slow", until: 100, power: 0.25 });
    expect(slowFactor(m, 50)).toBeCloseTo(0.6 * 0.75);
    expect(slowFactor(m, 100)).toBe(1);
  });

  test("re-applying a kind refreshes the timer and keeps the stronger power", () => {
    const m = host();
    applyDebuff(m, { kind: "weaken", until: 100, power: 0.3 });
    applyDebuff(m, { kind: "weaken", until: 200, power: 0.2 });
    expect(m.debuffs).toEqual([{ kind: "weaken", until: 200, power: 0.3 }]);
    expect(weakenFactor(m, 150)).toBeCloseTo(0.7);
  });

  test("doom raises damage taken", () => {
    const m = host();
    applyDebuff(m, { kind: "doom", until: 100, power: 0.2 });
    expect(doomFactor(m, 10)).toBeCloseTo(1.2);
    expect(doomFactor(m, 100)).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test sim/debuffs.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `sim/debuffs.ts`**

```ts
import type { Element } from "./elements";
import type { PlayerId } from "./state";

export type DebuffKind = "chill" | "weaken" | "slow" | "doom" | "burn" | "bleed";

export interface Debuff {
  kind: DebuffKind;
  /** Tick the effect ends. */
  until: number;
  /** Fraction for chill/slow/weaken/doom; damage per tick for burn/bleed. */
  power: number;
  /** Damage-over-time element (burn: fire, bleed: physical). */
  element?: Element;
  /** Who gets credit for damage-over-time kills. */
  source?: PlayerId;
}

export interface Debuffed { debuffs: Debuff[] }

/** Same kind refreshes the timer and keeps the higher power. */
export function applyDebuff(m: Debuffed, d: Debuff): void {
  const existing = m.debuffs.find((e) => e.kind === d.kind);
  if (!existing) {
    m.debuffs.push({ ...d });
    return;
  }
  existing.until = Math.max(existing.until, d.until);
  existing.power = Math.max(existing.power, d.power);
  if (d.element) existing.element = d.element;
  if (d.source !== undefined) existing.source = d.source;
}

function active(m: Debuffed, tick: number, kind: DebuffKind): Debuff | undefined {
  return m.debuffs.find((d) => d.kind === kind && d.until > tick);
}

/** Multiplier on move and attack speed: chill × slow. */
export function slowFactor(m: Debuffed, tick: number): number {
  let f = 1;
  const chill = active(m, tick, "chill");
  const slow = active(m, tick, "slow");
  if (chill) f *= 1 - chill.power;
  if (slow) f *= 1 - slow.power;
  return f;
}

/** Multiplier on damage dealt. */
export function weakenFactor(m: Debuffed, tick: number): number {
  const w = active(m, tick, "weaken");
  return w ? 1 - w.power : 1;
}

/** Multiplier on damage taken, applied after resistance. */
export function doomFactor(m: Debuffed, tick: number): number {
  const d = active(m, tick, "doom");
  return d ? 1 + d.power : 1;
}

/** Drop expired entries in place. */
export function pruneDebuffs(m: Debuffed, tick: number): void {
  for (let i = m.debuffs.length - 1; i >= 0; i--) if (m.debuffs[i]!.until <= tick) m.debuffs.splice(i, 1);
}
```

- [ ] **Step 4: Write the failing sim tests** (`sim/skills.test.ts`)

```ts
import { applyDebuff } from "./debuffs";
import { CHILL_POWER } from "./skills";

describe("debuffs in the world", () => {
  test("a chilled monster closes distance more slowly", () => {
    const fast = createGameOn(1, arena());
    const slow = createGameOn(1, arena());
    const a = spawnAt(fast, "shambler", { x: 7, y: 2 });
    const b = spawnAt(slow, "shambler", { x: 7, y: 2 });
    applyDebuff(b, { kind: "chill", until: slow.tick + 100, power: CHILL_POWER });
    for (let i = 0; i < 10; i++) { stepSolo(fast, {}); stepSolo(slow, {}); }
    const moved = (m: { pos: { x: number } }) => 7 - m.pos.x;
    expect(moved(b)).toBeLessThan(moved(a));
    expect(moved(b)).toBeGreaterThan(0);
  });

  test("a weakened monster hits for less", () => {
    const state = createGameOn(1, arena());
    const m = spawnAt(state, "shambler", { x: 2, y: 1 });
    m.dmgMin = 10; m.dmgMax = 10; m.attackRating = 100000;
    applyDebuff(m, { kind: "weaken", until: state.tick + 1000, power: 0.5 });
    for (let i = 0; i < 60; i++) stepSolo(state, {});
    const hit = state.events.find((e) => e.type === "player_hit");
    expect(hit && hit.type === "player_hit" ? hit.amount : 0).toBe(5);
  });

  test("burn ticks fire damage credited to its source and expires", () => {
    const state = createGameOn(1, arena());
    const m = spawnAt(state, "shambler", { x: 7, y: 2 });
    applyDebuff(m, { kind: "burn", until: state.tick + 3, power: 2, element: "fire", source: 0 });
    for (let i = 0; i < 5; i++) stepSolo(state, {});
    expect(m.life).toBe(m.maxLife - 6);
    expect(m.lastHitBy).toBe(0);
    expect(m.debuffs).toHaveLength(0);
  });

  test("frost nova chills instead of stunning", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state, 4, 2);
    stepSolo(state, { spendSkill: "frostbolt" });
    stepSolo(state, { spendSkill: "frostnova" });
    const m = spawnAt(state, "shambler", { x: 2, y: 1 });
    stepSolo(state, { cast: { skill: "frostnova" } });
    expect(m.stunnedUntil).toBe(0);
    expect(m.debuffs.some((d) => d.kind === "chill")).toBe(true);
  });
});
```

Note: `player_hit` event may be gated by `inCamp`; `createGameOn` places the player in a barrow arena, not camp, so hits land. Adjust the loop length if the shambler's windup delays the first strike.

- [ ] **Step 5: Implement**

- `sim/monsters.ts`: `Monster.debuffs: Debuff[]`, spawn with `debuffs: []`.
- `sim/systems/combat.ts` `monsterAiSystem`: every `moveAlongPath(m.pos, m.path, m.speed…)` becomes `m.speed * slowFactor(m, state.tick)` (three sites); when setting `m.swingCooldown = m.swingEvery` use `Math.round(m.swingEvery / slowFactor(m, state.tick))`; the strike's `rollDamage(...)` result is `Math.max(1, Math.floor(raw * weakenFactor(m, state.tick)))`. In `hitMonster`, `doomPower: doomFactor(m, state.tick) - 1`.
- `sim/systems/skills.ts`:

```ts
/** Tick damage-over-time and shed expired debuffs. Runs before monster AI. */
export function debuffSystem(state: GameState, zone: ZoneState): void {
  for (const m of zone.monsters.values()) {
    for (const d of m.debuffs) {
      if (d.until <= state.tick) continue;
      if (d.kind !== "burn" && d.kind !== "bleed") continue;
      const source = d.source !== undefined ? state.players.get(d.source) : undefined;
      if (!source) continue;
      hitMonster(state, zone, m, source, Math.floor(d.power), d.element ?? "physical");
    }
    pruneDebuffs(m, state.tick);
  }
}
```

  Frost Nova case: replace `m.stunnedUntil = …` with `applyDebuff(m, { kind: "chill", until: state.tick + chill, power: CHILL_POWER })`.
- `sim/tick.ts`: call `debuffSystem(state, zone)` right before `monsterAiSystem(state, zone, here())`.
- Dead monsters: `deathSystem` already removes monsters at `life <= 0`; DoT kills flow through it because `hitMonster` set `lastHitBy`.

- [ ] **Step 6: Run everything**

Run: `bun test sim client && bun run build`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A sim
git commit -m "Monsters carry debuffs: chill, slow, weaken, doom, burn, bleed"
```

---

### Task 6: Passives feed derived stats and mana regen

**Files:**
- Modify: `sim/character.ts` (`computeStats` signature + passives), `sim/systems/inventory.ts:24` (`recomputePlayerStats` passes `p.skills`), `sim/systems/skills.ts` (`manaRegenSystem` Warmth; fire spells × Fire Mastery), `sim/character.test.ts`, `sim/skills.test.ts`
- Grep-and-fix other `computeStats(` callers (`sim/tick.ts` player init, tests).

**Interfaces:**
- Produces: `computeStats(eq, level, klass, skills: Record<SkillId, number>)`; `fireDamageMultiplier(p): number` in `sim/skills.ts`.

- [ ] **Step 1: Write the failing tests** (`sim/character.test.ts`)

```ts
import { SKILL_IDS, type SkillId } from "./skills";
const noSkills = () => Object.fromEntries(SKILL_IDS.map((id) => [id, 0])) as Record<SkillId, number>;

describe("passives", () => {
  test("weapon mastery raises damage and attack rating", () => {
    const eq = createEquipment();
    const base = computeStats(eq, 10, "warrior", noSkills());
    const skilled = computeStats(eq, 10, "warrior", { ...noSkills(), weaponmastery: 5 });
    expect(skilled.attackRating).toBe(base.attackRating + 60);
    expect(skilled.dmgMax).toBeGreaterThanOrEqual(base.dmgMax);
  });
  test("iron skin scales defense", () => {
    const eq = createEquipment();
    const base = computeStats(eq, 10, "warrior", noSkills());
    const skilled = computeStats(eq, 10, "warrior", { ...noSkills(), ironskin: 10 });
    expect(skilled.defense).toBe(Math.floor(base.defense * 1.8));
  });
  test("fleetfoot adds move speed", () => {
    const eq = createEquipment();
    expect(computeStats(eq, 10, "warrior", { ...noSkills(), fleetfoot: 10 }).moveSpeedPct).toBe(30);
  });
});
```

And in `sim/skills.test.ts`:

```ts
describe("warmth", () => {
  test("mana comes back faster per rank", () => {
    const plain = createGameOn(1, arena());
    const warm = createGameOn(1, arena());
    warm.players.get(0)!.skills.warmth = 10;
    for (const s of [plain, warm]) { player(s).mana = 0; stepSolo(s, {}); }
    expect(player(warm).mana).toBeCloseTo(MANA_REGEN_PER_TICK + 0.1);
    expect(player(plain).mana).toBeCloseTo(MANA_REGEN_PER_TICK);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test sim/character.test.ts sim/skills.test.ts`
Expected: FAIL — `computeStats` ignores the fourth argument / Warmth not applied.

- [ ] **Step 3: Implement**

`sim/character.ts`: signature `computeStats(eq, level = 1, klass: Klass = "warrior", skills?: Record<SkillId, number>)`. After the gear loop and before the `dmgPct` fold:

```ts
  const rank = (id: SkillId) => skills?.[id] ?? 0;
  dmgPct += weaponMasteryDamage(rank("weaponmastery")) * 100;
  attackRating += weaponMasteryAttackRating(rank("weaponmastery"));
  moveSpeedPct += fleetfootSpeed(rank("fleetfoot")) * 100;
```

After defense is final: `defense = Math.floor(defense * (1 + ironSkinDefense(rank("ironskin"))));`.

`sim/systems/inventory.ts`: `computeStats(p.equipment, p.level, p.klass, p.skills)`.

`sim/systems/skills.ts`:

```ts
export function manaRegenSystem(players: Player[]): void {
  for (const p of players) {
    p.mana = Math.min(p.maxMana, p.mana + MANA_REGEN_PER_TICK + warmthRegen(p.skills.warmth));
  }
}
```

`sim/skills.ts`: `export function fireDamageMultiplier(p: Player): number { return 1 + fireMasteryBonus(p.skills.firemastery); }` — multiply into the firebolt and fireball damage rolls in `sim/systems/skills.ts` (`* spellMultiplier(state, p) * fireDamageMultiplier(p)`). Add a test: a witch with `firemastery: 10` casting firebolt on a `shambler` deals ≥ 1.8× the rank-1 minimum.

- [ ] **Step 4: Run everything**

Run: `bun test sim client && bun run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A sim
git commit -m "Passives: Weapon Mastery, Iron Skin, Fleetfoot, Warmth, Fire Mastery reach the stats"
```

---

### Task 7: New actives — Frost Bolt, Weaken, Slow, Doom, Soulchain drain

**Files:**
- Modify: `sim/systems/skills.ts` (bolt code generalised by element; curse helper; soulchain heal), `sim/skills.test.ts`, `client/main.tsx` (sounds), `client/render/scene.ts` (fx)

**Interfaces:**
- Consumes: `applyDebuff`, `hitMonster(…, element)`, `CURSE_RADIUS`, `CURSE_RANGE`, rank functions from Task 1.

- [ ] **Step 1: Write the failing tests**

```ts
describe("frost bolt", () => {
  test("hits the nearest monster in sight for cold and chills it", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state, 1, 1);
    stepSolo(state, { spendSkill: "frostbolt" });
    const m = spawnAt(state, "shambler", { x: 6, y: 2 });
    stepSolo(state, { cast: { skill: "frostbolt" } });
    expect(m.life).toBeLessThan(m.maxLife);
    expect(state.events.some((e) => e.type === "monster_hit" && e.element === "cold")).toBe(true);
    expect(m.debuffs.find((d) => d.kind === "chill")?.until).toBe(state.tick - 1 + frostboltChillTicks(1));
  });

  test("walks toward a hovered target beyond reach, like firebolt", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state, 1, 1);
    stepSolo(state, { spendSkill: "frostbolt" });
    const m = spawnAt(state, "shambler", { x: 30, y: 2 });
    stepSolo(state, { cast: { skill: "frostbolt", target: m.id } });
    expect(player(state).castTarget).toEqual({ skill: "frostbolt", monster: m.id, breakable: undefined });
  });
});

describe("curses", () => {
  test("weaken curses every monster near the aimed spot", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state, 1, 1);
    stepSolo(state, { spendSkill: "weaken" });
    const near = spawnAt(state, "shambler", { x: 5, y: 2 });
    const far = spawnAt(state, "shambler", { x: 8, y: 3 });
    stepSolo(state, { cast: { skill: "weaken", at: { x: 5, y: 2 } } });
    expect(near.debuffs).toEqual([{ kind: "weaken", until: state.tick - 1 + weakenTicks(1), power: weakenPower(1) }]);
    expect(far.debuffs).toEqual([]);
  });

  test("slow duration grows with weaken ranks", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state, 12, 10);
    for (const id of ["weaken", "weaken", "weaken", "blink", "focus", "slow"] as const) stepSolo(state, { spendSkill: id });
    const m = spawnAt(state, "shambler", { x: 5, y: 2 });
    stepSolo(state, { cast: { skill: "slow", at: { x: 5, y: 2 } } });
    expect(m.debuffs[0]!.until).toBe(state.tick - 1 + slowTicks(1, 3));
  });

  test("doomed monsters take more damage from a plain swing", () => {
    const state = createGameOn(1, arena());
    const m = spawnAt(state, "shambler", { x: 3, y: 2 });
    applyDebuff(m, { kind: "doom", until: state.tick + 100, power: 0.5 });
    hitMonster(state, playerZone(state), m, player(state), 20, "physical");
    expect(m.life).toBe(m.maxLife - 30);
  });

  test("a curse beyond range or out of sight does nothing", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state, 1, 1);
    stepSolo(state, { spendSkill: "weaken" });
    const m = spawnAt(state, "shambler", { x: 8, y: 2 });
    player(state).pos = { x: 1.5, y: 1.5 };
    stepSolo(state, { cast: { skill: "weaken", at: { x: 40, y: 2 } } });
    expect(m.debuffs).toEqual([]);
    expect(player(state).mana).toBe(player(state).maxMana);
  });
});

describe("soulchain", () => {
  test("deals shadow through three targets and heals the caster", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state, 18, 1);
    player(state).skills.soulchain = 1;
    player(state).life = 10;
    const ms = [4, 5, 6, 7].map((x) => spawnAt(state, "shambler", { x, y: 2 }));
    stepSolo(state, { cast: { skill: "soulchain" } });
    const hurt = ms.filter((m) => m.life < m.maxLife);
    expect(hurt).toHaveLength(3);
    const dealt = hurt.reduce((s, m) => s + (m.maxLife - m.life), 0);
    expect(player(state).life).toBe(10 + Math.floor(dealt * soulchainDrain(1, 0)));
    expect(state.events.filter((e) => e.type === "monster_hit").every((e) => e.type === "monster_hit" && e.element === "shadow")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test sim/skills.test.ts -t "frost bolt|curses|soulchain"`
Expected: FAIL — no handlers.

- [ ] **Step 3: Implement**

Generalise the bolt path in `sim/systems/skills.ts`: `boltReaches(zone, p, c, range)`; `boltMonster(state, zone, p, m, skill: "firebolt" | "frostbolt")` rolls `fireboltDamage`/`frostboltDamage`, multiplies by `spellMultiplier` (and `fireDamageMultiplier` for fire), calls `hitMonster` with the skill's element, and for frostbolt applies `{ kind: "chill", until: state.tick + frostboltChillTicks(rank), power: CHILL_POWER }`. `castPursuitSystem` dispatches on `pursuit.skill`. The `firebolt` case becomes a shared `castBolt(state, zone, p, cast, "firebolt" | "frostbolt")` used by both cases.

Curse helper:

```ts
function castCurse(
  state: GameState, zone: ZoneState, p: Player, cast: NonNullable<PlayerInput["cast"]>,
  skill: "weaken" | "slow" | "doom", debuff: Omit<Debuff, "until"> & { ticks: number },
): void {
  if (!cast.at) return;
  if (Math.hypot(cast.at.x - p.pos.x, cast.at.y - p.pos.y) > CURSE_RANGE) return;
  if (!hasLineOfSight(zone.map, p.pos, cast.at)) return;
  const targets = [...zone.monsters.values()].filter(
    (m) => Math.hypot(m.pos.x - cast.at!.x, m.pos.y - cast.at!.y) <= CURSE_RADIUS,
  );
  if (targets.length === 0) return;
  if (!spendMana(state, p, skill)) return;
  for (const m of targets) applyDebuff(m, { kind: debuff.kind, power: debuff.power, until: state.tick + debuff.ticks });
  state.events.push({ type: "skill_cast", playerId: p.id, skill, pos: { ...p.pos }, at: { x: cast.at.x, y: cast.at.y }, zone: zone.id });
}
```

Cases:
- `weaken`: `castCurse(…, "weaken", { kind: "weaken", power: weakenPower(r), ticks: weakenTicks(r) })`.
- `slow`: `{ kind: "slow", power: slowPower(r), ticks: slowTicks(r, p.skills.weaken) }`.
- `doom`: `{ kind: "doom", power: doomPower(r), ticks: doomTicks(r, p.skills.slow) }`.

Curses on shadow-resistant monsters: per spec, duration × `(100 − resist.shadow) / 100`, floored at 0 (an immune monster shrugs it off entirely). Put that inside `castCurse`: `until: state.tick + Math.floor(debuff.ticks * Math.max(0, 100 - m.resist.shadow) / 100)` and skip entries whose ticks come out 0.

Soulchain case: after each strike, accumulate `dealt` from the pre/post life delta; then `p.life = Math.min(p.maxLife, p.life + Math.floor(dealt * soulchainDrain(p.skills.soulchain, p.skills.doom)))`. Element `"shadow"`.

Client: in `client/main.tsx` sound switch add `frostbolt` → same as firebolt, `weaken`/`slow`/`doom` → `"cleave"` (placeholder whoosh); in `client/render/scene.ts` `skill_cast` fx: `frostbolt` reuses the firebolt bolt with colour `0x7fc8f5`; curses reuse the frost-nova ring at `event.at` with colour `0xb07cf0`. Read the surrounding cases before editing to match the existing helper calls.

- [ ] **Step 4: Run everything**

Run: `bun test sim client && bun run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A sim client
git commit -m "Frost Bolt, Weaken, Slow, Doom, and a Soulchain that drains"
```

---

### Task 8: Respec at Sera's

**Files:**
- Modify: `sim/state.ts` (`PlayerInput.respec`, event `respec`), `sim/systems/skills.ts` (`applyRespecInput`), `sim/tick.ts` (input order), `sim/skills.test.ts`
- Modify: `client/ui/HealerPanel.tsx` (row + `onRespec`), `client/main.tsx` (wire input; reset hotbar on event), `client/hotbar.ts` (`resetHotbar`)

**Interfaces:**
- Produces: `PlayerInput.respec?: boolean`; event `{ type: "respec"; playerId: PlayerId; cost: number }`; `resetHotbar(klass): Hotbar`.

- [ ] **Step 1: Write the failing tests**

```ts
import { respecCost } from "./skills";
import { inCamp } from "./map";

describe("respec", () => {
  function skilled(): GameState {
    const state = soloGame(7); // camp
    const p = player(state);
    p.level = 10; p.skillPoints = 2;
    p.skills.cleave = 4; p.skills.crush = 3;
    p.gold = respecCost(10);
    p.buffs.warcry = state.tick + 500;
    return state;
  }

  test("refunds every rank, clears buffs, charges gold, and announces itself", () => {
    const state = skilled();
    expect(inCamp(playerZone(state).map, player(state).pos)).toBe(true);
    stepSolo(state, { respec: true });
    const p = player(state);
    expect(p.skillPoints).toBe(9);
    expect(p.skills.cleave).toBe(0);
    expect(p.skills.crush).toBe(0);
    expect(p.gold).toBe(0);
    expect(p.buffs).toEqual({});
    expect(state.events).toContainEqual({ type: "respec", playerId: 0, cost: respecCost(10) });
  });

  test("refuses without the gold", () => {
    const state = skilled();
    player(state).gold -= 1;
    stepSolo(state, { respec: true });
    expect(player(state).skills.cleave).toBe(4);
  });

  test("refuses outside camp", () => {
    const state = skilled();
    travel(state, player(state), dungeonZoneId("barrow", 1));
    stepSolo(state, { respec: true });
    expect(player(state).skills.cleave).toBe(4);
  });
});
```

(`soloGame` from `./test-helpers`; `travel`, `dungeonZoneId` from `./tick` / `./state` — see `test-helpers.ts` for the imports.)

- [ ] **Step 2: Run to verify it fails**

Run: `bun test sim/skills.test.ts -t respec`
Expected: FAIL — `respec` not an input.

- [ ] **Step 3: Implement**

`sim/state.ts`: `/** Unlearn every skill at Sera's for respecCost(level) gold. */ respec?: boolean;` and event `| { type: "respec"; playerId: PlayerId; cost: number }`.

`sim/systems/skills.ts`:

```ts
/** Unlearn everything: camp only, costs respecCost(level), refunds one point per rank. */
export function applyRespecInput(state: GameState, p: Player, input: PlayerInput): void {
  if (!input.respec || p.dead) return;
  const zone = zoneOf(state, p);
  if (!inCamp(zone.map, p.pos)) return;
  const cost = respecCost(p.level);
  if (p.gold < cost) return;
  let refunded = 0;
  for (const id of SKILL_IDS) { refunded += p.skills[id]; p.skills[id] = 0; }
  if (refunded === 0) return;
  p.gold -= cost;
  p.skillPoints += refunded;
  p.buffs = {};
  recomputePlayerStats(state, p);
  state.events.push({ type: "respec", playerId: p.id, cost });
}
```

`sim/tick.ts`: call `applyRespecInput(state, p, input)` after `applySpendSkillInput`.

`client/hotbar.ts`: export `resetHotbar(klass)` = write `defaultHotbar(klass)` to storage and return it. Default loadout: `CLASS_TREES(klass)` → the tier-1 active of each tree, then the tier-4 skill of the first tree if active: `[tree1[0], tree2[0], tree3[0], tree1[1]]` filtered to `kind === "active"`.

`client/ui/HealerPanel.tsx`: add prop `onRespec: () => void`; after the wares, a row "unlearn all skills · refunds every point" with price `respecCost(p.level)` on the right, dimmed when `p.gold < cost` or the player has no ranks, `onClick` → `onRespec()`.

`client/main.tsx`: pass `onRespec={() => { uiInputRef.current.respec = true; }}`; in the event switch add `case "respec": { const bar = resetHotbar(localPlayer(game).klass); hotbarRef.current = bar; setHotbar(bar); play("spend" or whatever the skill-spend sound is named — check `play(` calls near "skill_learned"); break; }`.

- [ ] **Step 4: Run everything**

Run: `bun test sim client && bun run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A sim client
git commit -m "Sera unlearns skills for gold"
```

---

### Task 9: Save v2 with refund migration

**Files:**
- Modify: `sim/save.ts`, `sim/save.test.ts` (or `client/save.test.ts` — put the sim-side test beside `sim/save.ts`; create `sim/save.test.ts` if missing)

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "bun:test";
import { applyCharacter, serializeCharacter } from "./save";
import { player, soloGame } from "./test-helpers";

describe("save migration", () => {
  test("a v1 save loads with every point refunded", () => {
    const state = soloGame(1);
    const p = player(state);
    p.level = 12; p.skillPoints = 1; p.skills.cleave = 5; p.skills.crush = 5;
    const raw = JSON.parse(serializeCharacter(state, 0));
    raw.v = 1;
    raw.skills = { cleave: 5, crush: 5, chainbolt: 0 };
    const fresh = soloGame(2);
    expect(applyCharacter(fresh, 0, JSON.stringify(raw))).toBe(true);
    expect(player(fresh).skillPoints).toBe(11);
    expect(player(fresh).skills.cleave).toBe(0);
  });

  test("a v2 save with an unknown ranked skill refunds everything", () => {
    const state = soloGame(1);
    const p = player(state);
    p.level = 5; p.skillPoints = 0; p.skills.cleave = 4;
    const raw = JSON.parse(serializeCharacter(state, 0));
    raw.skills.chainbolt = 3;
    const fresh = soloGame(2);
    expect(applyCharacter(fresh, 0, JSON.stringify(raw))).toBe(true);
    expect(player(fresh).skillPoints).toBe(4);
    expect(player(fresh).skills.cleave).toBe(0);
  });

  test("a current save round-trips ranks untouched", () => {
    const state = soloGame(1);
    const p = player(state);
    p.level = 5; p.skillPoints = 1; p.skills.cleave = 3;
    const fresh = soloGame(2);
    expect(applyCharacter(fresh, 0, serializeCharacter(state, 0))).toBe(true);
    expect(player(fresh).skills.cleave).toBe(3);
    expect(player(fresh).skillPoints).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test sim/save.test.ts`
Expected: FAIL — v1 rejected; unknown ranked id silently dropped.

- [ ] **Step 3: Implement**

`sim/save.ts`: `const VERSION = 2;` and accept `save.v === 1 || save.v === VERSION`. Change `normalizeSkills` to also report unknown ranked ids:

```ts
function normalizeSkills(raw: unknown): { skills: Record<SkillId, number>; unknownRanked: boolean } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const out = {} as Record<SkillId, number>;
  const known = new Set<string>(SKILL_IDS);
  let unknownRanked = false;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!known.has(key)) { if (Number(value) > 0) unknownRanked = true; continue; }
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    out[key as SkillId] = n;
  }
  for (const id of SKILL_IDS) out[id] ??= 0;
  return { skills: out, unknownRanked };
}
```

In `applyCharacter`, after validation:

```ts
  const refund = save.v < VERSION || normalized.unknownRanked;
  if (refund) {
    p.skills = Object.fromEntries(SKILL_IDS.map((id) => [id, 0])) as Record<SkillId, number>;
    p.skillPoints = Math.max(0, save.level - 1);
  } else {
    p.skills = normalized.skills;
    p.skillPoints = save.skillPoints;
  }
```

- [ ] **Step 4: Run everything**

Run: `bun test sim client && bun run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sim/save.ts sim/save.test.ts
git commit -m "Saves bump to v2; older characters respec for free on load"
```

---

### Task 10: Tree panel

**Files:**
- Rewrite: `client/ui/SkillPanel.tsx`
- Modify: `client/hotbar.ts` (defaults per Task 8), `client/main.tsx` (panel width may need `left` adjust)

**Interfaces:**
- Consumes: `CLASS_TREES`, `TREE_SKILLS`, `TIERS`, `SKILLS[id].describe/synergies/prereqs/kind/pending`, `canSpendOn` from `sim/systems/skills.ts`, `MAX_RANK`.

- [ ] **Step 1: Build the layout**

Panel becomes `width: 760`, positioned as before. Body is a CSS grid: `gridTemplateColumns: "repeat(3, 1fr)"`, `gap: 10`. Each column: header (tree `name` in `#e8dcc0`, `blurb` in `#6b6455`, 10px), then six cells in `TIERS` order. Each cell:

- Top line: name (gold `#c9a84c` if rank > 0, `#948c7d` otherwise), `RankPips` (kept from the current file), and for actives the hotkey chips (kept; hidden when `def.kind === "passive"`); the `+` button appears when `canSpendOn(p, def.id)`.
- Second line: `def.describe(rank)` in `#8f8778`; when `rank < MAX_RANK`, a third line `next: …` with `def.describe(rank + 1)` in `#55503f`.
- Lock reasons: `p.level < def.tier` → `unlocks at level N`; unmet prereqs → `needs ` + names joined by ", "; `def.pending` → `coming`. Dim (`opacity: .45`) when locked or pending.
- Synergies: `def.synergies.map(s => s.text)` listed in `#8a6a3a` under the description when `rank > 0` or hovered.
- Connector: for each cell whose `prereqs` is non-empty draw a 2px vertical bar (`#3a3442`, gold when the prereq has a rank) centred above the cell, height 8, so the chain reads downward. Since prereqs are always the previous tier in the same tree, the bar between consecutive cells is enough.
- Tier label: a thin left gutter is not needed; put `lvl N` at the right of the top line in `#55503f` when locked.

Keep the unspent-point banner, pulse keyframes, and the footer hint; footer gains "unlearn at Sera's".

- [ ] **Step 2: Verify by playing**

Run the dev server via the `run` skill or `.claude/launch.json` (`bun run dev`, port 5197). Create a witch, open the panel with `s`, confirm: three columns, tier locks, prereq dimming, `+` only on legal cells, passives without hotkeys, pending rows say "coming". Spend a point and confirm the pips and description update. Bind Frost Bolt to `q`, cast at a shambler, see a blue bolt and blue damage numbers. Check the browser console for React warnings about shorthand/longhand styles.

- [ ] **Step 3: Commit**

```bash
git add client
git commit -m "The skill panel is a tree: three columns, six tiers, prerequisite chains"
```

---

### Task 11: Final sweep

- [ ] **Step 1:** `grep -rn "levelReq\|prereq\b\|buffUntil\|chainbolt\|CHAINBOLT" sim client` → must be empty.
- [ ] **Step 2:** `bun test sim client && bun run build` green.
- [ ] **Step 3:** Play one warrior and one witch to level 5 in the dev server: tree spending, respec at Sera, damage number colours, chill visibly slowing a shambler, a tomb_bloat shrugging off fire.
- [ ] **Step 4:** Update `CLAUDE.md` layout line: `sim/` list gains `elements, debuffs`; skills entry reads `skills (trees/tiers/rank math)`.
- [ ] **Step 5:** Commit: `git commit -am "Skill trees: sweep and docs"`.
