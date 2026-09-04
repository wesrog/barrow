import { describe, expect, test } from "bun:test";
import { mapFromStrings } from "./map";
import { stepSolo } from "./tick";
import { createGameOn, player, playerZone, spawnAt } from "./test-helpers";
import {
  LEAP_TICKS,
  MAX_RANK,
  SKILLS,
  damageMultiplier,
  cleaveMultiplier,
  deathblowMultiplier,
  stompMultiplier,
  stompStunTicks,
  leapRange,
  chargeMultiplier,
  chargeStunTicks,
} from "./skills";
import { MANA_REGEN_PER_TICK } from "./systems/skills";
import { BUFF_TICKS, CHILL_POWER, CLASS_TREES, SKILL_IDS, TIERS, TREES, TREE_SKILLS, hasBuff } from "./skills";
import { applyDebuff } from "./debuffs";
import type { GameState } from "./state";
import type { SkillId } from "./skills";

const arena = () =>
  mapFromStrings([
    "##########",
    "#@.......#",
    "#........#",
    "#........#",
    "##########",
  ]);

function readyPlayer(state: GameState, level = 24, points = 12): void {
  player(state).level = level;
  player(state).skillPoints = points;
  player(state).mana = player(state).maxMana;
}

/** Spend along the prerequisite chain, then on the skill itself. */
function learn(state: GameState, id: SkillId): void {
  for (const pre of SKILLS[id].prereqs) if (player(state).skills[pre] <= 0) learn(state, pre);
  stepSolo(state, { spendSkill: id });
}

describe("skill points", () => {
  test("spending a point raises the skill rank and consumes the point", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state, 2, 1);
    stepSolo(state, { spendSkill: "cleave" });
    expect(player(state).skills.cleave).toBe(1);
    expect(player(state).skillPoints).toBe(0);
  });

  test("a successful spend announces the skill and its new rank", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state, 2, 2);
    stepSolo(state, { spendSkill: "cleave" });
    stepSolo(state, { spendSkill: "cleave" });
    const learned = state.events.filter((e) => e.type === "skill_learned");
    expect(learned).toEqual([{ type: "skill_learned", playerId: player(state).id, skill: "cleave", rank: 2 }]);
  });

  test("a refused spend stays silent", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state, 10, 0);
    stepSolo(state, { spendSkill: "cleave" });
    expect(state.events.some((e) => e.type === "skill_learned")).toBe(false);
  });

  test("skills are gated by character level", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state, 1, 5);
    stepSolo(state, { spendSkill: "leap" }); // leap unlocks at 4
    expect(player(state).skills.leap).toBe(0);
    expect(player(state).skillPoints).toBe(5);
  });

  test("no points, no rank", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state, 10, 0);
    stepSolo(state, { spendSkill: "cleave" });
    expect(player(state).skills.cleave).toBe(0);
  });

  test("ranks cap at MAX_RANK; the point is kept", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state, 40, MAX_RANK + 3);
    for (let i = 0; i < MAX_RANK + 2; i++) stepSolo(state, { spendSkill: "cleave" });
    expect(player(state).skills.cleave).toBe(MAX_RANK);
    expect(player(state).skillPoints).toBe(3);
  });
});

describe("capstone synergies", () => {
  test("deathblow scales with crush investment", () => {
    expect(deathblowMultiplier(1, 0)).toBeCloseTo(3.0);
    expect(deathblowMultiplier(2, 0)).toBeCloseTo(3.75);
    // +15% per crush rank, multiplicative: rank 1 with crush maxed = 3 × 2.5
    expect(deathblowMultiplier(1, 10)).toBeCloseTo(7.5);
  });

  test("stomp damage and stun scale with leap investment", () => {
    expect(stompMultiplier(1, 0)).toBeCloseTo(1.2);
    // +5% per leap rank, multiplicative: rank 1 with leap maxed = 1.2 × 1.5
    expect(stompMultiplier(1, 10)).toBeCloseTo(1.8);
    expect(stompStunTicks(1, 0)).toBe(20);
    // +2 stun ticks per leap rank
    expect(stompStunTicks(1, 10)).toBe(40);
  });
});

