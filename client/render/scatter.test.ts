import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import * as THREE from "three";
import { KIT_URLS, type Kits } from "./models";
import { bakePiece, bakeScatter, SCATTER_PIECES, ScatterBatch } from "./scatter";

/** A nature kit the way GLTFLoader hands it over: one node per piece, meshes under it. */
function fakeKits(): Kits {
  const scene = new THREE.Group();
  for (const defs of Object.values(SCATTER_PIECES)) {
    for (const def of defs) {
      const node = new THREE.Object3D();
      node.name = def.node;
      // A unit box standing on the ground plane, the way Synty authors trunks.
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial({ color: 0xffffff }));
      mesh.position.y = 1;
      node.add(mesh);
      scene.add(node);
    }
  }
  // A piece whose node translation cancels an offset authored into the mesh.
  const offset = new THREE.Object3D();
  offset.name = "Offset_Rock";
  offset.position.set(-20, 0, -8);
  const offsetMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2).translate(20, 1, 8), new THREE.MeshStandardMaterial());
  offset.add(offsetMesh);
  scene.add(offset);
  return { viking_nature: { scene, animations: [] } as unknown as Kits["viking_nature"] };
}

describe("bakePiece", () => {
  test("bakes the mesh transform and the nominal scale into the geometry", () => {
    const parts = bakePiece(fakeKits(), { kit: "viking_nature", node: "Env_Tree_Pine_01", scale: 0.5 })!;
    expect(parts.length).toBe(1);
    parts[0]!.geometry.computeBoundingBox();
    const bb = parts[0]!.geometry.boundingBox!;
    expect(bb.min.y).toBeCloseTo(0);
    expect(bb.max.y).toBeCloseTo(1);
    expect(bb.max.x).toBeCloseTo(0.25);
  });

  test("keeps a node translation that centres an offset mesh", () => {
    const parts = bakePiece(fakeKits(), { kit: "viking_nature", node: "Offset_Rock", scale: 1 })!;
    parts[0]!.geometry.computeBoundingBox();
    const bb = parts[0]!.geometry.boundingBox!;
    expect(bb.min.x).toBeCloseTo(-1);
    expect(bb.max.x).toBeCloseTo(1);
    expect(bb.min.z).toBeCloseTo(-1);
  });

  test("is null when the kit or the node is missing", () => {
    expect(bakePiece({}, SCATTER_PIECES.pine[0]!)).toBeNull();
    expect(bakePiece(fakeKits(), { kit: "viking_nature", node: "Env_Nope", scale: 1 })).toBeNull();
  });
});

describe("bakeScatter", () => {
  test("bakes every variant of every kind, or nothing at all without the kit", () => {
    const baked = bakeScatter(fakeKits())!;
    expect(baked.pine.length).toBe(SCATTER_PIECES.pine.length);
    expect(baked.tuft.length).toBe(SCATTER_PIECES.tuft.length);
    expect(bakeScatter({})).toBeNull();
  });
});

describe("ScatterBatch", () => {
  test("groups instances per variant and chunk, tints by kind, shadows by kind", () => {
    const batch = new ScatterBatch(bakeScatter(fakeKits())!, { foliage: 0x80ff80, stone: 0x808080 }, 16);
    const m = new THREE.Matrix4();
    batch.add("pine", 0, m.makeTranslation(0.5, 0, 0.5), 0, 0);
    batch.add("pine", 0, m.makeTranslation(3.5, 0, 3.5), 3, 3);
    batch.add("pine", 0, m.makeTranslation(20.5, 0, 0.5), 20, 0);
    batch.add("rock", 1, m.makeTranslation(1.5, 0, 1.5), 1, 1);
    batch.add("tuft", 7, m.makeTranslation(1.5, 0, 1.5), 1, 1);
    const parent = new THREE.Group();
    const meshes = batch.build(parent);
    expect(meshes.length).toBe(4);
    const counts = meshes.map((mesh) => mesh.count).sort();
    expect(counts).toEqual([1, 1, 1, 2]);
    const pine = meshes.find((mesh) => mesh.count === 2)!;
    expect(pine.castShadow).toBe(true);
    expect((pine.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0x80ff80);
    expect(pine.boundingSphere!.radius).toBeGreaterThan(1);
    const rock = meshes.find((mesh) => (mesh.material as THREE.MeshStandardMaterial).color.getHex() === 0x808080)!;
    expect(rock.count).toBe(1);
    const tuft = meshes.find((mesh) => !mesh.castShadow)!;
    expect(tuft.count).toBe(1);
  });

  test("shares one tinted material across chunks of the same piece", () => {
    const batch = new ScatterBatch(bakeScatter(fakeKits())!, { foliage: 0xffffff, stone: 0xffffff }, 16);
    const m = new THREE.Matrix4();
    batch.add("pine", 0, m.identity(), 0, 0);
    batch.add("pine", 0, m.identity(), 40, 40);
    const meshes = batch.build(new THREE.Group());
    expect(meshes.length).toBe(2);
    expect(meshes[0]!.material).toBe(meshes[1]!.material);
  });
});

// Only meaningful where the converted kit exists; elsewhere the scene keeps its primitives.
const naturePath = `public${KIT_URLS.viking_nature}`;
describe.if(existsSync(naturePath))("scatter table matches the nature kit", () => {
  test("every scatter piece names a real kit node", () => {
    const buf = readFileSync(naturePath);
    const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString("utf8")) as { nodes: { name: string }[] };
    const names = new Set(json.nodes.map((n) => n.name));
    for (const defs of Object.values(SCATTER_PIECES)) {
      for (const def of defs) expect(names.has(def.node)).toBe(true);
    }
  });
});
