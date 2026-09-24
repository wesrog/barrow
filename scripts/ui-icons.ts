/**
 * Copy the 2D art of the Synty INTERFACE Fantasy Screens pack out of the
 * licensed source folder into public/icons/synty/ (gitignored, like the
 * models) and write a manifest describing it: every PNG under Sprites/ and
 * Core/, grouped into sets by folder and into pieces by name, with the
 * Clean/Stroke/Underlay variants of an icon folded into one piece. Icons are
 * white silhouettes on transparency, which the HUD masks and tints; sprites
 * (frames, bars, coins, logos) are coloured and drawn as they are. The
 * Samples folder (158 MB of example screenshots) stays out.
 *
 *   bun scripts/ui-icons.ts
 */
import { copyFile, mkdir, open, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const SRC = "assets-src/synty/fantasy_screens";
const ROOTS = ["Sprites", "Core"];
const OUT = "public/icons/synty";

/** Folder ids the generic rule (strip Icons_, lowercase, join with -) gets wrong. */
const SET_ALIASES: Record<string, string> = { fantasyscreens: "screens" };

/** Icon sets are tintable white silhouettes; everything else is a coloured sprite. */
const ICON_DIRS = /^(Icons_|Core\/Icons_)/;

/** File-name prefixes that carry no information once the set is known. */
const NAME_PREFIXES = [
  /^ICON_FantasyScreens_(Inventory|Menu|Character|Playback)_/,
  /^ICON_Input_/,
  /^ICON_Social_/,
  /^ICON_SM_Item_/,
  /^SPR_FantasyScreens_/,
  /^SPR_Synty_Branding_/,
];
const VARIANT_RE = /_(Clean|Stroke|Underlay)$/;

interface Piece {
  set: string;
  name: string;
  w: number;
  h: number;
  files: Record<string, string>;
}
interface SetInfo {
  id: string;
  label: string;
  dir: string;
  kind: "icon" | "sprite";
  count: number;
}

async function pngSize(path: string): Promise<[number, number]> {
  const fh = await open(path);
  try {
    const buf = Buffer.alloc(24);
    await fh.read(buf, 0, 24, 0);
    return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  } finally {
    await fh.close();
  }
}

async function* pngs(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* pngs(path);
    else if (entry.name.toLowerCase().endsWith(".png")) yield path;
  }
}

function setId(dirRel: string): string {
  const raw = dirRel
    .replace(/^(Sprites|Core)\//, "")
    .split("/")
    .map((part) => part.replace(/^Icons_/, "").toLowerCase())
    .join("-");
  return SET_ALIASES[raw] ?? raw;
}

function setLabel(dirRel: string): string {
  return dirRel
    .replace(/^(Sprites|Core)\//, "")
    .split("/")
    .map((part) => part.replace(/^Icons_/, "").replace(/([a-z])([A-Z])/g, "$1 $2"))
    .join(" · ");
}

await rm(OUT, { recursive: true, force: true });
const sets = new Map<string, SetInfo>();
const pieces = new Map<string, Piece>();
let copied = 0;
for (const root of ROOTS) {
  for await (const path of pngs(join(SRC, root))) {
    const rel = relative(SRC, path);
    const dirRel = rel.slice(0, rel.lastIndexOf("/"));
    const id = setId(dirRel);
    const kind: SetInfo["kind"] = ICON_DIRS.test(dirRel.replace(/^Sprites\//, "")) ? "icon" : "sprite";
    if (!sets.has(id)) sets.set(id, { id, label: setLabel(dirRel), dir: dirRel, kind, count: 0 });
    const file = rel.slice(rel.lastIndexOf("/") + 1);
    let stem = file.replace(/\.png$/i, "");
    for (const re of NAME_PREFIXES) stem = stem.replace(re, "");
    const variant = kind === "icon" ? (VARIANT_RE.exec(stem)?.[1] ?? "") : "";
    const name = kind === "icon" ? stem.replace(VARIANT_RE, "") : stem;
    const outRel = `${id}/${file}`;
    await mkdir(join(OUT, id), { recursive: true });
    await copyFile(path, join(OUT, outRel));
    copied++;
    const key = `${id}/${name}`;
    let piece = pieces.get(key);
    if (!piece) {
      const [w, h] = await pngSize(path);
      piece = { set: id, name, w, h, files: {} };
      pieces.set(key, piece);
      sets.get(id)!.count++;
    }
    piece.files[variant] = outRel;
  }
}

const manifest = {
  version: 2,
  sets: [...sets.values()].sort((a, b) => a.id.localeCompare(b.id)),
  pieces: [...pieces.values()].sort((a, b) => a.set.localeCompare(b.set) || a.name.localeCompare(b.name)),
};
await writeFile(join(OUT, "manifest.json"), JSON.stringify(manifest) + "\n");
for (const s of manifest.sets) console.log(`${s.id.padEnd(24)} ${s.kind.padEnd(7)} ${s.count} pieces`);
console.log(`copied ${copied} files, ${manifest.pieces.length} pieces, wrote ${OUT}/manifest.json`);
