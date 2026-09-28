import * as THREE from "three";
import { kitMeshes, type KitName, type Kits } from "./models";

/**
 * Outdoor scatter from the Viking Realm nature kit: pines, standing stones,
 * berry bushes and the odd grass tuft as instanced meshes, batched per 16-cell chunk
 * so frustum culling drops everything off screen. This file is data plus a
 * matrix collector; the scene decides where each instance stands. When the
 * kit is absent the scene keeps its primitive cones and icosahedra.
 */

export type ScatterKind = "pine" | "rock" | "bush" | "tuft";

export interface ScatterPieceDef {
  kit: KitName;
  node: string;
  /** Uniform scale that brings the piece to its nominal in-game size, in cells. */
  scale: number;
}

/**
 * Nominal sizes before the per-cell jitter: pines 2.2 to 2.5 tall and under a
 * cell wide, stones about a cell wide and half buried (they are authored
 * centred on y=0), bushes under a cell, tufts a hand high. The pines are the
 * pack's single-material ones at 1.1k to 1.8k triangles; Pine_02 (3k) and the
 * pre-grouped clumps stay out of the instanced set.
 */
export const SCATTER_PIECES: Record<ScatterKind, ScatterPieceDef[]> = {
  pine: [
    { kit: "viking_nature", node: "Env_Tree_Pine_01", scale: 0.2 },
    { kit: "viking_nature", node: "Env_Tree_Pine_03", scale: 0.19 },
    { kit: "viking_nature", node: "Env_Tree_Pine_04", scale: 0.22 },
    { kit: "viking_nature", node: "Env_Tree_Pine_05", scale: 0.24 },
  ],
  rock: [
    { kit: "viking_nature", node: "Env_Stone_01", scale: 0.78 },
    { kit: "viking_nature", node: "Env_Stone_02", scale: 0.52 },
    { kit: "viking_nature", node: "Env_Stone_03", scale: 0.4 },
    { kit: "viking_nature", node: "Env_Stone_04", scale: 0.43 },
  ],
  bush: [
    { kit: "viking_nature", node: "Env_Bush_Berries_02", scale: 0.4 },
    { kit: "viking_nature", node: "Env_Bush_Berries_04", scale: 0.4 },
  ],
  tuft: [
    { kit: "viking_nature", node: "Bld_House_Roof_Grass_Tuft_01", scale: 0.35 },
    { kit: "viking_nature", node: "Bld_House_Roof_Grass_Tuft_02", scale: 0.35 },
    { kit: "viking_nature", node: "Bld_House_Roof_Grass_Tuft_03", scale: 0.4 },
  ],
};

/** Which kinds throw shadows; tufts are too small to be worth the depth pass. */
export const SCATTER_SHADOWS: Record<ScatterKind, boolean> = {
  pine: true,
  rock: true,
  bush: true,
  tuft: false,
};

/** Cells per instancing chunk on each axis. */
export const SCATTER_CHUNK = 16;

export interface BakedPart {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
}

/** Per kind, the baked parts of every variant that loaded. */
export type BakedPieces = Record<ScatterKind, BakedPart[][]>;

export interface ScatterTints {
  /** Multiplied into pine, bush and tuft materials. */
  foliage: number;
  /** Multiplied into stone materials. */
  stone: number;
}

/**
 * Flatten a kit node into instanceable geometry: every mesh under it with its
 * transform relative to the kit scene baked in, then the nominal scale. Null
 * when the kit or the node is missing.
 */
export function bakePiece(kits: Kits, def: ScatterPieceDef): BakedPart[] | null {
  const parts: BakedPart[] = [];
  for (const { mesh, matrix } of kitMeshes(kits, def.kit, def.node) ?? []) {
    if (!(mesh.material instanceof THREE.MeshStandardMaterial)) continue;
    const geometry = mesh.geometry.clone().applyMatrix4(matrix).scale(def.scale, def.scale, def.scale);
    parts.push({ geometry, material: mesh.material });
  }
  return parts.length > 0 ? parts : null;
}

/**
 * Every kind baked once (geometry is shared across regions), or null when any
 * kind has no variant to draw, in which case the scene keeps its primitives.
 */
export function bakeScatter(kits: Kits): BakedPieces | null {
  const out = {} as BakedPieces;
  for (const kind of Object.keys(SCATTER_PIECES) as ScatterKind[]) {
    const variants: BakedPart[][] = [];
    for (const def of SCATTER_PIECES[kind]) {
      const parts = bakePiece(kits, def);
      if (parts) variants.push(parts);
    }
    if (variants.length === 0) return null;
    out[kind] = variants;
  }
  return out;
}

/**
 * Collects instance matrices per (kind, variant, chunk) and turns them into
 * InstancedMeshes. One batch per region, so its tints follow the biome.
 */
export class ScatterBatch {
  private readonly buckets = new Map<string, THREE.Matrix4[]>();
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();

  constructor(
    private readonly pieces: BakedPieces,
    private readonly tints: ScatterTints,
    private readonly chunk = SCATTER_CHUNK,
  ) {}

  variants(kind: ScatterKind): number {
    return this.pieces[kind].length;
  }

  /** Queue one instance; `variant` wraps, so any hash bits will do. */
  add(kind: ScatterKind, variant: number, matrix: THREE.Matrix4, cellX: number, cellY: number): void {
    const n = this.pieces[kind].length;
    const v = ((variant % n) + n) % n;
    const key = `${kind}/${v}/${Math.floor(cellX / this.chunk)},${Math.floor(cellY / this.chunk)}`;
    let list = this.buckets.get(key);
    if (!list) {
      list = [];
      this.buckets.set(key, list);
    }
    list.push(matrix.clone());
  }

  /** One InstancedMesh per bucket and part, added to `parent`; returned for disposal. */
  build(parent: THREE.Object3D): THREE.InstancedMesh[] {
    const meshes: THREE.InstancedMesh[] = [];
    for (const [key, mats] of this.buckets) {
      const [kind, v] = key.split("/") as [ScatterKind, string];
      const tint = kind === "rock" ? this.tints.stone : this.tints.foliage;
      for (const part of this.pieces[kind][Number(v)]!) {
        const mesh = new THREE.InstancedMesh(part.geometry, this.tinted(part.material, tint), mats.length);
        mats.forEach((m, i) => mesh.setMatrixAt(i, m));
        mesh.castShadow = SCATTER_SHADOWS[kind];
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        parent.add(mesh);
        meshes.push(mesh);
      }
    }
    return meshes;
  }

  /** The kit material times a tint, shared by every chunk in this batch. */
  private tinted(source: THREE.MeshStandardMaterial, tint: number): THREE.MeshStandardMaterial {
    const key = `${source.uuid}/${tint}`;
    let mat = this.materials.get(key);
    if (!mat) {
      mat = source.clone();
      mat.color.multiply(new THREE.Color(tint));
      this.materials.set(key, mat);
    }
    return mat;
  }
}
