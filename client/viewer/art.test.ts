import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { filterPieces, pieceFile, prettyName, setCounts, TINTS, type ArtManifest, type ArtPiece } from "./art";

const pieces: ArtPiece[] = [
  { set: "inventory", name: "Swords_01", w: 256, h: 256, files: { Clean: "inventory/a_Clean.png", Stroke: "inventory/a_Stroke.png", Underlay: "inventory/a_Underlay.png" } },
  { set: "input-xbox", name: "Xbox_Button_A", w: 256, h: 256, files: { Clean: "input-xbox/b_Clean.png", Underlay: "input-xbox/b_Underlay.png" } },
  { set: "general", name: "Bar_Rounded_01", w: 512, h: 64, files: { "": "general/c.png" } },
];

describe("art helpers", () => {
  test("filters by set and by name or set text", () => {
    expect(filterPieces(pieces, "", new Set(["inventory", "general"])).map((p) => p.name)).toEqual(["Swords_01", "Bar_Rounded_01"]);
    expect(filterPieces(pieces, "sword", new Set(["inventory", "input-xbox", "general"])).length).toBe(1);
    expect(filterPieces(pieces, "xbox", new Set(["input-xbox"])).length).toBe(1);
  });

  test("falls back through the variants a piece has", () => {
    expect(pieceFile(pieces[0]!, "Stroke")).toBe("inventory/a_Stroke.png");
    expect(pieceFile(pieces[1]!, "Stroke")).toBe("input-xbox/b_Clean.png");
    expect(pieceFile(pieces[2]!, "Clean")).toBe("general/c.png");
  });

  test("labels and counts", () => {
    expect(prettyName("Xbox_Button_A")).toBe("Xbox Button A");
    expect(setCounts(pieces).get("inventory")).toBe(1);
    expect(TINTS.some((t) => t.name === "magic")).toBe(true);
  });
});

// Only where the licensed art was copied: the manifest must point at real files.
const OUT = join(import.meta.dir, "../../public/icons/synty");
describe.if(existsSync(join(OUT, "manifest.json")))("copied art manifest", () => {
  test("every piece's files exist and every set counts its pieces", () => {
    const manifest = JSON.parse(readFileSync(join(OUT, "manifest.json"), "utf8")) as ArtManifest;
    expect(manifest.version).toBe(2);
    for (const p of manifest.pieces) {
      expect(Object.keys(p.files).length).toBeGreaterThan(0);
      for (const f of Object.values(p.files)) expect(existsSync(join(OUT, f))).toBe(true);
      expect(p.w).toBeGreaterThan(0);
    }
    const counts = setCounts(manifest.pieces);
    for (const s of manifest.sets) expect(counts.get(s.id)).toBe(s.count);
    expect(manifest.sets.find((s) => s.id === "inventory")?.kind).toBe("icon");
    expect(manifest.sets.find((s) => s.id === "general")?.kind).toBe("sprite");
  });
});