describe("cleave", () => {
  test("hits every monster in reach and spends mana", () => {
    // Seed chosen so both 95%-capped hit rolls land; determinism keeps it stable.
    const state = createGameOn(2, arena());
    readyPlayer(state);
    learn(state, "cleave");
    const a = spawnAt(state, "skitter", { x: 2.2, y: 1.5 });
    const b = spawnAt(state, "skitter", { x: 1.5, y: 2.3 });
    const c = spawnAt(state, "skitter", { x: 8.5, y: 3.5 }); // far away
    const manaBefore = player(state).mana;
    stepSolo(state, { cast: { skill: "cleave" } });
    // The cast spends mana in the input phase; one tick of regen trickles back after.
    expect(player(state).mana).toBeCloseTo(manaBefore - SKILLS.cleave.manaCost + MANA_REGEN_PER_TICK, 6);
    const hitIds = state.events.filter((e) => e.type === "monster_hit").map((e) => (e as any).id);
    expect(hitIds).toContain(a.id);
    expect(hitIds).toContain(b.id);
    expect(hitIds).not.toContain(c.id);
  });

  test("damage multiplier grows with ranks and warcry synergy", () => {
    expect(cleaveMultiplier(1, 0)).toBeCloseTo(1.0);
    expect(cleaveMultiplier(3, 0)).toBeGreaterThan(cleaveMultiplier(1, 0));
    expect(cleaveMultiplier(1, 5)).toBeGreaterThan(cleaveMultiplier(1, 0));
  });

  test("cannot cast without a rank or without mana", () => {
    const state = createGameOn(7, arena());
    readyPlayer(state);
    const m = spawnAt(state, "skitter", { x: 2.2, y: 1.5 });
    stepSolo(state, { cast: { skill: "cleave" } }); // no rank
    expect(state.events.filter((e) => e.type === "monster_hit")).toHaveLength(0);
    learn(state, "cleave");
    player(state).mana = 0;
    stepSolo(state, { cast: { skill: "cleave" } }); // no mana
    expect(state.events.filter((e) => e.type === "monster_hit")).toHaveLength(0);
    expect(playerZone(state).monsters.has(m.id)).toBe(true);
  });

  test("an empty-mana cast announces the failure; a rankless one stays silent", () => {
    const state = createGameOn(7, arena());
    readyPlayer(state);
    spawnAt(state, "skitter", { x: 2.2, y: 1.5 }); // cleave needs a target in reach
    stepSolo(state, { cast: { skill: "cleave" } }); // no rank — a misclick, not a mana problem
    expect(state.events.filter((e) => e.type === "cast_failed")).toHaveLength(0);
    learn(state, "cleave");
    player(state).mana = 0;
    stepSolo(state, { cast: { skill: "cleave" } });
    const fails = state.events.filter((e) => e.type === "cast_failed");
    expect(fails).toEqual([{ type: "cast_failed", playerId: 0, reason: "mana" }]);
  });
});

describe("crush", () => {
  test("lands a guaranteed heavy hit on a target in reach", () => {
    const state = createGameOn(7, arena());
    readyPlayer(state);
    learn(state, "crush");
    const m = spawnAt(state, "skitter", { x: 2.2, y: 1.5 });
    stepSolo(state, { cast: { skill: "crush", target: m.id } });
    const hit = state.events.find((e) => e.type === "monster_hit");
    expect(hit).toBeDefined();
    // 2x multiplier on a 1-6 blade: at least 2
    expect((hit as any).amount).toBeGreaterThanOrEqual(2);
  });

  test("ignores a target out of reach", () => {
    const state = createGameOn(7, arena());
    readyPlayer(state);
    learn(state, "crush");
    const m = spawnAt(state, "skitter", { x: 8.5, y: 3.5 });
    const manaBefore = player(state).mana;
    stepSolo(state, { cast: { skill: "crush", target: m.id } });
    expect(player(state).mana).toBe(manaBefore);
    expect(state.events.filter((e) => e.type === "monster_hit")).toHaveLength(0);
  });

  test("with no target given, strikes the nearest monster in reach", () => {
    const state = createGameOn(7, arena());
    readyPlayer(state);
    learn(state, "crush");
    const near = spawnAt(state, "skitter", { x: 2.2, y: 1.5 });
    spawnAt(state, "skitter", { x: 8.5, y: 3.5 });
    stepSolo(state, { cast: { skill: "crush" } });
    const hit = state.events.find((e) => e.type === "monster_hit");
    expect(hit).toBeDefined();
    expect((hit as any).id).toBe(near.id);
  });

  test("an out-of-reach target falls back to the nearest monster in reach", () => {
    const state = createGameOn(7, arena());
    readyPlayer(state);
    learn(state, "crush");
    const near = spawnAt(state, "skitter", { x: 2.2, y: 1.5 });
    const far = spawnAt(state, "skitter", { x: 8.5, y: 3.5 });
    stepSolo(state, { cast: { skill: "crush", target: far.id } });
    const hit = state.events.find((e) => e.type === "monster_hit");
    expect(hit).toBeDefined();
    expect((hit as any).id).toBe(near.id);
  });

  test("with nothing in reach, spends no mana", () => {
    const state = createGameOn(7, arena());
    readyPlayer(state);
    learn(state, "crush");
    const manaBefore = player(state).mana;
    stepSolo(state, { cast: { skill: "crush" } });
    expect(player(state).mana).toBe(manaBefore);
    expect(state.events.filter((e) => e.type === "monster_hit")).toHaveLength(0);
  });
});

