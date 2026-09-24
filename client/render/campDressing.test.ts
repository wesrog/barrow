import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import * as THREE from "three";
import { CAMP_DRESSING, DOOR_WALL, HUT_WALLS, PALISADE, againstWall, dressBuildings, dressCamp, dressHuts, dressMarkers, dressPalisade, type DressingRow } from "./campDressing";
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
    for (const name of [HUT_WALLS.wall, HUT_WALLS.post, HUT_WALLS.half]) {
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
    // Two half walls per corner, each running from the post toward the ring's next edge.
    const halves = placed.filter((p) => p.name === HUT_WALLS.half);
    expect(halves.length).toBe(8);
    const nw = halves.filter((p) => p.x === 40.5 && p.z === 20.5).map((p) => p.ry).sort();
    expect(nw).toEqual([-Math.PI / 2, 0]); // east along +x, south along +z
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

describe("dressBuildings", () => {
  const kits = (): Kits => {
    const scene = new THREE.Group();
    for (const name of [HUT_WALLS.wall, HUT_WALLS.post, HUT_WALLS.half, DOOR_WALL]) {
      const node = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
      node.name = name;
      scene.add(node);
    }
    return { viking_structures: { scene, animations: [] } as unknown as Kits["viking_structures"] };
  };

  test("posts on the corners, walls along the edges, the door wall on the door cell", () => {
    const hall = { ch: "J", x0: 13, y0: 25, x1: 19, y1: 29, door: [16, 29] as const };
    const placed: { name: string; x: number; z: number; ry: number }[] = [];
    const walled = dressBuildings(kits(), [hall], (node, x, z, ry) => placed.push({ name: node.name, x, z, ry }));
    expect(walled.size).toBe(7 * 2 + 3 * 2);
    expect(placed.filter((p) => p.name === HUT_WALLS.post).length).toBe(4);
    expect(placed.filter((p) => p.name === HUT_WALLS.half).length).toBe(8);
    const se = placed.filter((p) => p.name === HUT_WALLS.half && p.x === 19.5 && p.z === 29.5).map((p) => p.ry).sort();
    expect(se).toEqual([Math.PI / 2, Math.PI]); // north along -z, west along -x
    expect(placed.filter((p) => p.name === HUT_WALLS.wall).length).toBe(20 - 4 - 1);
    const door = placed.find((p) => p.name === DOOR_WALL)!;
    expect(door.x).toBe(16.5);
    expect(door.z).toBe(29.5);
    expect(door.ry).toBe(0);
    expect(placed.find((p) => p.x === 13.5 && p.z === 27.5)!.ry).toBeCloseTo(Math.PI / 2);
  });

  test("raises nothing without the structures kit", () => {
    let calls = 0;
    expect(dressBuildings({}, [{ ch: "J", x0: 0, y0: 0, x1: 4, y1: 4, door: [2, 4] }], () => calls++).size).toBe(0);
    expect(calls).toBe(0);
  });
});

describe("dressPalisade", () => {
  const kits = (): Kits => {
    const structures = new THREE.Group();
    for (const name of [HUT_WALLS.wall, HUT_WALLS.post, HUT_WALLS.half]) {
      const node = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
      node.name = name;
      structures.add(node);
    }
    const props = new THREE.Group();
    for (const name of [PALISADE.torch, PALISADE.flag, PALISADE.sign, PALISADE.beacon]) {
      const node = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
      node.name = name;
      props.add(node);
    }
    return {
      viking_structures: { scene: structures, animations: [] } as unknown as Kits["viking_structures"],
      viking_props: { scene: props, animations: [] } as unknown as Kits["viking_props"],
    };
  };

  test("walls the ring, posts and flags the corners, torches the gate, and lights a beacon outside", () => {
    // A 4x3 camp with its gate (three open ring cells) in the east wall.
    const camp = { x0: 2, y0: 2, x1: 6, y1: 5 };
    const gate = new Set(["6,2", "6,3", "6,4"]);
    const placed: { name: string; x: number; z: number; ry: number; opts?: { y?: number; flame?: unknown } }[] = [];
    const walled = dressPalisade(kits(), [camp], (x, y) => gate.has(`${x},${y}`), (node, x, z, ry, _s, opts) =>
      placed.push({ name: node.name, x, z, ry, opts }),
    );
    // Ring: 6 x 5 cells minus the three gate cells.
    expect(walled.size).toBe(6 * 2 + 3 * 2 - 3);
    expect(walled.has("6,3")).toBe(false);
    expect(placed.filter((p) => p.name === HUT_WALLS.post).length).toBe(4);
    expect(placed.filter((p) => p.name === PALISADE.flag).length).toBe(4);
    const walls = placed.filter((p) => p.name === HUT_WALLS.wall);
    expect(walls.length).toBe(walled.size - 4);
    expect(walls.find((p) => p.x === 3.5 && p.z === 1.5)!.ry).toBe(0);
    expect(walls.find((p) => p.x === 1.5 && p.z === 3.5)!.ry).toBeCloseTo(Math.PI / 2);
    // Torches on the two corner posts that flank the gate, lit.
    const torches = placed.filter((p) => p.name === PALISADE.torch);
    expect(torches.length).toBe(2);
    for (const t of torches) {
      expect(t.x).toBeGreaterThan(6.5);
      expect(t.opts?.flame).toBeDefined();
    }
    // The beacon and sign stand outside the gate, east of the wall.
    for (const name of [PALISADE.beacon, PALISADE.sign]) {
      const piece = placed.find((p) => p.name === name)!;
      expect(piece.x).toBeGreaterThan(7);
    }
  });

  test("raises nothing without the structures kit", () => {
    let calls = 0;
    expect(dressPalisade({}, [{ x0: 2, y0: 2, x1: 6, y1: 5 }], () => false, () => calls++).size).toBe(0);
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
    for (const row of CAMP_DRESSING) {
      if (row.kit !== "viking_props") continue;
      expect(names.has(row.node)).toBe(true);
    }
    for (const node of [PALISADE.torch, PALISADE.flag, PALISADE.sign, PALISADE.beacon]) expect(names.has(node)).toBe(true);
  });

  test("rows from other kits name real nodes too", () => {
    for (const kit of new Set(CAMP_DRESSING.map((r) => r.kit))) {
      if (kit === "viking_props") continue;
      const path = `public${KIT_URLS[kit]}`;
      if (!existsSync(path)) continue;
      const buf = readFileSync(path);
      const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString("utf8")) as { nodes: { name: string }[] };
      const names = new Set(json.nodes.map((n) => n.name));
      for (const row of CAMP_DRESSING.filter((r) => r.kit === kit)) expect(names.has(row.node)).toBe(true);
    }
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
    expect(names.has(HUT_WALLS.half)).toBe(true);
    expect(names.has(DOOR_WALL)).toBe(true);
  });
});
