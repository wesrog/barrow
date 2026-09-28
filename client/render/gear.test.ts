import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import * as THREE from "three";
import {
  captureRestInverses,
  gripInto,
  heldModel,
  IN_PLACE_HEIGHT,
  measureAxis,
  uprightRotation,
  wearPiece,
  wornPlacement,
  type AuthoredAxis,
} from "./gear";
import { KIT_URLS, type Kits } from "./models";
import { MONSTER_LOOKS, WEAPON_KITS } from "./modelRigs";

/** A box with its pivot at one end, the way weapons are authored. */
function piece(name: string, size: [number, number, number], centre: [number, number, number]): THREE.Object3D {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size).translate(...centre), new THREE.MeshStandardMaterial());
  mesh.name = name;
  return mesh;
}

function fakeKits(): Kits {
  const weapons = new THREE.Group();
  weapons.add(
    piece("Wep_Sword_02", [0.04, 0.16, 1.6], [0, 0, 0.64]),
    piece("Wep_Axe_01", [0.09, 1.08, 0.31], [0, 0.3, 0.08]),
    piece("Wep_Staff_Down", [0.1, 2, 0.1], [0, -0.6, 0]),
    piece("Wep_Shield_Set_01", [0.7, 0.7, 0.1], [0, 0, 0.05]),
  );
  // A rigged attachment the way the kit ships it: mesh beside a copy of the rig.
  const fur = new THREE.Object3D();
  fur.name = "Attach_Fur_03";
  fur.add(piece("SM_Chr_Attach_Fur_03", [0.6, 0.3, 0.4], [0, 1.4, 0]));
  const furRoot = new THREE.Bone();
  furRoot.name = "Root";
  fur.add(furRoot);
  const attachments = new THREE.Group();
  attachments.add(
    piece("Attach_Helmet_01", [0.3, 0.4, 0.3], [0, 0.15, 0]),
    piece("Attach_Hat_07", [0.5, 0.7, 0.5], [0, 0.3, 0]),
    piece("Attach_Pouch_01", [0.15, 0.25, 0.15], [-0.13, 0.06, 0.12]),
    fur,
  );
  const gltf = (scene: THREE.Object3D) => ({ scene, animations: [] }) as unknown as Kits["viking_weapons"];
  return { viking_weapons: gltf(weapons), viking_attachments: gltf(attachments) };
}

describe("measureAxis and uprightRotation", () => {
  test("reads the long axis and its direction from the bounds", () => {
    const kits = fakeKits();
    expect(measureAxis(kits, "viking_weapons", "Wep_Sword_02")).toEqual({ axis: "z", sign: 1 });
    expect(measureAxis(kits, "viking_weapons", "Wep_Axe_01")).toEqual({ axis: "y", sign: 1 });
    expect(measureAxis(kits, "viking_weapons", "Wep_Staff_Down")).toEqual({ axis: "y", sign: -1 });
    expect(measureAxis(kits, "viking_weapons", "Wep_Nope")).toBeNull();
  });

  test("turns every authored axis onto +Y", () => {
    const cases: AuthoredAxis[] = [
      { axis: "x", sign: 1 }, { axis: "x", sign: -1 },
      { axis: "y", sign: 1 }, { axis: "y", sign: -1 },
      { axis: "z", sign: 1 }, { axis: "z", sign: -1 },
    ];
    for (const c of cases) {
      const v = new THREE.Vector3(c.axis === "x" ? c.sign : 0, c.axis === "y" ? c.sign : 0, c.axis === "z" ? c.sign : 0);
      v.applyEuler(uprightRotation(c));
      expect(v.x).toBeCloseTo(0);
      expect(v.y).toBeCloseTo(1);
      expect(v.z).toBeCloseTo(0);
    }
  });
});

describe("heldModel and gripInto", () => {
  test("wraps a weapon with its length up +Y and seats it with the grip", () => {
    const held = heldModel(fakeKits(), "viking_weapons", "Wep_Sword_02")!;
    const socket = new THREE.Object3D();
    gripInto(socket, { rotation: [Math.PI, 0, 0], position: [-0.1, 0, 0] }, held);
    socket.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(held);
    // Authored along +Z, upright puts the blade along +Y; the grip's half turn drops it to -Y in the socket.
    expect(box.min.y).toBeLessThan(-1.3);
    expect(Math.abs(box.max.z - box.min.z)).toBeLessThan(0.3);
    expect(held.position.x).toBeCloseTo(-0.1);
    expect(held.parent).toBe(socket);
  });

  test("gives shields the outward half turn instead", () => {
    const held = heldModel(fakeKits(), "viking_weapons", "Wep_Shield_Set_01")!;
    expect((held.children[0] as THREE.Object3D).rotation.y).toBeCloseTo(Math.PI);
    expect(heldModel(fakeKits(), "viking_weapons", "Wep_Nope")).toBeNull();
  });
});

