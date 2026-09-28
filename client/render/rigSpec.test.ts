import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { CLIP_KITS, MONSTER_LOOKS, WEAPON_KITS } from "./modelRigs";
import { KIT_URLS, type KitName } from "./models";
import { SYNTY_DUNGEON_RIG, SYNTY_GOBLIN_RIG, SYNTY_HUMAN_RIG, type ClipId, type RigSpec } from "./rigSpec";

const CLIP_IDS: ClipId[] = [
  "idle", "idleCombat", "walk", "shamble", "run", "attack1h", "slash", "attack2h", "attackUnarmed",
  "attackSpin", "attackChop", "attackSlice", "cast", "castRaise", "cheer", "jump", "taunt", "death",
];

const SYNTY_SPECS: Record<keyof typeof CLIP_KITS, RigSpec> = { human: SYNTY_HUMAN_RIG, goblin: SYNTY_GOBLIN_RIG, dungeon: SYNTY_DUNGEON_RIG };

function candidates(spec: RigSpec, id: ClipId): string[] {
  const c = spec.clips[id];
  return c === undefined ? [] : Array.isArray(c) ? c : [c];
}

describe("rig specs", () => {
  test("every rig answers every clip id", () => {
    for (const id of CLIP_IDS) {
      for (const spec of Object.values(SYNTY_SPECS)) expect(candidates(spec, id).length).toBeGreaterThan(0);
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
  test("each Synty rig can play every clip id from the kits it draws on", () => {
    for (const [rig, spec] of Object.entries(SYNTY_SPECS) as [keyof typeof CLIP_KITS, RigSpec][]) {
      const available = new Set<string>();
      for (const kit of CLIP_KITS[rig]) {
        for (const a of kitJson(kit)?.animations ?? []) available.add(a.name);
      }
      expect(available.size).toBeGreaterThan(0);
      for (const id of CLIP_IDS) {
        expect(candidates(spec, id).some((n) => available.has(n))).toBe(true);
      }
    }
  });

  test("character kits have every bone role their rig spec names", () => {
    const pairs = [["goblin_characters", SYNTY_GOBLIN_RIG], ["viking_characters", SYNTY_HUMAN_RIG], ["dungeon_characters", SYNTY_DUNGEON_RIG]] as const;
    for (const [kit, spec] of pairs) {
      const names = nodeNames(kit);
      if (!names) continue;
      for (const bone of Object.values(spec.bones)) expect(names.has(bone)).toBe(true);
    }
  });

  test("every Synty monster look names a real character node and weapon", () => {
    for (const [type, looks] of Object.entries(MONSTER_LOOKS)) {
      const look = looks.synty;
      if (!look) continue;
      const json = kitJson(look.kit);
      if (!json) continue;
      const roots = new Set(json.scenes[0]!.nodes.map((i) => json.nodes[i]!.name));
      expect(roots.has(look.node)).toBe(true);
      if (look.weapon) {
        const weapons = nodeNames(WEAPON_KITS[look.rig]);
        if (weapons) expect(weapons.has(look.weapon)).toBe(true);
      }
      expect(type).toBeTruthy();
    }
  });
});