describe("cast aim point", () => {
  test("crush's cast event carries the struck monster's position", () => {
    const state = createGameOn(7, arena());
    readyPlayer(state);
    learn(state, "crush");
    const m = spawnAt(state, "skitter", { x: 2.2, y: 1.5 });
    stepSolo(state, { cast: { skill: "crush" } });
    const cast = state.events.find((e) => e.type === "skill_cast") as any;
    expect(cast.at).toEqual(m.pos);
  });

  test("cleave's cast event aims at the nearest monster struck", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state);
    learn(state, "cleave");
    const near = spawnAt(state, "skitter", { x: 1.9, y: 1.5 });
    spawnAt(state, "skitter", { x: 1.5, y: 2.9 });
    stepSolo(state, { cast: { skill: "cleave" } });
    const cast = state.events.find((e) => e.type === "skill_cast") as any;
    expect(cast.at).toEqual(near.pos);
  });

  test("stomp's cast event aims at the nearest monster struck", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state, 20, 10);
    learn(state, "leap");
    learn(state, "stomp");
    const near = spawnAt(state, "skitter", { x: 1.9, y: 1.5 });
    spawnAt(state, "skitter", { x: 1.5, y: 2.9 });
    stepSolo(state, { cast: { skill: "stomp" } });
    const cast = state.events.find((e) => e.type === "skill_cast") as any;
    expect(cast.at).toEqual(near.pos);
  });
});

describe("warcry", () => {
  test("buffs damage for a duration", () => {
    const state = createGameOn(7, arena());
    readyPlayer(state);
    learn(state, "warcry");
    expect(damageMultiplier(state, player(state))).toBeCloseTo(1.0);
    stepSolo(state, { cast: { skill: "warcry" } });
    expect(damageMultiplier(state, player(state))).toBeGreaterThan(1.0);
    for (let i = 0; i < BUFF_TICKS + 5; i++) stepSolo(state, {});
    expect(damageMultiplier(state, player(state))).toBeCloseTo(1.0);
  });
});

