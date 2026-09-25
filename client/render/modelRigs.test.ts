import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { makeMonsterModelRig, MONSTER_LOOKS } from "./modelRigs";
import type { GameAssets } from "./models";

/** A Dungeon Pack kit the way the loader hands it over: one rigged skeleton, a sword kit, a clip kit. */
function fakeAssets(): GameAssets {
  const character = new THREE.Object3D();
  character.name = "Skeleton_Slave_01";
  const bones: Record<string, THREE.Bone> = {};
  for (const name of ["root", "pelvis", "spine_02", "head", "hand_r", "hand_l"]) {
    bones[name] = new THREE.Bone();
    bones[name]!.name = name;
  }
  bones.root!.add(bones.pelvis!);
  bones.pelvis!.add(bones.spine_02!);
  bones.spine_02!.add(bones.head!, bones.hand_r!, bones.hand_l!);
  const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  mesh.add(bones.root!);
  mesh.bind(new THREE.Skeleton(Object.values(bones)));
  character.add(mesh);
  const characters = new THREE.Group();
  characters.add(character);

  const sword = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 0.1).translate(0, 0.4, 0), new THREE.MeshStandardMaterial({ color: 0x888888 }));
  sword.name = "Wep_BrokenSword_01";
  const weapons = new THREE.Group();
  weapons.add(sword);

  const clip = new THREE.AnimationClip("Idle", 1, [new THREE.QuaternionKeyframeTrack("pelvis.quaternion", [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])]);
  const gltf = (scene: THREE.Object3D, animations: THREE.AnimationClip[] = []) =>
    ({ scene, animations }) as unknown as GameAssets["kits"]["dungeon_characters"];
  return {
    dungeon: {} as GameAssets["dungeon"],
    kits: {
      dungeon_characters: gltf(characters),
      dungeon_weapons: gltf(weapons),
      dungeon_kaykit_clips: gltf(new THREE.Group(), [clip]),
    },
  };
}

function weaponMaterials(group: THREE.Object3D): THREE.Material[] {
  const hand = group.getObjectByName("hand_r")!;
  const mats: THREE.Material[] = [];
  hand.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.material instanceof THREE.Material) mats.push(obj.material);
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
    for (const mat of matsA) expect(matsB).not.toContain(mat);
  });

  test("scales the model to the type's look and names the missing kit otherwise", () => {
    const rig = makeMonsterModelRig(fakeAssets(), "shambler");
    expect(rig.group.scale.x).toBeCloseTo(MONSTER_LOOKS.shambler!.scale);
    expect(() => makeMonsterModelRig({ dungeon: {} as GameAssets["dungeon"], kits: {} }, "shambler")).toThrow(/dungeon_characters/);
  });

  test("types without a look keep their procedural rig", () => {
    const rig = makeMonsterModelRig(fakeAssets(), "tomb_bloat");
    expect(rig.group).toBeTruthy();
    expect(MONSTER_LOOKS.tomb_bloat).toBeUndefined();
  });
});
