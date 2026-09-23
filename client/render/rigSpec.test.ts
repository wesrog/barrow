import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { MONSTER_LOOKS } from "./modelRigs";
import { KIT_URLS, type KitName } from "./models";
import { KAYKIT_RIG, SYNTY_RIG, type ClipId } from "./rigSpec";

const CLIP_IDS: ClipId[] = [
  "idle", "idleCombat", "walk", "shamble", "run", "attack1h", "slash", "attack2h", "attackUnarmed",
  "attackSpin", "attackChop", "attackSlice", "cast", "castRaise", "cheer", "jump", "taunt", "death",
];

describe("rig specs", () => {
  test("every family answers every clip id", () => {
    for (const id of CLIP_IDS) {
      expect(KAYKIT_RIG.clips[id]).toBeTruthy();
      expect(SYNTY_RIG.clips[id]).toBeTruthy();
    }
  });
});

/** The JSON chunk of a GLB, or null when the (gitignored) kit is not on this machine. */
function kitJson(kit: KitName): { nodes: { name: string }[]; scenes: { nodes: number[] }[]; animations?: { name: string }[] } | null {
  const path = `public${KIT_URLS[kit]}`;
  if (!existsSync(path)) return null;
  const buf = readFileSync(path);
  const jsonLength = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + jsonLength).toString("utf8"));
}

function nodeNames(kit: KitName): Set<string> | null {
  const json = kitJson(kit);
  return json && new Set(json.nodes.map((n) => n.name));
}

// Only meaningful where the converted kits exist; elsewhere the game falls back to KayKit.
const haveKits = existsSync(`public${KIT_URLS.goblin_characters}`);

describe.if(haveKits)("Synty kits match the tables that address them", () => {
  test("clip kit has every Synty clip", () => {
    const clips = new Set(kitJson("goblin_clips")!.animations!.map((a) => a.name));
    for (const id of CLIP_IDS) expect(clips.has(SYNTY_RIG.clips[id]!)).toBe(true);
  });

  test("goblin and viking rigs have every bone role", () => {
    for (const kit of ["goblin_characters", "viking_characters"] as const) {
      const names = nodeNames(kit)!;
      for (const bone of Object.values(SYNTY_RIG.bones)) expect(names.has(bone)).toBe(true);
    }
  });

  test("every Synty monster look names a real character node and weapon", () => {
    const weapons = nodeNames("goblin_weapons")!;
    for (const [type, looks] of Object.entries(MONSTER_LOOKS)) {
      const look = looks.synty;
      if (!look) continue;
      const roots = new Set(kitJson(look.kit)!.scenes[0]!.nodes.map((i) => kitJson(look.kit)!.nodes[i]!.name));
      expect(roots.has(look.node)).toBe(true);
      if (look.weapon) expect(weapons.has(look.weapon)).toBe(true);
      expect(type).toBeTruthy();
    }
  });
});
