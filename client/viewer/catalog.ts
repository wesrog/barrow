import * as THREE from "three";
import { captureRestInverses, isShieldNode } from "../render/gear";
import { CLIP_KITS, RIG_SPECS } from "../render/modelRigs";
import { instantiateKit, type CharacterInstance, type GameAssets, type KitName } from "../render/models";
import type { ClipId, RigSpec } from "../render/rigSpec";

/**
 * Every character model the game can load, instantiated with its clips, for
 * the asset viewer. Pure data over the loaded assets: no DOM, no renderer.
 */

export type PackId = "goblin_war_camp" | "viking_realm" | "dungeon_pack";

export const PACK_LABELS: Record<PackId, string> = {
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
  /** Inverse rest frames of the bones, for pieces authored in place over the T-pose. */
  rest: Map<THREE.Object3D, THREE.Matrix4>;
}

/** Character kits: which nodes are playable characters and how they animate. Scale is the hero's. */
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
        rest: captureRestInverses(inst.group),
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

// ---------------------------------------------------------------------------
// Gear a figure can hold or wear

/** A kit piece by kit and node. */
export interface GearRef {
  kit: KitName;
  node: string;
}

export interface GearOption extends GearRef {
  id: string;
  label: string;
  kind: "weapon" | "shield" | "worn";
}

export function gearId(ref: GearRef): string {
  return `${ref.kit}/${ref.node}`;
}

const KIT_SHORT: Partial<Record<KitName, string>> = {
  viking_weapons: "viking",
  goblin_weapons: "goblin",
  dungeon_weapons: "dungeon",
};

/** Weapon kits a Synty rig may draw from, its own pack first; grips are per rig, so any pack's piece fits. */
const HELD_KITS: Record<string, KitName[]> = {
  human: ["viking_weapons", "goblin_weapons", "dungeon_weapons"],
  goblin: ["goblin_weapons", "viking_weapons", "dungeon_weapons"],
  dungeon: ["dungeon_weapons", "viking_weapons", "goblin_weapons"],
};

/** Attachment kits per rig; the Dungeon Pack ships none. */
const WORN_KITS: Record<string, KitName> = { human: "viking_attachments", goblin: "goblin_attachments" };

/** Everything an entry could hold, from the weapon kits its rig can grip. */
export function heldOptions(assets: GameAssets, entry: CatalogEntry): GearOption[] {
  const out: GearOption[] = [];
  for (const kit of HELD_KITS[entry.rig] ?? []) {
    const scene = assets.kits[kit]?.scene;
    if (!scene) continue;
    for (const node of scene.children) {
      if (!node.name.startsWith("Wep_")) continue;
      out.push({
        id: gearId({ kit, node: node.name }),
        label: `${prettify(node.name.slice(4))} · ${KIT_SHORT[kit]}`,
        kit,
        node: node.name,
        kind: isShieldNode(node.name) ? "shield" : "weapon",
      });
    }
  }
  return out;
}

/** Everything an entry could wear from its pack's attachments. */
export function wornOptions(assets: GameAssets, entry: CatalogEntry): GearOption[] {
  const kit = WORN_KITS[entry.rig];
  const scene = kit && assets.kits[kit]?.scene;
  if (!kit || !scene) return [];
  return scene.children
    .filter((n) => n.name.startsWith("Attach_"))
    .map((n) => ({ id: gearId({ kit, node: n.name }), label: prettify(n.name.slice(7)), kit, node: n.name, kind: "worn" as const }));
}

/** What "arm everyone" hands each rig. */
export const DEFAULT_ARMS: Record<string, { r?: GearRef; l?: GearRef }> = {
  human: { r: { kit: "viking_weapons", node: "Wep_Sword_02" }, l: { kit: "viking_weapons", node: "Wep_Shield_Set_01" } },
  goblin: { r: { kit: "goblin_weapons", node: "Wep_Sword_01" }, l: { kit: "goblin_weapons", node: "Wep_Shield_01" } },
  dungeon: { r: { kit: "dungeon_weapons", node: "Wep_Straightsword_01" }, l: { kit: "dungeon_weapons", node: "Wep_Shield_Round_01" } },
};

/** Semantic clips worth a button once a figure holds something. */
export const ACTION_IDS: ClipId[] = [
  "attack1h", "slash", "attackChop", "attackSlice", "attackSpin", "attack2h", "attackUnarmed", "cast", "castRaise", "taunt", "death",
];
