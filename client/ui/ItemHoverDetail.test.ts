import { describe, expect, test } from "bun:test";
import { createEquipment } from "../../sim/character";
import type { Item } from "../../sim/items/generate";
import { itemDetail } from "./ItemHoverDetail";

const plain = (baseId: string): Item => ({ baseId, rarity: "normal", name: baseId, affixIds: [], mods: [], ilvl: 1 });
const texts = (lines: { text: string }[]) => lines.map((l) => l.text);

describe("itemDetail and two-handers", () => {
  test("a two-hander says so, and names the shield it would knock off", () => {
    const eq = createEquipment();
    expect(texts(itemDetail(plain("war_maul"), 10, "warrior", eq).lines)).toContain("two-handed");
    eq.shield = { ...plain("plank_buckler"), name: "Plank Buckler" };
    expect(texts(itemDetail(plain("war_maul"), 10, "warrior", eq).lines)).toContain(
      "two-handed — unequips Plank Buckler",
    );
  });

  test("a shield warns when both hands are already full", () => {
    const eq = createEquipment();
    eq.weapon = plain("war_maul");
    const detail = itemDetail(plain("plank_buckler"), 10, "warrior", eq);
    const line = detail.lines.find((l) => l.text.includes("two-handed"));
    expect(line?.text).toBe("cannot hold with a two-handed weapon");
    expect(line?.color).toBeDefined();
    expect(texts(itemDetail(plain("plank_buckler"), 10, "warrior").lines).join()).not.toContain("two-handed");
  });
});
