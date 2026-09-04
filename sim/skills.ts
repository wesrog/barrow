import type { GameState, Player } from "./state";
import type { Element } from "./elements";
export type { Element } from "./elements";

export type Klass = "warrior" | "witch";
export type TreeId = "arms" | "warcries" | "fury" | "fire" | "frost" | "hexes";
export type Tier = 1 | 4 | 8 | 12 | 18 | 24;
export type SkillKind = "active" | "passive";
/** How the client aims a cast: none = fire-and-forget, target = a monster, point = a ground spot. */
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

export interface TreeDef {
  id: TreeId;
  klass: Klass;
  name: string;
  blurb: string;
}

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

/**
 * Ranks per skill cap here. With one point per level, a level-30 career holds
 * 29 points against 180 of capacity — three maxed skills or a wider spread.
 * Scarcity is what makes spending a choice.
 */
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

// ── geometry ──
export const CLEAVE_RADIUS = 1.8;
export const CRUSH_RANGE = 1.6;
export const STOMP_RADIUS = 2.2;
export const DEATHBLOW_RANGE = 1.6;
export const FIREBALL_RANGE = 8;
export const FIREBALL_RADIUS = 2.0;
export const SOULCHAIN_RANGE = 8;
export const SOULCHAIN_TARGETS = 3;
/** Second and third soulchain strikes land at this fraction of full damage. */
export const SOULCHAIN_FALLOFF = 0.7;
export const CHARGE_RANGE = 8;
/** The rush stops this far short of the quarry — beside it, not on top of it. */
export const CHARGE_STOP_SHORT = 1.1;
/** Ground speed of the rush in tiles per tick — well above walking pace. */
export const CHARGE_SPEED = 0.8;
/** The rammed monster must still be this close to the stop point to eat the hit. */
export const CHARGE_HIT_RADIUS = 2.0;
export const LEAP_STUN_RADIUS = 1.6;
/** Airborne travel time — the stun and landing hit resolve when the flight ends. */
export const LEAP_TICKS = 10;
export const FIREBOLT_RANGE = 12;
export const FROSTBOLT_RANGE = 12;
export const FROSTNOVA_RADIUS = 2.5;
export const BLINK_RANGE = 12;
export const CURSE_RADIUS = 2.5;
export const CURSE_RANGE = 10;
/** Chill slows move and attack speed by this fraction. */
export const CHILL_POWER = 0.4;

// ── warrior rank math ──

/** Leap reach: 8 tiles, +0.5 per extra rank — matches blink's 12 range near max. */
export function leapRange(rank: number): number {
  return 8 + 0.5 * (rank - 1);
}

/** Cleave: 100% weapon damage, +25% per extra rank, +10% per Warcry rank (synergy). */
export function cleaveMultiplier(cleaveRank: number, warcryRank: number): number {
  return 1 + 0.25 * (cleaveRank - 1) + 0.1 * warcryRank;
}

/** Crush: 200% weapon damage, +50% per extra rank. Always hits. */
export function crushMultiplier(rank: number): number {
  return 2 + 0.5 * (rank - 1);
}

/** Warcry buff: +10% damage, +5% per extra rank, while active. */
export function warcryMultiplier(rank: number): number {
  return 1 + 0.1 + 0.05 * (rank - 1);
}

/** Charge ram: 130% weapon damage, +30% per extra rank. Always hits. */
export function chargeMultiplier(rank: number): number {
  return 1.3 + 0.3 * (rank - 1);
}

/** The rammed target reels briefly — enough that arrival isn't a free swing against you. */
export function chargeStunTicks(rank: number): number {
  return 10 + 3 * rank;
}

export function leapStunTicks(rank: number): number {
  return 30 + 10 * (rank - 1);
}

/** Leap landing: 150% weapon damage, +40% per extra rank. The slam always hits. */
export function leapMultiplier(rank: number): number {
  return 1.5 + 0.4 * (rank - 1);
}

/** Stomp: 120% weapon damage around you, +30% per extra rank, ×(1 + 5% per Leap rank). Always hits. */
export function stompMultiplier(rank: number, leapRank: number): number {
  return (1.2 + 0.3 * (rank - 1)) * (1 + 0.05 * leapRank);
}

