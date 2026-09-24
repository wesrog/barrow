import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import * as THREE from "three";
import { CAMP_DRESSING, dressCamp } from "./campDressing";
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
