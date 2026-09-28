import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { SAMPLES } from "./sfx";

describe("sample manifest", () => {
  test("every clip it names is shipped under public/sfx, with the licence beside them", () => {
    for (const [name, urls] of Object.entries(SAMPLES)) {
      expect(urls.length).toBeGreaterThan(0);
      for (const url of urls) expect({ name, url, present: existsSync(`public${url}`) }).toEqual({ name, url, present: true });
    }
    expect(existsSync("public/sfx/kenney/LICENSE.txt")).toBe(true);
  });
});
