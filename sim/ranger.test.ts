import { describe, expect, test } from "bun:test";
import { mapFromStrings } from "./map";
import { stepSolo } from "./tick";
import { createGameOn, player, playerZone, spawnAt } from "./test-helpers";
import { CLASS_STATS, computeStats, createEquipment } from "./character";
import { BASES } from "./items/bases";
import { TREASURE_CLASSES } from "./items/treasure";
import {
  CLASS_TREES,
  SKILLS,
  TREE_SKILLS,
  eagleEyeRange,
  evasionDefense,
  multishotCount,
  multishotFan,
  powershotMultiplier,
  snareTicks,
} from "./skills";
import { newCharacterRaw, STARTING_SKILL, STARTING_WEAPON, type CharacterSave } from "./save";
import { recomputePlayerStats } from "./systems/inventory";
import type { Item } from "./items/generate";
import type { GameState } from "./state";
import type { SkillId } from "./skills";

const open = () =>
  mapFromStrings([
    "######################",
    "#@...................#",
    "#....................#",
    "#....................#",
    "######################",
  ]);

/** A wall between the player's column and the far side, open only along the bottom row. */
const walled = () =>
  mapFromStrings([
    "##############",
    "#@....#......#",
    "#.....#......#",
    "#............#",
    "##############",
  ]);

function bow(baseId = "short_bow"): Item {
  return { baseId, rarity: "normal", name: BASES[baseId]!.name, affixIds: [], mods: [], ilvl: 1 };
}

/** The solo player as a level-24 ranger with a bow, full mana, and points to spend. */
function ranger(state: GameState, points = 12): void {
  const p = player(state);
  p.klass = "ranger";
  p.level = 24;
  p.skillPoints = points;
  p.equipment.weapon = bow();
  recomputePlayerStats(state, p);
  p.mana = p.maxMana;
}

type ArrowEvent = Extract<GameState["events"][number], { type: "arrow" }>;

/** Step with an input, then idle, and return every arrow loosed along the way (events clear each tick). */
function shoot(state: GameState, input: Parameters<typeof stepSolo>[1], ticks = 12): ArrowEvent[] {
  const arrows: ArrowEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    stepSolo(state, i === 0 ? input : {});
    for (const e of state.events) if (e.type === "arrow") arrows.push(e);
  }
  return arrows;
}

function learn(state: GameState, id: SkillId): void {
  for (const pre of SKILLS[id].prereqs) if (player(state).skills[pre] <= 0) learn(state, pre);
  stepSolo(state, { spendSkill: id });
}


describe("the ranger class", () => {
  test("has its own pools and three trees of six skills", () => {
    expect(CLASS_STATS.ranger.maxLife).toBeGreaterThan(CLASS_STATS.witch.maxLife);
    expect(CLASS_STATS.ranger.maxLife).toBeLessThan(CLASS_STATS.warrior.maxLife);
    const trees = CLASS_TREES("ranger");
    expect(trees.map((t) => t.id)).toEqual(["archery", "hunting", "survival"]);
    for (const t of trees) expect(TREE_SKILLS(t.id).length).toBe(6);
  });

  test("a new ranger starts with a short bow and one rank of power shot", () => {
    expect(STARTING_WEAPON.ranger.baseId).toBe("short_bow");
    expect(STARTING_SKILL.ranger).toBe("powershot");
    const save = JSON.parse(newCharacterRaw("Wren", "ranger")) as CharacterSave;
    expect(save.klass).toBe("ranger");
    expect(save.equipment.weapon?.baseId).toBe("short_bow");
    expect(save.skills.powershot).toBe(1);
  });

  test("bows are two-handed ranger weapons that drop from the treasure classes", () => {
    const bows = Object.values(BASES).filter((b) => b.reach !== undefined);
    expect(bows.length).toBeGreaterThanOrEqual(4);
    for (const b of bows) {
      expect(b.classReq).toBe("ranger");
      expect(b.twoHanded).toBe(true);
      expect(b.reach!).toBeGreaterThan(5);
    }
    const dropped = new Set(Object.values(TREASURE_CLASSES).flatMap((tc) => tc.entries.flatMap((e) => e.baseIds)));
    for (const b of bows) expect(dropped.has(b.id)).toBe(true);
  });

  test("a bow gives its reach; melee keeps arm's length", () => {
    const eq = createEquipment();
    expect(computeStats(eq, 1, "ranger").range).toBeCloseTo(1.2);
    eq.weapon = bow();
    expect(computeStats(eq, 1, "ranger").range).toBeCloseTo(BASES.short_bow!.reach!);
  });
});

