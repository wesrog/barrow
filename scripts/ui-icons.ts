/**
 * Copy the Synty INTERFACE Fantasy Screens icons the HUD can use out of the
 * licensed source folder into public/icons/synty/ (gitignored, like the
 * models), and write a manifest the client reads to know which are present.
 * Icons are white silhouettes on transparency, so the HUD masks and tints
 * them exactly as it does the CC-licensed SVGs they replace.
 *
 *   bun scripts/ui-icons.ts
 */
import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SRC = "assets-src/synty/fantasy_screens/Sprites";
const OUT = "public/icons/synty";

/** Source folder -> output folder, with the file-name prefix stripped from each icon. */
const SETS: { dir: string; out: string; prefix: string; variant: string }[] = [
  { dir: "Icons_Inventory", out: "inventory", prefix: "ICON_FantasyScreens_Inventory_", variant: "_Clean" },
  { dir: "Icons_Menu", out: "menu", prefix: "ICON_FantasyScreens_Menu_", variant: "_Clean" },
  { dir: "Icons_Character", out: "character", prefix: "ICON_FantasyScreens_Character_", variant: "_Clean" },
  { dir: "Icons_Playback", out: "playback", prefix: "ICON_FantasyScreens_Playback_", variant: "_Clean" },
];

const manifest: Record<string, string[]> = {};
for (const set of SETS) {
  const files = (await readdir(join(SRC, set.dir))).filter((f) => f.startsWith(set.prefix) && f.endsWith(`${set.variant}.png`));
  await mkdir(join(OUT, set.out), { recursive: true });
  const names: string[] = [];
  for (const f of files) {
    const name = f.slice(set.prefix.length, -`${set.variant}.png`.length);
    await copyFile(join(SRC, set.dir, f), join(OUT, set.out, `${name}.png`));
    names.push(name);
  }
  manifest[set.out] = names.sort();
  console.log(`${set.out}: ${names.length} icons`);
}
await writeFile(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

// A contact sheet for picking icons: /icons/synty/_gallery.html on the dev server.
const tile = (set: string, name: string) =>
  `<div class="i"><div style="-webkit-mask-image:url(${set}/${name}.png);mask-image:url(${set}/${name}.png)"></div>${name}</div>`;
const gallery =
  `<!doctype html><meta charset="utf-8"><title>icons</title><style>body{background:#14141a;color:#d8d2c4;font:11px ui-monospace,monospace;margin:16px}` +
  `h2{font-size:13px;margin:14px 0 6px;color:#e8dcc0}.g{display:flex;flex-wrap:wrap;gap:8px}.i{width:96px;text-align:center}` +
  `.i div{width:64px;height:64px;margin:0 auto 3px;background:#d9b85c;-webkit-mask-size:contain;mask-size:contain;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center}</style>` +
  Object.entries(manifest)
    .map(([set, names]) => `<h2>${set} (${names.length})</h2><div class="g">${names.map((n) => tile(set, n)).join("")}</div>`)
    .join("");
await writeFile(join(OUT, "_gallery.html"), gallery);
console.log(`wrote ${OUT}/manifest.json and _gallery.html`);
