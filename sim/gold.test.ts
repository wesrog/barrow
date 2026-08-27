import { describe, expect, test } from "bun:test";
import { mapFromStrings } from "./map";
import { stepSolo } from "./tick";
import { createGameOn, player, playerZone, spawnAt } from "./test-helpers";
import { recomputePlayerStats } from "./systems/inventory";
import type { GameState } from "./state";

const arena = () =>
  mapFromStrings([
    "########",
    "#@.....#",
    "#......#",
    "########",
  ]);

function armed(state: GameState): void {
  player(state).equipment.weapon!.mods = [
    { stat: "dmgMin", value: 500 },
    { stat: "dmgMax", value: 500 },
    { stat: "life", value: 100000 },
  ];
  recomputePlayerStats(state, player(state));
  player(state).life = player(state).maxLife;
}

describe("gold", () => {
  test("kills sometimes drop gold piles that scale with monster level", () => {
    const state = createGameOn(9, arena());
    armed(state);
    let piles = 0;
    let total = 0;
    for (let round = 0; round < 80; round++) {
      const m = spawnAt(state, "skitter", { x: 5.5, y: 1.5 });
      m.life = 0;
      stepSolo(state, {});
      for (const e of state.events) {
        if (e.type === "gold_dropped") {
          piles++;
          total += e.amount;
        }
      }
    }
    expect(piles).toBeGreaterThan(10);
    expect(piles).toBeLessThan(60);
    expect(total / piles).toBeGreaterThanOrEqual(2);
  });

  test("walking over a pile scoops it up automatically", () => {
    const state = createGameOn(1, arena());
    playerZone(state).goldPiles.set(1, { id: 1, amount: 25, pos: { x: 4.5, y: 1.5 } });
    stepSolo(state, { moveTo: { x: 6.5, y: 1.5 } });
    for (let i = 0; i < 60; i++) stepSolo(state, {});
    expect(playerZone(state).goldPiles.size).toBe(0);
    expect(player(state).gold).toBe(25);
  });
});
