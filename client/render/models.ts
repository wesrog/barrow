import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { RigSpec } from "./rigSpec";

/**
 * Model assets. Two sets load side by side:
 *
 * - KayKit CC0 GLBs (kaylousberg.com), committed under public/models. Characters
 *   carry full animation suites and handslot bones; weapons fit those slots.
 * - Synty POLYGON kits built by scripts/synty-to-glb.py under public/models/synty.
 *   Licensed and gitignored, so they are optional: a kit that fails to load is
 *   simply absent and everything that would use it falls back to KayKit.
 */

const CHARACTER_URLS = {
  barbarian: "/models/characters/Barbarian.glb",
  knight: "/models/characters/Knight.glb",
  skeleton_warrior: "/models/characters/Skeleton_Warrior.glb",
  skeleton_minion: "/models/characters/Skeleton_Minion.glb",
  skeleton_mage: "/models/characters/Skeleton_Mage.glb",
  skeleton_rogue: "/models/characters/Skeleton_Rogue.glb",
} as const;

const WEAPON_URLS = {
  sword_1handed: "/models/weapons/sword_1handed.gltf",
  sword_2handed: "/models/weapons/sword_2handed.gltf",
  axe_1handed: "/models/weapons/axe_1handed.gltf",
  axe_2handed: "/models/weapons/axe_2handed.gltf",
  dagger: "/models/weapons/dagger.gltf",
  skeleton_blade: "/models/weapons/Skeleton_Blade.gltf",
  skeleton_axe: "/models/weapons/Skeleton_Axe.gltf",
  skeleton_staff: "/models/weapons/Skeleton_Staff.gltf",
} as const;

const DUNGEON_URLS = {
  wall: "/models/dungeon/wall.glb",
  wall_cracked: "/models/dungeon/wall_cracked.glb",
  wall_broken: "/models/dungeon/wall_broken.glb",
  floor: "/models/dungeon/floor_tile_small.glb",
  floor_broken: "/models/dungeon/floor_tile_small_broken_A.glb",
  floor_weeds: "/models/dungeon/floor_tile_small_weeds_A.glb",
  pillar: "/models/dungeon/pillar.glb",
  column: "/models/dungeon/column.glb",
  torch_mounted: "/models/dungeon/torch_mounted.glb",
  barrel: "/models/dungeon/barrel_large.glb",
  crates: "/models/dungeon/crates_stacked.glb",
  chest: "/models/dungeon/chest.glb",
  chest_gold: "/models/dungeon/chest_gold.glb",
  stairs: "/models/dungeon/stairs_narrow.glb",
} as const;

/** Synty kits: one GLB per kit, every piece a named top-level node. */
export const KIT_URLS = {
  dungeon: "/models/synty/dungeon/dungeon.glb",
  dungeon_props: "/models/synty/dungeon/props.glb",
  dungeon_characters: "/models/synty/dungeon/characters.glb",
  dungeon_weapons: "/models/synty/dungeon/weapons.glb",
  goblin_characters: "/models/synty/goblin_war_camp/characters.glb",
  goblin_weapons: "/models/synty/goblin_war_camp/weapons.glb",
  goblin_clips: "/models/synty/goblin_locomotion/clips.glb",
  viking_characters: "/models/synty/viking_realm/characters.glb",
  viking_weapons: "/models/synty/viking_realm/weapons.glb",
  viking_attachments: "/models/synty/viking_realm/attachments.glb",
  viking_props: "/models/synty/viking_realm/props.glb",
  viking_nature: "/models/synty/viking_realm/nature.glb",
  // The KayKit clip suite retargeted onto each Synty rig (scripts/synty-to-glb.py).
  goblin_kaykit_clips: "/models/synty/kaykit_clips/goblin_rig.glb",
  dungeon_kaykit_clips: "/models/synty/kaykit_clips/dungeon_rig.glb",
} as const;

export type CharacterName = keyof typeof CHARACTER_URLS;
export type WeaponName = keyof typeof WEAPON_URLS;
export type DungeonName = keyof typeof DUNGEON_URLS;
export type KitName = keyof typeof KIT_URLS;
export type Kits = Partial<Record<KitName, GLTF>>;

/**
 * One part of a Synty stand-in for a KayKit dungeon piece. `scale` and
 * `offset` normalize the Synty node to the KayKit piece's footprint (measured
 * in Blender: KayKit floor tiles are 2x2 centred, walls 4 wide by 4 tall
 * centred on their edge, pillars 4 tall) so the scene's placement scales keep
 * working unchanged. `offset` is in the normalized piece's units.
 */
interface PiecePart {
  kit: KitName;
  node: string;
  scale: number;
  offset?: [number, number, number];
  ry?: number;
}

