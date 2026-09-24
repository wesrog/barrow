import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { filterPieces, pieceFile, prettyName, setCounts, TINTS, type ArtManifest, type ArtPiece } from "./art";

const pieces: ArtPiece[] = [
  { set: "fs-inventory", name: "Swords_01", kind: "icon", w: 256, h: 256, files: { Clean: "fs-inventory/a_Clean.png", Stroke: "fs-inventory/a_Stroke.png", Underlay: "fs-inventory/a_Underlay.png" } },
  { set: "fs-input-xbox", name: "Xbox_Button_A", kind: "icon", w: 256, h: 256, files: { Clean: "fs-input-xbox/b_Clean.png", Underlay: "fs-input-xbox/b_Underlay.png" } },
  { set: "fs-general", name: "Bar_Rounded_01", kind: "sprite", w: 512, h: 64, files: { "": "fs-general/c.png" } },
  { set: "fw-weapons", name: "Wep_Sword_03", kind: "render", w: 1024, h: 1024, files: { Underlay: "fw-weapons/d_Underlay.png", Side: "fw-weapons/d_Side.png", Render: "fw-weapons/d.png" } },
];

describe("art helpers", () => {
  test("filters by set and by name or set text", () => {
    expect(filterPieces(pieces, "", new Set(["fs-inventory", "fs-general"])).map((p) => p.name)).toEqual(["Swords_01", "Bar_Rounded_01"]);
    expect(filterPieces(pieces, "sword", new Set(["fs-inventory", "fs-input-xbox", "fs-general"])).length).toBe(1);
    expect(filterPieces(pieces, "xbox", new Set(["fs-input-xbox"])).length).toBe(1);
  });

  test("falls back through the variants a piece has", () => {
    expect(pieceFile(pieces[0]!, "Stroke")).toBe("fs-inventory/a_Stroke.png");
    expect(pieceFile(pieces[1]!, "Stroke")).toBe("fs-input-xbox/b_Clean.png");
    expect(pieceFile(pieces[2]!, "Clean")).toBe("fs-general/c.png");
    expect(pieceFile(pieces[3]!, "Clean")).toBe("fw-weapons/d.png");
    expect(pieceFile(pieces[0]!, "Render")).toBe("fs-inventory/a_Clean.png");
  });

  test("labels and counts", () => {
    expect(prettyName("Xbox_Button_A")).toBe("Xbox Button A");
    expect(setCounts(pieces).get("fs-inventory")).toBe(1);
    expect(TINTS.some((t) => t.name === "magic")).toBe(true);
  });
});

// Only where the licensed art was copied: the manifest must point at real files.
const OUT = join(import.meta.dir, "../../public/icons/synty");
describe.if(existsSync(join(OUT, "manifest.json")))("copied art manifest", () => {
  test("every piece's files exist and every set counts its pieces", () => {
    const manifest = JSON.parse(readFileSync(join(OUT, "manifest.json"), "utf8")) as ArtManifest;
    expect(manifest.version).toBe(3);
    for (const p of manifest.pieces) {
      expect(Object.keys(p.files).length).toBeGreaterThan(0);
      for (const f of Object.values(p.files)) expect(existsSync(join(OUT, f))).toBe(true);
      expect(p.w).toBeGreaterThan(0);
    }
    const counts = setCounts(manifest.pieces);
    for (const s of manifest.sets) expect(counts.get(s.id)).toBe(s.count);
    expect(manifest.pieces.find((p) => p.set === "fs-inventory")?.kind).toBe("icon");
    expect(manifest.pieces.find((p) => p.set === "fs-general")?.kind).toBe("sprite");
    expect(manifest.pieces.find((p) => p.set === "fw-weapons")?.kind).toBe("render");
  });
});
