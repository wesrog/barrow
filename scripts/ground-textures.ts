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

/** The matching normal maps, where the pack has one: the relief that makes flat dirt read as dirt. */
export const GROUND_NORMAL_FILES: Record<string, string> = {
  dirt: "Dirt_Normals_01.png",
  mud: "Mud_Normals_01.png",
  rock: "Rock_Normals_01.png",
  grass: "Grass_Normals_01.png",
  grass_dark: "Grass_Normals_01.png",
  needles: "Synty_Alpine_Ground_Pine_normal.png",
  dirt_pine: "Synty_Alpine_Ground_DirtPine_01_normal.png",
  rock_moss: "Rock_Rough_Moss_Normals_01.png",
};

await mkdir(OUT, { recursive: true });
let written = 0;
const copy = async (file: string, out: string, label: string) => {
  // macOS ships sips; anywhere else the full-size copy still works.
  const sips = Bun.spawnSync(["sips", "-Z", String(SIZE), join(SRC, file), "--out", out], { stdout: "ignore", stderr: "ignore" });
  if (sips.exitCode !== 0) await copyFile(join(SRC, file), out);
  console.log(`${label.padEnd(18)} <- ${file}${sips.exitCode === 0 ? ` (${SIZE}px)` : ""}`);
  written++;
};
for (const [name, file] of Object.entries(GROUND_TEXTURE_FILES)) await copy(file, join(OUT, `${name}.png`), name);
for (const [name, file] of Object.entries(GROUND_NORMAL_FILES)) await copy(file, join(OUT, `${name}_normal.png`), `${name} (normal)`);
console.log(`wrote ${written} textures to ${OUT}`);
