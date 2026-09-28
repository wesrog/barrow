import * as THREE from "three";

/**
 * The outdoor ground: a plane per region tiled with the Alpine pack's ground
 * texture for its biome, multiplied by the biome's tint, with the texture's
 * normal map giving the facets a little relief under the moon and the lamps.
 * Without the texture (fresh clone, no `bun run assets:ground`) the plane
 * keeps the flat colour.
 */

/** Cells per repeat of a ground texture unless the biome says otherwise. */
export const GROUND_TILE = 6;

/** How hard the normal map presses unless the biome says otherwise: a hint of relief, not gravel. */
export const GROUND_RELIEF = 0.5;

export interface GroundPalette {
  ground: number;
  groundTint: number;
  groundTile?: number;
  groundRelief?: number;
}

/** A ground plane whose UVs tile the texture every `tile` cells whatever its size. */
export function groundGeometry(w: number, h: number, tile = GROUND_TILE): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(w, h);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * h) / tile);
  return geo;
}

/** The biome's ground: its texture under its tint with its relief, or the flat colour when the texture is absent. */
export function groundMaterial(
  tex: THREE.Texture | undefined,
  normal: THREE.Texture | undefined,
  pal: GroundPalette,
): THREE.MeshStandardMaterial {
  if (!tex) return new THREE.MeshStandardMaterial({ color: pal.ground, roughness: 1, flatShading: true });
  const relief = pal.groundRelief ?? GROUND_RELIEF;
  return new THREE.MeshStandardMaterial({
    map: tex,
    color: pal.groundTint,
    roughness: 1,
    normalMap: normal ?? null,
    normalScale: new THREE.Vector2(relief, relief),
  });
}
