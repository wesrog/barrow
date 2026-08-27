import { describe, expect, test } from "bun:test";
import { soloGame } from "./test-helpers";
import { joinPlayer, step, stepSolo, travel } from "./tick";
import { getZone } from "./state";
import { placeItem } from "./character";
import { rollDurability } from "./items/generate";
import { inCamp, isWalkable } from "./map";

describe("corpse runs", () => {
  test("death strips equipment onto a corpse and respawns the player in camp", () => {
    const g = soloGame(1);
    const p = g.players.get(0)!;
    travel(g, p, "floor:1");
    const spot = { ...p.pos };
    p.life = 0;
    stepSolo(g, {});
    expect(p.zoneId).toBe("overworld");
    expect(p.life).toBe(p.maxLife);
    expect(p.equipment.weapon).toBeNull();
    const corpses = [...getZone(g, "floor:1").playerCorpses.values()];
    expect(corpses).toHaveLength(1);
    expect(corpses[0]!.playerId).toBe(0);
    expect(corpses[0]!.equipment.weapon?.baseId).toBe("rusted_blade");
    expect(corpses[0]!.pos).toEqual(spot);
    expect(p.gold).toBe(p.gold); // gold, inventory, belt untouched
  });

  test("reclaiming re-equips everything and removes the corpse", () => {
    const g = soloGame(1);
    const p = g.players.get(0)!;
    travel(g, p, "floor:1");
    p.life = 0;
    stepSolo(g, {});
    travel(g, p, "floor:1");
    const corpse = [...getZone(g, "floor:1").playerCorpses.values()][0]!;
    p.pos = { ...corpse.pos };
    stepSolo(g, { reclaim: corpse.id });
    for (let i = 0; i < 5; i++) stepSolo(g, {});
    expect(p.equipment.weapon?.baseId).toBe("rusted_blade");
    expect(getZone(g, "floor:1").playerCorpses.size).toBe(0);
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

    travel(g, p, "floor:1");
    p.life = 0;
    stepSolo(g, {});
    expect(p.zoneId).toBe("overworld");
    expect(getZone(g, "floor:1").playerCorpses.size).toBe(1);

    // re-equip nothing; head down to floor:2 and die again, naked this time
    travel(g, p, "floor:2");
    p.life = 0;
    stepSolo(g, {});

    expect(getZone(g, "floor:1").playerCorpses.size).toBe(0);
    const corpses = [...getZone(g, "floor:2").playerCorpses.values()];
    expect(corpses).toHaveLength(1);
    expect(corpses[0]!.equipment.weapon?.baseId).toBe("rusted_blade");
    expect(corpses[0]!.equipment.helm?.baseId).toBe("cracked_helm");
  });

  test("a fresh run walks corpse gear back to camp instead of destroying it", () => {
    const g = soloGame(1);
    const p = g.players.get(0)!;
    travel(g, p, "floor:2");
    p.life = 0;
    stepSolo(g, {});
    expect(getZone(g, "floor:2").playerCorpses.size).toBe(1);

    stepSolo(g, { newGame: true });

    // floor:2 is forgotten, but the gear on it is not.
    expect(g.zones.has("floor:2")).toBe(false);
    const corpses = [...getZone(g, "overworld").playerCorpses.values()];
    expect(corpses).toHaveLength(1);
    expect(corpses[0]!.playerId).toBe(0);
    expect(corpses[0]!.equipment.weapon?.baseId).toBe("rusted_blade");

    // ...and the owner can still walk over and take it back.
    expect(p.equipment.weapon).toBeNull();
    p.pos = { ...corpses[0]!.pos };
    stepSolo(g, { reclaim: corpses[0]!.id });
    for (let i = 0; i < 5; i++) stepSolo(g, {});
    expect(p.equipment.weapon?.baseId).toBe("rusted_blade");
    expect(getZone(g, "overworld").playerCorpses.size).toBe(0);
  });

  test("relocated corpses land on walkable camp cells, one per cell", () => {
    const g = soloGame(1);
    const p0 = g.players.get(0)!;
    const p1 = joinPlayer(g, { id: 1 });
    travel(g, p0, "floor:1");
    travel(g, p1, "floor:1");
    p0.life = 0;
    p1.life = 0;
    stepSolo(g, {});
    expect(getZone(g, "floor:1").playerCorpses.size).toBe(2);

    stepSolo(g, { newGame: true });
    const camp = getZone(g, "overworld");
    const corpses = [...camp.playerCorpses.values()];
    expect(corpses).toHaveLength(2);
    for (const c of corpses) {
      expect(isWalkable(camp.map, Math.floor(c.pos.x), Math.floor(c.pos.y))).toBe(true);
      expect(inCamp(camp.map, c.pos)).toBe(true);
    }
    const cells = new Set(corpses.map((c) => `${Math.floor(c.pos.x)},${Math.floor(c.pos.y)}`));
    expect(cells.size).toBe(2);
  });

  test("only the owner can reclaim", () => {
    const g = soloGame(1);
    const p0 = g.players.get(0)!;
    travel(g, p0, "floor:1");
    p0.life = 0;
    stepSolo(g, {});
    const corpse = [...getZone(g, "floor:1").playerCorpses.values()][0]!;

    const p1 = joinPlayer(g, { id: 1 });
    travel(g, p1, "floor:1");
    p1.pos = { ...corpse.pos };
    const p1WeaponBefore = p1.equipment.weapon?.baseId;

    step(g, { tick: g.tick, inputs: { 1: { reclaim: corpse.id } } });
    for (let i = 0; i < 5; i++) step(g, { tick: g.tick, inputs: {} });

    expect(getZone(g, "floor:1").playerCorpses.size).toBe(1);
    expect(p1.equipment.weapon?.baseId).toBe(p1WeaponBefore);
    expect(p1.equipment.helm).toBeNull();
  });
});