/** Stomp stun: +2 ticks per Leap rank (synergy). */
export function stompStunTicks(rank: number, leapRank: number): number {
  return 20 + 5 * (rank - 1) + 2 * leapRank;
}

/** Deathblow: 300% weapon damage, +75% per extra rank, ×(1 + 15% per Crush rank). Always hits. */
export function deathblowMultiplier(rank: number, crushRank: number): number {
  return (3 + 0.75 * (rank - 1)) * (1 + 0.15 * crushRank);
}

/** Weapon Mastery: +6% weapon damage per rank. */
export function weaponMasteryDamage(rank: number): number {
  return 0.06 * rank;
}
/** Weapon Mastery: +12 attack rating per rank. */
export function weaponMasteryAttackRating(rank: number): number {
  return 12 * rank;
}
/** Iron Skin: +8% defense per rank. */
export function ironSkinDefense(rank: number): number {
  return 0.08 * rank;
}
/** Fleetfoot: +3% move speed per rank. */
export function fleetfootSpeed(rank: number): number {
  return 0.03 * rank;
}

// ── witch rank math ──

/** Fireball: spell blast by rank, +8% per Firebolt rank (synergy). */
export function fireballDamage(rank: number, fireboltRank: number): { min: number; max: number } {
  const synergy = 1 + 0.08 * fireboltRank;
  return {
    min: Math.floor((8 + 5 * (rank - 1)) * synergy),
    max: Math.floor((14 + 8 * (rank - 1)) * synergy),
  };
}

/** Firebolt: spell damage by rank, +10% per Focus rank (synergy). Spells never miss. */
export function fireboltDamage(rank: number, focusRank: number): { min: number; max: number } {
  const synergy = 1 + 0.1 * focusRank;
  return {
    min: Math.floor((5 + 4 * (rank - 1)) * synergy),
    max: Math.floor((9 + 5 * (rank - 1)) * synergy),
  };
}

/** Warmth: +0.01 mana per tick per rank (base regen is 0.05). */
export function warmthRegen(rank: number): number {
  return 0.01 * rank;
}
/** Fire Mastery: +8% fire damage per rank. */
export function fireMasteryBonus(rank: number): number {
  return 0.08 * rank;
}

export function frostboltDamage(rank: number): { min: number; max: number } {
  return { min: 4 + 3 * (rank - 1), max: 7 + 4 * (rank - 1) };
}
export function frostboltChillTicks(rank: number): number {
  return 30 + 5 * (rank - 1);
}

export function frostnovaDamage(rank: number): { min: number; max: number } {
  return { min: 3 + 2 * (rank - 1), max: 6 + 3 * (rank - 1) };
}

export function frostnovaChillTicks(rank: number): number {
  return 20 + 5 * (rank - 1);
}

/** Cold Mastery: enemy cold resistance −8 points per rank. */
export function coldMasteryReduction(rank: number): number {
  return 8 * rank;
}

/** Focus buff: +10% spell damage, +5% per extra rank, while active. */
export function focusMultiplier(rank: number): number {
  return 1 + 0.1 + 0.05 * (rank - 1);
}

/** Weaken: −20% damage dealt, +3% per extra rank. */
export function weakenPower(rank: number): number {
  return 0.2 + 0.03 * (rank - 1);
}
export function weakenTicks(rank: number): number {
  return 200 + 25 * (rank - 1);
}
/** Slow: −25% move and attack speed, +3% per extra rank. */
export function slowPower(rank: number): number {
  return 0.25 + 0.03 * (rank - 1);
}
/** Slow lasts 6 s, +0.8 s per extra rank, +5% per Weaken rank (synergy). */
export function slowTicks(rank: number, weakenRank: number): number {
  return Math.floor((150 + 20 * (rank - 1)) * (1 + 0.05 * weakenRank));
}
/** Doom: +20% damage taken, +4% per extra rank. */
export function doomPower(rank: number): number {
  return 0.2 + 0.04 * (rank - 1);
}
/** Doom lasts 6 s, +0.6 s per extra rank, +5% per Slow rank (synergy). */
export function doomTicks(rank: number, slowRank: number): number {
  return Math.floor((150 + 15 * (rank - 1)) * (1 + 0.05 * slowRank));
}
/** Soulchain: per-strike shadow damage by rank. */
export function soulchainDamage(rank: number): { min: number; max: number } {
  return { min: 6 + 4 * (rank - 1), max: 11 + 5 * (rank - 1) };
}
/** Soulchain drain: 15% of damage dealt comes back as life, +1% per extra rank, +1.5% per Doom rank (synergy). */
export function soulchainDrain(rank: number, doomRank: number): number {
  return 0.15 + 0.01 * (rank - 1) + 0.015 * doomRank;
}

