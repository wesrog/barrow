import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { instantiateKit, type Kits } from "./models";
import { SYNTY_RIG } from "./rigSpec";

/** A kit the way GLTFLoader hands it over: bone names made unique with _N suffixes. */
function fakeKits(): Kits {
  const character = new THREE.Object3D();
  character.name = "Warrior_Male_01";
  const root = new THREE.Bone();
  root.name = "Root_15";
  const hips = new THREE.Bone();
  hips.name = "Hips_15";
  const spine = new THREE.Bone();
  spine.name = "Spine_01_15";
  const handR = new THREE.Bone();
  handR.name = "Hand_R_15";
  root.add(hips);
  hips.add(spine);
  spine.add(handR);
  const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  mesh.name = "SM_Chr_Warrior_Male_01";
  mesh.add(root);
  mesh.bind(new THREE.Skeleton([root, hips, spine, handR]));
  character.add(mesh);
  const characters = new THREE.Group();
  characters.add(character);

  const clip = new THREE.AnimationClip("Walk_F", 1, [
    new THREE.QuaternionKeyframeTrack("Root.quaternion", [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
    new THREE.VectorKeyframeTrack("Hips.position", [0, 1], [0, 0.8, 0, 0, 0.9, 0]),
    new THREE.QuaternionKeyframeTrack("Spine_01.quaternion", [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
    new THREE.QuaternionKeyframeTrack("Hand_R.quaternion", [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
  ]);
  const clipRig = new THREE.Group();
  clipRig.name = "Rig";
  return {
    goblin_characters: { scene: characters, animations: [] } as unknown as Kits["goblin_characters"],
    goblin_clips: { scene: clipRig, animations: [clip] } as unknown as Kits["goblin_clips"],
  };
}

describe("instantiateKit", () => {
  test("restores the bone names the clips address and finds the hand socket", () => {
    const inst = instantiateKit(fakeKits(), "goblin_characters", "Warrior_Male_01", "goblin_clips", SYNTY_RIG)!;
    expect(inst).toBeTruthy();
    expect(inst.group.getObjectByName("Hips")).toBeTruthy();
    expect(inst.group.getObjectByName("Spine_01")).toBeTruthy();
    expect(inst.group.getObjectByName("Root")).toBeTruthy();
    expect(inst.handSlotR?.name).toBe("Hand_R");
    expect(inst.actions.has("Walk_F")).toBe(true);
  });

  test("leaves the shared kit source untouched and returns null for a missing kit", () => {
    const kits = fakeKits();
    instantiateKit(kits, "goblin_characters", "Warrior_Male_01", "goblin_clips", SYNTY_RIG);
    expect(kits.goblin_characters!.scene.getObjectByName("Hips_15")).toBeTruthy();
    expect(instantiateKit(kits, "viking_characters", "Peasant_Male_01", "goblin_clips", SYNTY_RIG)).toBeNull();
    expect(instantiateKit(kits, "goblin_characters", "Nobody", "goblin_clips", SYNTY_RIG)).toBeNull();
  });
});