describe("leap", () => {
  test("flies across ticks instead of teleporting, landing on the target cell", () => {
    const state = createGameOn(7, arena());
    readyPlayer(state);
    learn(state, "leap");
    stepSolo(state, { cast: { skill: "leap", at: { x: 7.5, y: 3.5 } } });
    // Airborne after the cast tick: on the way, but nowhere near the landing cell.
    expect(player(state).leap).not.toBeNull();
    expect(Math.hypot(player(state).pos.x - 7.5, player(state).pos.y - 3.5)).toBeGreaterThan(1);
    let landed = false;
    for (let i = 0; i < LEAP_TICKS; i++) {
      stepSolo(state, {});
      if (state.events.some((e) => e.type === "leap_land")) landed = true;
    }
    expect(landed).toBe(true);
    expect(player(state).leap).toBeNull();
    expect(player(state).pos.x).toBeCloseTo(7.5);
    expect(player(state).pos.y).toBeCloseTo(3.5);
  });

  test("stuns monsters around the landing spot on arrival, not at takeoff", () => {
    const state = createGameOn(7, arena());
    readyPlayer(state);
    learn(state, "leap");
    // A short hop keeps the chasing skitter inside the stun radius at touchdown.
    const near = spawnAt(state, "skitter", { x: 2.5, y: 2.3 });
    stepSolo(state, { cast: { skill: "leap", at: { x: 2.5, y: 1.5 } } });
    expect(near.stunnedUntil).toBeLessThanOrEqual(state.tick);
    while (player(state).leap) stepSolo(state, {});
    expect(near.stunnedUntil).toBeGreaterThan(state.tick);
    // Stunned monsters neither move nor swing
    const posAtLanding = { ...near.pos };
    for (let i = 0; i < 10; i++) stepSolo(state, {});
    expect(near.pos).toEqual(posAtLanding);
  });

  test("move input mid-flight is ignored", () => {
    const state = createGameOn(7, arena());
    readyPlayer(state);
    learn(state, "leap");
    stepSolo(state, { cast: { skill: "leap", at: { x: 7.5, y: 3.5 } } });
    stepSolo(state, { moveTo: { x: 2.5, y: 1.5 } });
    expect(player(state).path).toEqual([]);
    while (player(state).leap) stepSolo(state, {});
    expect(player(state).pos.x).toBeCloseTo(7.5);
    expect(player(state).pos.y).toBeCloseTo(3.5);
  });

  test("damages monsters around the landing spot, leaving distant ones unhurt", () => {
    const state = createGameOn(7, arena());
    readyPlayer(state);
    learn(state, "leap");
    const near = spawnAt(state, "skitter", { x: 7.5, y: 3.4 });
    const far = spawnAt(state, "skitter", { x: 2.5, y: 8.5 });
    const nearLife = near.life;
    const farLife = far.life;
    stepSolo(state, { cast: { skill: "leap", at: { x: 7.5, y: 3.5 } } });
    expect(near.life).toBe(nearLife); // nothing lands until touchdown
    while (player(state).leap) stepSolo(state, {});
    expect(near.life).toBeLessThan(nearLife);
    expect(far.life).toBe(farLife);
    expect(state.events.some((e) => e.type === "monster_hit" && e.id === near.id)).toBe(true);
  });

  test("lands on the exact aim point, not the cell center", () => {
    const state = createGameOn(7, arena());
    readyPlayer(state);
    learn(state, "leap");
    stepSolo(state, { cast: { skill: "leap", at: { x: 7.2, y: 3.8 } } });
    while (player(state).leap) stepSolo(state, {});
    expect(player(state).pos.x).toBeCloseTo(7.2);
    expect(player(state).pos.y).toBeCloseTo(3.8);
  });

  test("range grows with rank, matching blink's reach at max", () => {
    expect(leapRange(1)).toBeCloseTo(8);
    expect(leapRange(2)).toBeCloseTo(8.5);
    expect(leapRange(10)).toBeCloseTo(12.5);
  });

  test("a higher-rank leap reaches spots a rank-1 leap cannot", () => {
    const corridor = () =>
      mapFromStrings([
        "##############",
        "#@...........#",
        "##############",
      ]);
    const at = { x: 10.5, y: 1.5 }; // 9 tiles out: past rank 1's 8, within rank 3's 9

    const lowRank = createGameOn(7, corridor());
    readyPlayer(lowRank);
    learn(lowRank, "leap");
    stepSolo(lowRank, { cast: { skill: "leap", at } });
    expect(player(lowRank).leap).toBeNull();

    const highRank = createGameOn(7, corridor());
    readyPlayer(highRank);
    for (let i = 0; i < 3; i++) learn(highRank, "leap");
    stepSolo(highRank, { cast: { skill: "leap", at } });
    expect(player(highRank).leap).not.toBeNull();
  });

  test("cannot leap into a wall or across the map", () => {
    const state = createGameOn(7, arena());
    readyPlayer(state);
    learn(state, "leap");
    const before = { ...player(state).pos };
    stepSolo(state, { cast: { skill: "leap", at: { x: 0.5, y: 0.5 } } }); // wall
    expect(player(state).pos).toEqual(before);
  });
});

describe("charge", () => {
  test("damage and stun scale with rank", () => {
    expect(chargeMultiplier(1)).toBeCloseTo(1.3);
    expect(chargeMultiplier(2)).toBeCloseTo(1.6);
    expect(chargeStunTicks(1)).toBe(13);
    expect(chargeStunTicks(3)).toBe(19);
  });

  test("rushes to the target over ticks, then hits and stuns it on arrival", () => {
    const state = createGameOn(7, arena());
    readyPlayer(state);
    learn(state, "charge");
    const m = spawnAt(state, "skitter", { x: 7.5, y: 2.5 });
    const life = m.life;
    stepSolo(state, { cast: { skill: "charge", target: m.id } });
    expect(player(state).charge).not.toBeNull();
    expect(m.life).toBe(life); // nothing lands until arrival
    let hit = false;
    let ticks = 0;
    while (player(state).charge && ticks++ < 20) {
      stepSolo(state, {});
      if (state.events.some((e) => e.type === "charge_hit")) hit = true;
    }
    expect(player(state).charge).toBeNull();
    expect(hit).toBe(true);
    // Stops beside the quarry, not on top of it.
    const d = Math.hypot(player(state).pos.x - m.pos.x, player(state).pos.y - m.pos.y);
    expect(d).toBeLessThan(2.0);
    expect(d).toBeGreaterThan(0.4);
    expect(m.life).toBeLessThan(life);
    expect(m.stunnedUntil).toBeGreaterThan(state.tick);
  });

  test("without a cursor pick, charges the nearest reachable monster", () => {
    const state = createGameOn(7, arena());
    readyPlayer(state);
    learn(state, "charge");
    const near = spawnAt(state, "skitter", { x: 5.5, y: 1.5 });
    const nearLife = near.life;
    spawnAt(state, "skitter", { x: 8.5, y: 3.5 });
    stepSolo(state, { cast: { skill: "charge" } });
    expect(player(state).charge).not.toBeNull();
    while (player(state).charge) stepSolo(state, {});
    expect(near.life).toBeLessThan(nearLife);
  });

  test("refuses a target hidden behind a wall", () => {
    const walled = mapFromStrings([
      "##########",
      "#@...#...#",
      "#....#...#",
      "#....#...#",
      "##########",
    ]);
    const state = createGameOn(7, walled);
    readyPlayer(state);
    learn(state, "charge");
    const m = spawnAt(state, "skitter", { x: 7.5, y: 1.5 });
    const before = { ...player(state).pos };
    const mana = player(state).mana;
    stepSolo(state, { cast: { skill: "charge", target: m.id } });
    expect(player(state).charge).toBeNull();
    expect(player(state).pos).toEqual(before);
    expect(player(state).mana).toBe(mana);
  });

  test("move input mid-rush is ignored", () => {
    const state = createGameOn(7, arena());
    readyPlayer(state);
    learn(state, "charge");
    const m = spawnAt(state, "skitter", { x: 7.5, y: 3.5 });
    stepSolo(state, { cast: { skill: "charge", target: m.id } });
    expect(player(state).charge).not.toBeNull();
    stepSolo(state, { moveTo: { x: 1.5, y: 3.5 } });
    expect(player(state).path).toEqual([]);
    while (player(state).charge) stepSolo(state, {});
    expect(player(state).pos.x).toBeGreaterThan(5);
  });
});

