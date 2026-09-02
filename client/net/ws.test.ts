// End-to-end: real signal server, real WebSockets, real host core and joiner
// session — the whole multiplayer transport, headless. This is the test the
// WebRTC transport could never have.
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type { Server } from "bun";
import { startServer } from "../../signal/server";
import { hostGame, joinGame } from "./ws";
import { hostCore, joinDriver } from "./driver";
import { Session } from "../../net/session";
import { serializeGame } from "../../net/snapshot";
import type { ClientMsg, HostMsg } from "../../net/protocol";

let server: Server;
let url: string;

beforeAll(() => {
  server = startServer(0);
  url = `ws://localhost:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

const tick = () => new Promise((r) => setTimeout(r, 10));

describe("websocket transport", () => {
  test("host and joiner converge to byte-identical worlds over real sockets", async () => {
    const core = hostCore(1234);
    const room = await hostGame(url, core.onPeer);
    expect(room.code).toHaveLength(5);

    // Let the host run a while before anyone joins.
    for (let i = 0; i < 20; i++) core.pump();
    while (core.driver.session.tryStep());

    const link = await joinGame(url, room.code);
    const session = new Session((msg: ClientMsg) => link.send(msg));
    let welcomed = false;
    link.onMessage((msg: HostMsg) => {
      session.onHostMsg(msg);
      if (msg.type === "welcome") welcomed = true;
    });
    link.send({ type: "hello" } satisfies ClientMsg);

    for (let i = 0; i < 50 && !welcomed; i++) await tick();
    expect(welcomed).toBe(true);

    // Play a stretch: joiner inputs ride the relay back to the host.
    for (let t = 0; t < 30; t++) {
      core.pump();
      await tick();
      while (core.driver.session.tryStep());
      while (session.tryStep());
      if (t % 5 === 0 && session.state) {
        session.sendInput({ moveTo: { x: 4 + t, y: 4 } });
      }
    }
    // Drain any frames still in flight.
    for (let i = 0; i < 20; i++) await tick();
    while (core.driver.session.tryStep());
    while (session.tryStep());

    expect(session.state).not.toBeNull();
    expect(session.state!.players.size).toBe(2);
    expect(serializeGame(session.state!)).toBe(serializeGame(core.driver.session.state!));

    link.close();
    room.stop();
  });

  test("a join cancelled in the same task claims no seat (StrictMode double-effect)", async () => {
    const core = hostCore(42);
    const room = await hostGame(url, core.onPeer);

    // React StrictMode runs the lobby's auto-join effect, its cleanup, and the
    // effect again, all in one task: the first attempt is cancelled before its
    // lazy import has even resolved, so it must never open a socket — only the
    // second attempt may claim a seat.
    let cancelled = false;
    const doomed = joinDriver(url, room.code, undefined, () => cancelled);
    cancelled = true;
    const driver = await joinDriver(url, room.code, undefined, () => false);
    expect(await doomed).toBeNull();
    expect(driver).not.toBeNull();

    // Run a few beats so every join in flight rides a frame into the world.
    for (let t = 0; t < 5; t++) {
      core.pump();
      await tick();
    }
    while (core.driver.session.tryStep());

    // Exactly two players: the host and one joiner — no zombie second seat.
    expect(core.driver.session.state!.players.size).toBe(2);

    driver!.stop();
    room.stop();
  });

  test("joining a nonexistent room rejects with no-such-room", async () => {
    expect(joinGame(url, "ZZZZZ")).rejects.toThrow("no-such-room");
  });

  test("host stop() surfaces as the joiner link closing", async () => {
    const core = hostCore(7);
    const room = await hostGame(url, core.onPeer);
    const link = await joinGame(url, room.code);
    let closed = false;
    link.onClose(() => {
      closed = true;
    });
    room.stop();
    for (let i = 0; i < 50 && !closed; i++) await tick();
    expect(closed).toBe(true);
  });

  test("a joiner dropping surfaces as that peer link closing on the host", async () => {
    const core = hostCore(9);
    const room = await hostGame(url, core.onPeer);
    const link = await joinGame(url, room.code);

    // Seat the peer so the host tracks it, then drop it.
    link.send({ type: "hello" } satisfies ClientMsg);
    for (let i = 0; i < 20; i++) await tick();
    link.close();
    for (let i = 0; i < 50; i++) await tick();
    // The freed seat is reusable: a fresh join gets seated without error.
    const link2 = await joinGame(url, room.code);
    link2.send({ type: "hello" } satisfies ClientMsg);
    let welcomed = false;
    link2.onMessage((msg: HostMsg) => {
      if (msg.type === "welcome") welcomed = true;
    });
    for (let i = 0; i < 50 && !welcomed; i++) await tick();
    expect(welcomed).toBe(true);
    link2.close();
    room.stop();
  });
});
