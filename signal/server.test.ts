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
  close(): void;
}

function connect(): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(baseUrl);
    const waiters = new Map<string, Array<(msg: Msg) => void>>();
    const backlog = new Map<string, Msg[]>();

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
  test("host gets a room code; joiner and host relay signals both ways", async () => {
    const host = await connect();
    host.send({ type: "host" });
    const { code } = await host.next("room");
    expect(typeof code).toBe("string");
    expect((code as string).length).toBe(5);

    const peer = await connect();
    peer.send({ type: "join", code: code as string });
    const { peerId } = await host.next("joined");
    expect(peerId).toBe(1);

    peer.send({ type: "signal", to: 0, payload: { sdp: "offer" } });
    const fromPeer = await host.next("signal");
    expect(fromPeer.from).toBe(1);
    expect(fromPeer.payload).toEqual({ sdp: "offer" });

    host.send({ type: "signal", to: peerId as number, payload: { sdp: "answer" } });
    const fromHost = await peer.next("signal");
    expect(fromHost.from).toBe(0);
    expect(fromHost.payload).toEqual({ sdp: "answer" });

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
});
