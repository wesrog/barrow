import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { instantiateKit, type Kits } from "./models";
import { SYNTY_GOBLIN_RIG } from "./rigSpec";

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
    const inst = instantiateKit(fakeKits(), "goblin_characters", "Warrior_Male_01", ["goblin_clips"], SYNTY_GOBLIN_RIG)!;
    expect(inst).toBeTruthy();
    expect(inst.group.getObjectByName("Hips")).toBeTruthy();
    expect(inst.group.getObjectByName("Spine_01")).toBeTruthy();
    expect(inst.group.getObjectByName("Root")).toBeTruthy();
    expect(inst.handSlotR?.name).toBe("Hand_R");
    expect(inst.actions.has("Walk_F")).toBe(true);
  });

  test("drops clip tracks for bones the character lacks", () => {
    const kits = fakeKits();
    const clip = kits.goblin_clips!.animations[0]!;
    clip.tracks.push(new THREE.QuaternionKeyframeTrack("Toes_L.quaternion", [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]));
    const inst = instantiateKit(kits, "goblin_characters", "Warrior_Male_01", ["goblin_clips"], SYNTY_GOBLIN_RIG)!;
    const fitted = inst.actions.get("Walk_F")!.getClip();
    expect(fitted.tracks.length).toBe(clip.tracks.length - 1);
    expect(fitted.tracks.some((t) => t.name.startsWith("Toes_L"))).toBe(false);
    expect(fitted.duration).toBe(clip.duration);
  });

  test("leaves the shared kit source untouched and returns null for a missing kit", () => {
    const kits = fakeKits();
    instantiateKit(kits, "goblin_characters", "Warrior_Male_01", ["goblin_clips"], SYNTY_GOBLIN_RIG);
    expect(kits.goblin_characters!.scene.getObjectByName("Hips_15")).toBeTruthy();
    expect(instantiateKit(kits, "viking_characters", "Peasant_Male_01", ["goblin_clips"], SYNTY_GOBLIN_RIG)).toBeNull();
    expect(instantiateKit(kits, "goblin_characters", "Nobody", ["goblin_clips"], SYNTY_GOBLIN_RIG)).toBeNull();
    expect(instantiateKit(kits, "goblin_characters", "Warrior_Male_01", ["goblin_kaykit_clips"], SYNTY_GOBLIN_RIG)).toBeNull();
  });
});

import { makeHeroModelRig } from "./modelRigs";
import type { GameAssets } from "./models";
import type { Item } from "../../sim/items/generate";

/** A Viking character kit plus weapon and attachment kits, shaped like the loader output. */
function fakeHeroAssets(): GameAssets {
  const character = new THREE.Object3D();
  character.name = "Warrior_Male_01";
  const bones: Record<string, THREE.Bone> = {};
  for (const name of ["Root", "Hips", "Spine_02", "Head", "Shoulder_L", "Shoulder_R", "LowerLeg_L", "LowerLeg_R", "Hand_L", "Hand_R"]) {
    bones[name] = new THREE.Bone();
    bones[name]!.name = `${name}_3`;
  }
  bones.Root!.add(bones.Hips!);
  // A rest pose with height, so the chest frame is not the identity.
  bones.Hips!.position.y = 0.9;
  bones.Spine_02!.position.y = 0.3;
  bones.Hips!.add(bones.Spine_02!, bones.LowerLeg_L!, bones.LowerLeg_R!);
  bones.Spine_02!.add(bones.Head!, bones.Shoulder_L!, bones.Shoulder_R!);
  bones.Shoulder_L!.add(bones.Hand_L!);
  bones.Shoulder_R!.add(bones.Hand_R!);
  const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  mesh.add(bones.Root!);
  mesh.bind(new THREE.Skeleton(Object.values(bones)));
  character.add(mesh);
  const characters = new THREE.Group();
  characters.add(character);

  const clips = Object.keys(bones).map(
    (name) => new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
  );
  const named = (name: string) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 0.1), new THREE.MeshStandardMaterial());
    o.name = name;
    return o;
  };
  const weapons = new THREE.Group();
  weapons.add(named("Wep_Sword_02"), named("Wep_Shield_Set_02"), named("Wep_Hammer_01"));
  const attachments = new THREE.Group();
  attachments.add(named("Attach_Helmet_01"));
  // A fur mantle the way the kit ships it: the mesh authored in place over the
  // T-posed shoulders, beside a copy of the rig.
  const fur = new THREE.Object3D();
  fur.name = "Attach_Fur_03";
  const furMesh = named("SM_Chr_Attach_Fur_03");
  furMesh.position.y = 1.4;
  const furRoot = new THREE.Bone();
  furRoot.name = "Root";
  fur.add(furMesh, furRoot);
  attachments.add(fur);
  const gltf = (scene: THREE.Object3D, animations: THREE.AnimationClip[] = []) =>
    ({ scene, animations }) as unknown as GameAssets["kits"]["viking_characters"];
  return {
    dungeon: {} as GameAssets["dungeon"],
    kits: {
      viking_characters: gltf(characters),
      viking_weapons: gltf(weapons),
      viking_attachments: gltf(attachments),
      goblin_clips: gltf(new THREE.Group(), [new THREE.AnimationClip("Idle_Standing", 1, clips), new THREE.AnimationClip("Run_F", 1, clips)]),
    },
  };
}

