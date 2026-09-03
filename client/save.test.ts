import { describe, expect, test } from "bun:test";
import { zoneOf } from "../sim/state";
import { inCamp, isWalkable } from "../sim/map";
import { player, soloGame } from "../sim/test-helpers";
import { joinPlayer } from "../sim/tick";
import { BASE_STATS, LIFE_PER_LEVEL, placeItem } from "../sim/character";
import { worldWaypointPos } from "../sim/surface";
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
    // Derived stats recomputed for level 5, revived on the camp's safe ground
    expect(player(b).maxLife).toBe(BASE_STATS.maxLife + 4 * LIFE_PER_LEVEL);
    expect(player(b).life).toBe(player(b).maxLife);
    expect(inCamp(zoneOf(b, player(b)).map, player(b).pos)).toBe(true);
  });

  test("garbage data is rejected without corrupting the game", () => {
    const state = soloGame(1);
    const level = player(state).level;
    expect(applyCharacter(state, 0, "not json {")).toBe(false);
    expect(applyCharacter(state, 0, JSON.stringify({ hello: 1 }))).toBe(false);
    expect(player(state).level).toBe(level);
  });

  test("a save with a shapeless inventory is rejected", () => {
    // `inventory: {}` used to sail through the guard and then blow up inside
    // step() at the entries loop — a deterministic crash on every client.
    const state = soloGame(1);
    const raw = serializeCharacter(state, 0);
    const save = JSON.parse(raw);
    save.inventory = {};
    expect(applyCharacter(state, 0, JSON.stringify(save))).toBe(false);

    save.inventory = { entries: "nope" };
    expect(applyCharacter(state, 0, JSON.stringify(save))).toBe(false);
  });

  test("non-numeric core fields are rejected", () => {
    const state = soloGame(1);
    const save = JSON.parse(serializeCharacter(state, 0));
    for (const field of ["level", "xp", "skillPoints", "belt"]) {
      const bad = { ...save, [field]: "3" };
      expect(applyCharacter(state, 0, JSON.stringify(bad))).toBe(false);
    }
  });

  test("skills must be an object; missing ranks fill in as 0", () => {
    const state = soloGame(1);
    const save = JSON.parse(serializeCharacter(state, 0));

    // A non-object skills field is unusable — reject.
    expect(applyCharacter(state, 0, JSON.stringify({ ...save, skills: null }))).toBe(false);
    expect(applyCharacter(state, 0, JSON.stringify({ ...save, skills: 5 }))).toBe(false);
    // So is a rank that won't coerce to a finite number.
    expect(
      applyCharacter(state, 0, JSON.stringify({ ...save, skills: { cleave: "lots" } })),
    ).toBe(false);

    // A partial object is fine: the ranks it omits are simply 0, never undefined.
    const partial = { ...save, skills: { cleave: 2 } };
    expect(applyCharacter(state, 0, JSON.stringify(partial))).toBe(true);
    expect(player(state).skills).toEqual({
      cleave: 2,
      crush: 0,
      charge: 0,
      warcry: 0,
      leap: 0,
      firebolt: 0,
      frostnova: 0,
      focus: 0,
      blink: 0,
      stomp: 0,
      deathblow: 0,
      fireball: 0,
      chainbolt: 0,
    });
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

describe("checkpoint persistence", () => {
  test("the save carries the world seed, checkpoint, and discovered waypoints", () => {
    const a = soloGame(41);
    player(a).waypoints = ["overworld", "redfen"];
    player(a).checkpoint = "redfen";
    const save = JSON.parse(serializeCharacter(a, 0));
    expect(save.worldSeed).toBe(41);
    expect(save.checkpoint).toBe("redfen");
    expect(save.waypoints).toEqual(["overworld", "redfen"]);
  });

  test("a restored character wakes at their checkpoint outpost", () => {
    const a = soloGame(1);
    player(a).waypoints = ["overworld", "redfen"];
    player(a).checkpoint = "redfen";
    const raw = serializeCharacter(a, 0);
    const b = soloGame(2);
    expect(applyCharacter(b, 0, raw)).toBe(true);
    expect(player(b).zoneId).toBe("surface");
    expect(b.zones.has("surface")).toBe(true);
    expect(player(b).waypoints).toEqual(["overworld", "redfen"]);
    expect(player(b).checkpoint).toBe("redfen");
    expect(player(b).pos).toEqual(worldWaypointPos(zoneOf(b, player(b)).map, "redfen"));
    const map = zoneOf(b, player(b)).map;
    expect(isWalkable(map, Math.floor(player(b).pos.x), Math.floor(player(b).pos.y))).toBe(true);
  });

  test("garbled checkpoint fields fall back to camp without rejecting the hero", () => {
    const a = soloGame(1);
    const save = JSON.parse(serializeCharacter(a, 0));
    save.checkpoint = "atlantis";
    save.waypoints = ["overworld", "atlantis", 7];
    const b = soloGame(2);
    expect(applyCharacter(b, 0, JSON.stringify(save))).toBe(true);
    expect(player(b).zoneId).toBe("surface");
    expect(player(b).checkpoint).toBe("overworld");
    expect(player(b).pos).toEqual(worldWaypointPos(zoneOf(b, player(b)).map, "overworld"));
    expect(player(b).waypoints).toEqual(["overworld"]);
  });

  test("reaching a town on foot is enough — no waypoint touch needed to resume there", () => {
    // Walking into an outpost stamps the checkpoint before its waypoint is
    // ever touched; the reload still honors it.
    const a = soloGame(1);
    const save = JSON.parse(serializeCharacter(a, 0));
    save.checkpoint = "redfen";
    save.waypoints = ["overworld"];
    const b = soloGame(2);
    expect(applyCharacter(b, 0, JSON.stringify(save))).toBe(true);
    expect(player(b).zoneId).toBe("surface");
    expect(player(b).checkpoint).toBe("redfen");
    expect(player(b).pos).toEqual(worldWaypointPos(zoneOf(b, player(b)).map, "redfen"));
    expect(player(b).waypoints).toEqual(["overworld"]);
  });

  test("a save from before checkpoints still applies, seated at camp", () => {
    const a = soloGame(1);
    const save = JSON.parse(serializeCharacter(a, 0));
    delete save.worldSeed;
    delete save.checkpoint;
    delete save.waypoints;
    const b = soloGame(2);
    expect(applyCharacter(b, 0, JSON.stringify(save))).toBe(true);
    expect(player(b).zoneId).toBe("surface");
    expect(player(b).waypoints).toEqual(["overworld"]);
    expect(player(b).checkpoint).toBe("overworld");
    expect(player(b).pos).toEqual(worldWaypointPos(zoneOf(b, player(b)).map, "overworld"));
  });
});
