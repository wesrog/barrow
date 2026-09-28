import { describe, expect, test } from "bun:test";
import { applyCharacter, newCharacterRaw, serializeCharacter, STARTING_SKILL, STARTING_WEAPON, type CharacterSave } from "./save";
import { player, soloGame } from "./test-helpers";

describe("a new character's kit", () => {
  test("the witch starts with a bone wand and one rank of firebolt, the warrior with a blade and nothing learned", () => {
    const witch = JSON.parse(newCharacterRaw("Hexudis", "witch")) as CharacterSave;
    expect(witch.equipment.weapon?.baseId).toBe("bone_wand");
    expect(witch.skills.firebolt).toBe(1);
    expect(Object.entries(witch.skills).filter(([, r]) => r > 0)).toEqual([["firebolt", 1]]);
    const warrior = JSON.parse(newCharacterRaw("Kelorgar", "warrior")) as CharacterSave;
    expect(warrior.equipment.weapon?.baseId).toBe(STARTING_WEAPON.warrior.baseId);
    expect(Object.values(warrior.skills).every((r) => r === 0)).toBe(true);
    expect(STARTING_SKILL.warrior).toBeUndefined();
  });

  test("a fresh witch can cast her bolt as soon as she joins", () => {
    const state = soloGame(4);
    expect(applyCharacter(state, player(state).id, newCharacterRaw("Hexudis", "witch"))).toBe(true);
    expect(player(state).klass).toBe("witch");
    expect(player(state).skills.firebolt).toBe(1);
    expect(player(state).equipment.weapon?.baseId).toBe("bone_wand");
  });
});

describe("save migration", () => {
  test("a v1 save loads with every point refunded", () => {
    const state = soloGame(1);
    const p = player(state);
    p.level = 12;
    p.skillPoints = 1;
    p.skills.cleave = 5;
    p.skills.crush = 5;
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
    p.level = 5;
    p.skillPoints = 0;
    p.skills.cleave = 4;
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
    p.level = 5;
    p.skillPoints = 1;
    p.skills.cleave = 3;
    const fresh = soloGame(2);
    expect(applyCharacter(fresh, 0, serializeCharacter(state, 0))).toBe(true);
    expect(player(fresh).skills.cleave).toBe(3);
    expect(player(fresh).skillPoints).toBe(1);
  });
});