describe("cast rate", () => {
  test("cleave cannot be recast until its cast time elapses", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state);
    learn(state, "cleave");
    spawnAt(state, "skitter", { x: 2.2, y: 1.5 });
    stepSolo(state, { cast: { skill: "cleave" } });
    const castsAfterFirst = state.events.filter((e) => e.type === "skill_cast").length;
    expect(castsAfterFirst).toBe(1);
    // Spamming during the animation does nothing and spends no mana.
    const manaAfterFirst = player(state).mana;
    stepSolo(state, { cast: { skill: "cleave" } });
    expect(state.events.filter((e) => e.type === "skill_cast")).toHaveLength(0);
    for (let i = 0; i < SKILLS.cleave.castTicks - 2; i++) {
      stepSolo(state, { cast: { skill: "cleave" } });
      expect(state.events.filter((e) => e.type === "skill_cast")).toHaveLength(0);
    }
    expect(player(state).mana).toBeLessThanOrEqual(manaAfterFirst + 1); // regen only
    // Once the cast time has fully elapsed, the next cast lands.
    stepSolo(state, { cast: { skill: "cleave" } });
    expect(state.events.filter((e) => e.type === "skill_cast")).toHaveLength(1);
  });

  test("every skill occupies the shared action cooldown", () => {
    const state = createGameOn(7, arena());
    readyPlayer(state);
    for (const id of ["cleave", "crush", "warcry", "leap"] as const) {
      stepSolo(state, { spendSkill: id });
    }
    spawnAt(state, "skitter", { x: 2.2, y: 1.5 });
    stepSolo(state, { cast: { skill: "warcry" } });
    expect(state.events.filter((e) => e.type === "skill_cast")).toHaveLength(1);
    expect(player(state).swingCooldown).toBe(SKILLS.warcry.castTicks - 1);
    // Mid-warcry, cleave is refused.
    stepSolo(state, { cast: { skill: "cleave" } });
    expect(state.events.filter((e) => e.type === "skill_cast")).toHaveLength(0);
  });

  test("a basic swing blocks skills, and a skill blocks basic swings", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state);
    learn(state, "cleave");
    spawnAt(state, "skitter", { x: 2.2, y: 1.5 });
    stepSolo(state, { swingAt: { x: 2.2, y: 1.5 } });
    expect(state.events.filter((e) => e.type === "player_swing")).toHaveLength(1);
    // Still mid-swing: cleave refused.
    stepSolo(state, { cast: { skill: "cleave" } });
    expect(state.events.filter((e) => e.type === "skill_cast")).toHaveLength(0);
    // Wait out the swing, cleave, then a swing is refused mid-cleave.
    while (player(state).swingCooldown > 0) stepSolo(state, {});
    stepSolo(state, { cast: { skill: "cleave" } });
    expect(state.events.filter((e) => e.type === "skill_cast")).toHaveLength(1);
    stepSolo(state, { swingAt: { x: 2.2, y: 1.5 } });
    expect(state.events.filter((e) => e.type === "player_swing")).toHaveLength(0);
  });
});

describe("mana", () => {
  test("regenerates slowly over time", () => {
    const state = createGameOn(7, arena());
    player(state).mana = 0;
    for (let i = 0; i < 250; i++) stepSolo(state, {}); // 10 seconds
    expect(player(state).mana).toBeGreaterThan(5);
    expect(player(state).mana).toBeLessThanOrEqual(player(state).maxMana);
  });
});

