import { expect, test } from "bun:test";
import { Sequencer } from "./sequencer";

test("host is seated as player 0 in frame 0", () => {
  const s = new Sequencer();
  const f0 = s.nextFrame();
  expect(f0.tick).toBe(0);
  expect(f0.joins).toEqual([{ id: 0, character: undefined }]);
});

test("frames carry received inputs and empty-default missing ones", () => {
  const s = new Sequencer();
  s.nextFrame();
  const id = s.addPeer();
  const f1 = s.nextFrame();
  expect(f1.joins).toEqual([{ id, character: undefined }]);
  s.onInput(0, 2, { drink: true });
  const f2 = s.nextFrame();
  expect(f2.inputs[0]).toEqual({ drink: true });
  expect(f2.inputs[id]).toBeUndefined(); // missing = no input, sim treats as {}
});

test("late input is rescheduled into the next frame, never dropped", () => {
  // A relayed joiner's inputs routinely arrive stamped for ticks the host has
  // already emitted (transport latency exceeds INPUT_DELAY_TICKS). The click
  // must still happen — just a beat later.
  const s = new Sequencer();
  s.nextFrame(); // tick 0 emitted; sequencer now at tick 1
  s.onInput(0, 0, { drink: true }); // late by one tick
  const f1 = s.nextFrame();
  expect(f1.inputs[0]).toEqual({ drink: true });
  // A fresher input already pending for the current tick wins over a
  // later-arriving stale one (ordered transport: arrival order is send order).
  s.onInput(0, 2, { drink: true });
  s.onInput(0, 0, { moveTo: { x: 1, y: 1 } }); // stale arrival, rescheduled to 2
  const f2 = s.nextFrame();
  expect(f2.inputs[0]).toEqual({ moveTo: { x: 1, y: 1 } });
});

test("a hash riding a late input is not recorded (hashes are tick-exact)", () => {
  const s = new Sequencer();
  s.nextFrame();
  s.nextFrame(); // at tick 2
  s.onInput(0, 1, { drink: true }, 0xbeef);
  expect(s.hashesFor(1).size).toBe(0);
  expect(s.hashesFor(2).size).toBe(0); // not rescheduled either
});

test("ids are recycled lowest-first; 5th peer throws", () => {
  const s = new Sequencer();
  s.nextFrame();
  const a = s.addPeer(),
    b = s.addPeer(),
    c = s.addPeer();
  expect([a, b, c]).toEqual([1, 2, 3]);
  expect(() => s.addPeer()).toThrow();
  s.removePeer(2);
  expect(s.nextFrame().leaves).toEqual([2]);
  expect(s.addPeer()).toBe(2);
});

test("hashes are collected per tick", () => {
  const s = new Sequencer();
  s.nextFrame();
  s.onInput(0, 5, {}, 0xabc);
  expect(s.hashesFor(5).get(0)).toBe(0xabc);
});