/** Respec price at Sera's: 15 × level². */
export function respecCost(level: number): number {
  return 15 * level * level;
}

// ── buffs ──

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

/** Fire Mastery's passive lift on every fire spell. */
export function fireDamageMultiplier(p: Player): number {
  return 1 + fireMasteryBonus(p.skills.firemastery);
}

// ── the table ──

const pct = (x: number) => `${Math.round(x * 100)}%`;
const secs = (ticks: number) => `${(ticks / 25).toFixed(1)}s`;
/** Describe at least rank 1: rank 0 reads as "what the first point gives". */
const r1 = (rank: number) => Math.max(1, rank);

type RowInput = Pick<SkillDef, "id" | "name" | "klass" | "tree" | "tier" | "describe"> &
  Partial<Pick<SkillDef, "prereqs" | "synergies" | "kind" | "targeting" | "element" | "manaCost" | "castTicks" | "buffId">>;

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

function passive(r: Omit<RowInput, "kind" | "targeting" | "manaCost" | "castTicks" | "buffId">): SkillDef {
  return row({ ...r, kind: "passive", targeting: "none", manaCost: 0, castTicks: 0 });
}

function pending(r: RowInput): SkillDef {
  return { ...row(r), pending: true };
}

export const SKILLS: Record<SkillId, SkillDef> = {
  // ── warrior · arms ──
  cleave: row({ id: "cleave", name: "Cleave", klass: "warrior", tree: "arms", tier: 1, manaCost: 3, castTicks: 18,
    synergies: [{ from: "warcry", text: "+10% damage per Warcry rank" }],
    describe: (r) => `sweep every enemy within ${CLEAVE_RADIUS} · ${pct(cleaveMultiplier(r1(r), 0))} weapon damage` }),
  crush: row({ id: "crush", name: "Crush", klass: "warrior", tree: "arms", tier: 4, targeting: "target", manaCost: 4, castTicks: 14,
    prereqs: ["cleave"],
    describe: (r) => `a guaranteed heavy blow · ${pct(crushMultiplier(r1(r)))} weapon damage` }),
  weaponmastery: passive({ id: "weaponmastery", name: "Weapon Mastery", klass: "warrior", tree: "arms", tier: 8,
    describe: (r) => `+${pct(weaponMasteryDamage(r1(r)))} weapon damage · +${weaponMasteryAttackRating(r1(r))} attack rating` }),
  deathblow: row({ id: "deathblow", name: "Deathblow", klass: "warrior", tree: "arms", tier: 12, targeting: "target", manaCost: 8, castTicks: 16,
    prereqs: ["crush"], synergies: [{ from: "crush", text: "+15% damage per Crush rank" }],
    describe: (r) => `one executioner's strike · ${pct(deathblowMultiplier(r1(r), 0))} weapon damage · never misses` }),
  whirl: pending({ id: "whirl", name: "Whirl", klass: "warrior", tree: "arms", tier: 18, targeting: "point", manaCost: 9, castTicks: 20,
    prereqs: ["deathblow"], synergies: [{ from: "cleave", text: "+8% damage per Cleave rank" }],
    describe: (r) => `spin to a spot, striking everything you pass · ${pct(0.8 + 0.2 * (r1(r) - 1))} weapon damage per hit` }),
  rend: pending({ id: "rend", name: "Rend", klass: "warrior", tree: "arms", tier: 24, targeting: "target", manaCost: 10, castTicks: 16,
    prereqs: ["whirl"], synergies: [{ from: "deathblow", text: "+10% bleed per Deathblow rank" }],
    describe: (r) => `a heavy strike that leaves a bleed · ${pct(1.5 + 0.3 * (r1(r) - 1))} weapon damage, then ${2 + r1(r)} per tick for ${secs(75)}` }),

  // ── warrior · warcries ──
  warcry: row({ id: "warcry", name: "Warcry", klass: "warrior", tree: "warcries", tier: 1, manaCost: 6, castTicks: 15, buffId: "warcry",
    describe: (r) => `battle shout · +${pct(warcryMultiplier(r1(r)) - 1)} damage for ${secs(BUFF_TICKS)}` }),
  taunt: pending({ id: "taunt", name: "Taunt", klass: "warrior", tree: "warcries", tier: 4, manaCost: 5, castTicks: 14,
    prereqs: ["warcry"],
    describe: (r) => `pull every monster within ${6 + r1(r)} onto you` }),
  ironskin: passive({ id: "ironskin", name: "Iron Skin", klass: "warrior", tree: "warcries", tier: 8,
    describe: (r) => `+${pct(ironSkinDefense(r1(r)))} defense` }),
  battleshout: pending({ id: "battleshout", name: "Battle Shout", klass: "warrior", tree: "warcries", tier: 12, manaCost: 8, castTicks: 15, buffId: "battleshout",
    prereqs: ["taunt"],
    describe: (r) => `the party's max life +${pct(0.1 + 0.03 * (r1(r) - 1))} for ${secs(BUFF_TICKS)}` }),
  howl: pending({ id: "howl", name: "Howl", klass: "warrior", tree: "warcries", tier: 18, manaCost: 9, castTicks: 16,
    prereqs: ["battleshout"],
    describe: (r) => `a shout that stuns everything within 3 for ${secs(25 + 5 * (r1(r) - 1))}` }),
  rally: pending({ id: "rally", name: "Rally", klass: "warrior", tree: "warcries", tier: 24, manaCost: 12, castTicks: 18,
    prereqs: ["howl"], synergies: [{ from: "warcry", text: "+3% party damage per Warcry rank" }],
    describe: (r) => `stuns everything near you and lifts the party's damage +${pct(0.2 + 0.04 * (r1(r) - 1))} for ${secs(BUFF_TICKS)}` }),

  // ── warrior · fury ──
  charge: row({ id: "charge", name: "Charge", klass: "warrior", tree: "fury", tier: 1, targeting: "target", manaCost: 4, castTicks: 16,
    describe: (r) => `rush a distant enemy and ram it · ${pct(chargeMultiplier(r1(r)))} weapon damage · stuns ${secs(chargeStunTicks(r1(r)))}` }),
  leap: row({ id: "leap", name: "Leap", klass: "warrior", tree: "fury", tier: 4, targeting: "point", manaCost: 5, castTicks: 20,
    prereqs: ["charge"],
    describe: (r) => `jump up to ${leapRange(r1(r))} tiles · ${pct(leapMultiplier(r1(r)))} weapon damage on landing · stuns ${secs(leapStunTicks(r1(r)))}` }),
  fleetfoot: passive({ id: "fleetfoot", name: "Fleetfoot", klass: "warrior", tree: "fury", tier: 8,
    describe: (r) => `+${pct(fleetfootSpeed(r1(r)))} move speed` }),
  stomp: row({ id: "stomp", name: "Stomp", klass: "warrior", tree: "fury", tier: 12, manaCost: 7, castTicks: 16,
    prereqs: ["leap"], synergies: [{ from: "leap", text: "+5% damage and a longer stun per Leap rank" }],
    describe: (r) => `slam the ground · ${pct(stompMultiplier(r1(r), 0))} weapon damage around you · stuns ${secs(stompStunTicks(r1(r), 0))}` }),
  frenzy: pending({ id: "frenzy", name: "Frenzy", klass: "warrior", tree: "fury", tier: 18, manaCost: 8, castTicks: 12, buffId: "frenzy",
    prereqs: ["stomp"], synergies: [{ from: "charge", text: "+2% speed per Charge rank" }],
    describe: (r) => `+${pct(0.15 + 0.03 * (r1(r) - 1))} attack and move speed for ${secs(BUFF_TICKS)}` }),
  berserk: pending({ id: "berserk", name: "Berserk", klass: "warrior", tree: "fury", tier: 24, manaCost: 12, castTicks: 14, buffId: "berserk",
    prereqs: ["frenzy"], synergies: [{ from: "frenzy", text: "+4% damage per Frenzy rank" }],
    describe: (r) => `+${pct(0.5 + 0.1 * (r1(r) - 1))} damage, defense drops to 0, for ${secs(BUFF_TICKS)}` }),

  // ── witch · fire ──
  firebolt: row({ id: "firebolt", name: "Firebolt", klass: "witch", tree: "fire", tier: 1, targeting: "target", element: "fire", manaCost: 4, castTicks: 14,
    synergies: [{ from: "focus", text: "+10% damage per Focus rank" }],
    describe: (r) => { const d = fireboltDamage(r1(r), 0); return `hurl fire at a distant enemy · ${d.min}–${d.max} fire · never misses`; } }),
  warmth: passive({ id: "warmth", name: "Warmth", klass: "witch", tree: "fire", tier: 4,
    describe: (r) => `+${(warmthRegen(r1(r)) * 25).toFixed(2)} mana per second` }),
  fireball: row({ id: "fireball", name: "Fireball", klass: "witch", tree: "fire", tier: 8, targeting: "point", element: "fire", manaCost: 9, castTicks: 16,
    prereqs: ["firebolt"], synergies: [{ from: "firebolt", text: "+8% damage per Firebolt rank" }],
    describe: (r) => { const d = fireballDamage(r1(r), 0); return `a blast at the aimed spot · ${d.min}–${d.max} fire to all within ${FIREBALL_RADIUS}`; } }),
  firewall: pending({ id: "firewall", name: "Fire Wall", klass: "witch", tree: "fire", tier: 12, targeting: "point", element: "fire", manaCost: 10, castTicks: 16,
    prereqs: ["fireball"],
    describe: (r) => `a line of burning ground · ${3 + 2 * (r1(r) - 1)} fire per tick for ${secs(100)}` }),
  meteor: pending({ id: "meteor", name: "Meteor", klass: "witch", tree: "fire", tier: 18, targeting: "point", element: "fire", manaCost: 14, castTicks: 18,
    prereqs: ["firewall"], synergies: [{ from: "fireball", text: "+6% damage per Fireball rank" }, { from: "firewall", text: "+6% burn per Fire Wall rank" }],
    describe: (r) => `a delayed blast that leaves burning ground · ${20 + 10 * (r1(r) - 1)}–${35 + 14 * (r1(r) - 1)} fire` }),
  firemastery: passive({ id: "firemastery", name: "Fire Mastery", klass: "witch", tree: "fire", tier: 24, element: "fire",
    describe: (r) => `+${pct(fireMasteryBonus(r1(r)))} fire damage` }),

  // ── witch · frost ──
  frostbolt: row({ id: "frostbolt", name: "Frost Bolt", klass: "witch", tree: "frost", tier: 1, targeting: "target", element: "cold", manaCost: 4, castTicks: 14,
    describe: (r) => { const d = frostboltDamage(r1(r)); return `a chilling bolt · ${d.min}–${d.max} cold · chills ${pct(CHILL_POWER)} for ${secs(frostboltChillTicks(r1(r)))}`; } }),
  frostnova: row({ id: "frostnova", name: "Frost Nova", klass: "witch", tree: "frost", tier: 4, element: "cold", manaCost: 6, castTicks: 15,
    prereqs: ["frostbolt"],
    describe: (r) => { const d = frostnovaDamage(r1(r)); return `an icy burst around you · ${d.min}–${d.max} cold · chills ${pct(CHILL_POWER)} for ${secs(frostnovaChillTicks(r1(r)))}`; } }),
  icearmor: pending({ id: "icearmor", name: "Ice Armor", klass: "witch", tree: "frost", tier: 8, element: "cold", manaCost: 7, castTicks: 12, buffId: "icearmor",
    prereqs: ["frostnova"],
    describe: (r) => `+${pct(0.2 + 0.05 * (r1(r) - 1))} defense and melee attackers are chilled, for ${secs(BUFF_TICKS)}` }),
  glacialspike: pending({ id: "glacialspike", name: "Glacial Spike", klass: "witch", tree: "frost", tier: 12, targeting: "point", element: "cold", manaCost: 10, castTicks: 16,
    prereqs: ["icearmor"], synergies: [{ from: "frostbolt", text: "+8% damage per Frost Bolt rank" }],
    describe: (r) => `a blast that freezes all it touches · ${10 + 5 * (r1(r) - 1)}–${16 + 8 * (r1(r) - 1)} cold · stuns ${secs(30 + 5 * (r1(r) - 1))}` }),
  blizzard: pending({ id: "blizzard", name: "Blizzard", klass: "witch", tree: "frost", tier: 18, targeting: "point", element: "cold", manaCost: 15, castTicks: 18,
    prereqs: ["glacialspike"], synergies: [{ from: "frostnova", text: "+6% damage per Frost Nova rank" }],
    describe: (r) => `a storm over the aimed spot for ${secs(100)} · ${4 + 2 * (r1(r) - 1)}–${7 + 3 * (r1(r) - 1)} cold per strike` }),
  coldmastery: passive({ id: "coldmastery", name: "Cold Mastery", klass: "witch", tree: "frost", tier: 24, element: "cold",
    describe: (r) => `enemy cold resistance −${coldMasteryReduction(r1(r))}% · immunities at one fifth` }),

  // ── witch · hexes ──
  weaken: row({ id: "weaken", name: "Weaken", klass: "witch", tree: "hexes", tier: 1, targeting: "point", element: "shadow", manaCost: 5, castTicks: 14,
    describe: (r) => `curse everything within ${CURSE_RADIUS} of the spot · −${pct(weakenPower(r1(r)))} damage dealt for ${secs(weakenTicks(r1(r)))}` }),
  blink: row({ id: "blink", name: "Blink", klass: "witch", tree: "hexes", tier: 4, targeting: "point", element: "shadow", manaCost: 6, castTicks: 16,
    prereqs: ["weaken"],
    describe: () => `step through shadow to a spot you can see, up to ${BLINK_RANGE} tiles` }),
  focus: row({ id: "focus", name: "Focus", klass: "witch", tree: "hexes", tier: 8, element: "shadow", manaCost: 5, castTicks: 12, buffId: "focus",
    prereqs: ["blink"],
    describe: (r) => `gather your will · +${pct(focusMultiplier(r1(r)) - 1)} spell damage for ${secs(BUFF_TICKS)}` }),
  slow: row({ id: "slow", name: "Slow", klass: "witch", tree: "hexes", tier: 12, targeting: "point", element: "shadow", manaCost: 6, castTicks: 14,
    prereqs: ["focus"], synergies: [{ from: "weaken", text: "+5% duration per Weaken rank" }],
    describe: (r) => `curse everything within ${CURSE_RADIUS} · −${pct(slowPower(r1(r)))} move and attack speed for ${secs(slowTicks(r1(r), 0))}` }),
  soulchain: row({ id: "soulchain", name: "Soulchain", klass: "witch", tree: "hexes", tier: 18, element: "shadow", manaCost: 10, castTicks: 15,
    prereqs: ["slow"], synergies: [{ from: "doom", text: "+1.5% life drained per Doom rank" }],
    describe: (r) => { const d = soulchainDamage(r1(r)); return `shadow leaps through the ${SOULCHAIN_TARGETS} nearest enemies · ${d.min}–${d.max} shadow · heals you ${pct(soulchainDrain(r1(r), 0))} of damage dealt`; } }),
  doom: row({ id: "doom", name: "Doom", klass: "witch", tree: "hexes", tier: 24, targeting: "point", element: "shadow", manaCost: 10, castTicks: 16,
    prereqs: ["soulchain"], synergies: [{ from: "slow", text: "+5% duration per Slow rank" }],
    describe: (r) => `curse everything within ${CURSE_RADIUS} · +${pct(doomPower(r1(r)))} damage taken from everything for ${secs(doomTicks(r1(r), 0))}` }),
};

/** Every skill id, in definition (and therefore save/init) order. */
export const SKILL_IDS = Object.keys(SKILLS) as SkillId[];

const TREE_ORDER: TreeId[] = ["arms", "warcries", "fury", "fire", "frost", "hexes"];

export function CLASS_TREES(klass: Klass): TreeDef[] {
  return TREE_ORDER.map((id) => TREES[id]).filter((t) => t.klass === klass);
}

/** A tree's six skills in tier order. */
export function TREE_SKILLS(tree: TreeId): SkillDef[] {
  return SKILL_IDS.map((id) => SKILLS[id])
    .filter((d) => d.tree === tree)
    .sort((a, b) => a.tier - b.tier);
}

/** A class's skills, tree by tree, tier by tier. */
export function CLASS_SKILLS(klass: Klass): SkillDef[] {
  return CLASS_TREES(klass).flatMap((t) => TREE_SKILLS(t.id));
}