describe("skill tree prerequisites", () => {
  test("elite skills refuse points until their prerequisite has a rank", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state, 20, 10);
    stepSolo(state, { spendSkill: "stomp" }); // requires a rank of leap
    expect(player(state).skills.stomp).toBe(0);
    stepSolo(state, { spendSkill: "charge" });
    stepSolo(state, { spendSkill: "leap" });
    stepSolo(state, { spendSkill: "stomp" });
    expect(player(state).skills.stomp).toBe(1);
    stepSolo(state, { spendSkill: "deathblow" }); // requires crush
    expect(player(state).skills.deathblow).toBe(0);
    stepSolo(state, { spendSkill: "cleave" });
    stepSolo(state, { spendSkill: "crush" });
    stepSolo(state, { spendSkill: "deathblow" });
    expect(player(state).skills.deathblow).toBe(1);
  });

  test("the witch's fire chain runs firebolt → fireball", () => {
    const state = createGameOn(1, arena());
    player(state).klass = "witch";
    readyPlayer(state, 20, 10);
    stepSolo(state, { spendSkill: "fireball" });
    expect(player(state).skills.fireball).toBe(0); // no firebolt yet
    stepSolo(state, { spendSkill: "firebolt" });
    stepSolo(state, { spendSkill: "fireball" });
    expect(player(state).skills.fireball).toBe(1);
  });
});

describe("stomp", () => {
  test("slams and stuns everything around the warrior", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state, 20, 10);
    learn(state, "leap");
    learn(state, "stomp");
    const a = spawnAt(state, "skitter", { x: 2.2, y: 1.5 });
    const b = spawnAt(state, "skitter", { x: 8.5, y: 3.5 }); // far away
    stepSolo(state, { cast: { skill: "stomp" } });
    const hitIds = state.events.filter((e) => e.type === "monster_hit").map((e) => (e as any).id);
    expect(hitIds).toContain(a.id);
    expect(hitIds).not.toContain(b.id);
    expect(a.stunnedUntil).toBeGreaterThan(state.tick);
  });
});

describe("deathblow", () => {
  test("lands one huge always-hit blow on the nearest target in reach", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state, 20, 10);
    learn(state, "crush");
    learn(state, "deathblow");
    const m = spawnAt(state, "shambler", { x: 2.2, y: 1.5 });
    const lifeBefore = m.life;
    stepSolo(state, { cast: { skill: "deathblow" } });
    expect(m.life).toBeLessThan(lifeBefore);
    expect(state.events.some((e) => e.type === "skill_cast" && (e as any).skill === "deathblow")).toBe(true);
  });
});

describe("casting stops the approach", () => {
  test("a ranged cast plants your feet instead of walking into melee", () => {
    const state = createGameOn(1, arena());
    player(state).klass = "witch";
    readyPlayer(state, 20, 10);
    learn(state, "firebolt");
    const m = spawnAt(state, "skitter", { x: 8.5, y: 1.5 }); // in spell range, far from melee
    stepSolo(state, { attack: m.id }); // click the enemy: the walk-in begins
    expect(player(state).attackTarget).toBe(m.id);
    const posBefore = { ...player(state).pos };
    stepSolo(state, { cast: { skill: "firebolt", target: m.id } });
    expect(state.events.some((e) => e.type === "monster_hit")).toBe(true);
    expect(player(state).attackTarget).toBeNull();
    expect(player(state).path).toHaveLength(0);
    expect(player(state).pos).toEqual(posBefore);
  });
});

