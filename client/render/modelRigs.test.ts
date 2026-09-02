import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { makeMonsterModelRig } from "./modelRigs";
import type { GameAssets } from "./models";

/** Minimal fake assets: one rigged-ish character with a hand slot, one weapon. */
function fakeAssets(): GameAssets {
  const scene = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xdddddd }),
  );
  // GLTFLoader would strip the "." from the authored "handslot.r".
  const slot = new THREE.Object3D();
  slot.name = "handslotr";
  scene.add(body, slot);
  const gltf = { scene, animations: [] } as unknown as GameAssets["characters"]["skeleton_warrior"];

  const blade = new THREE.Group();
  blade.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 1, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x888888 }),
    ),
  );

  return {
    characters: { skeleton_warrior: gltf } as GameAssets["characters"],
    weapons: { skeleton_blade: blade } as GameAssets["weapons"],
    dungeon: {} as GameAssets["dungeon"],
  };
}

function weaponMaterials(group: THREE.Object3D): THREE.Material[] {
  const slot = group.getObjectByName("handslotr")!;
  const mats: THREE.Material[] = [];
  slot.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.material instanceof THREE.Material) {
      mats.push(obj.material);
    }
  });
  return mats;
}

describe("makeMonsterModelRig", () => {
  test("two monsters of the same type don't share weapon materials (hit flash must not leak)", () => {
    const assets = fakeAssets();
    const a = makeMonsterModelRig(assets, "shambler");
    const b = makeMonsterModelRig(assets, "shambler");
    const matsA = weaponMaterials(a.group);
    const matsB = weaponMaterials(b.group);
    expect(matsA.length).toBeGreaterThan(0);
    for (const mat of matsA) {
      expect(matsB).not.toContain(mat);
    }
  });
});
