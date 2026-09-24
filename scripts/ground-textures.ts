/**
 * Copy the POLYGON Alpine Mountain pack's tiling ground textures out of its
 * source folder into public/textures/ground/ (gitignored, like the models)
 * under the short names the biome palettes refer to. The outdoor ground
 * planes tile these, tinted per biome; without them the scene keeps its flat
 * biome colour.
 *
 *   bun scripts/ground-textures.ts
 */
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const SRC = "assets-src/synty/alpine_mountain/Textures";
const OUT = "public/textures/ground";

/** Short name -> the pack's file. All 2048 square, seamless. */
export const GROUND_TEXTURE_FILES: Record<string, string> = {
  grass: "Grass_Texture_01.png",
  grass_dark: "Grass_Texture_02.png",
  mud: "Mud_Texture_01.png",
  dirt: "Dirt_Texture_01.png",
  rock: "Rock_Texture_01.png",
};

await mkdir(OUT, { recursive: true });
for (const [name, file] of Object.entries(GROUND_TEXTURE_FILES)) {
  await copyFile(join(SRC, file), join(OUT, `${name}.png`));
  console.log(`${name.padEnd(12)} <- ${file}`);
}
console.log(`wrote ${Object.keys(GROUND_TEXTURE_FILES).length} textures to ${OUT}`);
