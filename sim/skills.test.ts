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
} from "./skills";
import { MANA_REGEN_PER_TICK } from "./systems/skills";
import type { GameState } from "./state";

const arena = () =>
  mapFromStrings([
    "##########",
    "#@.......#",
    "#........#",
    "#........#",
    "##########",
  ]);

function readyPlayer(state: GameState, level = 10, points = 10): void {
  player(state).level = level;
  player(state).skillPoints = points;
  player(state).mana = player(state).maxMana;
}

describe("skill points", () => {
  test("spending a point raises the skill rank and consumes the point", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state, 2, 1);
    stepSolo(state, { spendSkill: "cleave" });
    expect(player(state).skills.cleave).toBe(1);
    expect(player(state).skillPoints).toBe(0);
  });

  test("skills are gated by character level", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state, 1, 5);
    stepSolo(state, { spendSkill: "leap" }); // leap unlocks at 6
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
    stepSolo(state, { spendSkill: "cleave" });
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
    stepSolo(state, { spendSkill: "cleave" });
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
    stepSolo(state, { spendSkill: "cleave" });
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
    stepSolo(state, { spendSkill: "crush" });
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
    stepSolo(state, { spendSkill: "crush" });
    const m = spawnAt(state, "skitter", { x: 8.5, y: 3.5 });
    const manaBefore = player(state).mana;
    stepSolo(state, { cast: { skill: "crush", target: m.id } });
    expect(player(state).mana).toBe(manaBefore);
    expect(state.events.filter((e) => e.type === "monster_hit")).toHaveLength(0);
  });

  test("with no target given, strikes the nearest monster in reach", () => {
    const state = createGameOn(7, arena());
    readyPlayer(state);
    stepSolo(state, { spendSkill: "crush" });
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
    stepSolo(state, { spendSkill: "crush" });
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
    stepSolo(state, { spendSkill: "crush" });
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
    stepSolo(state, { spendSkill: "crush" });
    const m = spawnAt(state, "skitter", { x: 2.2, y: 1.5 });
    stepSolo(state, { cast: { skill: "crush" } });
    const cast = state.events.find((e) => e.type === "skill_cast") as any;
    expect(cast.at).toEqual(m.pos);
  });

  test("cleave's cast event aims at the nearest monster struck", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state);
    stepSolo(state, { spendSkill: "cleave" });
    const near = spawnAt(state, "skitter", { x: 1.9, y: 1.5 });
    spawnAt(state, "skitter", { x: 1.5, y: 2.9 });
    stepSolo(state, { cast: { skill: "cleave" } });
    const cast = state.events.find((e) => e.type === "skill_cast") as any;
    expect(cast.at).toEqual(near.pos);
  });

  test("stomp's cast event aims at the nearest monster struck", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state, 20, 10);
    stepSolo(state, { spendSkill: "leap" });
    stepSolo(state, { spendSkill: "stomp" });
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
    stepSolo(state, { spendSkill: "warcry" });
    expect(damageMultiplier(state, player(state))).toBeCloseTo(1.0);
    stepSolo(state, { cast: { skill: "warcry" } });
    expect(damageMultiplier(state, player(state))).toBeGreaterThan(1.0);
    for (let i = 0; i < SKILLS.warcry.buffTicks + 5; i++) stepSolo(state, {});
    expect(damageMultiplier(state, player(state))).toBeCloseTo(1.0);
  });
});

describe("leap", () => {
  test("flies across ticks instead of teleporting, landing on the target cell", () => {
    const state = createGameOn(7, arena());
    readyPlayer(state);
    stepSolo(state, { spendSkill: "leap" });
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
    stepSolo(state, { spendSkill: "leap" });
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
    stepSolo(state, { spendSkill: "leap" });
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
    stepSolo(state, { spendSkill: "leap" });
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
    stepSolo(state, { spendSkill: "leap" });
    stepSolo(state, { cast: { skill: "leap", at: { x: 7.2, y: 3.8 } } });
    while (player(state).leap) stepSolo(state, {});
    expect(player(state).pos.x).toBeCloseTo(7.2);
    expect(player(state).pos.y).toBeCloseTo(3.8);
  });

  test("cannot leap into a wall or across the map", () => {
    const state = createGameOn(7, arena());
    readyPlayer(state);
    stepSolo(state, { spendSkill: "leap" });
    const before = { ...player(state).pos };
    stepSolo(state, { cast: { skill: "leap", at: { x: 0.5, y: 0.5 } } }); // wall
    expect(player(state).pos).toEqual(before);
  });
});