describe("worn pieces", () => {
  test("classifies by name and authored height", () => {
    const kits = fakeKits();
    expect(wornPlacement(kits, "viking_attachments", "Attach_Helmet_01")).toEqual({ role: "head", frame: "bone", offset: [0, 0.02, 0] });
    expect(wornPlacement(kits, "viking_attachments", "Attach_Hat_07")).toEqual({ role: "head", frame: "bone", offset: [0, 0, 0] });
    expect(wornPlacement(kits, "viking_attachments", "Attach_Pouch_01")).toEqual({ role: "hips", frame: "bone", offset: [0, 0, 0] });
    expect(wornPlacement(kits, "viking_attachments", "Attach_Fur_03")).toEqual({ role: "chest", frame: "character", offset: [0, 0, 0] });
    expect(IN_PLACE_HEIGHT).toBeGreaterThan(1.0);
    expect(wornPlacement(kits, "viking_attachments", "Attach_Nope")).toBeNull();
  });

  test("bone-frame pieces sit at the bone plus offset; in-place pieces go through the rest frame", () => {
    const kits = fakeKits();
    const group = new THREE.Group();
    const hips = new THREE.Bone();
    hips.position.y = 0.9;
    const chest = new THREE.Bone();
    chest.position.y = 0.3;
    const head = new THREE.Bone();
    head.position.y = 0.4;
    group.add(hips);
    hips.add(chest);
    chest.add(head);
    const rest = captureRestInverses(group);
    // Pose the chest afterwards: worn pieces must not care.
    chest.rotation.z = 1;
    chest.position.y = 0.5;

    const helm = wearPiece(kits, "viking_attachments", "Attach_Helmet_01", wornPlacement(kits, "viking_attachments", "Attach_Helmet_01")!, head, rest.get(head))!;
    expect(helm.length).toBe(1);
    expect(helm[0]!.parent).toBe(head);
    expect(helm[0]!.position.y).toBeCloseTo(0.02);

    const fur = wearPiece(kits, "viking_attachments", "Attach_Fur_03", wornPlacement(kits, "viking_attachments", "Attach_Fur_03")!, chest, rest.get(chest))!;
    expect(fur.length).toBe(1);
    expect(fur[0]!.name).toBe("SM_Chr_Attach_Fur_03");
    // The fur's 1.4 sits in its geometry, so the rest frame (chest at 1.2)
    // drops the clone by 1.2 and the mesh renders 0.2 above the bone.
    expect(fur[0]!.position.y).toBeCloseTo(-1.2);
    expect(fur[0]!.quaternion.w).toBeCloseTo(1);
    chest.rotation.z = 0;
    chest.position.y = 0.3;
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(fur[0]!);
    expect((box.min.y + box.max.y) / 2).toBeCloseTo(1.4);

    expect(wearPiece(kits, "viking_attachments", "Attach_Fur_03", { role: "chest", frame: "character", offset: [0, 0, 0] }, chest, undefined)).toBeNull();
  });
});

/**
 * Bounds of a kit node straight from the GLB's JSON chunk (accessor min/max
 * shifted by node translations), so the real kits can be checked without a
 * browser. Null when the kit is not on this machine.
 */
function glbAxis(kit: keyof typeof KIT_URLS, node: string): AuthoredAxis | null {
  const path = `public${KIT_URLS[kit]}`;
  if (!existsSync(path)) return null;
  const buf = readFileSync(path);
  const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString("utf8")) as {
    nodes: { name: string; mesh?: number; translation?: number[]; children?: number[] }[];
    meshes: { primitives: { attributes: { POSITION: number } }[] }[];
    accessors: { min: number[]; max: number[] }[];
  };
  const index = json.nodes.findIndex((n) => n.name === node);
  if (index < 0) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const visit = (i: number, off: number[]) => {
    const n = json.nodes[i]!;
    const t = n.translation ? off.map((v, k) => v + n.translation![k]!) : off;
    if (n.mesh !== undefined) {
      for (const p of json.meshes[n.mesh]!.primitives) {
        const acc = json.accessors[p.attributes.POSITION]!;
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k]!, acc.min[k]! + t[k]!);
          max[k] = Math.max(max[k]!, acc.max[k]! + t[k]!);
        }
      }
    }
    for (const c of n.children ?? []) visit(c, t);
  };
  visit(index, [0, 0, 0]);
  const size = [0, 1, 2].map((k) => max[k]! - min[k]!);
  const centre = [0, 1, 2].map((k) => (max[k]! + min[k]!) / 2);
  const a = size[0]! >= size[1]! && size[0]! >= size[2]! ? 0 : size[1]! >= size[2]! ? 1 : 2;
  return { axis: (["x", "y", "z"] as const)[a]!, sign: centre[a]! >= 0 ? 1 : -1 };
}

// Only where the converted kits exist. Monster weapons were verified by eye
// attached raw, so the measured axis must be +Y or heldModel would turn them.
describe.if(existsSync(`public${KIT_URLS.viking_weapons}`))("weapon axes in the real kits", () => {
  test("every monster look's weapon is authored along +Y", () => {
    for (const looks of Object.values(MONSTER_LOOKS)) {
      const look = looks.synty;
      if (!look?.weapon) continue;
      expect(glbAxis(WEAPON_KITS[look.rig], look.weapon)).toEqual({ axis: "y", sign: 1 });
    }
  });

  test("Viking swords and knives lie along +Z, axes and hammers along +Y", () => {
    expect(glbAxis("viking_weapons", "Wep_Sword_02")).toEqual({ axis: "z", sign: 1 });
    expect(glbAxis("viking_weapons", "Wep_Knife_01")).toEqual({ axis: "z", sign: 1 });
    expect(glbAxis("viking_weapons", "Wep_Axe_01")).toEqual({ axis: "y", sign: 1 });
    expect(glbAxis("viking_weapons", "Wep_Hammer_01")).toEqual({ axis: "y", sign: 1 });
  });
});
