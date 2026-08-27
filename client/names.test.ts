import { describe, expect, test } from "bun:test";
import { generateName } from "./names";

/** Tiny deterministic RNG for tests — same shape as Math.random. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("generateName", () => {
  test("produces a non-empty name within the 16-char input limit", () => {
    const rand = seeded(7);
    for (let i = 0; i < 200; i++) {
      const name = generateName(rand);
      expect(name.length).toBeGreaterThan(1);
      expect(name.length).toBeLessThanOrEqual(16);
    }
  });

  test("is capitalized and only letters", () => {
    const rand = seeded(42);
    for (let i = 0; i < 200; i++) {
      const name = generateName(rand);
      expect(name).toMatch(/^[A-Z][a-z]+$/);
    }
  });

  test("same RNG sequence gives the same name", () => {
    expect(generateName(seeded(9))).toBe(generateName(seeded(9)));
  });

  test("varies across rolls", () => {
    const rand = seeded(3);
    const names = new Set(Array.from({ length: 50 }, () => generateName(rand)));
    expect(names.size).toBeGreaterThan(20);
  });
});