/** Synty stand-ins for every KayKit dungeon piece. */
const SYNTY_DUNGEON: Record<DungeonName, PiecePart[]> = {
  // Tiles are 5x5 with a corner pivot; walls 5.24 wide with an end pivot.
  floor: [{ kit: "dungeon", node: "Env_Tiles_01", scale: 0.4, offset: [-1, 0, -1] }],
  floor_broken: [{ kit: "dungeon", node: "Env_Tiles_03", scale: 0.4, offset: [-1, 0, -1] }],
  floor_weeds: [{ kit: "dungeon", node: "Env_Tiles_05", scale: 0.4, offset: [-1, 0, -1] }],
  wall: [{ kit: "dungeon", node: "Env_Wall_01", scale: 0.763, offset: [-1.885, 0.07, -0.04] }],
  wall_cracked: [{ kit: "dungeon", node: "Env_Wall_03", scale: 0.772, offset: [-1.907, 0.03, -0.04] }],
  wall_broken: [{ kit: "dungeon", node: "Env_Wall_04", scale: 0.772, offset: [-1.907, 0.03, -0.04] }],
  pillar: [{ kit: "dungeon", node: "Env_Pillar_Round_01", scale: 1.018 }],
  column: [{ kit: "dungeon", node: "Env_Pillar_Square_01", scale: 0.667 }],
  torch_mounted: [{ kit: "dungeon_props", node: "Prop_Torch_Ornate_02", scale: 1.18, offset: [0, 0, 0.21] }],
  barrel: [{ kit: "dungeon_props", node: "Prop_Barrel_01", scale: 1.94 }],
  crates: [
    { kit: "dungeon_props", node: "Prop_Crate_Wood_01", scale: 1.95 },
    { kit: "dungeon_props", node: "Prop_Crate_Wood_03", scale: 1.6, offset: [0.1, 2.14, -0.1], ry: 0.3 },
  ],
  chest: [
    { kit: "dungeon_props", node: "Prop_Chest_01", scale: 2.0 },
    { kit: "dungeon_props", node: "Prop_Chest_01_Lid", scale: 2.0 },
  ],
  chest_gold: [
    { kit: "dungeon_props", node: "Prop_Chest_Wood_01", scale: 1.47 },
    { kit: "dungeon_props", node: "Prop_Chest_Wood_Lid", scale: 1.47 },
  ],
  // KayKit stairs span x -2..2, z 0..4; the Synty flight has a top-corner pivot.
  stairs: [{ kit: "dungeon", node: "Env_Stairs_01", scale: 0.8, offset: [1.97, 0.21, 4.03] }],
};

export interface GameAssets {
  characters: Record<CharacterName, GLTF>;
  weapons: Record<WeaponName, THREE.Group>;
  /** Dungeon pieces at KayKit footprints: Synty stand-ins when the kits loaded, else KayKit. */
  dungeon: Record<DungeonName, THREE.Group>;
  kits: Kits;
}

/** A named piece of a kit, or null when that kit did not load. */
export function kitNode(kits: Kits, kit: KitName, node: string): THREE.Object3D | null {
  return kits[kit]?.scene.getObjectByName(node) ?? null;
}

/** Assemble a dungeon piece from its Synty parts; null if any part is missing. */
function buildPiece(kits: Kits, parts: PiecePart[]): THREE.Group | null {
  const group = new THREE.Group();
  for (const part of parts) {
    const src = kitNode(kits, part.kit, part.node);
    if (!src) return null;
    const clone = src.clone(true);
    clone.scale.setScalar(part.scale);
    if (part.offset) clone.position.set(...part.offset);
    if (part.ry) clone.rotation.y = part.ry;
    group.add(clone);
  }
  return group;
}

