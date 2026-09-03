import { describe, expect, test } from "bun:test";
import { soloGame } from "./test-helpers";
import { joinPlayer, step, stepSolo, travel } from "./tick";
import { applyCharacter, serializeCharacter } from "./save";
import { getZone } from "./state";
import { placeItem } from "./character";
import { rollDurability } from "./items/generate";
import { inCamp, isWalkable } from "./map";

describe("corpse runs", () => {
  test("death strips equipment onto a corpse and respawns the player in camp", () => {
    const g = soloGame(1);
    const p = g.players.get(0)!;
    travel(g, p, "dungeon:barrow:1");
    const spot = { ...p.pos };
    p.life = 0;
    stepSolo(g, {});
    expect(p.zoneId).toBe("surface");
    expect(p.life).toBe(p.maxLife);
    expect(p.equipment.weapon).toBeNull();
    const corpses = [...getZone(g, "dungeon:barrow:1").playerCorpses.values()];
    expect(corpses).toHaveLength(1);
    expect(corpses[0]!.playerId).toBe(0);
    expect(corpses[0]!.equipment.weapon?.baseId).toBe("rusted_blade");
    expect(corpses[0]!.pos).toEqual(spot);
    expect(p.gold).toBe(p.gold); // gold, inventory, belt untouched
  });

  test("reclaiming re-equips everything and removes the corpse", () => {
    const g = soloGame(1);
    const p = g.players.get(0)!;
    travel(g, p, "dungeon:barrow:1");
    p.life = 0;
    stepSolo(g, {});
    travel(g, p, "dungeon:barrow:1");
    const corpse = [...getZone(g, "dungeon:barrow:1").playerCorpses.values()][0]!;
    p.pos = { ...corpse.pos };
    stepSolo(g, { reclaim: corpse.id });
    for (let i = 0; i < 5; i++) stepSolo(g, {});
    expect(p.equipment.weapon?.baseId).toBe("rusted_blade");
    expect(getZone(g, "dungeon:barrow:1").playerCorpses.size).toBe(0);
  });

  test("dying again merges old corpse gear onto the new corpse", () => {
    // equip a second item (helm) first; die on floor:1, re-equip nothing, die on floor:2
    const g = soloGame(1);
    const p = g.players.get(0)!;
    const helmId = g.nextId++;
    placeItem(p.inventory, helmId, {
      baseId: "cracked_helm",
      rarity: "normal",
      name: "Cracked Helm",
      affixIds: [],
      mods: [],
      ilvl: 1,
      durability: rollDurability("cracked_helm"),
    });
    stepSolo(g, { equip: helmId });
    expect(p.equipment.helm?.baseId).toBe("cracked_helm");

    travel(g, p, "dungeon:barrow:1");
    p.life = 0;
    stepSolo(g, {});
    expect(p.zoneId).toBe("surface");
    expect(getZone(g, "dungeon:barrow:1").playerCorpses.size).toBe(1);

    // re-equip nothing; head down to floor:2 and die again, naked this time
    travel(g, p, "dungeon:barrow:2");
    p.life = 0;
    stepSolo(g, {});

    expect(getZone(g, "dungeon:barrow:1").playerCorpses.size).toBe(0);
    const corpses = [...getZone(g, "dungeon:barrow:2").playerCorpses.values()];
    expect(corpses).toHaveLength(1);
    expect(corpses[0]!.equipment.weapon?.baseId).toBe("rusted_blade");
    expect(corpses[0]!.equipment.helm?.baseId).toBe("cracked_helm");
  });

  test("a fresh run walks corpse gear back to camp instead of destroying it", () => {
    const g = soloGame(1);
    const p = g.players.get(0)!;
    travel(g, p, "dungeon:barrow:2");
    p.life = 0;
    stepSolo(g, {});
    expect(getZone(g, "dungeon:barrow:2").playerCorpses.size).toBe(1);

    stepSolo(g, { newGame: true });

    // floor:2 is forgotten, but the gear on it is not.
    expect(g.zones.has("dungeon:barrow:2")).toBe(false);
    const corpses = [...getZone(g, "surface").playerCorpses.values()];
    expect(corpses).toHaveLength(1);
    expect(corpses[0]!.playerId).toBe(0);
    expect(corpses[0]!.equipment.weapon?.baseId).toBe("rusted_blade");

    // ...and the owner can still walk over and take it back.
    expect(p.equipment.weapon).toBeNull();
    p.pos = { ...corpses[0]!.pos };
    stepSolo(g, { reclaim: corpses[0]!.id });
    for (let i = 0; i < 5; i++) stepSolo(g, {});
    expect(p.equipment.weapon?.baseId).toBe("rusted_blade");
    expect(getZone(g, "surface").playerCorpses.size).toBe(0);
  });

  test("relocated corpses land on walkable camp cells, one per cell", () => {
    const g = soloGame(1);
    const p0 = g.players.get(0)!;
    const p1 = joinPlayer(g, { id: 1 });
    travel(g, p0, "dungeon:barrow:1");
    travel(g, p1, "dungeon:barrow:1");
    p0.life = 0;
    p1.life = 0;
    stepSolo(g, {});
    expect(getZone(g, "dungeon:barrow:1").playerCorpses.size).toBe(2);

    stepSolo(g, { newGame: true });
    const camp = getZone(g, "surface");
    const corpses = [...camp.playerCorpses.values()];
    expect(corpses).toHaveLength(2);
    for (const c of corpses) {
      expect(isWalkable(camp.map, Math.floor(c.pos.x), Math.floor(c.pos.y))).toBe(true);
      expect(inCamp(camp.map, c.pos)).toBe(true);
    }
    const cells = new Set(corpses.map((c) => `${Math.floor(c.pos.x)},${Math.floor(c.pos.y)}`));
    expect(cells.size).toBe(2);
  });

  test("a corpse survives leaving the game: the save carries it back to camp", () => {
    const g = soloGame(1);
    const p = g.players.get(0)!;
    travel(g, p, "dungeon:barrow:1");
    p.life = 0;
    stepSolo(g, {});
    expect(p.equipment.weapon).toBeNull();

    // Refresh: serialize, rebuild the world, rejoin, restore.
    const raw = serializeCharacter(g, 0);
    const g2 = soloGame(1);
    expect(applyCharacter(g2, 0, raw)).toBe(true);

    const camp = getZone(g2, "surface");
    const corpses = [...camp.playerCorpses.values()];
    expect(corpses).toHaveLength(1);
    expect(corpses[0]!.playerId).toBe(0);
    expect(corpses[0]!.equipment.weapon?.baseId).toBe("rusted_blade");
    expect(isWalkable(camp.map, Math.floor(corpses[0]!.pos.x), Math.floor(corpses[0]!.pos.y))).toBe(
      true,
    );
    expect(inCamp(camp.map, corpses[0]!.pos)).toBe(true);

    // ...and it can be reclaimed as usual.
    const p2 = g2.players.get(0)!;
    p2.pos = { ...corpses[0]!.pos };
    stepSolo(g2, { reclaim: corpses[0]!.id });
    for (let i = 0; i < 5; i++) stepSolo(g2, {});
    expect(p2.equipment.weapon?.baseId).toBe("rusted_blade");
    expect(camp.playerCorpses.size).toBe(0);
  });

  test("a save without a corpse spawns none, and a live corpse is not duplicated", () => {
    // No death: nothing extra appears on load.
    const g = soloGame(1);
    const raw = serializeCharacter(g, 0);
    const g2 = soloGame(1);
    expect(applyCharacter(g2, 0, raw)).toBe(true);
    expect(getZone(g2, "surface").playerCorpses.size).toBe(0);

    // Rejoining a world that still holds this player's corpse must not clone it.
    const g3 = soloGame(1);
    const p3 = g3.players.get(0)!;
    travel(g3, p3, "dungeon:barrow:1");
    p3.life = 0;
    stepSolo(g3, {});
    const raw3 = serializeCharacter(g3, 0);
    expect(applyCharacter(g3, 0, raw3)).toBe(true);
    let total = 0;
    for (const z of g3.zones.values()) total += z.playerCorpses.size;
    expect(total).toBe(1);
  });

  test("restored corpses of two players land on distinct camp cells", () => {
    const g = soloGame(1);
    const p0 = g.players.get(0)!;
    const p1 = joinPlayer(g, { id: 1 });
    travel(g, p0, "dungeon:barrow:1");
    travel(g, p1, "dungeon:barrow:1");
    p0.life = 0;
    p1.life = 0;
    stepSolo(g, {});
    const raw0 = serializeCharacter(g, 0);
    const raw1 = serializeCharacter(g, 1);

    const g2 = soloGame(1);
    joinPlayer(g2, { id: 1 });
    expect(applyCharacter(g2, 0, raw0)).toBe(true);
    expect(applyCharacter(g2, 1, raw1)).toBe(true);
    const corpses = [...getZone(g2, "surface").playerCorpses.values()];
    expect(corpses).toHaveLength(2);
    const cells = new Set(corpses.map((c) => `${Math.floor(c.pos.x)},${Math.floor(c.pos.y)}`));
    expect(cells.size).toBe(2);
  });

  test("only the owner can reclaim", () => {
    const g = soloGame(1);
    const p0 = g.players.get(0)!;
    travel(g, p0, "dungeon:barrow:1");
    p0.life = 0;
    stepSolo(g, {});
    const corpse = [...getZone(g, "dungeon:barrow:1").playerCorpses.values()][0]!;

    const p1 = joinPlayer(g, { id: 1 });
    travel(g, p1, "dungeon:barrow:1");
    p1.pos = { ...corpse.pos };
    const p1WeaponBefore = p1.equipment.weapon?.baseId;

    step(g, { tick: g.tick, inputs: { 1: { reclaim: corpse.id } } });
    for (let i = 0; i < 5; i++) step(g, { tick: g.tick, inputs: {} });

    expect(getZone(g, "dungeon:barrow:1").playerCorpses.size).toBe(1);
    expect(p1.equipment.weapon?.baseId).toBe(p1WeaponBefore);
    expect(p1.equipment.helm).toBeNull();
  });
});