describe("firebolt targeting", () => {
  const longArena = () =>
    mapFromStrings([
      "######################",
      "#@...................#",
      "#....................#",
      "#....................#",
      "######################",
    ]);

  function witchWithBolt(seed = 1) {
    const state = createGameOn(seed, longArena());
    player(state).klass = "witch";
    readyPlayer(state, 20, 10);
    learn(state, "firebolt");
    return state;
  }

  function placeBarrel(state: GameState, pos: { x: number; y: number }): number {
    const id = state.nextId++;
    playerZone(state).breakables.set(id, { id, kind: "barrel", pos });
    return id;
  }

  test("reaches a hovered monster out to 12 units", () => {
    const state = witchWithBolt();
    const m = spawnAt(state, "skitter", { x: 12.5, y: 1.5 }); // 11 away
    stepSolo(state, { cast: { skill: "firebolt", target: m.id } });
    expect(state.events.some((e) => e.type === "monster_hit" && (e as any).id === m.id)).toBe(true);
  });

  test("a hovered barrel in range pops from afar, spilling its loot chance", () => {
    const state = witchWithBolt();
    playerZone(state).breakables.clear();
    const id = placeBarrel(state, { x: 6.5, y: 1.5 });
    const manaBefore = player(state).mana;
    stepSolo(state, { cast: { skill: "firebolt", breakable: id } });
    expect(playerZone(state).breakables.has(id)).toBe(false);
    expect(state.events.some((e) => e.type === "breakable_broken" && (e as any).id === id)).toBe(true);
    expect(state.events.some((e) => e.type === "skill_cast" && (e as any).skill === "firebolt")).toBe(true);
    expect(player(state).mana).toBeLessThan(manaBefore);
  });

  test("barrels are never auto-targeted without a hover hint", () => {
    const state = witchWithBolt();
    playerZone(state).breakables.clear();
    playerZone(state).monsters.clear();
    const id = placeBarrel(state, { x: 3.5, y: 1.5 });
    const manaBefore = player(state).mana;
    stepSolo(state, { cast: { skill: "firebolt" } });
    expect(playerZone(state).breakables.has(id)).toBe(true);
    // Nothing spent: only the tick's regen moved the pool.
    expect(player(state).mana).toBeCloseTo(manaBefore + MANA_REGEN_PER_TICK);
  });

  test("a hovered monster beyond range starts a walk-in, casting once in reach", () => {
    const state = witchWithBolt();
    playerZone(state).monsters.clear();
    const m = spawnAt(state, "skitter", { x: 19.5, y: 1.5 }); // 18 away
    stepSolo(state, { cast: { skill: "firebolt", target: m.id } });
    expect(state.events.some((e) => e.type === "monster_hit")).toBe(false);
    expect(player(state).castTarget).not.toBeNull();
    let hit = false; // events reset each tick — collect as the walk-in unfolds
    for (let i = 0; i < 300 && !hit; i++) {
      stepSolo(state, {});
      hit = state.events.some((e) => e.type === "monster_hit" && (e as any).id === m.id);
    }
    expect(hit).toBe(true);
    expect(player(state).castTarget).toBeNull();
  });

  test("a hovered barrel beyond range starts a walk-in, breaking it once in reach", () => {
    const state = witchWithBolt();
    playerZone(state).breakables.clear();
    playerZone(state).monsters.clear();
    const id = placeBarrel(state, { x: 19.5, y: 1.5 });
    stepSolo(state, { cast: { skill: "firebolt", breakable: id } });
    expect(playerZone(state).breakables.has(id)).toBe(true);
    for (let i = 0; i < 300; i++) stepSolo(state, {});
    expect(playerZone(state).breakables.has(id)).toBe(false);
  });

  test("a new move order cancels the walk-in cast", () => {
    const state = witchWithBolt();
    playerZone(state).monsters.clear();
    const m = spawnAt(state, "skitter", { x: 19.5, y: 1.5 });
    stepSolo(state, { cast: { skill: "firebolt", target: m.id } });
    expect(player(state).castTarget).not.toBeNull();
    stepSolo(state, { moveTo: { x: 1.5, y: 3.5 } });
    expect(player(state).castTarget).toBeNull();
    for (let i = 0; i < 50; i++) {
      stepSolo(state, {});
      expect(state.events.some((e) => e.type === "monster_hit")).toBe(false);
    }
  });
});

describe("fireball", () => {
  test("explodes at the aimed point, burning everything in the blast", () => {
    const state = createGameOn(1, arena());
    player(state).klass = "witch";
    readyPlayer(state, 20, 10);
    learn(state, "firebolt");
    learn(state, "fireball");
    const a = spawnAt(state, "skitter", { x: 6.5, y: 2.5 });
    const b = spawnAt(state, "skitter", { x: 6.9, y: 3.1 });
    const c = spawnAt(state, "skitter", { x: 1.5, y: 3.5 }); // outside the blast
    stepSolo(state, { cast: { skill: "fireball", at: { x: 6.5, y: 2.5 } } });
    const hitIds = state.events.filter((e) => e.type === "monster_hit").map((e) => (e as any).id);
    expect(hitIds).toContain(a.id);
    expect(hitIds).toContain(b.id);
    expect(hitIds).not.toContain(c.id);
    expect(state.events.some((e) => e.type === "exploded")).toBe(true);
  });

  test("needs a rank in firebolt first and a target point in range", () => {
    const state = createGameOn(1, arena());
    player(state).klass = "witch";
    readyPlayer(state, 20, 10);
    learn(state, "firebolt");
    learn(state, "fireball");
    spawnAt(state, "skitter", { x: 6.5, y: 2.5 });
    stepSolo(state, { cast: { skill: "fireball", at: { x: 60, y: 60 } } }); // out of range
    expect(state.events.filter((e) => e.type === "monster_hit")).toHaveLength(0);
  });
});

