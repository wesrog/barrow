/**
 * Copy the 2D art of the Synty INTERFACE packs out of the licensed source
 * folders into public/icons/synty/ (gitignored, like the models) and write a
 * manifest describing it: every PNG, grouped into sets by pack and folder and
 * into pieces by name, with a piece's variants folded together. Each piece
 * has a kind: "icon" is a white silhouette the HUD masks and tints (variants
 * Clean/Stroke/Underlay), "render" an icon rendered from a POLYGON model
 * (ICON_SM_*: the suffix-less coloured render is stored as "Render", beside
 * its white Clean silhouette, Underlay backing and coloured Side view),
 * "sprite" any other coloured art (frames, bars, banners). Demo-UI
 * screenshots stay out.
 *
 *   bun scripts/ui-icons.ts
 */
import { copyFile, mkdir, open, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const OUT = "public/icons/synty";

/** Each pack: where it was unzipped, which folders hold art, a short id that prefixes its sets. */
const PACKS = [
  { id: "fs", label: "Fantasy Screens", root: "assets-src/synty/fantasy_screens", dirs: ["Sprites", "Core", "Samples"] },
  { id: "fw", label: "Fantasy Warrior HUD", root: "assets-src/synty/fantasy_warrior_hud/Source_Sprites", dirs: ["Sprites", "Core", "Sample"] },
];

/** Demo-UI screenshots, not art to use in a game. */
const SKIP = /ExampleScreenshot/;

/** Folder ids the generic rule (strip Icons_, lowercase, join with -) gets wrong. */
const SET_ALIASES: Record<string, string> = { fantasyscreens: "screens", fantasywarrior: "warrior", samples: "samples", sample: "samples" };

/** File-name prefixes that carry no information once the set is known. */
const NAME_PREFIXES = [
  /^ICON_FantasyScreens_(Inventory|Menu|Character|Playback)_/,
  /^ICON_FantasyWarrior_(Inventory|Status|Stat|Element|Map|Social)_/,
  /^ICON_Input_/,
  /^ICON_Social_/,
  /^ICON_SM_/,
  /^SPR_FantasyScreens_Example_/,
  /^SPR_FantasyScreens_/,
  /^SPR_HUD_FantasyWarrior_Example_/,
  /^SPR_HUD_FantasyWarrior_/,
  /^SPR_FX_FantasyWarrior_/,
  /^SPR_MouseCursor_FantasyWarrior_/,
  /^SPR_FantasyWarrior_/,
  /^SPR_Synty_Branding_/,
];
const VARIANT_RE = /_(Clean|Stroke|Underlay|Side)$/;

type Kind = "icon" | "render" | "sprite";
interface Piece {
  set: string;
  name: string;
  kind: Kind;
  w: number;
  h: number;
  files: Record<string, string>;
}
interface SetInfo {
  id: string;
  pack: string;
  label: string;
  dir: string;
  count: number;
}

function kindOf(file: string): Kind {
  if (file.startsWith("ICON_SM_")) return "render";
  if (file.startsWith("ICON_")) return "icon";
  return "sprite";
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
    else if (entry.name.toLowerCase().endsWith(".png") && !SKIP.test(entry.name)) yield path;
  }
}

function folderId(dirRel: string): string {
  const raw = dirRel
    .replace(/^(Sprites|Core)\//, "")
    .split("/")
    .map((part) => part.replace(/^Icons_/, "").toLowerCase())
    .join("-");
  return SET_ALIASES[raw] ?? raw;
}

function folderLabel(dirRel: string): string {
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
for (const pack of PACKS) {
  for (const dir of pack.dirs) {
    let files: AsyncGenerator<string>;
    try {
      files = pngs(join(pack.root, dir));
    } catch {
      continue;
    }
    for await (const path of files) {
      const rel = relative(pack.root, path);
      const dirRel = rel.slice(0, rel.lastIndexOf("/"));
      const id = `${pack.id}-${folderId(dirRel)}`;
      if (!sets.has(id)) sets.set(id, { id, pack: pack.id, label: `${pack.label} · ${folderLabel(dirRel)}`, dir: `${pack.root}/${dirRel}`, count: 0 });
      const file = rel.slice(rel.lastIndexOf("/") + 1);
      const kind = kindOf(file);
      let stem = file.replace(/\.png$/i, "");
      for (const re of NAME_PREFIXES) stem = stem.replace(re, "");
      const variant = kind === "sprite" ? "" : (VARIANT_RE.exec(stem)?.[1] ?? (kind === "render" ? "Render" : ""));
      const name = kind === "sprite" ? stem : stem.replace(VARIANT_RE, "");
      const outRel = `${id}/${file}`;
      await mkdir(join(OUT, id), { recursive: true });
      await copyFile(path, join(OUT, outRel));
      copied++;
      const key = `${id}/${name}`;
      let piece = pieces.get(key);
      if (!piece) {
        const [w, h] = await pngSize(path);
        piece = { set: id, name, kind, w, h, files: {} };
        pieces.set(key, piece);
        sets.get(id)!.count++;
      }
      piece.files[variant] = outRel;
    }
  }
}

const manifest = {
  version: 3,
  packs: PACKS.map((p) => ({ id: p.id, label: p.label })),
  sets: [...sets.values()].sort((a, b) => a.id.localeCompare(b.id)),
  pieces: [...pieces.values()].sort((a, b) => a.set.localeCompare(b.set) || a.name.localeCompare(b.name)),
};
await writeFile(join(OUT, "manifest.json"), JSON.stringify(manifest) + "\n");
for (const s of manifest.sets) console.log(`${s.id.padEnd(28)} ${String(s.count).padStart(4)} pieces`);
console.log(`copied ${copied} files, ${manifest.pieces.length} pieces, wrote ${OUT}/manifest.json`);
