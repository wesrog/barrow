import type { ServerWebSocket } from "bun";

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 5;

type ClientMessage =
  | { type: "host" }
  | { type: "join"; code: string }
  // Opaque game traffic, relayed verbatim. `data` is a string so the server
  // never parses (or pays to re-serialize) the payload.
  | { type: "relay"; to: number; data: string }
  // Host only: close a peer's socket (e.g. the room is full).
  | { type: "kick"; to: number };

type ServerMessage =
  | { type: "room"; code: string }
  | { type: "joined"; peerId: number }
  | { type: "relay"; from: number; data: string }
  | { type: "peer-left"; peerId: number }
  | { type: "error"; reason: "no-such-room" | "room-closed" };

interface Room {
  code: string;
  host: ServerWebSocket<SocketData>;
  peers: Map<number, ServerWebSocket<SocketData>>;
  nextPeer: number;
}

interface SocketData {
  code?: string;
  address?: number; // 0 = host, >=1 = peer id
}

function makeRoomCode(existing: Set<string>): string {
  let code: string;
  do {
    code = Array.from(
      { length: CODE_LENGTH },
      () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)],
    ).join("");
  } while (existing.has(code));
  return code;
}

function send(ws: ServerWebSocket<SocketData>, msg: ServerMessage): void {
  ws.send(JSON.stringify(msg));
}

export function startServer(port: number) {
  const rooms = new Map<string, Room>();

  const server = Bun.serve<SocketData, undefined>({
    port,
    fetch(req, srv) {
      if (srv.upgrade(req, { data: {} })) return undefined;
      return new Response("signal server: websocket upgrade required", { status: 400 });
    },
    websocket: {
      message(ws, raw) {
        let msg: ClientMessage;
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return;
        }

        if (msg.type === "host") {
          const code = makeRoomCode(new Set(rooms.keys()));
          const room: Room = { code, host: ws, peers: new Map(), nextPeer: 1 };
          rooms.set(code, room);
          ws.data.code = code;
          ws.data.address = 0;
          send(ws, { type: "room", code });
          return;
        }

        if (msg.type === "join") {
          const room = rooms.get(msg.code);
          if (!room) {
            send(ws, { type: "error", reason: "no-such-room" });
            return;
          }
          const peerId = room.nextPeer++;
          room.peers.set(peerId, ws);
          ws.data.code = room.code;
          ws.data.address = peerId;
          // Both sides hear about it: the host to build the seat, the joiner
          // as its cue that the room exists and it can start talking.
          send(room.host, { type: "joined", peerId });
          send(ws, { type: "joined", peerId });
          return;
        }

        if (msg.type === "relay") {
          const code = ws.data.code;
          const from = ws.data.address;
          if (code === undefined || from === undefined || typeof msg.data !== "string") return;
          const room = rooms.get(code);
          if (!room) return;
          const target = msg.to === 0 ? room.host : room.peers.get(msg.to);
          if (!target) return;
          send(target, { type: "relay", from, data: msg.data });
          return;
        }

        if (msg.type === "kick") {
          const code = ws.data.code;
          if (code === undefined || ws.data.address !== 0) return; // host only
          const room = rooms.get(code);
          if (!room) return;
          room.peers.get(msg.to)?.close();
          return;
        }
      },
      close(ws) {
        const code = ws.data.code;
        const address = ws.data.address;
        if (code === undefined || address === undefined) return;
        const room = rooms.get(code);
        if (!room) return;

        if (address === 0) {
          rooms.delete(code);
          for (const peer of room.peers.values()) {
            send(peer, { type: "error", reason: "room-closed" });
          }
        } else {
          room.peers.delete(address);
          send(room.host, { type: "peer-left", peerId: address });
        }
      },
    },
  });

  return server;
}

if (import.meta.main) {
  const port = Number(process.env.PORT) || 5200;
  const server = startServer(port);
  console.log(`signal server listening on :${server.port}`);
}
