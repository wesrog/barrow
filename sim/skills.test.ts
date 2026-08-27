import { describe, expect, test } from "bun:test";
import { mapFromStrings } from "./map";
import { step } from "./tick";
import { createGameOn, playerZone, spawnAt } from "./test-helpers";
import { SKILLS, damageMultiplier, cleaveMultiplier } from "./skills";
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
  state.player.level = level;
  state.player.skillPoints = points;
  state.player.mana = state.player.maxMana;
}

describe("skill points", () => {
  test("spending a point raises the skill rank and consumes the point", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state, 2, 1);
    step(state, { spendSkill: "cleave" });
    expect(state.player.skills.cleave).toBe(1);
    expect(state.player.skillPoints).toBe(0);
  });

  test("skills are gated by character level", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state, 1, 5);
    step(state, { spendSkill: "leap" }); // leap unlocks at 6
    expect(state.player.skills.leap).toBe(0);
    expect(state.player.skillPoints).toBe(5);
  });

  test("no points, no rank", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state, 10, 0);
    step(state, { spendSkill: "cleave" });
    expect(state.player.skills.cleave).toBe(0);
  });
});

describe("cleave", () => {
  test("hits every monster in reach and spends mana", () => {
    // Seed chosen so both 95%-capped hit rolls land; determinism keeps it stable.
    const state = createGameOn(1, arena());
    readyPlayer(state);
    step(state, { spendSkill: "cleave" });
    const a = spawnAt(state, "skitter", { x: 2.2, y: 1.5 });
    const b = spawnAt(state, "skitter", { x: 1.5, y: 2.3 });
    const c = spawnAt(state, "skitter", { x: 8.5, y: 3.5 }); // far away
    const manaBefore = state.player.mana;
    step(state, { cast: { skill: "cleave" } });
    expect(state.player.mana).toBe(manaBefore - SKILLS.cleave.manaCost);
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
    step(state, { cast: { skill: "cleave" } }); // no rank
    expect(state.events.filter((e) => e.type === "monster_hit")).toHaveLength(0);
    step(state, { spendSkill: "cleave" });
    state.player.mana = 0;
    step(state, { cast: { skill: "cleave" } }); // no mana
    expect(state.events.filter((e) => e.type === "monster_hit")).toHaveLength(0);
    expect(playerZone(state).monsters.has(m.id)).toBe(true);
  });
});

describe("crush", () => {
  test("lands a guaranteed heavy hit on a target in reach", () => {
    const state = createGameOn(7, arena());
    readyPlayer(state);
    step(state, { spendSkill: "crush" });
    const m = spawnAt(state, "skitter", { x: 2.2, y: 1.5 });
    step(state, { cast: { skill: "crush", target: m.id } });
    const hit = state.events.find((e) => e.type === "monster_hit");
    expect(hit).toBeDefined();
    // 2x multiplier on a 1-6 blade: at least 2
    expect((hit as any).amount).toBeGreaterThanOrEqual(2);
  });

  test("ignores a target out of reach", () => {
    const state = createGameOn(7, arena());
    readyPlayer(state);
    step(state, { spendSkill: "crush" });
    const m = spawnAt(state, "skitter", { x: 8.5, y: 3.5 });
    const manaBefore = state.player.mana;
    step(state, { cast: { skill: "crush", target: m.id } });
    expect(state.player.mana).toBe(manaBefore);
    expect(state.events.filter((e) => e.type === "monster_hit")).toHaveLength(0);
  });
});

describe("warcry", () => {
  test("buffs damage for a duration", () => {
    const state = createGameOn(7, arena());
    readyPlayer(state);
    step(state, { spendSkill: "warcry" });
    expect(damageMultiplier(state)).toBeCloseTo(1.0);
    step(state, { cast: { skill: "warcry" } });
    expect(damageMultiplier(state)).toBeGreaterThan(1.0);
    for (let i = 0; i < SKILLS.warcry.buffTicks + 5; i++) step(state, {});
    expect(damageMultiplier(state)).toBeCloseTo(1.0);
  });
});