function gearItem(baseId: string, rarity: Item["rarity"] = "normal"): Item {
  return { baseId, rarity, name: baseId, affixIds: [], mods: [], ilvl: 1 };
}

const BARE = { weapon: null, shield: null, helm: null, chest: null, boots: null, amulet: null, ring1: null, ring2: null };

describe("Synty hero", () => {
  test("dresses a Viking from the kits and undresses cleanly", () => {
    const hero = makeHeroModelRig(fakeHeroAssets(), "warrior");
    expect(hero.family).toBe("synty");
    // Only the goblin pack's clips exist in this fake, so idle falls back to its standing idle.
    expect(hero.currentClip()).toBe("Idle_Standing");
    hero.setEquipment({ ...BARE, weapon: gearItem("rusted_blade", "rare"), shield: gearItem("plank_buckler"), helm: gearItem("iron_barbute"), chest: gearItem("grave_plate"), boots: gearItem("worn_boots") });
    expect(hero.group.getObjectByName("Hand_R")!.getObjectByName("Wep_Sword_02")).toBeTruthy();
    expect(hero.group.getObjectByName("Hand_L")!.getObjectByName("Wep_Shield_Set_02")).toBeTruthy();
    expect(hero.group.getObjectByName("Head")!.getObjectByName("Attach_Helmet_01")).toBeTruthy();
    // The grave plate wears a fur mantle from the attachments kit, hung on the
    // chest bone in its rest frame (chest rests at 1.2, the fur at 1.4), and
    // no box pauldrons; the plate box stays.
    const chest = hero.group.getObjectByName("Spine_02")!;
    const mantle = chest.getObjectByName("SM_Chr_Attach_Fur_03") as THREE.Mesh;
    expect(mantle).toBeTruthy();
    expect(mantle.position.y).toBeCloseTo(0.2);
    expect(chest.children.filter((c) => c instanceof THREE.Mesh).length).toBe(2);
    expect(hero.group.getObjectByName("Shoulder_L")!.children.filter((c) => c instanceof THREE.Mesh).length).toBe(0);
    expect(hero.attackClip()).toBe("attack1h");

    hero.setEquipment({ ...BARE, weapon: gearItem("war_maul"), shield: gearItem("plank_buckler") });
    expect(hero.attackClip()).toBe("attack2h");
    // A two-hander hides the shield even though the slot still holds one.
    expect(hero.group.getObjectByName("Hand_L")!.getObjectByName("Wep_Shield_Set_02")).toBeFalsy();
    expect(hero.group.getObjectByName("Head")!.getObjectByName("Attach_Helmet_01")).toBeFalsy();

    hero.setEquipment(BARE);
    expect(hero.group.getObjectByName("Hand_R")!.children.length).toBe(0);
  });

  test("hangs a mantle in the rest frame even while the chest bone is posed", () => {
    const hero = makeHeroModelRig(fakeHeroAssets(), "warrior");
    const chest = hero.group.getObjectByName("Spine_02")!;
    chest.rotation.z = Math.PI / 2;
    chest.position.y = 0.6;
    hero.group.updateMatrixWorld(true);
    hero.setEquipment({ ...BARE, chest: gearItem("grave_plate") });
    const mantle = chest.getObjectByName("SM_Chr_Attach_Fur_03")!;
    expect(mantle.position.y).toBeCloseTo(0.2);
    expect(mantle.quaternion.w).toBeCloseTo(1);
  });

  test("keeps box pauldrons for chests without a mantle in the kit", () => {
    const hero = makeHeroModelRig(fakeHeroAssets(), "warrior");
    hero.setEquipment({ ...BARE, chest: gearItem("lamellar_coat") });
    expect(hero.group.getObjectByName("Shoulder_L")!.children.filter((c) => c instanceof THREE.Mesh).length).toBe(1);
    hero.setEquipment({ ...BARE, chest: gearItem("rag_tunic") });
    expect(hero.group.getObjectByName("Shoulder_L")!.children.filter((c) => c instanceof THREE.Mesh).length).toBe(0);
    expect(hero.group.getObjectByName("Spine_02")!.children.filter((c) => c instanceof THREE.Mesh).length).toBe(1);
  });

  test("prefers the retargeted KayKit idle when that kit is present", () => {
    const assets = fakeHeroAssets();
    const tracks = ["Root", "Hips", "Head"].map((n) => new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]));
    assets.kits.goblin_kaykit_clips = { scene: new THREE.Group(), animations: [new THREE.AnimationClip("Idle", 1, tracks)] } as unknown as GameAssets["kits"]["goblin_kaykit_clips"];
    const hero = makeHeroModelRig(assets, "warrior");
    expect(hero.currentClip()).toBe("Idle");
    expect(hero.clipNames()).toContain("Run_F");
  });

  test("says which kit is missing instead of drawing nothing", () => {
    const assets = fakeHeroAssets();
    assets.kits = {};
    expect(() => makeHeroModelRig(assets, "witch")).toThrow(/viking_characters/);
  });
});
