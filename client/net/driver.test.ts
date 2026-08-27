import { expect, test } from "bun:test";
import { localDriver } from "./driver";
import { INPUT_DELAY_TICKS } from "../../net/protocol";

/** Ask the driver for one tick and consume the frame it produced — exactly
 * what the main loop does per accumulated tick. */
function tick(driver: ReturnType<typeof localDriver>): boolean {
  driver.requestTick?.();
  return driver.session.tryStep();
}

test("localDriver runs the solo game forward one tick per requested tick", () => {
  const driver = localDriver(1234);
  expect(driver.session.localId).toBe(0);

  for (let i = 0; i < 100; i++) {
    expect(tick(driver)).toBe(true);
  }

  const state = driver.session.state!;
  expect(state.tick).toBe(100);
  expect(state.players.has(0)).toBe(true);
  driver.stop();
});

test("localDriver applies local input exactly INPUT_DELAY_TICKS later", () => {
  const driver = localDriver(1234);
  for (let i = 0; i < 3; i++) tick(driver);
  const state = driver.session.state!;
  expect(state.tick).toBe(3);

  const me = state.players.get(0)!;
  const start = { ...me.pos };
  // Somewhere reachable inside the camp, a few cells along.
  driver.sendInput({ moveTo: { x: start.x + 3, y: start.y } });

  // Ticks 3 and 4 run on empty input: the hero has not moved yet.
  for (let t = 3; t < 3 + INPUT_DELAY_TICKS; t++) {
    expect(tick(driver)).toBe(true);
    expect(state.players.get(0)!.pos).toEqual(start);
  }
  expect(state.tick).toBe(3 + INPUT_DELAY_TICKS);

  // The step of tick 3 + INPUT_DELAY_TICKS is the one that carries the input.
  expect(tick(driver)).toBe(true);
  expect(state.players.get(0)!.pos).not.toEqual(start);
  driver.stop();
});