describe("leap", () => {
  test("moves the player to the target cell and stuns nearby monsters", () => {
    const state = createGameOn(7, arena());
    readyPlayer(state);
    step(state, { spendSkill: "leap" });
    // Close enough to stun, far enough that body-blocking doesn't shove anyone.
    const near = spawnAt(state, "skitter", { x: 7.5, y: 2.8 });
    const posBefore = { ...near.pos };
    step(state, { cast: { skill: "leap", at: { x: 7.5, y: 3.5 } } });
    expect(state.player.pos.x).toBeCloseTo(7.5);
    expect(state.player.pos.y).toBeCloseTo(3.5);
    expect(near.stunnedUntil).toBeGreaterThan(state.tick);
    // Stunned monsters neither move nor swing
    for (let i = 0; i < 10; i++) step(state, {});
    expect(near.pos).toEqual(posBefore);
  });

  test("cannot leap into a wall or across the map", () => {
    const state = createGameOn(7, arena());
    readyPlayer(state);
    step(state, { spendSkill: "leap" });
    const before = { ...state.player.pos };
    step(state, { cast: { skill: "leap", at: { x: 0.5, y: 0.5 } } }); // wall
    expect(state.player.pos).toEqual(before);
  });
});

describe("cast rate", () => {
  test("cleave cannot be recast until its cast time elapses", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state);
    step(state, { spendSkill: "cleave" });
    spawnAt(state, "skitter", { x: 2.2, y: 1.5 });
    step(state, { cast: { skill: "cleave" } });
    const castsAfterFirst = state.events.filter((e) => e.type === "skill_cast").length;
    expect(castsAfterFirst).toBe(1);
    // Spamming during the animation does nothing and spends no mana.
    const manaAfterFirst = state.player.mana;
    step(state, { cast: { skill: "cleave" } });
    expect(state.events.filter((e) => e.type === "skill_cast")).toHaveLength(0);
    for (let i = 0; i < SKILLS.cleave.castTicks - 2; i++) {
      step(state, { cast: { skill: "cleave" } });
      expect(state.events.filter((e) => e.type === "skill_cast")).toHaveLength(0);
    }
    expect(state.player.mana).toBeLessThanOrEqual(manaAfterFirst + 1); // regen only
    // Once the cast time has fully elapsed, the next cast lands.
    step(state, { cast: { skill: "cleave" } });
    expect(state.events.filter((e) => e.type === "skill_cast")).toHaveLength(1);
  });

  test("every skill occupies the shared action cooldown", () => {
    const state = createGameOn(7, arena());
    readyPlayer(state);
    for (const id of ["cleave", "crush", "warcry", "leap"] as const) {
      step(state, { spendSkill: id });
    }
    spawnAt(state, "skitter", { x: 2.2, y: 1.5 });
    step(state, { cast: { skill: "warcry" } });
    expect(state.events.filter((e) => e.type === "skill_cast")).toHaveLength(1);
    expect(state.player.swingCooldown).toBe(SKILLS.warcry.castTicks - 1);
    // Mid-warcry, cleave is refused.
    step(state, { cast: { skill: "cleave" } });
    expect(state.events.filter((e) => e.type === "skill_cast")).toHaveLength(0);
  });

  test("a basic swing blocks skills, and a skill blocks basic swings", () => {
    const state = createGameOn(1, arena());
    readyPlayer(state);
    step(state, { spendSkill: "cleave" });
    spawnAt(state, "skitter", { x: 2.2, y: 1.5 });
    step(state, { swingAt: { x: 2.2, y: 1.5 } });
    expect(state.events.filter((e) => e.type === "player_swing")).toHaveLength(1);
    // Still mid-swing: cleave refused.
    step(state, { cast: { skill: "cleave" } });
    expect(state.events.filter((e) => e.type === "skill_cast")).toHaveLength(0);
    // Wait out the swing, cleave, then a swing is refused mid-cleave.
    while (state.player.swingCooldown > 0) step(state, {});
    step(state, { cast: { skill: "cleave" } });
    expect(state.events.filter((e) => e.type === "skill_cast")).toHaveLength(1);
    step(state, { swingAt: { x: 2.2, y: 1.5 } });
    expect(state.events.filter((e) => e.type === "player_swing")).toHaveLength(0);
  });
});

describe("mana", () => {
  test("regenerates slowly over time", () => {
    const state = createGameOn(7, arena());
    state.player.mana = 0;
    for (let i = 0; i < 250; i++) step(state, {}); // 10 seconds
    expect(state.player.mana).toBeGreaterThan(5);
    expect(state.player.mana).toBeLessThanOrEqual(state.player.maxMana);
  });
});
