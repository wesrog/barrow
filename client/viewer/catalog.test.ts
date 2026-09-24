import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import type { GameAssets } from "../render/models";
import { buildCatalog, clipCounts, defaultClip, filterEntries, gridLayout } from "./catalog";

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
    characters: { barbarian: gltf(rigged("Barbarian"), [clip("Idle"), clip("Cheer")]) } as unknown as GameAssets["characters"],
    weapons: {} as GameAssets["weapons"],
    dungeon: {} as GameAssets["dungeon"],
    kits: { goblin_characters: gltf(goblins), goblin_clips: gltf(new THREE.Group(), [clip("Idle_Standing"), clip("Walk_F")]) },
  };
}

describe("asset catalog", () => {
  test("lists every KayKit character and kit character except skinned attachments", () => {
    const entries = buildCatalog(fakeAssets());
    expect(entries.map((e) => e.id)).toEqual(["kaykit/barbarian", "goblin_war_camp/Warrior_Male_01", "goblin_war_camp/Shaman_01"]);
    expect(entries[0]!.clips).toEqual(["Cheer", "Idle"]);
    expect(entries[1]!.clips).toEqual(["Idle_Standing", "Walk_F"]);
    expect(defaultClip(entries[0]!)).toBe("Idle");
    expect(defaultClip(entries[1]!)).toBe("Idle_Standing");
  });

  test("filters by pack and name, and counts clips across the visible set", () => {
    const entries = buildCatalog(fakeAssets());
    expect(filterEntries(entries, "", new Set(["goblin_war_camp"])).length).toBe(2);
    expect(filterEntries(entries, "sham", new Set(["kaykit", "goblin_war_camp"])).map((e) => e.label)).toEqual(["Shaman 01"]);
    expect(clipCounts(entries).find((c) => c.name === "Idle_Standing")?.count).toBe(2);
  });

  test("lays a near-square grid out front row first", () => {
    const grid = gridLayout(7, 2, 3);
    expect(grid.length).toBe(7);
    expect(grid[0]).toEqual({ x: 0, z: 0 });
    expect(grid[4]).toEqual({ x: 0, z: 3 });
  });
});
