// WebSocket transport: all game traffic rides the signaling server's relay.
// Same PeerLink seam the WebRTC transport offered, none of the ICE/NAT grief —
// if you can reach the server (you got a room code, so you can), you can play.
// Lockstep traffic is tiny (inputs at 25 Hz plus one snapshot per join), so a
// relayed hop costs milliseconds, not bandwidth.

export { SIGNAL_URL } from "./config";

/** How long a join may wait for the server's ack before we call it dead. */
const JOIN_TIMEOUT_MS = 10_000;

type ServerMessage =
  | { type: "room"; code: string }
  | { type: "joined"; peerId: number }
  | { type: "relay"; from: number; data: string }
  | { type: "peer-left"; peerId: number }
  | { type: "error"; reason: "no-such-room" | "room-closed" };

export interface PeerLink {
  send(msg: object): void;
  onMessage(cb: (msg: any) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

/** A PeerLink over a relay address. Messages that arrive before onMessage is
 * registered are buffered, so callers can wire handlers in any order. */
function makeLink(sendData: (data: string) => void, doClose: () => void) {
  let onMessageCb: ((msg: any) => void) | null = null;
  let onCloseCb: (() => void) | null = null;
  const backlog: any[] = [];
  let closed = false;

  const link: PeerLink = {
    send(msg) {
      sendData(JSON.stringify(msg));
    },
    onMessage(cb) {
      onMessageCb = cb;
      for (const msg of backlog.splice(0)) cb(msg);
    },
    onClose(cb) {
      onCloseCb = cb;
    },
    close() {
      if (closed) return;
      closed = true;
      doClose();
    },
  };

  const deliver = (data: string) => {
    let msg: any;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (onMessageCb) onMessageCb(msg);
    else backlog.push(msg);
  };

  const fireClose = () => {
    if (closed) return;
    closed = true;
    onCloseCb?.();
  };

  return { link, deliver, fireClose };
}

function parse(raw: unknown): ServerMessage | null {
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

/** Open a room; resolve links as peers join. One WebSocket carries them all. */
export function hostGame(
  signalUrl: string,
  onPeer: (link: PeerLink) => void,
): Promise<{ code: string; stop(): void }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(signalUrl);
    const peers = new Map<number, ReturnType<typeof makeLink>>();
    let settled = false;

    ws.onopen = () => ws.send(JSON.stringify({ type: "host" }));

    ws.onerror = () => {
      if (!settled) {
        settled = true;
        reject(new Error("signal connection failed"));
      }
    };

    ws.onmessage = (ev) => {
      const msg = parse(ev.data);
      if (!msg) return;

      if (msg.type === "room") {
        settled = true;
        resolve({ code: msg.code, stop: () => ws.close() });
      } else if (msg.type === "joined") {
        const peerId = msg.peerId;
        const entry = makeLink(
          (data) => ws.send(JSON.stringify({ type: "relay", to: peerId, data })),
          () => {
            // Host-side close = boot the peer; the server closes its socket.
            ws.send(JSON.stringify({ type: "kick", to: peerId }));
            peers.delete(peerId);
          },
        );
        peers.set(peerId, entry);
        onPeer(entry.link);
      } else if (msg.type === "relay") {
        peers.get(msg.from)?.deliver(msg.data);
      } else if (msg.type === "peer-left") {
        const entry = peers.get(msg.peerId);
        peers.delete(msg.peerId);
        entry?.fireClose();
      }
    };

    ws.onclose = () => {
      for (const entry of peers.values()) entry.fireClose();
      peers.clear();
    };
  });
}

/** Join a room by code; resolves once the server acks the join. */
export function joinGame(signalUrl: string, code: string): Promise<PeerLink> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(signalUrl);
    let entry: ReturnType<typeof makeLink> | null = null;

    const fail = (message: string) => {
      if (entry) return; // already joined; failures now surface via onClose
      clearTimeout(timer);
      ws.close();
      reject(new Error(message));
    };

    const timer = setTimeout(() => fail("couldn't connect"), JOIN_TIMEOUT_MS);

    ws.onopen = () => ws.send(JSON.stringify({ type: "join", code }));
    ws.onerror = () => fail("signal connection failed");

    ws.onmessage = (ev) => {
      const msg = parse(ev.data);
      if (!msg) return;

      if (msg.type === "joined" && !entry) {
        clearTimeout(timer);
        entry = makeLink(
          (data) => ws.send(JSON.stringify({ type: "relay", to: 0, data })),
          () => ws.close(),
        );
        resolve(entry.link);
      } else if (msg.type === "relay" && msg.from === 0) {
        entry?.deliver(msg.data);
      } else if (msg.type === "error") {
        fail(msg.reason);
        // Post-join, "room-closed" means the host left: close the link.
        if (msg.reason === "room-closed") entry?.fireClose();
      }
    };

    ws.onclose = () => {
      clearTimeout(timer);
      entry?.fireClose();
    };
  });
}
