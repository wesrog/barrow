import { describe, expect, test } from "bun:test";
import { mapFromStrings } from "./map";
import { stepSolo } from "./tick";
import { createGameOn, player, playerZone, spawnAt } from "./test-helpers";
import {
  BLINK_RANGE,
  CLASS_SKILLS,
  FIREBOLT_RANGE,
  chainboltDamage,
  fireballDamage,
  fireboltDamage,
  focusMultiplier,
  frostnovaChillTicks,
  frostnovaDamage,
  SKILLS,
} from "./skills";
import { CLASS_STATS, computeStats, createEquipment } from "./character";
import { applyCharacter, newCharacterRaw, serializeCharacter } from "./save";
import type { GameState } from "./state";

const arena = () =>
  mapFromStrings([
    "############",
    "#@.........#",
    "#..........#",
    "#..........#",
    "############",
  ]);

/** Turn the solo player into a leveled witch with points to spend. */
function makeWitch(state: GameState, level = 10, points = 10): void {
  const p = player(state);
  p.klass = "witch";
  p.level = level;
  p.skillPoints = points;
  const s = computeStats(p.equipment, level, "witch");
  p.maxLife = s.maxLife;
  p.life = s.maxLife;
  p.maxMana = s.maxMana;
  p.mana = s.maxMana;
}

describe("class stats", () => {
  test("warrior base stats are unchanged", () => {
    const s = computeStats(createEquipment(), 1, "warrior");
    expect(s.maxLife).toBe(100);
    expect(s.maxMana).toBe(30);
  });

  test("witch trades life for a deep mana pool", () => {
    const s = computeStats(createEquipment(), 1, "witch");
    expect(s.maxLife).toBe(CLASS_STATS.witch.maxLife);
    expect(s.maxMana).toBe(CLASS_STATS.witch.maxMana);
    expect(s.maxLife).toBeLessThan(100);
    expect(s.maxMana).toBeGreaterThan(30);
  });

  test("witch gains life and mana per level", () => {
    const s = computeStats(createEquipment(), 5, "witch");
    expect(s.maxLife).toBe(CLASS_STATS.witch.maxLife + 4 * CLASS_STATS.witch.lifePerLevel);
    expect(s.maxMana).toBe(CLASS_STATS.witch.maxMana + 4 * CLASS_STATS.witch.manaPerLevel);
  });
});

describe("class skill rosters", () => {
  test("each class gets its own six skills in unlock order", () => {
    expect(CLASS_SKILLS("warrior").map((d) => d.id)).toEqual([
      "cleave",
      "crush",
      "warcry",
      "leap",
      "stomp",
      "deathblow",
    ]);
    expect(CLASS_SKILLS("witch").map((d) => d.id)).toEqual([
      "firebolt",
      "frostnova",
      "focus",
      "blink",
      "fireball",
      "chainbolt",
    ]);
  });

  test("a warrior cannot spend points on witch skills", () => {
    const state = createGameOn(1, arena());
    player(state).level = 10;
    player(state).skillPoints = 1;
    stepSolo(state, { spendSkill: "firebolt" });
    expect(player(state).skills.firebolt).toBe(0);
    expect(player(state).skillPoints).toBe(1);
  });

  test("a witch cannot spend points on warrior skills", () => {
    const state = createGameOn(1, arena());
    makeWitch(state);
    stepSolo(state, { spendSkill: "cleave" });
    expect(player(state).skills.cleave).toBe(0);
    stepSolo(state, { spendSkill: "firebolt" });
    expect(player(state).skills.firebolt).toBe(1);
  });
});

describe("firebolt", () => {
  test("strikes a distant monster, always hits, and spends mana", () => {
    const state = createGameOn(1, arena());
    makeWitch(state);
    stepSolo(state, { spendSkill: "firebolt" });
    const m = spawnAt(state, "skitter", { x: 8.5, y: 1.5 });
    const lifeBefore = m.life;
    const manaBefore = player(state).mana;
    stepSolo(state, { cast: { skill: "firebolt", target: m.id } });
    expect(m.life).toBeLessThan(lifeBefore);
    expect(player(state).mana).toBeLessThan(manaBefore);
    expect(state.events.some((e) => e.type === "skill_cast" && e.skill === "firebolt")).toBe(true);
  });

  test("out of range does nothing", () => {
    const state = createGameOn(1, arena());
    makeWitch(state);
    stepSolo(state, { spendSkill: "firebolt" });
    const m = spawnAt(state, "skitter", { x: 1.5 + FIREBOLT_RANGE + 2, y: 1.5 });
    const manaBefore = player(state).mana;
    stepSolo(state, { cast: { skill: "firebolt", target: m.id } });
    expect(m.life).toBe(m.maxLife);
    expect(player(state).mana).toBe(manaBefore);
  });

  test("damage grows with rank and focus synergy", () => {
    expect(fireboltDamage(1, 0)).toEqual({ min: 5, max: 9 });
    // Steeper per-rank growth: +4/+5 — ranks are the witch's whole damage curve.
    expect(fireboltDamage(3, 0)).toEqual({ min: 13, max: 19 });
    const withSynergy = fireboltDamage(1, 2);
    expect(withSynergy.min).toBeGreaterThan(5);
    expect(withSynergy.max).toBeGreaterThan(9);
  });
});

