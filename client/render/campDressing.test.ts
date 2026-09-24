import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import * as THREE from "three";
import { CAMP_DRESSING, HUT_WALLS, againstWall, dressCamp, dressHuts, dressMarkers, type DressingRow } from "./campDressing";
import { KIT_URLS, type Kits } from "./models";

function fakeKits(): Kits {
  const scene = new THREE.Group();
  for (const row of CAMP_DRESSING) {
    if (scene.getObjectByName(row.node)) continue;
    const node = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    node.name = row.node;
    scene.add(node);
  }
  return { viking_props: { scene, animations: [] } as unknown as Kits["viking_props"] };
}

describe("dressCamp", () => {
  test("places every row of each marker it knows, offset from the marker", () => {
    const placed: { name: string; x: number; z: number }[] = [];
    const markers = [
      { ch: "F", x: 7.5, y: 30.5 },
      { ch: "V", x: 4.5, y: 29.5 },
      { ch: ">", x: 58.5, y: 56.5 },
    ];
    const dressed = dressCamp(fakeKits(), markers, (node, x, z) => placed.push({ name: node.name, x, z }));
    expect([...dressed].sort()).toEqual(["F", "V"]);
    const rows = CAMP_DRESSING.filter((r) => r.marker === "F" || r.marker === "V");
    expect(placed.length).toBe(rows.length);
    const pit = placed.find((p) => p.name === "Prop_Fire_Pit_02")!;
    expect(pit.x).toBeCloseTo(7.5);
    expect(pit.z).toBeCloseTo(30.5);
    const awning = placed.find((p) => p.name === "Prop_Awning_01")!;
    expect(awning.x).toBeLessThan(4.5);
  });

  test("dresses nothing without the props kit", () => {
    let calls = 0;
    const dressed = dressCamp({}, [{ ch: "F", x: 1, y: 1 }], () => calls++);
    expect(dressed.size).toBe(0);
    expect(calls).toBe(0);
  });
});

describe("dressMarkers", () => {
  const rows: DressingRow[] = [
    { marker: "K", kit: "viking_props", node: "Prop_Awning_01", dx: 0, dz: 0, ry: 0, scale: 0.4, wall: true },
    { marker: "K", kit: "viking_props", node: "Prop_Fire_Pit_02", dx: 0, dz: 0, ry: 0, scale: 0.4, wall: true, flat: true, along: 2 },
    { marker: "K", kit: "viking_props", node: "Prop_Awning_01", dx: 1, dz: 0, ry: 0, scale: 0.4 },
  ];

  test("wall rows sit just inside the nearest wall face, turned into the room", () => {
    const placed: { name: string; x: number; z: number; ry: number }[] = [];
    // The wall is three cells north of the marker (y decreasing).
    const north = () => ({ dx: 0, dy: -1, dist: 3 });
    dressMarkers(fakeKits(), [{ ch: "K", x: 10.5, y: 20.5 }], rows, (node, x, z, ry) => placed.push({ name: node.name, x, z, ry }), north);
    expect(placed.length).toBe(3);
    const throne = placed[0]!;
    expect(throne.x).toBeCloseTo(10.5);
    expect(throne.z).toBeCloseTo(20.5 - 3 + 0.5 + 0.22); // its own depth off the face at z = 18
    expect(throne.ry).toBeCloseTo(0); // front (+z) faces back into the room
    const hanging = placed[1]!;
    expect(hanging.z).toBeCloseTo(20.5 - 3 + 0.5 + 0.04); // flat on the face
    expect(hanging.x).toBeCloseTo(10.5 + 2); // `along` runs sideways along the wall
    expect(placed[2]!.x).toBeCloseTo(11.5); // plain rows still offset from the marker
  });

  test("wall rows are skipped when no wall is in reach", () => {
    const placed: string[] = [];
    dressMarkers(fakeKits(), [{ ch: "K", x: 10.5, y: 20.5 }], rows, (node) => placed.push(node.name), () => null);
    expect(placed).toEqual(["Prop_Awning_01"]);
  });

  test("againstWall faces each wall direction into the room", () => {
    expect(againstWall({ dx: 1, dy: 0, dist: 1 }, 0.5, 0.5).ry).toBeCloseTo(-Math.PI / 2);
    expect(Math.abs(againstWall({ dx: 0, dy: 1, dist: 1 }, 0.5, 0.5).ry)).toBeCloseTo(Math.PI);
    expect(againstWall({ dx: -1, dy: 0, dist: 1 }, 0.5, 0.5).x).toBeCloseTo(0.5 - 0.28);
  });
});

describe("dressHuts", () => {
  const structures = () => {
    const scene = new THREE.Group();
    for (const name of [HUT_WALLS.wall, HUT_WALLS.post]) {
      const node = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
      node.name = name;
      scene.add(node);
    }
    return { viking_structures: { scene, animations: [] } as unknown as Kits["viking_structures"] };
  };

  test("walls every solid ring cell, posts the corners, leaves the doorway open", () => {
    const placed: { name: string; x: number; z: number; ry: number; offset?: readonly number[] }[] = [];
    // The doorway sits south of home, as the carver leaves it when the gate lies that way.
    const door = { x: 42, y: 24 };
    const walled = dressHuts(structures(), [{ x: 42.5, y: 22.5 }], (x, y) => x === door.x && y === door.y, (node, x, z, ry, _s, opts) =>
      placed.push({ name: node.name, x, z, ry, offset: opts?.offset }),
    );
    expect(walled.size).toBe(15);
    expect(walled.has("42,24")).toBe(false);
    expect(placed.filter((p) => p.name === HUT_WALLS.post).length).toBe(4);
    const walls = placed.filter((p) => p.name === HUT_WALLS.wall);
    expect(walls.length).toBe(11);
    const north = walls.find((p) => p.z === 20.5 && p.x === 42.5)!;
    expect(north.ry).toBe(0);
    expect(north.offset).toEqual(HUT_WALLS.wallOffset);
    const east = walls.find((p) => p.x === 44.5 && p.z === 22.5)!;
    expect(east.ry).toBeCloseTo(Math.PI / 2);
  });

  test("raises nothing without the structures kit", () => {
    let calls = 0;
    expect(dressHuts({}, [{ x: 1.5, y: 1.5 }], () => false, () => calls++).size).toBe(0);
    expect(calls).toBe(0);
  });
});

// Only meaningful where the converted kit exists.
const propsPath = `public${KIT_URLS.viking_props}`;
describe.if(existsSync(propsPath))("camp dressing matches the props kit", () => {
  test("every row names a real kit node", () => {
    const buf = readFileSync(propsPath);
    const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString("utf8")) as { nodes: { name: string }[] };
    const names = new Set(json.nodes.map((n) => n.name));
    for (const row of CAMP_DRESSING) expect(names.has(row.node)).toBe(true);
  });
});

const structuresPath = `public${KIT_URLS.viking_structures}`;
describe.if(existsSync(structuresPath))("hut walls match the structures kit", () => {
  test("wall and post name real kit nodes", () => {
    const buf = readFileSync(structuresPath);
    const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString("utf8")) as { nodes: { name: string }[] };
    const names = new Set(json.nodes.map((n) => n.name));
    expect(names.has(HUT_WALLS.wall)).toBe(true);
    expect(names.has(HUT_WALLS.post)).toBe(true);
  });
});
