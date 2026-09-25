import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { KIT_URLS, type KitName } from "./models";
import { CRYPT_LIGHTS, OUTDOOR_LIGHTS } from "./lightDressing";

const settings = [OUTDOOR_LIGHTS, CRYPT_LIGHTS];

describe("scattered lights", () => {
  test("sparse by construction: at most one light per block, big enough blocks, and every piece lit", () => {
    for (const s of settings) {
      expect(s.block).toBeGreaterThanOrEqual(8);
      expect(s.chance).toBeLessThanOrEqual(0.6);
      for (const p of s.pieces) {
        expect(p.weight).toBeGreaterThan(0);
        expect(p.light.intensity).toBeGreaterThan(0);
        expect(p.flame.height).toBeGreaterThan(0);
      }
    }
  });

  const kits = [...new Set(settings.flatMap((s) => s.pieces.flatMap((p) => p.parts.map((part) => part.kit))))] as KitName[];
  test.if(kits.every((k) => existsSync(`public${KIT_URLS[k]}`)))("every part names a real kit node", () => {
    const names = new Map<KitName, Set<string>>();
    for (const kit of kits) {
      const buf = readFileSync(`public${KIT_URLS[kit]}`);
      const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString("utf8")) as { nodes: { name: string }[] };
      names.set(kit, new Set(json.nodes.map((n) => n.name)));
    }
    for (const s of settings) for (const p of s.pieces) for (const part of p.parts) expect(names.get(part.kit)!.has(part.node)).toBe(true);
  });
});
