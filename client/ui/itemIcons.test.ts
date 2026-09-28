import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BASES } from "../../sim/items/bases";
import { itemIcon, packIcons, setAvailableItemIcons, SYNTY_ITEM_ICONS, type IconManifest } from "./itemIcons";

const ICON_DIR = join(import.meta.dir, "../../public/icons/items");
const MANIFEST = join(import.meta.dir, "../../public/icons/packs/manifest.json");

describe("item icons", () => {
  test("every base has an icon svg", () => {
    const missing = Object.keys(BASES).filter((id) => !existsSync(join(ICON_DIR, `${id}.svg`)));
    expect(missing).toEqual([]);
  });

  test("every base names a pack icon", () => {
    const missing = Object.keys(BASES).filter((id) => !SYNTY_ITEM_ICONS[id]);
    expect(missing).toEqual([]);
  });

  test("uses the pack icon only when it was copied, masks silhouettes and draws renders as images", () => {
    setAvailableItemIcons(new Map());
    expect(itemIcon("rusted_blade")).toEqual({ url: "/icons/items/rusted_blade.svg", kind: "mask" });
    const icons = packIcons({ version: 3, pieces: [
      { set: "as-weapons", name: "one-handed_sword_01", kind: "render", files: { Render: "as-weapons/one-handed_sword_01.png" } },
      { set: "fw-weapons", name: "Wep_Sword_01", kind: "render", files: { Render: "fw-weapons/ICON_SM_Wep_Sword_01.png", Side: "fw-weapons/ICON_SM_Wep_Sword_01_Side.png" } },
      { set: "fs-inventory", name: "Boots_01", kind: "icon", files: { Clean: "fs-inventory/ICON_Boots_01_Clean.png" } },
      { set: "fs-general", name: "Bar_01", kind: "sprite", files: { "": "fs-general/SPR_Bar_01.png" } },
    ] });
    setAvailableItemIcons(icons);
    expect(itemIcon("rusted_blade")).toEqual({ url: "/icons/packs/as-weapons/one-handed_sword_01.png", kind: "image" });
    expect(icons.get("fw-weapons/Wep_Sword_01")).toEqual({ url: "/icons/packs/fw-weapons/ICON_SM_Wep_Sword_01.png", kind: "image", side: "/icons/packs/fw-weapons/ICON_SM_Wep_Sword_01_Side.png" });
    expect(icons.get("fs-inventory/Boots_01")).toEqual({ url: "/icons/packs/fs-inventory/ICON_Boots_01_Clean.png", kind: "mask" });
    expect(icons.has("fs-general/Bar_01")).toBe(false);
    expect(itemIcon("hatchet").kind).toBe("mask");
    expect(itemIcon("hatchet").url).toBe("/icons/items/hatchet.svg");
  });

  // Only where the licensed art was copied.
  test.if(existsSync(MANIFEST))("every mapped icon exists in the copied packs", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as IconManifest;
    const have = packIcons(manifest);
    const missing = [...new Set(Object.values(SYNTY_ITEM_ICONS))].filter((n) => !have.has(n));
    expect(missing).toEqual([]);
  });
});
