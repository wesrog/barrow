import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { BASES } from "../../sim/items/bases";

const ICON_DIR = join(import.meta.dir, "../../public/icons/items");

describe("item icons", () => {
  test("every base has an icon svg", () => {
    const missing = Object.keys(BASES).filter((id) => !existsSync(join(ICON_DIR, `${id}.svg`)));
    expect(missing).toEqual([]);
  });
});
