import { describe, expect, test } from "bun:test";
import { mapFromStrings } from "./map";
import { createGame, step } from "./tick";
import { spawnMonster } from "./monsters";

const arena = () =>
  mapFromStrings([
    "########",
    "#@.....#",
    "#......#",
    "########",
  ]);

describe("monster drops", () => {
  test("killing many monsters produces ground items at corpse positions", () => {
    const game = createGame(2, arena());
    game.player.dmgMin = 500;
    game.player.dmgMax = 500;
    game.player.life = 100000;
    game.player.maxLife = 100000;
    let kills = 0;
    for (let round = 0; round < 60; round++) {
      const m = spawnMonster(game, "skitter", { x: 2.5, y: 1.5 });
      step(game, { attack: m.id });
      for (let i = 0; i < 60 && game.monsters.has(m.id); i++) step(game, {});
      if (!game.monsters.has(m.id)) kills++;
    }
    expect(kills).toBe(60);
    const items = [...game.groundItems.values()];
    // trash TC drops ~30% of the time; 60 kills should yield some but not all.
    expect(items.length).toBeGreaterThan(2);
    expect(items.length).toBeLessThan(55);
    for (const gi of items) {
      expect(gi.item.baseId).toBeDefined();
      // dropped near the corpse (scatter is small)
      expect(Math.abs(gi.pos.x - 2.5)).toBeLessThanOrEqual(1.6);
      expect(Math.abs(gi.pos.y - 1.5)).toBeLessThanOrEqual(1.6);
    }
    const ids = items.map((gi) => gi.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("drops respect the monster's level for base selection", () => {
    const game = createGame(3, arena());
    game.player.dmgMin = 500;
    game.player.dmgMax = 500;
    game.player.life = 100000;
    game.player.maxLife = 100000;
    for (let round = 0; round < 80; round++) {
      const m = spawnMonster(game, "skitter", { x: 2.5, y: 1.5 });
      step(game, { attack: m.id });
      for (let i = 0; i < 60 && game.monsters.has(m.id); i++) step(game, {});
    }
    for (const gi of game.groundItems.values()) {
      expect(gi.item.ilvl).toBe(2); // skitter mlvl
    }
  });
});
