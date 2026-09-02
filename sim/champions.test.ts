import { describe, expect, test } from "bun:test";
import { createRng } from "./rng";
import { soloGame, spawnAt, player } from "./test-helpers";
import { getZone } from "./state";
import { stepSolo, travel } from "./tick";
import {
  CHAMPIONS,
  CHAMPION_CHANCE,
  CHAMPION_IDS,
  championName,
  promoteToChampion,
  rollChampion,
} from "./champions";
import { MONSTER_TYPES } from "./monsters";

describe("champion table", () => {
  test("every champion scales threat up and pays out more xp", () => {
    for (const id of CHAMPION_IDS) {
      const c = CHAMPIONS[id];
      expect(c.lifeMult).toBeGreaterThan(1);
      expect(c.xpMult).toBeGreaterThan(1);
      expect(c.prefix.length).toBeGreaterThan(0);
    }
  });
});

describe("promotion", () => {
  test("multiplies stats, marks the champion, and guarantees a drop", () => {
    const state = soloGame(1);
    const plain = spawnAt(state, "shambler", { x: 5, y: 5 });
    const m = spawnAt(state, "shambler", { x: 6, y: 5 });
    promoteToChampion(m, "brutal");
    expect(m.championId).toBe("brutal");
    expect(m.maxLife).toBeGreaterThan(plain.maxLife);
    expect(m.life).toBe(m.maxLife);
    expect(m.dmgMax).toBeGreaterThan(plain.dmgMax);
    expect(m.xp).toBeGreaterThan(plain.xp);
    expect(m.guaranteedDrop).toBe(true);
  });

  test("a swift champion outruns its kin; a bulwark holds more armor", () => {
    const state = soloGame(1);
    const swift = spawnAt(state, "skitter", { x: 5, y: 5 });
    const wall = spawnAt(state, "skitter", { x: 6, y: 5 });
    const base = MONSTER_TYPES.skitter!;
    promoteToChampion(swift, "swift");
    promoteToChampion(wall, "bulwark");
    expect(swift.speed).toBeGreaterThan(base.speed);
    expect(wall.defense).toBeGreaterThan(base.defense);
  });

  test("a volatile champion detonates on death even if its kind never did", () => {
    const state = soloGame(1);
    const m = spawnAt(state, "shambler", { x: 5, y: 5 });
    expect(m.explode).toBeUndefined();
    promoteToChampion(m, "volatile");
    expect(m.explode).toBeDefined();
    expect(m.explode!.dmgMax).toBeGreaterThan(0);
  });

  test("championName leads with the modifier's prefix", () => {
    const state = soloGame(1);
    const m = spawnAt(state, "fen_howler", { x: 5, y: 5 });
    promoteToChampion(m, "swift");
    expect(championName(m)).toBe("Swift Fen Howler");
  });
});

describe("rollChampion", () => {
  test("promotes roughly CHAMPION_CHANCE of rolls, deterministically", () => {
    const rng = createRng(7);
    let hits = 0;
    const trials = 4000;
    for (let i = 0; i < trials; i++) if (rollChampion(rng) !== null) hits++;
    expect(hits / trials).toBeGreaterThan(CHAMPION_CHANCE * 0.6);
    expect(hits / trials).toBeLessThan(CHAMPION_CHANCE * 1.4);
    // Same seed, same stream of verdicts.
    const a = createRng(11);
    const b = createRng(11);
    for (let i = 0; i < 200; i++) expect(rollChampion(a)).toBe(rollChampion(b));
  });
});

describe("world spawns", () => {
  test("the surface carries some champions, and every one guarantees a drop", () => {
    // Champions are rare per spawn but the surface seeds hundreds of monsters:
    // across a handful of seeds at least one world must produce one.
    let seen = 0;
    for (let seed = 1; seed <= 5; seed++) {
      const state = soloGame(seed);
      for (const m of getZone(state, "surface").monsters.values()) {
        if (m.championId) {
          seen++;
          expect(m.guaranteedDrop).toBe(true);
          expect(CHAMPION_IDS).toContain(m.championId);
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  test("a slain champion always leaves an item behind", () => {
    const state = soloGame(1);
    travel(state, player(state), "floor:1");
    const zone = getZone(state, "floor:1");
    const m = spawnAt(state, "shambler", { x: 5, y: 5 });
    promoteToChampion(m, "brutal");
    const before = zone.groundItems.size;
    m.life = 0;
    stepSolo(state, {});
    expect(zone.groundItems.size).toBeGreaterThan(before);
  });
});
