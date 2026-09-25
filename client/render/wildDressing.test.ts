import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { LANDMARKS, LANDMARK_CHARS } from "../../sim/landmarks";
import { KIT_URLS, type KitName } from "./models";
import { WILD_SET_PIECES } from "./wildDressing";

describe("wild set pieces", () => {
  test("every landmark has rows and every row names a landmark", () => {
    const rowMarkers = new Set(WILD_SET_PIECES.map((r) => r.marker));
    for (const ch of LANDMARK_CHARS) expect(rowMarkers.has(ch)).toBe(true);
    for (const ch of rowMarkers) expect(LANDMARKS[ch]).toBeDefined();
  });

  test("the pieces that stand on a footprint sit inside it", () => {
    // The raider tents and tower are centred on their 2x2 blocks; the spike
    // wall on its column. A row that drifts off its solid cells would leave
    // a wall the player walks through, or a tent they walk into.
    const inSolid = (ch: string, dx: number, dz: number) =>
      LANDMARKS[ch]!.solid.some(([sx, sz]) => Math.abs(dx - sx) <= 0.5 && Math.abs(dz - sz) <= 0.5);
    for (const node of ["Prop_Goblin_Tent_01", "Prop_Goblin_Tent_02", "Prop_Goblin_Tower_01", "Prop_Goblin_Spikes_01"]) {
      const row = WILD_SET_PIECES.find((r) => r.marker === "C" && r.node === node)!;
      expect(inSolid("C", row.dx, row.dz)).toBe(true);
    }
    for (const row of WILD_SET_PIECES.filter((r) => r.marker === "O" && r.node === "Env_Stone_Engraved_03")) {
      expect(inSolid("O", row.dx, row.dz)).toBe(true);
    }
    for (const row of WILD_SET_PIECES.filter((r) => r.marker === "U" && r.node.startsWith("Env_Wall"))) {
      expect(inSolid("U", row.dx, row.dz)).toBe(true);
    }
  });
});

const kitsUsed = [...new Set(WILD_SET_PIECES.map((r) => r.kit))] as KitName[];
const allPresent = kitsUsed.every((k) => existsSync(`public${KIT_URLS[k]}`));
describe.if(allPresent)("wild set pieces match the kits", () => {
  test("every row names a real kit node", async () => {
    const names = new Map<KitName, Set<string>>();
    for (const kit of kitsUsed) {
      const buf = await Bun.file(`public${KIT_URLS[kit]}`).arrayBuffer();
      const gltf = await new GLTFLoader().parseAsync(buf, "");
      const set = new Set<string>();
      gltf.scene.traverse((o: THREE.Object3D) => set.add(o.name));
      names.set(kit, set);
    }
    for (const row of WILD_SET_PIECES) expect(names.get(row.kit)!.has(row.node)).toBe(true);
  });
});
