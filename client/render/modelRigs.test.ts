import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { makeHeroModelRig, makeMonsterModelRig } from "./modelRigs";
import type { GameAssets } from "./models";
import type { Item } from "../../sim/items/generate";

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

/** Barbarian-shaped fake: the round shield prop ships as a child of handslot.l,
 * exactly as in the real GLB. */
function fakeBarbarianAssets(): GameAssets {
  const scene = new THREE.Group();
  const slotL = new THREE.Object3D();
  slotL.name = "handslotl";
  const shield = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.5, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x996633 }),
  );
  shield.name = "Barbarian_Round_Shield";
  slotL.add(shield);
  const slotR = new THREE.Object3D();
  slotR.name = "handslotr";
  scene.add(slotL, slotR);
  const gltf = { scene, animations: [] } as unknown as GameAssets["characters"]["barbarian"];
  return {
    characters: { barbarian: gltf } as GameAssets["characters"],
    weapons: {} as GameAssets["weapons"],
    dungeon: {} as GameAssets["dungeon"],
  };
}

function item(baseId: string, name: string): Item {
  return { baseId, rarity: "normal", name, affixIds: [], mods: [], ilvl: 1 };
}

describe("makeHeroModelRig shield slot", () => {
  test("equipping a shield keeps the round-shield prop attached and visible", () => {
    const hero = makeHeroModelRig(fakeBarbarianAssets());
    const eq = {
      weapon: null,
      shield: item("plank_buckler", "Plank Buckler"),
      helm: null,
      chest: null,
      boots: null,
      amulet: null,
      ring1: null,
      ring2: null,
    };
    hero.setEquipment(eq);
    const shield = hero.group.getObjectByName("Barbarian_Round_Shield");
    expect(shield).toBeTruthy();
    expect(shield!.visible).toBe(true);
  });

  test("unequipping the shield hides the prop without detaching it", () => {
    const hero = makeHeroModelRig(fakeBarbarianAssets());
    const bare = {
      weapon: null,
      shield: null,
      helm: null,
      chest: null,
      boots: null,
      amulet: null,
      ring1: null,
      ring2: null,
    };
    hero.setEquipment({ ...bare, shield: item("plank_buckler", "Plank Buckler") });
    hero.setEquipment(bare);
    const shield = hero.group.getObjectByName("Barbarian_Round_Shield");
    expect(shield).toBeTruthy();
    expect(shield!.visible).toBe(false);
  });
});

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
