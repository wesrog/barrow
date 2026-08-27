import { expect, test } from "bun:test";
import { createGame } from "../sim/tick";
import { serializeGame } from "./snapshot";
import { Sequencer } from "./sequencer";
import { Session } from "./session";
import { INPUT_DELAY_TICKS } from "./protocol";
import { HASH_EVERY_TICKS } from "./hash";
import type { ClientMsg, HostMsg } from "./protocol";
import type { PlayerId } from "../sim/state";

/** Wires a Sequencer as host and any number of client Sessions over
 * in-memory function transports: each session's onSend feeds the
 * sequencer's onInput; nextFrame() is broadcast to every connected session
 * (including the host's own loopback session, which is just another
 * Session — no special casing). */
function makeHarness() {
  const sequencer = new Sequencer();
  const sessions: Session[] = [];

  function connect(): Session {
    const session = new Session((msg: ClientMsg) => {
      if (msg.type === "input") {
        sequencer.onInput(session.localId!, msg.tick, msg.input, msg.hash);
      }
    });
    sessions.push(session);
    return session;
  }

  function broadcast(msg: HostMsg) {
    for (const s of sessions) s.onHostMsg(msg);
  }

  return { sequencer, sessions, connect, broadcast };
}

test("two sessions lockstep over 200 ticks converge to byte-identical state", () => {
  const { sequencer, connect, broadcast } = makeHarness();

  // Bootstrap: host session receives its own welcome from a fresh empty
  // snapshot at tick 0; frame 0 then carries the host's own join.
  const hostSession = connect();
  const bootstrap = createGame(1);
  hostSession.onHostMsg({
    type: "welcome",
    playerId: 0,
    snapshot: serializeGame(bootstrap),
    snapshotTick: 0,
  });

  const peerSession = connect();
  const peerId = sequencer.addPeer();
  peerSession.onHostMsg({
    type: "welcome",
    playerId: peerId,
    snapshot: serializeGame(bootstrap),
    snapshotTick: 0,
  });

  let thirdSession: Session | null = null;

  for (let tick = 0; tick < 200; tick++) {
    // Scripted inputs: host moves every tick, peer drinks every 10th tick.
    hostSession.sendInput({ moveTo: { x: (tick % 20) + 1, y: 1 } });
    if (tick % 10 === 0) peerSession.sendInput({ drink: true });

    const frame = sequencer.nextFrame();
    broadcast({ type: "frame", frame });

    expect(hostSession.tryStep()).toBe(true);
    expect(peerSession.tryStep()).toBe(true);

    if (tick === 100) {
      thirdSession = connect();
      const joinerId = sequencer.addPeer();
      thirdSession.onHostMsg({
        type: "welcome",
        playerId: joinerId,
        snapshot: serializeGame(hostSession.state!),
        snapshotTick: hostSession.state!.tick,
      });
    }
  }

  // Drain any frames the third session buffered before or at join time.
  while (thirdSession!.tryStep()) {
    /* drain */
  }
  while (hostSession.tryStep()) {
    /* drain */
  }
  while (peerSession.tryStep()) {
    /* drain */
  }

  expect(serializeGame(hostSession.state!)).toBe(serializeGame(peerSession.state!));
  expect(serializeGame(hostSession.state!)).toBe(serializeGame(thirdSession!.state!));
});

test("tryStep returns false when the buffer is empty", () => {
  const session = new Session(() => {});
  const bootstrap = createGame(2);
  session.onHostMsg({
    type: "welcome",
    playerId: 0,
    snapshot: serializeGame(bootstrap),
    snapshotTick: 0,
  });
  expect(session.tryStep()).toBe(false);
});

test("sendInput stamps currentTick + INPUT_DELAY_TICKS", () => {
  const sent: ClientMsg[] = [];
  const session = new Session((msg) => sent.push(msg));
  const bootstrap = createGame(4);
  session.onHostMsg({
    type: "welcome",
    playerId: 0,
    snapshot: serializeGame(bootstrap),
    snapshotTick: 0,
  });

  session.sendInput({ drink: true });
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ type: "input", tick: 0 + INPUT_DELAY_TICKS });

  // Buffering a frame and stepping should advance state.tick; stamp should
  // follow the stepped tick, not be frozen at construction time.
  session.onHostMsg({ type: "frame", frame: { tick: 0, inputs: {} } });
  expect(session.tryStep()).toBe(true);
  expect(session.state!.tick).toBe(1);

  session.sendInput({ drink: true });
  expect(sent[1]).toMatchObject({ type: "input", tick: 1 + INPUT_DELAY_TICKS });
});

test("a hash rides every HASH_EVERY_TICKS-th input message", () => {
  const sent: ClientMsg[] = [];
  const session = new Session((msg) => sent.push(msg));
  const bootstrap = createGame(5);
  session.onHostMsg({
    type: "welcome",
    playerId: 0,
    snapshot: serializeGame(bootstrap),
    snapshotTick: 0,
  });

  // Drive state.tick up to HASH_EVERY_TICKS by feeding empty frames.
  for (let i = 0; i < HASH_EVERY_TICKS; i++) {
    session.onHostMsg({ type: "frame", frame: { tick: i, inputs: {} } });
    expect(session.tryStep()).toBe(true);
  }
  expect(session.state!.tick).toBe(HASH_EVERY_TICKS);

  session.sendInput({ drink: true });
  const last = sent[sent.length - 1]!;
  expect(last).toMatchObject({ type: "input", tick: HASH_EVERY_TICKS + INPUT_DELAY_TICKS });
  expect((last as { hash?: number }).hash).toBeDefined();
});

test("desync message sets desyncAt", () => {
  const session = new Session(() => {});
  const bootstrap = createGame(6);
  session.onHostMsg({
    type: "welcome",
    playerId: 0,
    snapshot: serializeGame(bootstrap),
    snapshotTick: 0,
  });
  expect(session.desyncAt).toBeNull();
  session.onHostMsg({ type: "desync", tick: 42, playerId: 0 });
  expect(session.desyncAt).toBe(42);
});

test("buffered() counts frames at or ahead of state.tick", () => {
  const session = new Session(() => {});
  const bootstrap = createGame(7);
  session.onHostMsg({
    type: "welcome",
    playerId: 0,
    snapshot: serializeGame(bootstrap),
    snapshotTick: 0,
  });
  expect(session.buffered()).toBe(0);
  session.onHostMsg({ type: "frame", frame: { tick: 0, inputs: {} } });
  session.onHostMsg({ type: "frame", frame: { tick: 1, inputs: {} } });
  expect(session.buffered()).toBe(2);
  session.tryStep();
  expect(session.buffered()).toBe(1);
});

test("welcome sets state, localId, and matches snapshotTick", () => {
  const session = new Session(() => {});
  const bootstrap = createGame(8);
  bootstrap.tick = 37;
  session.onHostMsg({
    type: "welcome",
    playerId: 3 as PlayerId,
    snapshot: serializeGame(bootstrap),
    snapshotTick: 37,
  });
  expect(session.localId).toBe(3);
  expect(session.state).not.toBeNull();
  expect(session.state!.tick).toBe(37);
});