describe("soulchain", () => {
  test("strikes up to three nearest enemies in sight", () => {
    const state = createGameOn(1, arena());
    player(state).klass = "witch";
    readyPlayer(state, 20, 10);
    learn(state, "firebolt");
    learn(state, "fireball");
    learn(state, "soulchain");
    const a = spawnAt(state, "skitter", { x: 3.5, y: 1.5 });
    const b = spawnAt(state, "skitter", { x: 4.5, y: 2.5 });
    const c = spawnAt(state, "skitter", { x: 5.5, y: 3.5 });
    const d = spawnAt(state, "skitter", { x: 8.5, y: 3.5 }); // fourth wheel
    stepSolo(state, { cast: { skill: "soulchain" } });
    const hitIds = state.events.filter((e) => e.type === "monster_hit").map((e) => (e as any).id);
    expect(hitIds).toContain(a.id);
    expect(hitIds).toContain(b.id);
    expect(hitIds).toContain(c.id);
    expect(hitIds).not.toContain(d.id);
  });
});

describe("life regen", () => {
  test("gear regen trickles life back each tick, capped at max", () => {
    const state = createGameOn(1, arena());
    const p = player(state);
    p.lifeRegen = 5; // 5 life/s -> 0.2 per tick at 25 Hz
    p.life = 50;
    stepSolo(state, {});
    expect(p.life).toBeCloseTo(50 + 5 / 25, 6);
    p.life = p.maxLife;
    stepSolo(state, {});
    expect(p.life).toBe(p.maxLife);
  });

  test("no regen without gear, and none while dead", () => {
    const state = createGameOn(1, arena());
    const p = player(state);
    p.life = 50;
    stepSolo(state, {});
    expect(p.life).toBe(50); // D2 rule: life does not come back on its own
    p.lifeRegen = 5;
    p.dead = true;
    p.life = 0;
    stepSolo(state, {});
    expect(p.life).toBe(0);
  });
});

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
});

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

describe("debuffs in the world", () => {
  test("a chilled monster closes distance more slowly", () => {
    const fast = createGameOn(1, arena());
    const slow = createGameOn(1, arena());
    const a = spawnAt(fast, "shambler", { x: 7, y: 2 });
    const b = spawnAt(slow, "shambler", { x: 7, y: 2 });
    applyDebuff(b, { kind: "chill", until: slow.tick + 100, power: CHILL_POWER });
    for (let i = 0; i < 10; i++) {
      stepSolo(fast, {});
      stepSolo(slow, {});
    }
    const moved = (m: { pos: { x: number } }) => 7 - m.pos.x;
    expect(moved(b)).toBeLessThan(moved(a));
    expect(moved(b)).toBeGreaterThan(0);
  });

  test("a weakened monster hits for less", () => {
    const state = createGameOn(1, arena());
    const m = spawnAt(state, "shambler", { x: 2, y: 1 });
    m.dmgMin = 10;
    m.dmgMax = 10;
    m.attackRating = 100000;
    applyDebuff(m, { kind: "weaken", until: state.tick + 1000, power: 0.5 });
    const hits: number[] = [];
    for (let i = 0; i < 60; i++) {
      stepSolo(state, {});
      for (const e of state.events) if (e.type === "player_hit") hits.push(e.amount);
    }
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h === 5)).toBe(true);
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
    player(state).klass = "witch";
    readyPlayer(state, 4, 2);
    learn(state, "frostnova");
    const m = spawnAt(state, "shambler", { x: 2, y: 1 });
    stepSolo(state, { cast: { skill: "frostnova" } });
    expect(m.stunnedUntil).toBe(0);
    expect(m.debuffs.some((d) => d.kind === "chill")).toBe(true);
  });
});

describe("warmth", () => {
  test("mana comes back faster per rank", () => {
    const plain = createGameOn(1, arena());
    const warm = createGameOn(1, arena());
    player(warm).skills.warmth = 10;
    for (const s of [plain, warm]) {
      player(s).mana = 0;
      stepSolo(s, {});
    }
    expect(player(warm).mana).toBeCloseTo(MANA_REGEN_PER_TICK + 0.1);
    expect(player(plain).mana).toBeCloseTo(MANA_REGEN_PER_TICK);
  });
});

describe("fire mastery", () => {
  test("lifts firebolt damage by rank", () => {
    const state = createGameOn(1, arena());
    player(state).klass = "witch";
    readyPlayer(state, 24, 1);
    learn(state, "firebolt");
    player(state).skills.firemastery = 10;
    const m = spawnAt(state, "skitter", { x: 5, y: 2 });
    m.maxLife = 1000;
    m.life = 1000;
    stepSolo(state, { cast: { skill: "firebolt" } });
    // rank-1 firebolt rolls 5–9; ×1.8 floors to at least 9
    expect(1000 - m.life).toBeGreaterThanOrEqual(9);
  });
});
