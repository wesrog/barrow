import * as THREE from "three";

/**
 * The outdoor ground: a plane per region tiled with the Alpine pack's ground
 * texture for its biome, multiplied by the biome's tint. Without the texture
 * (fresh clone, no `bun run assets:ground`) the plane keeps the flat colour.
 */

/** Cells per repeat of a ground texture: wide enough that its facets read as turf, not tile. */
export const GROUND_TILE = 6;

/** A ground plane whose UVs tile the texture every GROUND_TILE cells whatever its size. */
export function groundGeometry(w: number, h: number): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(w, h);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / GROUND_TILE, (uv.getY(i) * h) / GROUND_TILE);
  return geo;
}

/** The biome's ground: its texture under its tint, or the flat colour when the texture is absent. */
export function groundMaterial(
  tex: THREE.Texture | undefined,
  pal: { ground: number; groundTint: number },
): THREE.MeshStandardMaterial {
  return tex
    ? new THREE.MeshStandardMaterial({ map: tex, color: pal.groundTint, roughness: 1 })
    : new THREE.MeshStandardMaterial({ color: pal.ground, roughness: 1, flatShading: true });
}