describe("witch damage curves", () => {
  test("fireball grows +5/+8 per rank", () => {
    expect(fireballDamage(1, 0)).toEqual({ min: 8, max: 14 });
    expect(fireballDamage(3, 0)).toEqual({ min: 18, max: 30 });
  });

  test("chain bolt grows +4/+5 per rank and scales with fireball investment", () => {
    expect(chainboltDamage(1, 0)).toEqual({ min: 6, max: 11 });
    expect(chainboltDamage(3, 0)).toEqual({ min: 14, max: 21 });
    // +8% per fireball rank: rank 1 with fireball maxed = base × 1.8, floored
    expect(chainboltDamage(1, 10)).toEqual({ min: 10, max: 19 });
  });
});

describe("frost nova", () => {
  test("damages and chills everything in the ring, missing the far one", () => {
    const state = createGameOn(1, arena());
    makeWitch(state);
    stepSolo(state, { spendSkill: "frostnova" });
    const near = spawnAt(state, "skitter", { x: 2.5, y: 1.5 });
    const far = spawnAt(state, "skitter", { x: 9.5, y: 3.5 });
    stepSolo(state, { cast: { skill: "frostnova" } });
    expect(near.life).toBeLessThan(near.maxLife);
    expect(near.stunnedUntil).toBeGreaterThan(state.tick);
    expect(far.life).toBe(far.maxLife);
  });

  test("numbers scale with rank", () => {
    expect(frostnovaDamage(1)).toEqual({ min: 3, max: 6 });
    expect(frostnovaDamage(2).min).toBeGreaterThan(3);
    expect(frostnovaChillTicks(1)).toBe(20);
    expect(frostnovaChillTicks(3)).toBe(30);
  });
});

describe("focus", () => {
  test("buff multiplies spell damage while active", () => {
    expect(focusMultiplier(1)).toBeCloseTo(1.1);
    expect(focusMultiplier(3)).toBeCloseTo(1.2);
    const state = createGameOn(1, arena());
    makeWitch(state);
    stepSolo(state, { spendSkill: "focus" });
    stepSolo(state, { cast: { skill: "focus" } });
    expect(player(state).buffUntil).toBeGreaterThan(state.tick);
  });
});

describe("blink", () => {
  test("teleports to a walkable spot in range without stunning", () => {
    const state = createGameOn(1, arena());
    makeWitch(state);
    stepSolo(state, { spendSkill: "blink" });
    const bystander = spawnAt(state, "skitter", { x: 8.5, y: 3.5 });
    stepSolo(state, { cast: { skill: "blink", at: { x: 6.5, y: 1.5 } } });
    expect(player(state).pos).toEqual({ x: 6.5, y: 1.5 });
    expect(bystander.stunnedUntil).toBe(0);
  });

  test("arrives at the exact aim point, not the cell center", () => {
    const state = createGameOn(1, arena());
    makeWitch(state);
    stepSolo(state, { spendSkill: "blink" });
    stepSolo(state, { cast: { skill: "blink", at: { x: 6.2, y: 1.8 } } });
    expect(player(state).pos).toEqual({ x: 6.2, y: 1.8 });
  });

  test("refuses walls and spots beyond range", () => {
    const state = createGameOn(1, arena());
    makeWitch(state);
    stepSolo(state, { spendSkill: "blink" });
    const start = { ...player(state).pos };
    stepSolo(state, { cast: { skill: "blink", at: { x: 0.5, y: 0.5 } } }); // wall
    expect(player(state).pos).toEqual(start);
    stepSolo(state, { cast: { skill: "blink", at: { x: start.x + BLINK_RANGE + 3, y: 1.5 } } });
    expect(player(state).pos).toEqual(start);
  });
});

describe("character saves with identity", () => {
  test("a fresh witch save applies name, class, stats, and a staff", () => {
    const state = createGameOn(1, arena());
    const ok = applyCharacter(state, 0, newCharacterRaw("Mira", "witch"));
    expect(ok).toBe(true);
    const p = player(state);
    expect(p.name).toBe("Mira");
    expect(p.klass).toBe("witch");
    expect(p.maxMana).toBe(CLASS_STATS.witch.maxMana);
    expect(p.equipment.weapon?.baseId).toBe("gnarled_staff");
  });

  test("serialize round-trips name and class", () => {
    const state = createGameOn(1, arena());
    applyCharacter(state, 0, newCharacterRaw("Mira", "witch"));
    const raw = serializeCharacter(state, 0);
    const state2 = createGameOn(2, arena());
    expect(applyCharacter(state2, 0, raw)).toBe(true);
    expect(player(state2).name).toBe("Mira");
    expect(player(state2).klass).toBe("witch");
  });

  test("a legacy save without identity applies as a warrior", () => {
    const state = createGameOn(1, arena());
    const raw = serializeCharacter(state, 0);
    const legacy = JSON.parse(raw);
    delete legacy.name;
    delete legacy.klass;
    const state2 = createGameOn(2, arena());
    expect(applyCharacter(state2, 0, JSON.stringify(legacy))).toBe(true);
    expect(player(state2).klass).toBe("warrior");
  });

  test("skill ids in SKILLS all carry their class", () => {
    for (const def of Object.values(SKILLS)) {
      expect(def.klass === "warrior" || def.klass === "witch").toBe(true);
    }
  });
});
