import { expect, test } from "bun:test";
import { hostCore, localDriver, mismatchedPlayers } from "./driver";
import { Session } from "../../net/session";
import { INPUT_DELAY_TICKS } from "../../net/protocol";
import type { ClientMsg, HostMsg } from "../../net/protocol";
import type { PeerLink } from "./rtc";

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

/** A PeerLink the test drives by hand: whatever the host sends piles up in
 * `sent`, and `deliver` plays a client message back the other way. */
function fakeLink() {
  const sent: HostMsg[] = [];
  let onMsg: ((msg: ClientMsg) => void) | null = null;
  let onClose: (() => void) | null = null;
  const link: PeerLink = {
    send: (msg) => void sent.push(msg as HostMsg),
    onMessage: (cb) => void (onMsg = cb),
    onClose: (cb) => void (onClose = cb),
    close: () => {},
  };
  return {
    link,
    sent,
    deliver: (msg: ClientMsg) => onMsg?.(msg),
    drop: () => onClose?.(),
  };
}

test("hostCore seats a peer, welcomes it, and fans frames out", () => {
  const core = hostCore(99);
  core.pump(); // frame 0 seats the host

  const peer = fakeLink();
  core.onPeer(peer.link);
  peer.deliver({ type: "hello" });

  expect(peer.sent[0]).toMatchObject({ type: "welcome", playerId: 1 });

  core.pump();
  const frame = peer.sent[1];
  expect(frame?.type).toBe("frame");
  if (frame?.type === "frame") expect(frame.frame.joins).toEqual([{ id: 1, character: undefined }]);

  // The host's own world seats the joiner off that same frame.
  core.driver.session.tryStep();
  core.driver.session.tryStep();
  expect(core.driver.session.state!.players.has(1)).toBe(true);
  core.driver.stop();
});

test("a peer joining a host whose session lags still gets a snapshot it can step from", () => {
  // Backgrounded host tab: the 25 Hz interval keeps pumping frames, but rAF is
  // paused so nothing drives session.tryStep(). The snapshot must still be taken
  // at the sequencer's tick, or the joiner waits forever on a frame it never gets.
  const core = hostCore(99);
  core.pump();
  core.pump();
  expect(core.driver.session.state!.tick).toBe(0); // host hasn't stepped

  const peer = fakeLink();
  core.onPeer(peer.link);
  peer.deliver({ type: "hello" });
  core.pump();

  // Replay everything the link received into a fresh Session, as joinDriver does.
  const joiner = new Session(() => {});
  for (const msg of peer.sent) joiner.onHostMsg(msg);
  while (joiner.tryStep());

  const host = core.driver.session;
  while (host.tryStep());
  expect(host.state!.tick).toBe(3);
  expect(joiner.state!.tick).toBe(host.state!.tick);
  core.driver.stop();
});

test("hostCore frees the seat when a peer's link closes", () => {
  const core = hostCore(99);
  core.pump();
  const peer = fakeLink();
  core.onPeer(peer.link);
  peer.deliver({ type: "hello" });
  core.pump();
  const session = core.driver.session;
  while (session.tryStep());
  expect(session.state!.players.has(1)).toBe(true);

  // A dropped link is off the fan-out list, so the leave shows up in the
  // host's own world (and every surviving peer's), not in the dead peer's.
  peer.drop();
  core.pump();
  while (session.tryStep());
  expect(session.state!.players.has(1)).toBe(false);
  expect(session.state!.events).toContainEqual({ type: "player_left", playerId: 1 });
  core.driver.stop();
});

test("mismatchedPlayers names everyone who disagrees with the host", () => {
  expect(mismatchedPlayers(new Map())).toEqual([]);
  expect(mismatchedPlayers(new Map([[0, 7]]))).toEqual([]); // nothing to compare against
  expect(
    mismatchedPlayers(
      new Map([
        [0, 7],
        [1, 7],
      ]),
    ),
  ).toEqual([]);
  expect(
    mismatchedPlayers(
      new Map([
        [0, 7],
        [1, 8],
        [2, 9],
      ]),
    ),
  ).toEqual([1, 2]);
  // No host hash: the first report becomes the reference.
  expect(
    mismatchedPlayers(
      new Map([
        [1, 7],
        [2, 8],
      ]),
    ),
  ).toEqual([2]);
});

test("hostCore trips the desync tripwire when a peer's hash disagrees", () => {
  const core = hostCore(99);
  core.pump();
  const peer = fakeLink();
  core.onPeer(peer.link);
  peer.deliver({ type: "hello" });

  // Both worlds report a hash for the same future tick; the peer's differs.
  const tick = 20;
  core.driver.sequencer!.onInput(0, tick, {}, 0xabc);
  peer.deliver({ type: "input", tick, input: {}, hash: 0xdef });

  for (let i = 1; i <= tick; i++) core.pump();

  expect(peer.sent.find((m) => m.type === "desync")).toEqual({
    type: "desync",
    tick: tick - INPUT_DELAY_TICKS,
    playerId: 1,
  });
  // A diverged world keeps mismatching; the peer is told once, not forever.
  core.driver.sequencer!.onInput(0, tick + 50, {}, 0x111);
  peer.deliver({ type: "input", tick: tick + 50, input: {}, hash: 0x222 });
  for (let i = 0; i < 51; i++) core.pump();
  expect(peer.sent.filter((m) => m.type === "desync")).toHaveLength(1);
  // The host's own HUD raises the banner too.
  expect(core.driver.session.desyncAt).toBe(tick - INPUT_DELAY_TICKS);
  core.driver.stop();
});

test("hostCore stays quiet while every hash agrees", () => {
  const core = hostCore(99);
  core.pump();
  const peer = fakeLink();
  core.onPeer(peer.link);
  peer.deliver({ type: "hello" });

  const tick = 20;
  core.driver.sequencer!.onInput(0, tick, {}, 0xabc);
  peer.deliver({ type: "input", tick, input: {}, hash: 0xabc });
  for (let i = 1; i <= tick; i++) core.pump();

  expect(peer.sent.some((m) => m.type === "desync")).toBe(false);
  expect(core.driver.session.desyncAt).toBeNull();
  core.driver.stop();
});
