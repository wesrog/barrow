import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type { Server } from "bun";
import { startServer } from "./server";

let server: Server;
let baseUrl: string;

beforeAll(() => {
  server = startServer(0);
  baseUrl = `ws://localhost:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

type Msg = { type: string; [key: string]: unknown };

interface TestClient {
  send(msg: Msg): void;
  next(type: string): Promise<Msg>;
  closed: Promise<void>;
  close(): void;
}

function connect(): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(baseUrl);
    const waiters = new Map<string, Array<(msg: Msg) => void>>();
    const backlog = new Map<string, Msg[]>();
    let onClosed: () => void;
    const closed = new Promise<void>((res) => {
      onClosed = res;
    });

    ws.addEventListener("close", () => onClosed());

    ws.addEventListener("open", () => {
      resolve({
        send(msg: Msg) {
          ws.send(JSON.stringify(msg));
        },
        next(type: string) {
          return new Promise((res) => {
            const queued = backlog.get(type);
            if (queued && queued.length > 0) {
              res(queued.shift()!);
              return;
            }
            const list = waiters.get(type) ?? [];
            list.push(res);
            waiters.set(type, list);
          });
        },
        closed,
        close() {
          ws.close();
        },
      });
    });

    ws.addEventListener("error", reject);

    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data as string) as Msg;
      const list = waiters.get(msg.type);
      if (list && list.length > 0) {
        list.shift()!(msg);
        return;
      }
      const queued = backlog.get(msg.type) ?? [];
      queued.push(msg);
      backlog.set(msg.type, queued);
    });
  });
}

describe("signaling server", () => {
  test("host gets a room code; join is acked to both sides; relay carries data both ways", async () => {
    const host = await connect();
    host.send({ type: "host" });
    const { code } = await host.next("room");
    expect(typeof code).toBe("string");
    expect((code as string).length).toBe(5);

    const peer = await connect();
    peer.send({ type: "join", code: code as string });
    const { peerId } = await host.next("joined");
    expect(peerId).toBe(1);
    // The joiner gets the same ack, carrying its own id — its signal to start talking.
    const ack = await peer.next("joined");
    expect(ack.peerId).toBe(1);

    peer.send({ type: "relay", to: 0, data: JSON.stringify({ type: "hello" }) });
    const fromPeer = await host.next("relay");
    expect(fromPeer.from).toBe(1);
    expect(fromPeer.data).toBe(JSON.stringify({ type: "hello" }));

    host.send({ type: "relay", to: peerId as number, data: "big-frame-payload" });
    const fromHost = await peer.next("relay");
    expect(fromHost.from).toBe(0);
    expect(fromHost.data).toBe("big-frame-payload");

    host.close();
    peer.close();
  });

  test("joining a nonexistent room errors; host disconnect closes the room", async () => {
    const joiner = await connect();
    joiner.send({ type: "join", code: "ZZZZZ" });
    const err = await joiner.next("error");
    expect(err.reason).toBe("no-such-room");
    joiner.close();

    const host = await connect();
    host.send({ type: "host" });
    const { code } = await host.next("room");

    const peer = await connect();
    peer.send({ type: "join", code: code as string });
    await host.next("joined");

    const closedPromise = peer.next("error");
    host.close();
    const closedMsg = await closedPromise;
    expect(closedMsg.reason).toBe("room-closed");
    peer.close();
  });

  test("a peer's disconnect tells the host peer-left", async () => {
    const host = await connect();
    host.send({ type: "host" });
    const { code } = await host.next("room");

    const peer = await connect();
    peer.send({ type: "join", code: code as string });
    const { peerId } = await host.next("joined");

    peer.close();
    const left = await host.next("peer-left");
    expect(left.peerId).toBe(peerId);
    host.close();
  });

  test("the host can kick a peer: its socket closes", async () => {
    const host = await connect();
    host.send({ type: "host" });
    const { code } = await host.next("room");

    const peer = await connect();
    peer.send({ type: "join", code: code as string });
    const { peerId } = await host.next("joined");

    host.send({ type: "kick", to: peerId as number });
    await peer.closed;
    host.close();
  });
});
