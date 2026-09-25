import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import type { GameAssets } from "../render/models";
import { ACTION_IDS, buildCatalog, clipCounts, DEFAULT_ARMS, defaultClip, filterEntries, gearId, gridLayout, heldOptions, wornOptions } from "./catalog";

function rigged(name: string): THREE.Object3D {
  const character = new THREE.Object3D();
  character.name = name;
  const root = new THREE.Bone();
  root.name = "Root";
  const hips = new THREE.Bone();
  hips.name = "Hips";
  root.add(hips);
  const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  mesh.add(root);
  mesh.bind(new THREE.Skeleton([root, hips]));
  character.add(mesh);
  return character;
}

function fakeAssets(): GameAssets {
  const goblins = new THREE.Group();
  goblins.add(rigged("Warrior_Male_01"), rigged("Attach_Hood_01"), rigged("Shaman_01"));
  const clip = (name: string) => new THREE.AnimationClip(name, 1, [new THREE.QuaternionKeyframeTrack("Hips.quaternion", [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])]);
  const gltf = (scene: THREE.Object3D, animations: THREE.AnimationClip[] = []) => ({ scene, animations }) as unknown as GameAssets["kits"]["goblin_characters"];
  return {
    dungeon: {} as GameAssets["dungeon"],
    kits: { goblin_characters: gltf(goblins), goblin_clips: gltf(new THREE.Group(), [clip("Idle_Standing"), clip("Walk_F")]) },
  };
}

describe("asset catalog", () => {
  test("lists every kit character except skinned attachments", () => {
    const entries = buildCatalog(fakeAssets());
    expect(entries.map((e) => e.id)).toEqual(["goblin_war_camp/Warrior_Male_01", "goblin_war_camp/Shaman_01"]);
    expect(entries[0]!.clips).toEqual(["Idle_Standing", "Walk_F"]);
    expect(defaultClip(entries[0]!)).toBe("Idle_Standing");
  });

  test("filters by pack and name, and counts clips across the visible set", () => {
    const entries = buildCatalog(fakeAssets());
    expect(filterEntries(entries, "", new Set(["goblin_war_camp"])).length).toBe(2);
    expect(filterEntries(entries, "sham", new Set(["viking_realm", "goblin_war_camp"])).map((e) => e.label)).toEqual(["Shaman 01"]);
    expect(clipCounts(entries).find((c) => c.name === "Idle_Standing")?.count).toBe(2);
  });

  test("lays a near-square grid out front row first", () => {
    const grid = gridLayout(7, 2, 3);
    expect(grid.length).toBe(7);
    expect(grid[0]).toEqual({ x: 0, z: 0 });
    expect(grid[4]).toEqual({ x: 0, z: 3 });
  });
});

describe("gear options", () => {
  function armed(): GameAssets {
    const assets = fakeAssets();
    const named = (name: string) => {
      const o = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 0.1), new THREE.MeshStandardMaterial());
      o.name = name;
      return o;
    };
    const weapons = new THREE.Group();
    weapons.add(named("Wep_Sword_01"), named("Wep_Shield_01"), named("Not_A_Weapon"));
    const attachments = new THREE.Group();
    attachments.add(named("Attach_Hat_01"), named("Attach_Backpack_01"));
    assets.kits.goblin_weapons = { scene: weapons, animations: [] } as unknown as GameAssets["kits"]["goblin_weapons"];
    assets.kits.goblin_attachments = { scene: attachments, animations: [] } as unknown as GameAssets["kits"]["goblin_attachments"];
    return assets;
  }

  test("lists a rig's weapons (shields marked) and its pack's attachments", () => {
    const assets = armed();
    const [warrior] = buildCatalog(assets);
    const held = heldOptions(assets, warrior!);
    expect(held.map((o) => o.id)).toEqual(["goblin_weapons/Wep_Sword_01", "goblin_weapons/Wep_Shield_01"]);
    expect(held.map((o) => o.kind)).toEqual(["weapon", "shield"]);
    expect(wornOptions(assets, warrior!).map((o) => o.label)).toEqual(["Hat 01", "Backpack 01"]);
    expect(warrior!.rest.size).toBeGreaterThan(0);
  });

  test("default arms name real options and every action is a known clip id", () => {
    expect(gearId(DEFAULT_ARMS.goblin!.r!)).toBe("goblin_weapons/Wep_Sword_01");
    expect(gearId(DEFAULT_ARMS.goblin!.l!)).toBe("goblin_weapons/Wep_Shield_01");
    expect(ACTION_IDS).toContain("attack1h");
    expect(new Set(ACTION_IDS).size).toBe(ACTION_IDS.length);
  });
});