describe("cast rate", () => {
  test("cleave cannot be recast until its cast time elapses", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state);
    stepSolo(state, { spendSkill: "cleave" });
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
    stepSolo(state, { spendSkill: "cleave" });
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
    stepSolo(state, { spendSkill: "leap" });
    stepSolo(state, { spendSkill: "stomp" });
    expect(player(state).skills.stomp).toBe(1);
    stepSolo(state, { spendSkill: "deathblow" }); // requires crush
    expect(player(state).skills.deathblow).toBe(0);
    stepSolo(state, { spendSkill: "crush" });
    stepSolo(state, { spendSkill: "deathblow" });
    expect(player(state).skills.deathblow).toBe(1);
  });

  test("the witch's chain runs firebolt → fireball → chainbolt", () => {
    const state = createGameOn(1, arena());
    player(state).klass = "witch";
    readyPlayer(state, 20, 10);
    stepSolo(state, { spendSkill: "fireball" });
    expect(player(state).skills.fireball).toBe(0); // no firebolt yet
    stepSolo(state, { spendSkill: "chainbolt" });
    expect(player(state).skills.chainbolt).toBe(0); // no fireball yet
    stepSolo(state, { spendSkill: "firebolt" });
    stepSolo(state, { spendSkill: "fireball" });
    expect(player(state).skills.fireball).toBe(1);
    stepSolo(state, { spendSkill: "chainbolt" });
    expect(player(state).skills.chainbolt).toBe(1);
  });
});

describe("stomp", () => {
  test("slams and stuns everything around the warrior", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state, 20, 10);
    stepSolo(state, { spendSkill: "leap" });
    stepSolo(state, { spendSkill: "stomp" });
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
    stepSolo(state, { spendSkill: "crush" });
    stepSolo(state, { spendSkill: "deathblow" });
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
    stepSolo(state, { spendSkill: "firebolt" });
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
    stepSolo(state, { spendSkill: "firebolt" });
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
    expect(player(state).mana).toBe(manaBefore);
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
    stepSolo(state, { spendSkill: "firebolt" });
    stepSolo(state, { spendSkill: "fireball" });
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
    stepSolo(state, { spendSkill: "firebolt" });
    stepSolo(state, { spendSkill: "fireball" });
    spawnAt(state, "skitter", { x: 6.5, y: 2.5 });
    stepSolo(state, { cast: { skill: "fireball", at: { x: 60, y: 60 } } }); // out of range
    expect(state.events.filter((e) => e.type === "monster_hit")).toHaveLength(0);
  });
});

describe("chainbolt", () => {
  test("strikes up to three nearest enemies in sight", () => {
    const state = createGameOn(1, arena());
    player(state).klass = "witch";
    readyPlayer(state, 20, 10);
    stepSolo(state, { spendSkill: "firebolt" });
    stepSolo(state, { spendSkill: "fireball" });
    stepSolo(state, { spendSkill: "chainbolt" });
    const a = spawnAt(state, "skitter", { x: 3.5, y: 1.5 });
    const b = spawnAt(state, "skitter", { x: 4.5, y: 2.5 });
    const c = spawnAt(state, "skitter", { x: 5.5, y: 3.5 });
    const d = spawnAt(state, "skitter", { x: 8.5, y: 3.5 }); // fourth wheel
    stepSolo(state, { cast: { skill: "chainbolt" } });
    const hitIds = state.events.filter((e) => e.type === "monster_hit").map((e) => (e as any).id);
    expect(hitIds).toContain(a.id);
    expect(hitIds).toContain(b.id);
    expect(hitIds).toContain(c.id);
    expect(hitIds).not.toContain(d.id);
  });
});
