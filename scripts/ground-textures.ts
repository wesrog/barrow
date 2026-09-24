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

/** Pixels on a side after downsizing: the planes repeat every six cells, so 2048 is wasted memory. */
const SIZE = 1024;

const SRC = "assets-src/synty/alpine_mountain/Textures";
const OUT = "public/textures/ground";

/** Short name -> the pack's file. All 2048 square, seamless: the flat faceted
 * set (grass, mud, dirt, rock) and the painted ground set (grass with needle
 * litter, needle litter, needled dirt, mossy rock). */
export const GROUND_TEXTURE_FILES: Record<string, string> = {
  grass: "Grass_Texture_01.png",
  grass_dark: "Grass_Texture_02.png",
  mud: "Mud_Texture_01.png",
  dirt: "Dirt_Texture_01.png",
  rock: "Rock_Texture_01.png",
  grass_pine: "Synty_Alpine_Ground_GrassPine_01_basecolor.png",
  needles: "Synty_Alpine_Ground_Pine_basecolor.png",
  dirt_pine: "Synty_Alpine_Ground_DirtPine_01_basecolor.png",
  rock_moss: "Rock_Rough_Moss_Red_Texture_01.png",
};

await mkdir(OUT, { recursive: true });
for (const [name, file] of Object.entries(GROUND_TEXTURE_FILES)) {
  const out = join(OUT, `${name}.png`);
  // macOS ships sips; anywhere else the full-size copy still works.
  const sips = Bun.spawnSync(["sips", "-Z", String(SIZE), join(SRC, file), "--out", out], { stdout: "ignore", stderr: "ignore" });
  if (sips.exitCode !== 0) await copyFile(join(SRC, file), out);
  console.log(`${name.padEnd(12)} <- ${file}${sips.exitCode === 0 ? ` (${SIZE}px)` : ""}`);
}
console.log(`wrote ${Object.keys(GROUND_TEXTURE_FILES).length} textures to ${OUT}`);
