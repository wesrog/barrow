import { describe, expect, test } from "bun:test";
import { applyDebuff, doomFactor, slowFactor, weakenFactor, type Debuff } from "./debuffs";

const host = () => ({ debuffs: [] as Debuff[] });

describe("debuffs", () => {
  test("chill and slow stack multiplicatively on speed", () => {
    const m = host();
    applyDebuff(m, { kind: "chill", until: 100, power: 0.4 });
    applyDebuff(m, { kind: "slow", until: 100, power: 0.25 });
    expect(slowFactor(m, 50)).toBeCloseTo(0.6 * 0.75);
    expect(slowFactor(m, 100)).toBe(1);
  });

  test("re-applying a kind refreshes the timer and keeps the stronger power", () => {
    const m = host();
    applyDebuff(m, { kind: "weaken", until: 100, power: 0.3 });
    applyDebuff(m, { kind: "weaken", until: 200, power: 0.2 });
    expect(m.debuffs).toEqual([{ kind: "weaken", until: 200, power: 0.3 }]);
    expect(weakenFactor(m, 150)).toBeCloseTo(0.7);
  });

  test("doom raises damage taken", () => {
    const m = host();
    applyDebuff(m, { kind: "doom", until: 100, power: 0.2 });
    expect(doomFactor(m, 10)).toBeCloseTo(1.2);
    expect(doomFactor(m, 100)).toBe(1);
  });
});
