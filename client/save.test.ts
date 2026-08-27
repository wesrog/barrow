import { describe, expect, test } from "bun:test";
import { zoneOf } from "../sim/state";
import { player, soloGame } from "../sim/test-helpers";
import { joinPlayer } from "../sim/tick";
import { BASE_STATS, LIFE_PER_LEVEL, placeItem } from "../sim/character";
import { serializeCharacter, applyCharacter } from "./save";

describe("character save", () => {
  test("round-trips level, skills, belt, inventory, and equipment", () => {
    const a = soloGame(1);
    player(a).level = 5;
    player(a).xp = 300;
    player(a).skillPoints = 1;
    player(a).skills.cleave = 3;
    player(a).belt = 2;
    placeItem(player(a).inventory, 900, {
      baseId: "bone_ring",
      rarity: "magic",
      name: "Gleaming Bone Ring",
      affixIds: ["gleaming"],
      mods: [{ stat: "magicFind", value: 9 }],
      ilvl: 4,
    });

    const raw = serializeCharacter(a, 0);
    const b = soloGame(2);
    applyCharacter(b, 0, raw);

    expect(player(b).level).toBe(5);
    expect(player(b).xp).toBe(300);
    expect(player(b).skills.cleave).toBe(3);
    expect(player(b).belt).toBe(2);
    expect(player(b).inventory.entries).toHaveLength(1);
    expect(player(b).inventory.entries[0]!.item.name).toBe("Gleaming Bone Ring");
    expect(player(b).equipment.weapon?.baseId).toBe("rusted_blade");
    // Derived stats recomputed for level 5, revived at spawn
    expect(player(b).maxLife).toBe(BASE_STATS.maxLife + 4 * LIFE_PER_LEVEL);
    expect(player(b).life).toBe(player(b).maxLife);
    expect(player(b).pos).toEqual(zoneOf(b, player(b)).map.spawn);
  });

  test("garbage data is rejected without corrupting the game", () => {
    const state = soloGame(1);
    const level = player(state).level;
    expect(applyCharacter(state, 0, "not json {")).toBe(false);
    expect(applyCharacter(state, 0, JSON.stringify({ hello: 1 }))).toBe(false);
    expect(player(state).level).toBe(level);
  });

  test("a character joining through a frame arrives with its gear", () => {
    const a = soloGame(1);
    player(a).level = 4;
    player(a).gold = 77;
    const raw = serializeCharacter(a, 0);

    // Player 1 drops in mid-run carrying a saved hero.
    const b = soloGame(2);
    joinPlayer(b, { id: 1, character: raw });
    expect(b.players.get(1)!.level).toBe(4);
    expect(b.players.get(1)!.gold).toBe(77);
  });
});
