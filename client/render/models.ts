import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { RigSpec } from "./rigSpec";

/**
 * Model assets: the Synty POLYGON kits built by scripts/synty-to-glb.py under
 * public/models/synty. Licensed and gitignored, so a machine has to convert
 * them before the game runs; loadAssets says which kit is missing. The
 * kaykit_clips kits are the CC0 KayKit animation suite retargeted onto the
 * Synty rigs, the only KayKit data the game still uses.
 */

/** Synty kits: one GLB per kit, every piece a named top-level node. */
export const KIT_URLS = {
  dungeon: "/models/synty/dungeon/dungeon.glb",
  dungeon_props: "/models/synty/dungeon/props.glb",
  dungeon_characters: "/models/synty/dungeon/characters.glb",
  dungeon_weapons: "/models/synty/dungeon/weapons.glb",
  goblin_characters: "/models/synty/goblin_war_camp/characters.glb",
  goblin_weapons: "/models/synty/goblin_war_camp/weapons.glb",
  goblin_attachments: "/models/synty/goblin_war_camp/attachments.glb",
  goblin_clips: "/models/synty/goblin_locomotion/clips.glb",
  viking_characters: "/models/synty/viking_realm/characters.glb",
  viking_weapons: "/models/synty/viking_realm/weapons.glb",
  viking_attachments: "/models/synty/viking_realm/attachments.glb",
  viking_props: "/models/synty/viking_realm/props.glb",
  viking_nature: "/models/synty/viking_realm/nature.glb",
  viking_structures: "/models/synty/viking_realm/structures.glb",
  // The KayKit clip suite retargeted onto each Synty rig (scripts/synty-to-glb.py).
  goblin_kaykit_clips: "/models/synty/kaykit_clips/goblin_rig.glb",
  dungeon_kaykit_clips: "/models/synty/kaykit_clips/dungeon_rig.glb",
} as const;

export type KitName = keyof typeof KIT_URLS;
export type Kits = Partial<Record<KitName, GLTF>>;

/** Tiling ground textures copied by scripts/ground-textures.ts (the Alpine pack's). */
export const GROUND_TEXTURE_URLS = {
  grass: "/textures/ground/grass.png",
  grass_dark: "/textures/ground/grass_dark.png",
  mud: "/textures/ground/mud.png",
  dirt: "/textures/ground/dirt.png",
  rock: "/textures/ground/rock.png",
  grass_pine: "/textures/ground/grass_pine.png",
  needles: "/textures/ground/needles.png",
  dirt_pine: "/textures/ground/dirt_pine.png",
  rock_moss: "/textures/ground/rock_moss.png",
} as const;
export type GroundTexture = keyof typeof GROUND_TEXTURE_URLS;
export type GroundTextures = Partial<Record<GroundTexture, THREE.Texture>>;

/**
 * One part of a dungeon piece. `scale` and `offset` normalize the Synty node
 * to the footprints the scene was laid out on (floor tiles 2x2 centred, walls
 * 4 wide by 4 tall centred on their edge, pillars 4 tall; the KayKit set the
 * game began with), so placement scales in the scene stay as they are.
 * `offset` is in the normalized piece's units.
 */
interface PiecePart {
  kit: KitName;
  node: string;
  scale: number;
  offset?: [number, number, number];
  ry?: number;
}

/** The dungeon piece set, by role. */
const SYNTY_DUNGEON = {
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
  // The flight spans x -2..2, z 0..4 once normalized; the Synty piece has a top-corner pivot.
  stairs: [{ kit: "dungeon", node: "Env_Stairs_01", scale: 0.8, offset: [1.97, 0.21, 4.03] }],
} satisfies Record<string, PiecePart[]>;

export type DungeonName = keyof typeof SYNTY_DUNGEON;

export interface GameAssets {
  /** Dungeon pieces at the scene's footprints, assembled from the kits. */
  dungeon: Record<DungeonName, THREE.Group>;
  kits: Kits;
  /** Outdoor ground textures; a missing one leaves that biome on its flat colour. */
  ground: GroundTextures;
}

/** A named piece of a kit, or null when that kit did not load. */
export function kitNode(kits: Kits, kit: KitName, node: string): THREE.Object3D | null {
  return kits[kit]?.scene.getObjectByName(node) ?? null;
}

/** Object3D.clone shares materials; give each held or worn prop its own so
 * per-instance hit flashes, tints, and rarity glow don't leak. */
export function cloneProp(model: THREE.Object3D): THREE.Object3D {
  const clone = model.clone(true);
  clone.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      if (obj.material instanceof THREE.Material) obj.material = obj.material.clone();
    }
  });
  return clone;
}

/**
 * The meshes under a kit node with each one's transform relative to the kit
 * scene. Kit pieces stand at the origin, but a node may carry a translation
 * that centres an offset authored into the mesh, and rigged attachments hold
 * their mesh beside a copy of the skeleton, so callers take the meshes with
 * their matrices rather than the node. Null when the kit or node is missing.
 */
export function kitMeshes(kits: Kits, kit: KitName, node: string): { mesh: THREE.Mesh; matrix: THREE.Matrix4 }[] | null {
  const src = kitNode(kits, kit, node);
  if (!src) return null;
  const root = kits[kit]!.scene;
  root.updateMatrixWorld(true);
  const rootInverse = root.matrixWorld.clone().invert();
  const out: { mesh: THREE.Mesh; matrix: THREE.Matrix4 }[] = [];
  src.traverse((obj) => {
    if (obj instanceof THREE.Mesh) out.push({ mesh: obj, matrix: rootInverse.clone().multiply(obj.matrixWorld) });
  });
  return out;
}

/** Assemble a dungeon piece from its parts; null if any part is missing. */
function buildPiece(kits: Kits, parts: readonly PiecePart[]): THREE.Group | null {
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

  const kitEntries = Object.entries(KIT_URLS) as [KitName, string][];
  const groundEntries = Object.entries(GROUND_TEXTURE_URLS) as [GroundTexture, string][];
  const textureLoader = new THREE.TextureLoader();
  const [kitGltfs, groundTextures] = await Promise.all([
    Promise.all(
      kitEntries.map(([name, url]) =>
        load(url).catch((err: unknown) => {
          console.warn(`Synty kit ${name} not loaded (${url}).`, err);
          return null;
        }),
      ),
    ),
    Promise.all(
      groundEntries.map(([name, url]) =>
        textureLoader
          .loadAsync(import.meta.env.BASE_URL.replace(/\/$/, "") + url)
          .then((tex) => {
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.anisotropy = 4;
            return tex;
          })
          .catch(() => {
            console.warn(`Ground texture ${name} not loaded (${url}); run bun run assets:ground.`);
            return null;
          }),
      ),
    ),
  ]);
  const ground: GroundTextures = {};
  groundEntries.forEach(([name], i) => {
    const tex = groundTextures[i];
    if (tex) ground[name] = tex;
  });
  const kits: Kits = {};
  kitEntries.forEach(([name], i) => {
    const gltf = kitGltfs[i];
    if (gltf) kits[name] = gltf;
  });
  const dungeon = {} as Record<DungeonName, THREE.Group>;
  for (const name of Object.keys(SYNTY_DUNGEON) as DungeonName[]) {
    const piece = buildPiece(kits, SYNTY_DUNGEON[name]);
    if (!piece) {
      throw new Error(
        `Dungeon piece "${name}" needs the Synty dungeon kits under public/models/synty; run bun run assets:synty.`,
      );
    }
    dungeon[name] = piece;
  }
  return { dungeon, kits, ground };
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

/**
 * Instantiate a character from a kit node, animated by clip kits whose
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
