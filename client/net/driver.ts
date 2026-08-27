// The seam between the game loop and the network. main.tsx holds a NetDriver
// and never learns whether the frames it steps on came from an in-process
// Sequencer (solo), an in-process Sequencer that also feeds peers (host), or a
// DataChannel (joined). Everything below the seam is Session + Sequencer, which
// are pure; only the host/join drivers touch the browser, and they reach for
// rtc.ts lazily so tests can import this module without a DOM.

import { Sequencer } from "../../net/sequencer";
import { Session } from "../../net/session";
import { serializeGame } from "../../net/snapshot";
import type { ClientMsg, HostMsg } from "../../net/protocol";
import { createGame, TICK_RATE } from "../../sim/tick";
import type { PlayerId, PlayerInput } from "../../sim/state";
import type { PeerLink } from "./rtc";

/** What main.tsx talks to; hides solo vs host vs joined. */
export interface NetDriver {
  readonly session: Session;
  sendInput(input: PlayerInput): void;
  /** Solo only: make the next frame available, since nothing else produces one.
   * Absent for host (a 25 Hz interval pumps frames) and joiners (the host does).
   * It only *emits* the frame — the caller still drives `session.tryStep()`. */
  requestTick?(): void;
  /** Called when the underlying transport goes away (host left / peer dropped). */
  onClose?(cb: () => void): void;
  stop(): void;
}

/** Sequencer + Session wired to each other in-process: the reference wiring
 * that solo and host both sit on. The host additionally fans `emitFrame` out
 * to its peers. */
function localCore(seed: number, character?: string) {
  const sequencer = new Sequencer(character);
  const session: Session = new Session((msg: ClientMsg) => {
    if (msg.type === "input") {
      sequencer.onInput(session.localId ?? 0, msg.tick, msg.input, msg.hash);
    }
  });
  // Bootstrap: an empty world at tick 0. Frame 0 carries the host's own join,
  // so the local hero is seated by the first step like everybody else.
  session.onHostMsg({
    type: "welcome",
    playerId: 0,
    snapshot: serializeGame(createGame(seed)),
    snapshotTick: 0,
  });

  /** Assemble the next frame, hand it to the local session, and return it so
   * a host can broadcast the very same frame to its peers. */
  const emitFrame = (): HostMsg => {
    const msg: HostMsg = { type: "frame", frame: sequencer.nextFrame() };
    session.onHostMsg(msg);
    return msg;
  };

  return { sequencer, session, emitFrame };
}

/** Solo: an in-process Sequencer wired straight into the Session. One frame per requested tick. */
export function localDriver(seed: number, character?: string): NetDriver {
  const { session, emitFrame } = localCore(seed, character);
  return {
    session,
    sendInput: (input) => session.sendInput(input),
    requestTick: () => void emitFrame(),
    stop: () => {},
  };
}

/** Host: Sequencer + rtc.hostGame; emits frames on a 25 Hz interval; serves welcome snapshots. */
export async function hostDriver(
  seed: number,
  signalUrl: string,
  character?: string,
): Promise<{ driver: NetDriver; code: string }> {
  const { hostGame } = await import("./rtc");
  const { sequencer, session, emitFrame } = localCore(seed, character);
  const links = new Map<PeerLink, PlayerId | null>();

  const onPeer = (link: PeerLink) => {
    links.set(link, null);
    link.onMessage((msg: ClientMsg) => {
      if (msg.type === "hello") {
        if (links.get(link) !== null) return; // already seated
        // Order matters: snapshot the world at tick T *before* queuing the
        // join, so the join rides a frame the joiner is also going to get.
        // The welcome goes out synchronously, before the next interval fires,
        // so the joiner sees every frame from T onward.
        const snapshot = serializeGame(session.state!);
        const snapshotTick = session.state!.tick;
        let id: PlayerId;
        try {
          id = sequencer.addPeer(msg.character);
        } catch {
          link.close();
          links.delete(link);
          return;
        }
        links.set(link, id);
        link.send({ type: "welcome", playerId: id, snapshot, snapshotTick } satisfies HostMsg);
      } else if (msg.type === "input") {
        const id = links.get(link);
        if (id != null) sequencer.onInput(id, msg.tick, msg.input, msg.hash);
      }
    });
    link.onClose(() => {
      const id = links.get(link);
      if (id != null) sequencer.removePeer(id);
      links.delete(link);
    });
  };

  const room = await hostGame(signalUrl, onPeer);

  // Backgrounded tabs throttle setInterval; v1 accepts the resulting slowdown
  // (everyone is lockstepped to the host, so the game stalls rather than desyncs).
  const timer = setInterval(() => {
    const msg = emitFrame();
    for (const link of links.keys()) link.send(msg);
  }, 1000 / TICK_RATE);

  // A host has no transport that can go away underneath it — the game ends
  // when it calls stop(). Callbacks are registered so callers get consistent
  // behaviour across drivers, and stop() fires them so a shared teardown path
  // works either way; nothing else invokes them in v1.
  const closeCbs: (() => void)[] = [];

  const driver: NetDriver = {
    session,
    sendInput: (input) => session.sendInput(input),
    onClose: (cb) => closeCbs.push(cb),
    stop: () => {
      clearInterval(timer);
      for (const link of links.keys()) link.close();
      links.clear();
      room.stop();
      for (const cb of closeCbs.splice(0)) cb();
    },
  };
  return { driver, code: room.code };
}

/** Joiner: rtc.joinGame; sends hello, awaits welcome. */
export async function joinDriver(
  signalUrl: string,
  code: string,
  character?: string,
): Promise<NetDriver> {
  const { joinGame } = await import("./rtc");
  const link = await joinGame(signalUrl, code);
  const session = new Session((msg: ClientMsg) => link.send(msg));

  const closeCbs: (() => void)[] = [];
  let welcomed = false;

  await new Promise<void>((resolve, reject) => {
    link.onMessage((msg: HostMsg) => {
      session.onHostMsg(msg);
      if (msg.type === "welcome" && !welcomed) {
        welcomed = true;
        resolve();
      }
    });
    link.onClose(() => {
      if (!welcomed) reject(new Error("host closed before welcome"));
      for (const cb of closeCbs) cb();
    });
    link.send({ type: "hello", character } satisfies ClientMsg);
  });

  return {
    session,
    sendInput: (input) => session.sendInput(input),
    onClose: (cb) => closeCbs.push(cb),
    stop: () => link.close(),
  };
}
