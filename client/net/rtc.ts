// WebRTC plumbing: opens/joins rooms via the signaling relay (signal/server.ts),
// negotiates a peer connection per remote, and exposes a chunked-JSON PeerLink
// over the "game" DataChannel. Browser-API code only — no sim/ imports, no game
// logic. Opaque JSON in, opaque JSON out.

export { SIGNAL_URL } from "./config";

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const CHUNK_SIZE = 60_000;

type SignalPayload = { sdp: RTCSessionDescriptionInit } | { ice: RTCIceCandidateInit };

type ServerMessage =
  | { type: "room"; code: string }
  | { type: "joined"; peerId: number }
  | { type: "signal"; from: number; payload: SignalPayload }
  | { type: "error"; reason: "no-such-room" | "room-closed" };

interface ChunkFrame {
  type: "chunk";
  id: number;
  i: number;
  n: number;
  data: string;
}

export interface PeerLink {
  send(msg: object): void;
  onMessage(cb: (msg: any) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

function wsSend(ws: WebSocket, to: number, payload: SignalPayload): void {
  ws.send(JSON.stringify({ type: "signal", to, payload }));
}

/** Apply an incoming signal payload to a connection, queuing ICE candidates that arrive before the remote description. */
async function applySignal(
  pc: RTCPeerConnection,
  iceQueue: RTCIceCandidateInit[],
  payload: SignalPayload,
  onOffer?: (offer: RTCSessionDescriptionInit) => Promise<void>,
): Promise<void> {
  if ("sdp" in payload) {
    await pc.setRemoteDescription(payload.sdp);
    if (payload.sdp.type === "offer" && onOffer) await onOffer(payload.sdp);
    for (const candidate of iceQueue.splice(0)) await pc.addIceCandidate(candidate);
  } else if (pc.remoteDescription) {
    await pc.addIceCandidate(payload.ice);
  } else {
    iceQueue.push(payload.ice);
  }
}

function wrapChannel(channel: RTCDataChannel, pc: RTCPeerConnection): PeerLink {
  let onMessageCb: ((msg: any) => void) | null = null;
  let onCloseCb: (() => void) | null = null;
  let nextChunkId = 0;
  const pending = new Map<number, { n: number; parts: string[]; received: number }>();

  channel.onmessage = (ev) => {
    let frame: any;
    try {
      frame = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (frame && frame.type === "chunk") {
      const { id, i, n, data } = frame as ChunkFrame;
      let entry = pending.get(id);
      if (!entry) {
        entry = { n, parts: new Array(n).fill(""), received: 0 };
        pending.set(id, entry);
      }
      entry.parts[i] = data;
      entry.received++;
      if (entry.received === entry.n) {
        pending.delete(id);
        try {
          onMessageCb?.(JSON.parse(entry.parts.join("")));
        } catch {
          // malformed reassembled payload; drop it
        }
      }
      return;
    }
    onMessageCb?.(frame);
  };

  channel.onclose = () => onCloseCb?.();

  return {
    send(msg: object) {
      const json = JSON.stringify(msg);
      if (json.length <= CHUNK_SIZE) {
        channel.send(json);
        return;
      }
      const id = nextChunkId++;
      const n = Math.ceil(json.length / CHUNK_SIZE);
      for (let i = 0; i < n; i++) {
        const data = json.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const frame: ChunkFrame = { type: "chunk", id, i, n, data };
        channel.send(JSON.stringify(frame));
      }
    },
    onMessage(cb) {
      onMessageCb = cb;
    },
    onClose(cb) {
      onCloseCb = cb;
    },
    close() {
      channel.close();
      pc.close();
    },
  };
}

/** Open a room, resolve links as peers join. */
export function hostGame(
  signalUrl: string,
  onPeer: (link: PeerLink) => void,
): Promise<{ code: string; stop(): void }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(signalUrl);
    const peers = new Map<number, { pc: RTCPeerConnection; iceQueue: RTCIceCandidateInit[] }>();
    let settled = false;

    ws.onopen = () => ws.send(JSON.stringify({ type: "host" }));

    ws.onerror = () => {
      if (!settled) {
        settled = true;
        reject(new Error("signal connection failed"));
      }
    };

    ws.onmessage = async (ev) => {
      const msg: ServerMessage = JSON.parse(String(ev.data));

      if (msg.type === "room") {
        settled = true;
        resolve({ code: msg.code, stop: () => ws.close() });
        return;
      }

      if (msg.type === "joined") {
        const peerId = msg.peerId;
        const pc = new RTCPeerConnection(ICE_CONFIG);
        const iceQueue: RTCIceCandidateInit[] = [];
        peers.set(peerId, { pc, iceQueue });

        const channel = pc.createDataChannel("game");
        channel.onopen = () => onPeer(wrapChannel(channel, pc));

        pc.onicecandidate = (iceEv) => {
          if (iceEv.candidate) wsSend(ws, peerId, { ice: iceEv.candidate.toJSON() });
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        wsSend(ws, peerId, { sdp: offer });
        return;
      }

      if (msg.type === "signal") {
        const peer = peers.get(msg.from);
        if (!peer) return;
        await applySignal(peer.pc, peer.iceQueue, msg.payload);
        return;
      }

      if (msg.type === "error" && msg.reason === "room-closed" && !settled) {
        settled = true;
        reject(new Error(msg.reason));
      }
    };
  });
}

/** Join a room by code; resolves once the DataChannel to the host is open. */
export function joinGame(signalUrl: string, code: string): Promise<PeerLink> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(signalUrl);
    const pc = new RTCPeerConnection(ICE_CONFIG);
    const iceQueue: RTCIceCandidateInit[] = [];
    let settled = false;

    ws.onopen = () => ws.send(JSON.stringify({ type: "join", code }));

    ws.onerror = () => {
      if (!settled) {
        settled = true;
        reject(new Error("signal connection failed"));
      }
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate) wsSend(ws, 0, { ice: ev.candidate.toJSON() });
    };

    pc.ondatachannel = (ev) => {
      const channel = ev.channel;
      channel.onopen = () => {
        if (!settled) {
          settled = true;
          resolve(wrapChannel(channel, pc));
        }
      };
    };

    ws.onmessage = async (ev) => {
      const msg: ServerMessage = JSON.parse(String(ev.data));

      if (msg.type === "error") {
        if (!settled) {
          settled = true;
          reject(new Error(msg.reason));
        }
        ws.close();
        return;
      }

      if (msg.type === "signal") {
        await applySignal(pc, iceQueue, msg.payload, async (offer) => {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          wsSend(ws, 0, { sdp: answer });
        });
      }
    };
  });
}
