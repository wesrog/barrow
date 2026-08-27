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

test("late input for a past tick is dropped; ids are recycled lowest-first; 5th peer throws", () => {
  const s = new Sequencer();
  s.nextFrame();
  s.onInput(0, 0, { drink: true }); // tick 0 already emitted
  const f = s.nextFrame();
  expect(f.inputs[0]).toBeUndefined();
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
