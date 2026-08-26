import { describe, expect, test } from "bun:test";
import { createRng } from "./rng";

describe("createRng", () => {
  test("same seed produces the same sequence", () => {
    const a = createRng(1234);
    const b = createRng(1234);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  test("different seeds produce different sequences", () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  test("next() stays in [0, 1)", () => {
    const rng = createRng(99);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test("int(min, max) is inclusive of both ends and covers the range", () => {
    const rng = createRng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const v = rng.int(3, 6);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
    }
    expect(seen).toEqual(new Set([3, 4, 5, 6]));
  });

  test("state() lets a new rng resume the exact stream", () => {
    const a = createRng(12345);
    for (let i = 0; i < 7; i++) a.next();
    const b = createRng(a.state());
    const tailA = [a.next(), a.int(1, 100), a.next()];
    const tailB = [b.next(), b.int(1, 100), b.next()];
    expect(tailB).toEqual(tailA);
  });
});
