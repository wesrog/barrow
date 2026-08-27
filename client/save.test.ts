import { describe, expect, test } from "bun:test";
import { createGame } from "../sim/tick";
import { zoneOf } from "../sim/state";
import { BASE_STATS, LIFE_PER_LEVEL, placeItem } from "../sim/character";
import { serializeCharacter, applyCharacter } from "./save";


describe("character save", () => {
  test("round-trips level, skills, belt, inventory, and equipment", () => {
    const a = createGame(1);
    a.player.level = 5;
    a.player.xp = 300;
    a.player.skillPoints = 1;
    a.player.skills.cleave = 3;
    a.player.belt = 2;
    placeItem(a.player.inventory, 900, {
      baseId: "bone_ring",
      rarity: "magic",
      name: "Gleaming Bone Ring",
      affixIds: ["gleaming"],
      mods: [{ stat: "magicFind", value: 9 }],
      ilvl: 4,
    });

    const raw = serializeCharacter(a);
    const b = createGame(2);
    applyCharacter(b, raw);

    expect(b.player.level).toBe(5);
    expect(b.player.xp).toBe(300);
    expect(b.player.skills.cleave).toBe(3);
    expect(b.player.belt).toBe(2);
    expect(b.player.inventory.entries).toHaveLength(1);
    expect(b.player.inventory.entries[0]!.item.name).toBe("Gleaming Bone Ring");
    expect(b.player.equipment.weapon?.baseId).toBe("rusted_blade");
    // Derived stats recomputed for level 5, revived at spawn
    expect(b.player.maxLife).toBe(BASE_STATS.maxLife + 4 * LIFE_PER_LEVEL);
    expect(b.player.life).toBe(b.player.maxLife);
    expect(b.player.pos).toEqual(zoneOf(b, b.player).map.spawn);
  });

  test("garbage data is rejected without corrupting the game", () => {
    const state = createGame(1);
    const level = state.player.level;
    expect(applyCharacter(state, "not json {")).toBe(false);
    expect(applyCharacter(state, JSON.stringify({ hello: 1 }))).toBe(false);
    expect(state.player.level).toBe(level);
  });
});
