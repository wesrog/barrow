// The seam between the game loop and the network. main.tsx holds a NetDriver
// and never learns whether the frames it steps on came from an in-process
// Sequencer (solo), an in-process Sequencer that also feeds peers (host), or a
// DataChannel (joined). Everything below the seam is Session + Sequencer, which
// are pure; only the host/join drivers touch the browser, and they reach for
// rtc.ts lazily so tests can import this module without a DOM.

import { Sequencer } from "../../net/sequencer";
import { Session } from "../../net/session";
import { serializeGame } from "../../net/snapshot";
import { INPUT_DELAY_TICKS } from "../../net/protocol";
import type { ClientMsg, HostMsg } from "../../net/protocol";
import { createGame, TICK_RATE } from "../../sim/tick";
import type { PlayerId, PlayerInput } from "../../sim/state";
import type { PeerLink } from "./rtc";

/** What main.tsx talks to; hides solo vs host vs joined. */
export interface NetDriver {
  readonly session: Session;
  /** The in-process frame source, when there is one (solo/host, never a joiner).
   * Production code must not touch it — the driver owns frame assembly. It is
   * exposed only so tests and the DEV console hook (`window.__barrow`) can seat
   * and drive extra players without a second browser context. */
  readonly sequencer?: Sequencer;
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
  const emitFrame = (): HostMsg & { type: "frame" } => {
    const msg = { type: "frame", frame: sequencer.nextFrame() } as const;
    session.onHostMsg(msg);
    return msg;
  };

  return { sequencer, session, emitFrame };
}

/** Solo: an in-process Sequencer wired straight into the Session. One frame per requested tick. */
export function localDriver(seed: number, character?: string): NetDriver {
  const { sequencer, session, emitFrame } = localCore(seed, character);
  return {
    session,
    sequencer,
    sendInput: (input) => session.sendInput(input),
    requestTick: () => void emitFrame(),
    stop: () => {},
  };
}

/** Players whose reported state hash for a tick disagrees with the reference —
 * the host's own hash when it reported one, else the first hash in the map.
 * A lone report has nothing to disagree with, so it never trips. */
export function mismatchedPlayers(hashes: Map<PlayerId, number>): PlayerId[] {
  if (hashes.size < 2) return [];
  const reference = hashes.get(0) ?? [...hashes.values()][0]!;
  const out: PlayerId[] = [];
  for (const [id, hash] of hashes) {
    if (hash !== reference) out.push(id);
  }
  return out;
}

/** The transport-independent half of the host: seats peers arriving over any
 * PeerLink, assembles frames, and fans them out. `pump()` is one 25 Hz beat.
 * hostDriver bolts WebRTC and a timer onto this; tests drive it directly. */
export function hostCore(seed: number, character?: string) {
  const { sequencer, session, emitFrame } = localCore(seed, character);
  const links = new Map<PeerLink, PlayerId | null>();

  const onPeer = (link: PeerLink) => {
    links.set(link, null);
    link.onMessage((msg: ClientMsg) => {
      if (msg.type === "hello") {
        if (links.get(link) !== null) return; // already seated
        // The link only ever receives frames broadcast from now on, so the
        // snapshot has to sit at the sequencer's tick, not the host session's:
        // frames already emitted are gone as far as this peer is concerned.
        // Catching the session up first makes those two ticks equal — vital
        // when the host tab is backgrounded and its rAF loop has stalled while
        // the pump interval kept emitting. Only then snapshot, and only then
        // queue the join, so the join rides a frame the joiner also gets.
        while (session.tryStep());
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
      if (id != null) {
        sequencer.removePeer(id);
        // The seat can be handed to a fresh peer; clear the "already told"
        // mark so the newcomer isn't permanently exempt from the tripwire.
        reported.delete(id);
      }
      links.delete(link);
    });
  };

  // The tick the *next* frame will carry. Clients stamp their input (and the
  // hash riding it) for state tick + INPUT_DELAY_TICKS, so every hash for this
  // frame's tick is already in hand — but nextFrame() drops them along with
  // the tick's inputs, so the comparison has to happen first.
  let nextTick = 0;

  const reported = new Set<PlayerId>();

  /** Anyone whose world disagrees with the host's is told, once, before the
   * frame that would consume the evidence. The host raises its own banner too:
   * a split world is over for everybody, not just the odd one out. */
  const checkHashes = () => {
    const mismatched = mismatchedPlayers(sequencer.hashesFor(nextTick));
    for (const playerId of mismatched) {
      // A diverged world stays diverged, so every later hash mismatches too:
      // say it once per player rather than every HASH_EVERY_TICKS forever.
      if (reported.has(playerId)) continue;
      reported.add(playerId);
      const msg: HostMsg = { type: "desync", tick: nextTick - INPUT_DELAY_TICKS, playerId };
      session.onHostMsg(msg);
      for (const [link, seat] of links) {
        if (seat === playerId) link.send(msg);
      }
    }
  };

  /** One beat: compare hashes, assemble the frame, fan it out. */
  const pump = () => {
    checkHashes();
    const msg = emitFrame();
    nextTick = msg.frame.tick + 1;
    for (const link of links.keys()) link.send(msg);
  };

  // A host has no transport that can go away underneath it — the game ends
  // when it calls stop(). Callbacks are registered so callers get consistent
  // behaviour across drivers, and stop() fires them so a shared teardown path
  // works either way; nothing else invokes them in v1.
  const closeCbs: (() => void)[] = [];

  const driver: NetDriver = {
    session,
    sequencer,
    sendInput: (input) => session.sendInput(input),
    onClose: (cb) => closeCbs.push(cb),
    stop: () => {
      for (const link of links.keys()) link.close();
      links.clear();
      for (const cb of closeCbs.splice(0)) cb();
    },
  };

  return { driver, onPeer, pump };
}

/** Host: hostCore + rtc.hostGame; emits frames on a 25 Hz interval. */
export async function hostDriver(
  seed: number,
  signalUrl: string,
  character?: string,
): Promise<{ driver: NetDriver; code: string }> {
  const { hostGame } = await import("./rtc");
  const core = hostCore(seed, character);
  const room = await hostGame(signalUrl, core.onPeer);

  // Backgrounded tabs throttle setInterval; v1 accepts the resulting slowdown
  // (everyone is lockstepped to the host, so the game stalls rather than desyncs).
  const timer = setInterval(core.pump, 1000 / TICK_RATE);

  const driver: NetDriver = {
    ...core.driver,
    stop: () => {
      clearInterval(timer);
      core.driver.stop();
      room.stop();
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
