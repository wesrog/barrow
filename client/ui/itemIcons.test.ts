import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BASES } from "../../sim/items/bases";
import { itemIconUrl, setAvailableItemIcons, SYNTY_ITEM_ICONS } from "./itemIcons";

const ICON_DIR = join(import.meta.dir, "../../public/icons/items");
const MANIFEST = join(import.meta.dir, "../../public/icons/synty/manifest.json");

describe("item icons", () => {
  test("every base has an icon svg", () => {
    const missing = Object.keys(BASES).filter((id) => !existsSync(join(ICON_DIR, `${id}.svg`)));
    expect(missing).toEqual([]);
  });

  test("every base names a Fantasy Screens icon", () => {
    const missing = Object.keys(BASES).filter((id) => !SYNTY_ITEM_ICONS[id]);
    expect(missing).toEqual([]);
  });

  test("uses the pack icon only when it was copied, else the svg", () => {
    setAvailableItemIcons([]);
    expect(itemIconUrl("rusted_blade")).toBe("/icons/items/rusted_blade.svg");
    setAvailableItemIcons(["Swords_01"]);
    expect(itemIconUrl("rusted_blade")).toBe("/icons/synty/inventory/Swords_01.png");
    expect(itemIconUrl("hatchet")).toBe("/icons/items/hatchet.svg");
    expect(itemIconUrl("nothing")).toBe("/icons/items/nothing.svg");
  });

  // Only where the licensed icons were copied.
  test.if(existsSync(MANIFEST))("every mapped icon exists in the copied pack", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as Record<string, string[]>;
    const have = new Set(manifest.inventory);
    const missing = [...new Set(Object.values(SYNTY_ITEM_ICONS))].filter((n) => !have.has(n));
    expect(missing).toEqual([]);
  });
});
