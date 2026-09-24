import * as THREE from "three";
import { CLIP_KITS, RIG_SPECS } from "../render/modelRigs";
import { instantiate, instantiateKit, type CharacterInstance, type GameAssets, type KitName } from "../render/models";
import { KAYKIT_RIG, type ClipId, type RigSpec } from "../render/rigSpec";

/**
 * Every character model the game can load, instantiated with its clips, for
 * the asset viewer. Pure data over the loaded assets: no DOM, no renderer.
 */

export type PackId = "kaykit" | "goblin_war_camp" | "viking_realm" | "dungeon_pack";

export const PACK_LABELS: Record<PackId, string> = {
  kaykit: "KayKit",
  goblin_war_camp: "Goblin War Camp",
  viking_realm: "Viking Realm",
  dungeon_pack: "Dungeon Pack",
};

export interface CatalogEntry {
  id: string;
  label: string;
  pack: PackId;
  rig: string;
  spec: RigSpec;
  inst: CharacterInstance;
  /** Clip names this instance can play, sorted. */
  clips: string[];
  /** Scale that puts the model at its in-game height, so packs compare fairly. */
  scale: number;
  boneCount: number;
}

/** Character kits: which nodes are playable characters and how they animate. */
const CHARACTER_KITS: { kit: KitName; pack: PackId; rig: keyof typeof CLIP_KITS; scale: number }[] = [
  { kit: "goblin_characters", pack: "goblin_war_camp", rig: "goblin", scale: 0.87 },
  { kit: "viking_characters", pack: "viking_realm", rig: "human", scale: 0.87 },
  { kit: "dungeon_characters", pack: "dungeon_pack", rig: "dungeon", scale: 0.87 },
];

/** Skinned attachments (hoods, hair, capes) live beside the characters in a kit. */
const ATTACHMENT_PREFIX = "Attach_";

function countBones(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    if (o instanceof THREE.Bone) n++;
  });
  return n;
}

function prettify(name: string): string {
  return name.replace(/_/g, " ");
}

export function buildCatalog(assets: GameAssets): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (const [name, gltf] of Object.entries(assets.characters)) {
    const inst = instantiate(gltf, KAYKIT_RIG);
    entries.push({
      id: `kaykit/${name}`,
      label: prettify(name),
      pack: "kaykit",
      rig: "kaykit",
      spec: KAYKIT_RIG,
      inst,
      clips: [...inst.actions.keys()].sort(),
      scale: 0.72,
      boneCount: countBones(inst.group),
    });
  }
  for (const { kit, pack, rig, scale } of CHARACTER_KITS) {
    const scene = assets.kits[kit]?.scene;
    if (!scene) continue;
    for (const node of scene.children) {
      if (!node.name || node.name.startsWith(ATTACHMENT_PREFIX)) continue;
      const inst = instantiateKit(assets.kits, kit, node.name, CLIP_KITS[rig], RIG_SPECS[rig]);
      if (!inst) continue;
      entries.push({
        id: `${pack}/${node.name}`,
        label: prettify(node.name),
        pack,
        rig,
        spec: RIG_SPECS[rig],
        inst,
        clips: [...inst.actions.keys()].sort(),
        scale,
        boneCount: countBones(inst.group),
      });
    }
  }
  return entries;
}

/** The clip an entry plays when nothing else is asked of it: its rig's idle. */
export function defaultClip(entry: CatalogEntry, id: ClipId = "idle"): string | null {
  const choice = entry.spec.clips[id];
  if (!choice) return null;
  const names = Array.isArray(choice) ? choice : [choice];
  return names.find((n) => entry.inst.actions.has(n)) ?? null;
}

export function filterEntries(entries: CatalogEntry[], query: string, packs: ReadonlySet<PackId>): CatalogEntry[] {
  const q = query.trim().toLowerCase();
  return entries.filter((e) => packs.has(e.pack) && (q === "" || e.label.toLowerCase().includes(q) || e.id.toLowerCase().includes(q)));
}

/** Clip names across a set of entries with how many of them have each. */
export function clipCounts(entries: CatalogEntry[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const e of entries) for (const c of e.clips) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Grid positions for the visible entries: a near-square block, front row first. */
export function gridLayout(count: number, spacing = 2.4, rowSpacing = 3.0): { x: number; z: number }[] {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count * 1.7)));
  return Array.from({ length: count }, (_, i) => ({ x: (i % cols) * spacing, z: Math.floor(i / cols) * rowSpacing }));
}
