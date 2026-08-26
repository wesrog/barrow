import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";

/**
 * KayKit CC0 model assets (kaylousberg.com). Characters carry full animation
 * suites and handslot bones; weapons are separate models that fit those slots.
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

export type CharacterName = keyof typeof CHARACTER_URLS;
export type WeaponName = keyof typeof WEAPON_URLS;
export type DungeonName = keyof typeof DUNGEON_URLS;

export interface GameAssets {
  characters: Record<CharacterName, GLTF>;
  weapons: Record<WeaponName, THREE.Group>;
  dungeon: Record<DungeonName, THREE.Group>;
}

export async function loadAssets(): Promise<GameAssets> {
  const loader = new GLTFLoader();
  const load = (url: string) =>
    loader.loadAsync(import.meta.env.BASE_URL.replace(/\/$/, "") + url);

  const characterEntries = Object.entries(CHARACTER_URLS) as [CharacterName, string][];
  const weaponEntries = Object.entries(WEAPON_URLS) as [WeaponName, string][];
  const dungeonEntries = Object.entries(DUNGEON_URLS) as [DungeonName, string][];
  const [characterGltfs, weaponGltfs, dungeonGltfs] = await Promise.all([
    Promise.all(characterEntries.map(([, url]) => load(url))),
    Promise.all(weaponEntries.map(([, url]) => load(url))),
    Promise.all(dungeonEntries.map(([, url]) => load(url))),
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
  const dungeon = {} as Record<DungeonName, THREE.Group>;
  dungeonEntries.forEach(([name], i) => {
    dungeon[name] = dungeonGltfs[i]!.scene;
  });
  return { characters, weapons, dungeon };
}

export interface CharacterInstance {
  group: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  handSlotR: THREE.Object3D | null;
  handSlotL: THREE.Object3D | null;
}

/** Clone a rigged character (SkeletonUtils keeps bones/skin working). */
export function instantiate(gltf: GLTF): CharacterInstance {
  const group = cloneSkeleton(gltf.scene) as THREE.Group;
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      // Clone materials so per-instance flashes/tints don't leak.
      if (obj.material instanceof THREE.Material) obj.material = obj.material.clone();
    }
  });
  const mixer = new THREE.AnimationMixer(group);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const clip of gltf.animations) {
    actions.set(clip.name, mixer.clipAction(clip));
  }
  return {
    group,
    mixer,
    actions,
    handSlotR: group.getObjectByName("handslot.r") ?? null,
    handSlotL: group.getObjectByName("handslot.l") ?? null,
  };
}