describe("shooting", () => {
  test("a ranger shoots a monster across the room without walking to it", () => {
    const state = createGameOn(1, open());
    ranger(state);
    const p = player(state);
    const start = { ...p.pos };
    const m = spawnAt(state, "skitter", { x: p.pos.x + 5, y: p.pos.y });
    m.life = m.maxLife = 500;
    // Attack-hold re-sends every tick, as the client does.
    for (let i = 0; i < 60; i++) stepSolo(state, { attack: m.id });
    expect(m.life).toBeLessThan(500);
    expect(Math.hypot(p.pos.x - start.x, p.pos.y - start.y)).toBeLessThan(0.01);
  });

  test("a wall in the way sends the ranger around it before shooting", () => {
    const state = createGameOn(1, walled());
    ranger(state);
    const p = player(state);
    const start = { ...p.pos };
    const m = spawnAt(state, "skitter", { x: 8.5, y: 1.5 });
    m.life = m.maxLife = 500;
    m.aggro = 0;
    for (let i = 0; i < 5; i++) stepSolo(state, { attack: m.id });
    expect(m.life).toBe(500);
    expect(Math.hypot(p.pos.x - start.x, p.pos.y - start.y)).toBeGreaterThan(0.1);
  });

  test("a shot flies on past the point aimed at and strikes the monster beyond", () => {
    const state = createGameOn(1, open());
    ranger(state);
    const p = player(state);
    const m = spawnAt(state, "skitter", { x: p.pos.x + 7, y: p.pos.y });
    m.life = m.maxLife = 500;
    m.aggro = 0;
    // shift-click a spot two cells out, on the line to the monster
    const [arrow] = shoot(state, { swingAt: { x: p.pos.x + 2, y: p.pos.y } });
    expect(arrow).toBeDefined();
    expect(arrow!.hit).toBe(m.id);
    expect(arrow!.to.x).toBeGreaterThan(p.pos.x + 6);
  });

  test("a shot that finds nothing flies its full reach, and stops at a wall", () => {
    const state = createGameOn(1, open());
    ranger(state);
    const p = player(state);
    const [free] = shoot(state, { swingAt: { x: p.pos.x + 1, y: p.pos.y + 1 } });
    // down-right runs into the arena's bottom wall well before full reach
    expect(free!.hit).toBeNull();
    expect(Math.hypot(free!.to.x - free!.from.x, free!.to.y - free!.from.y)).toBeLessThan(p.range);
    const [along] = shoot(state, { swingAt: { x: p.pos.x + 1, y: p.pos.y } });
    expect(along!.hit).toBeNull();
    expect(Math.hypot(along!.to.x - along!.from.x, along!.to.y - along!.from.y)).toBeCloseTo(p.range, 0);
  });

  test("the first monster in the line takes the arrow", () => {
    const state = createGameOn(1, open());
    ranger(state);
    const p = player(state);
    const near = spawnAt(state, "skitter", { x: p.pos.x + 3, y: p.pos.y });
    const far = spawnAt(state, "skitter", { x: p.pos.x + 6, y: p.pos.y });
    near.life = near.maxLife = far.life = far.maxLife = 500;
    near.aggro = far.aggro = 0;
    const [arrow] = shoot(state, { swingAt: { x: p.pos.x + 6, y: p.pos.y } });
    expect(arrow!.hit).toBe(near.id);
  });

  test("eagle eye lengthens the reach", () => {
    const state = createGameOn(1, open());
    ranger(state);
    const before = player(state).range;
    learn(state, "eagleeye");
    expect(player(state).range).toBeCloseTo(before + eagleEyeRange(1));
  });
});

