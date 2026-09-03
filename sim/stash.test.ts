import { describe, expect, test } from "bun:test";
import { player, playerZone, soloGame } from "./test-helpers";
import { stepSolo, travel } from "./tick";
import { STASH_H, STASH_W, placeItem } from "./character";
import { rollItem } from "./items/generate";
import { applyCharacter, serializeCharacter } from "./save";
import { inCamp } from "./map";
import { collisionSystem, NPC_RADIUS, PLAYER_RADIUS } from "./systems/collision";
import type { GameState } from "./state";

/** A fresh normal item dropped straight into the solo player's pack. */
function packItem(state: GameState, baseId = "rusted_blade"): number {
  const id = state.nextId++;
  const item = rollItem(state.rng, baseId, 1, "normal");
  expect(placeItem(player(state).inventory, id, item)).toBe(true);
  return id;
}

describe("the stash", () => {
  test("a new player has an empty stash", () => {
    const state = soloGame(1);
    expect(player(state).stash.entries).toEqual([]);
  });

  test("stashing on camp ground moves the item from pack to stash", () => {
    const state = soloGame(1);
    const id = packItem(state);
    stepSolo(state, { stashPut: id });
    const p = player(state);
    expect(p.inventory.entries.length).toBe(0);
    expect(p.stash.entries.length).toBe(1);
    expect(p.stash.entries[0]!.id).toBe(id);
    expect(state.events.some((e) => e.type === "stashed" && e.playerId === 0)).toBe(true);
  });

  test("taking back moves the item from stash to pack", () => {
    const state = soloGame(1);
    const id = packItem(state);
    stepSolo(state, { stashPut: id });
    stepSolo(state, { stashTake: id });
    const p = player(state);
    expect(p.stash.entries.length).toBe(0);
    expect(p.inventory.entries.length).toBe(1);
    expect(p.inventory.entries[0]!.id).toBe(id);
    expect(state.events.some((e) => e.type === "unstashed" && e.playerId === 0)).toBe(true);
  });

  test("the stash is out of reach below ground", () => {
    const state = soloGame(1);
    const id = packItem(state);
    travel(state, player(state), "dungeon:barrow:1");
    stepSolo(state, { stashPut: id });
    expect(player(state).inventory.entries.length).toBe(1);
    expect(player(state).stash.entries.length).toBe(0);
  });

  test("the stash grid is larger than the pack and fills up honestly", () => {
    const state = soloGame(1);
    const p = player(state);
    // Rings are 1x1: the stash holds exactly STASH_W * STASH_H of them.
    for (let i = 0; i < STASH_W * STASH_H; i++) {
      const id = state.nextId++;
      const item = rollItem(state.rng, "bone_ring", 1, "normal");
      expect(placeItem(p.stash, id, item, STASH_W, STASH_H)).toBe(true);
    }
    const overflow = packItem(state, "bone_ring");
    stepSolo(state, { stashPut: overflow });
    // Full stash: the item stays in the pack and the player hears about it.
    expect(p.inventory.entries.length).toBe(1);
    expect(p.stash.entries.length).toBe(STASH_W * STASH_H);
    expect(state.events.some((e) => e.type === "stash_full" && e.playerId === 0)).toBe(true);
  });

  test("taking back with a full pack leaves the item stashed", () => {
    const state = soloGame(1);
    const p = player(state);
    const id = packItem(state);
    stepSolo(state, { stashPut: id });
    // Brick the pack solid with rings.
    while (placeItem(p.inventory, state.nextId++, rollItem(state.rng, "bone_ring", 1, "normal"))) {}
    stepSolo(state, { stashTake: id });
    expect(p.stash.entries.length).toBe(1);
    expect(state.events.some((e) => e.type === "inventory_full" && e.playerId === 0)).toBe(true);
  });

  test("the stash survives a save/load round trip", () => {
    const state = soloGame(1);
    const id = packItem(state);
    stepSolo(state, { stashPut: id });
    const raw = serializeCharacter(state, 0);

    const fresh = soloGame(2);
    expect(applyCharacter(fresh, 0, raw)).toBe(true);
    expect(player(fresh).stash.entries.length).toBe(1);
    expect(player(fresh).stash.entries[0]!.item.baseId).toBe("rusted_blade");
  });

  test("the camp holds a stash chest marker on safe ground", () => {
    const state = soloGame(1);
    const chest = playerZone(state).map.markers.find((m) => m.ch === "S")!;
    expect(chest).toBeDefined();
    expect(inCamp(playerZone(state).map, chest)).toBe(true);
  });

  test("the chest is solid — a player inside it is pushed out", () => {
    const state = soloGame(1);
    const chest = playerZone(state).map.markers.find((m) => m.ch === "S")!;
    player(state).pos = { x: chest.x + 0.1, y: chest.y };
    collisionSystem(state, playerZone(state), [player(state)]);
    const d = Math.hypot(player(state).pos.x - chest.x, player(state).pos.y - chest.y);
    expect(d).toBeGreaterThanOrEqual(PLAYER_RADIUS + NPC_RADIUS - 1e-6);
  });

  test("a save from before stashes existed loads with an empty stash", () => {
    const state = soloGame(1);
    const raw = serializeCharacter(state, 0);
    const save = JSON.parse(raw);
    delete save.stash;

    const fresh = soloGame(2);
    expect(applyCharacter(fresh, 0, JSON.stringify(save))).toBe(true);
    expect(player(fresh).stash.entries).toEqual([]);
  });
});