export async function loadAssets(): Promise<GameAssets> {
  const loader = new GLTFLoader();
  const load = (url: string) =>
    loader.loadAsync(import.meta.env.BASE_URL.replace(/\/$/, "") + url);

  const characterEntries = Object.entries(CHARACTER_URLS) as [CharacterName, string][];
  const weaponEntries = Object.entries(WEAPON_URLS) as [WeaponName, string][];
  const dungeonEntries = Object.entries(DUNGEON_URLS) as [DungeonName, string][];
  const kitEntries = Object.entries(KIT_URLS) as [KitName, string][];
  const [characterGltfs, weaponGltfs, dungeonGltfs, kitGltfs] = await Promise.all([
    Promise.all(characterEntries.map(([, url]) => load(url))),
    Promise.all(weaponEntries.map(([, url]) => load(url))),
    Promise.all(dungeonEntries.map(([, url]) => load(url))),
    Promise.all(
      kitEntries.map(([name, url]) =>
        load(url).catch((err: unknown) => {
          console.warn(`Synty kit ${name} not loaded (${url}); falling back to KayKit.`, err);
          return null;
        }),
      ),
    ),
  ]);

  const characters = {} as Record<CharacterName, GLTF>;
  characterEntries.forEach(([name], i) => {
    characters[name] = characterGltfs[i]!;
  });
  const weapons = {} as Record<WeaponName, THREE.Group>;
  weaponEntries.forEach(([name], i) => {
    const scene = weaponGltfs[i]!.scene;
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) obj.castShadow = true;
    });
    weapons[name] = scene;
  });
  const kits: Kits = {};
  kitEntries.forEach(([name], i) => {
    const gltf = kitGltfs[i];
    if (gltf) kits[name] = gltf;
  });
  const dungeon = {} as Record<DungeonName, THREE.Group>;
  dungeonEntries.forEach(([name], i) => {
    dungeon[name] = buildPiece(kits, SYNTY_DUNGEON[name]) ?? dungeonGltfs[i]!.scene;
  });
  return { characters, weapons, dungeon, kits };
}

export interface CharacterInstance {
  group: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  handSlotR: THREE.Object3D | null;
  handSlotL: THREE.Object3D | null;
}

/** GLTFLoader strips the characters [].:/ from node names (reserved for
 * animation track syntax), so the authored "handslot.r" loads as "handslotr".
 * Look nodes up by what the loader actually named them. */
export function findNode(root: THREE.Object3D, name: string): THREE.Object3D | null {
  return root.getObjectByName(name.replace(/\s/g, "_").replace(/[[\].:/]/g, "")) ?? null;
}

/**
 * Give a cloned kit character back its authored bone names. GLTFLoader keeps
 * node names unique per file, so the second character in a kit gets Root_1,
 * Hips_1 and so on, and clip tracks addressed to Root and Hips never bind.
 * Only names the clips actually target are restored, so a bone that really
 * ends in digits (Spine_01) is left alone.
 */
function restoreBoneNames(group: THREE.Object3D, clips: THREE.AnimationClip[]): void {
  const targets = new Set<string>();
  for (const clip of clips) {
    for (const track of clip.tracks) targets.add(THREE.PropertyBinding.parseTrackName(track.name).nodeName);
  }
  group.traverse((obj) => {
    if (targets.has(obj.name)) return;
    const authored = obj.name.replace(/_\d+$/, "");
    if (targets.has(authored)) obj.name = authored;
  });
}

/**
 * A clip with only the tracks this character has bones for. Kits share one
 * rig, but a few models drop bones (the Tormented Soul has no feet), and a
 * track without a target makes Three warn on every binding.
 */
function fitClip(clip: THREE.AnimationClip, group: THREE.Object3D): THREE.AnimationClip {
  const names = new Set<string>();
  group.traverse((o) => names.add(o.name));
  const tracks = clip.tracks.filter((t) => names.has(THREE.PropertyBinding.parseTrackName(t.name).nodeName));
  return tracks.length === clip.tracks.length ? clip : new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

/** Clone a rigged character subtree with its own materials, mixer, and actions. */
function instantiateNode(
  source: THREE.Object3D,
  clips: THREE.AnimationClip[],
  spec: RigSpec,
): CharacterInstance {
  // SkeletonUtils keeps bones/skin working across the clone.
  const group = cloneSkeleton(source) as THREE.Group;
  restoreBoneNames(group, clips);
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      // Clone materials so per-instance flashes/tints don't leak.
      if (obj.material instanceof THREE.Material) obj.material = obj.material.clone();
    }
  });
  const mixer = new THREE.AnimationMixer(group);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const clip of clips) {
    actions.set(clip.name, mixer.clipAction(fitClip(clip, group)));
  }
  return {
    group,
    mixer,
    actions,
    handSlotR: findNode(group, spec.bones.handR),
    handSlotL: findNode(group, spec.bones.handL),
  };
}

/** Instantiate a KayKit character: its clips ship inside its own GLB. */
export function instantiate(gltf: GLTF, spec: RigSpec): CharacterInstance {
  return instantiateNode(gltf.scene, gltf.animations, spec);
}

/**
 * Instantiate a character from a Synty kit node, animated by clip kits whose
 * tracks address bones by name. Every clip kit that loaded contributes; null
 * when the character kit or all of its clip kits are missing.
 */
export function instantiateKit(
  kits: Kits,
  kit: KitName,
  node: string,
  clipKits: readonly KitName[],
  spec: RigSpec,
): CharacterInstance | null {
  const source = kitNode(kits, kit, node);
  const clips = clipKits.flatMap((k) => kits[k]?.animations ?? []);
  if (!source || clips.length === 0) return null;
  return instantiateNode(source, clips, spec);
}