describe("ranger skills", () => {
  test("power shot strikes a distant target hard and spends mana", () => {
    const state = createGameOn(3, open());
    ranger(state);
    learn(state, "powershot");
    const p = player(state);
    const m = spawnAt(state, "skitter", { x: p.pos.x + 6, y: p.pos.y });
    m.life = m.maxLife = 1000;
    const mana = p.mana;
    stepSolo(state, { cast: { skill: "powershot", target: m.id } });
    expect(m.life).toBeLessThan(1000);
    // a tick of mana regen lands in the same step
    expect(p.mana).toBeCloseTo(mana - SKILLS.powershot.manaCost, 0);
    expect(powershotMultiplier(2)).toBeGreaterThan(powershotMultiplier(1));
  });

  test("multishot fans its arrows out around the aimed line", () => {
    const state = createGameOn(3, open());
    ranger(state);
    learn(state, "multishot");
    const p = player(state);
    // the middle row, so the fan's outer arrows stay inside the arena
    p.pos = { x: 1.5, y: 2.5 };
    const fan = multishotFan(multishotCount(1));
    expect(fan.length).toBe(multishotCount(1));
    const ms = fan.slice(0, 3).map((a) => {
      const m = spawnAt(state, "skitter", { x: p.pos.x + Math.cos(a) * 5, y: p.pos.y + Math.sin(a) * 5 });
      m.life = m.maxLife = 1000;
      return m;
    });
    stepSolo(state, { cast: { skill: "multishot", target: ms[1]!.id, at: { ...ms[1]!.pos } } });
    expect(multishotCount(1)).toBeGreaterThanOrEqual(3);
    for (const m of ms) expect(m.life).toBeLessThan(1000);
  });

  test("snare slows every monster around the spot for a while", () => {
    const state = createGameOn(3, open());
    ranger(state);
    learn(state, "snare");
    const p = player(state);
    const a = spawnAt(state, "skitter", { x: p.pos.x + 5, y: p.pos.y });
    const b = spawnAt(state, "skitter", { x: p.pos.x + 5.8, y: p.pos.y + 0.6 });
    const far = spawnAt(state, "skitter", { x: p.pos.x + 10, y: p.pos.y + 2 });
    stepSolo(state, { cast: { skill: "snare", at: { x: a.pos.x, y: a.pos.y } } });
    const slowed = (id: number) => playerZone(state).monsters.get(id)!.debuffs.some((d) => d.kind === "slow");
    expect(slowed(a.id)).toBe(true);
    expect(slowed(b.id)).toBe(true);
    expect(slowed(far.id)).toBe(false);
    const until = playerZone(state).monsters.get(a.id)!.debuffs.find((d) => d.kind === "slow")!.until;
    expect(until - state.tick).toBeGreaterThan(snareTicks(1) - 3);
  });

  test("evasion raises defense; swiftness raises speed", () => {
    const state = createGameOn(3, open());
    ranger(state);
    const p = player(state);
    const def = p.defense;
    const speed = p.speed;
    learn(state, "evasion");
    expect(p.defense).toBe(Math.floor(def * (1 + evasionDefense(1))));
    learn(state, "swiftness");
    expect(p.speed).toBeGreaterThan(speed);
  });

  test("ranger skills are the ranger's alone", () => {
    const state = createGameOn(3, open());
    const p = player(state);
    p.klass = "witch";
    p.level = 24;
    p.skillPoints = 3;
    stepSolo(state, { spendSkill: "powershot" });
    expect(p.skills.powershot).toBe(0);
  });

});
