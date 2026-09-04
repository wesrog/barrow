import { describe, expect, test } from "bun:test";
import { effectiveResist, resistedDamage } from "./elements";

describe("resistance", () => {
  test("no resistance passes damage through", () => expect(resistedDamage(40, 0)).toBe(40));
  test("partial resistance scales down and floors", () => expect(resistedDamage(41, 50)).toBe(20));
  test("immunity zeroes damage", () => expect(resistedDamage(40, 100)).toBe(0));
  test("weakness scales up", () => expect(resistedDamage(40, -50)).toBe(60));
  test("cold mastery subtracts from partial resistance at full strength", () => {
    expect(effectiveResist(50, { coldMasteryReduction: 24 })).toBe(26);
  });
  test("cold mastery bites immunities at one fifth", () => {
    expect(effectiveResist(100, { coldMasteryReduction: 80 })).toBe(84);
  });
  test("resistance never drops below -100 from mastery", () => {
    expect(effectiveResist(0, { coldMasteryReduction: 500 })).toBe(-100);
  });
  test("doom multiplies after resistance", () => {
    expect(resistedDamage(40, 50, { doomPower: 0.5 })).toBe(30);
  });
});
