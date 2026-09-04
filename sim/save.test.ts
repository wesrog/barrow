import { describe, expect, test } from "bun:test";
import { applyCharacter, serializeCharacter } from "./save";
import { player, soloGame } from "./test-helpers";

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
