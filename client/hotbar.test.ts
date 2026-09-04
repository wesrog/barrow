import { describe, expect, test } from "bun:test";
import { HOTBAR_SIZE, defaultHotbar, normalizeHotbar, slotForKey } from "./hotbar";

describe("hotbar", () => {
  test("six slots: the mouse first, then five keys", () => {
    expect(HOTBAR_SIZE).toBe(6);
    expect(slotForKey("q")).toBe(1);
    expect(slotForKey("f")).toBe(5);
    expect(slotForKey("rmb")).toBe(-1);
    expect(slotForKey("x")).toBe(-1);
  });

  test("defaults put each class's opener on the mouse and deal the rest across keys", () => {
    expect(defaultHotbar("warrior")).toEqual(["cleave", "warcry", "charge", "crush", "taunt", "leap"]);
    expect(defaultHotbar("witch")).toEqual(["firebolt", "frostbolt", "weaken", "fireball", "frostnova", "blink"]);
  });

  test("a legacy four-key bar shifts onto the keys and the mouse takes the opener", () => {
    // The opener is already on a key, so the mouse stays empty rather than duplicating it.
    expect(normalizeHotbar(["cleave", "crush", "warcry", "leap"], "warrior")).toEqual([
      null, "cleave", "crush", "warcry", "leap", null,
    ]);
    expect(normalizeHotbar(["crush", "warcry", "leap", "stomp"], "warrior")).toEqual([
      "cleave", "crush", "warcry", "leap", "stomp", null,
    ]);
  });

  test("unknown, off-class, and passive ids fall out", () => {
    expect(normalizeHotbar(["cleave", "firebolt", "weaponmastery", "chainbolt", null, "crush"], "warrior")).toEqual([
      "cleave", null, null, null, null, "crush",
    ]);
  });

  test("garbage falls back to the defaults", () => {
    expect(normalizeHotbar("nope", "witch")).toEqual(defaultHotbar("witch"));
  });
});
