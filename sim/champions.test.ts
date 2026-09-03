import { describe, expect, test } from "bun:test";
import { mapFromStrings } from "./map";
import {
  CHAMPION_CHANCE,
  CHAMPION_MODIFIERS,
  MONSTER_TYPES,
  monsterDisplayName,
  upgradeToChampion,
} from "./monsters";
import { getZone } from "./state";
import { stepSolo } from "./tick";
import { createGameOn, player, playerZone, soloGame, spawnAt } from "./test-helpers";

const openArena = () =>
  mapFromStrings([
    "############",
    "#@.........#",
    "#..........#",
    "#..........#",
    "############",
  ]);

describe("champion upgrades", () => {
  test("every champion gets the shared multipliers and a display prefix", () => {
    const state = createGameOn(5, openArena());
    const m = spawnAt(state, "cairn_wight", { x: 6.5, y: 2.5 });
    const base = MONSTER_TYPES.cairn_wight!;
    upgradeToChampion(m, "swift");
    expect(m.rank).toBe("champion");
    expect(m.modifier).toBe("swift");
    expect(m.maxLife).toBe(Math.round(base.maxLife * 2.5));
    expect(m.life).toBe(m.maxLife);
    expect(m.xp).toBe(base.xp * 3);
    expect(m.guaranteedDrop).toBe(true);
    expect(monsterDisplayName(m)).toBe("Swift Cairn Wight");
  });

  test("swift: faster feet and quicker swings", () => {
    const state = createGameOn(5, openArena());
    const m = spawnAt(state, "cairn_wight", { x: 6.5, y: 2.5 });
    const base = MONSTER_TYPES.cairn_wight!;
    upgradeToChampion(m, "swift");
    expect(m.speed).toBeCloseTo(base.speed * 1.6, 5);
    expect(m.swingEvery).toBe(Math.max(1, Math.round(base.swingEvery * 0.7)));
  });

  test("brutal: damage scaled 1.6x", () => {
    const state = createGameOn(5, openArena());
    const m = spawnAt(state, "cairn_wight", { x: 6.5, y: 2.5 });
    const base = MONSTER_TYPES.cairn_wight!;
    upgradeToChampion(m, "brutal");
    expect(m.dmgMin).toBe(Math.round(base.dmgMin * 1.6));
    expect(m.dmgMax).toBe(Math.round(base.dmgMax * 1.6));
  });

  test("stoneskin: double defense and extra life on top of champion life", () => {
    const state = createGameOn(5, openArena());
    const m = spawnAt(state, "cairn_wight", { x: 6.5, y: 2.5 });
    const base = MONSTER_TYPES.cairn_wight!;
    upgradeToChampion(m, "stoneskin");
    expect(m.defense).toBe(base.defense * 2);
    expect(m.maxLife).toBe(Math.round(Math.round(base.maxLife * 2.5) * 1.4));
  });

  test("volatile: gains an explode-on-death scaled to its damage", () => {
    const state = createGameOn(5, openArena());
    player(state).pos = { x: 2.5, y: 1.5 };
    const m = spawnAt(state, "cairn_wight", { x: 3.4, y: 1.5 });
    upgradeToChampion(m, "volatile");
    expect(m.explode).toBeDefined();
    expect(m.explode!.dmgMin).toBe(m.dmgMin * 2);
    expect(m.explode!.dmgMax).toBe(m.dmgMax * 2);
    // The kill's tripled xp can level the player and refill their globe, so
    // read the blast off a bystander instead.
    const bystander = spawnAt(state, "skitter", { x: 4.0, y: 1.5 });
    const bystanderLifeBefore = bystander.life;
    m.life = 0;
    stepSolo(state, {});
    expect(state.events.some((e) => e.type === "exploded")).toBe(true);
    expect(bystander.life).toBeLessThan(bystanderLifeBefore);
  });

  test("a slain champion always leaves a magic-or-better drop", () => {
    const state = createGameOn(5, openArena());
    const m = spawnAt(state, "cairn_wight", { x: 6.5, y: 2.5 });
    upgradeToChampion(m, "brutal");
    m.life = 0;
    stepSolo(state, {});
    expect(playerZone(state).groundItems.size).toBeGreaterThanOrEqual(1);
    const rarities = [...playerZone(state).groundItems.values()].map((gi) => gi.item.rarity);
    expect(rarities.some((r) => r !== "normal")).toBe(true);
  });
});

describe("surface champion packs", () => {
  test("roughly a fifth of surface packs field a champion", () => {
    const monsters = [...getZone(soloGame(1), "surface").monsters.values()];
    const champions = monsters.filter((m) => m.rank === "champion");
    const rate = champions.length / monsters.length;
    expect(rate).toBeGreaterThan(CHAMPION_CHANCE * 0.5);
    expect(rate).toBeLessThan(CHAMPION_CHANCE * 1.5);
    for (const c of champions) {
      expect(CHAMPION_MODIFIERS).toContain(c.modifier!);
      expect(c.guaranteedDrop).toBe(true);
    }
  });

  test("champion rolls are deterministic per seed", () => {
    const pick = (seed: number) =>
      [...getZone(soloGame(seed), "surface").monsters.values()]
        .filter((m) => m.rank === "champion")
        .map((m) => [m.id, m.modifier] as const);
    expect(pick(7)).toEqual(pick(7));
    expect(pick(7).length).toBeGreaterThan(0);
  });

  test("champion mlvl still tracks its region band (upgrade after scaling)", () => {
    const monsters = [...getZone(soloGame(3), "surface").monsters.values()];
    const champ = monsters.find((m) => m.rank === "champion")!;
    const base = MONSTER_TYPES[champ.typeId]!;
    expect(champ.mlvl).toBeGreaterThanOrEqual(base.mlvl);
    expect(champ.xp).toBeGreaterThan(base.xp);
  });
});
