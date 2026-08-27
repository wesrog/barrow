import type { ServerWebSocket } from "bun";

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 5;

type ClientMessage =
  | { type: "host" }
  | { type: "join"; code: string }
  | { type: "signal"; to: number; payload: unknown };

type ServerMessage =
  | { type: "room"; code: string }
  | { type: "joined"; peerId: number }
  | { type: "signal"; from: number; payload: unknown }
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
          send(room.host, { type: "joined", peerId });
          return;
        }

        if (msg.type === "signal") {
          const code = ws.data.code;
          const from = ws.data.address;
          if (code === undefined || from === undefined) return;
          const room = rooms.get(code);
          if (!room) return;
          const target = msg.to === 0 ? room.host : room.peers.get(msg.to);
          if (!target) return;
          send(target, { type: "signal", from, payload: msg.payload });
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
