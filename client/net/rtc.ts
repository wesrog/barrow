// WebRTC plumbing: opens/joins rooms via the signaling relay (signal/server.ts),
// negotiates a peer connection per remote, and exposes a chunked-JSON PeerLink
// over the "game" DataChannel. Browser-API code only — no sim/ imports, no game
// logic. Opaque JSON in, opaque JSON out.

export { SIGNAL_URL } from "./config";

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const CHUNK_SIZE = 60_000;

/** How long a join may sit in negotiation before we call it a dead end. Covers
 * the hostile-NAT case (ICE never completes and never reports "failed") and a
 * host that opened a room and then walked away. */
const JOIN_TIMEOUT_MS = 15_000;

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

/** "host" | "srflx" | "relay" | ... from a candidate line, for diagnostics. */
function candidateType(c: RTCIceCandidateInit): string {
  return /typ ([a-z]+)/.exec(c.candidate ?? "")?.[1] ?? "?";
}

/** Compact console diagnostics: connection states and candidate types, tagged
 * per side. Cheap enough to leave on — this is the first thing anyone needs
 * when "couldn't connect" strikes in the wild. */
function diagnose(pc: RTCPeerConnection, label: string): void {
  const log = (msg: string) => console.info(`[barrow rtc] ${label}: ${msg}`);
  pc.addEventListener("icegatheringstatechange", () => log(`gathering ${pc.iceGatheringState}`));
  pc.addEventListener("iceconnectionstatechange", () => log(`ice ${pc.iceConnectionState}`));
  pc.addEventListener("connectionstatechange", () => log(`connection ${pc.connectionState}`));
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
    console.info(`[barrow rtc] remote ${candidateType(payload.ice)}`);
    await pc.addIceCandidate(payload.ice);
  } else {
    console.info(`[barrow rtc] remote ${candidateType(payload.ice)} (queued)`);
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
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }

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
        diagnose(pc, `host->peer${peerId}`);

        const channel = pc.createDataChannel("game");
        channel.onopen = () => onPeer(wrapChannel(channel, pc));

        pc.onicecandidate = (iceEv) => {
          if (!iceEv.candidate) return;
          console.info(`[barrow rtc] host->peer${peerId}: local ${candidateType(iceEv.candidate)}`);
          wsSend(ws, peerId, { ice: iceEv.candidate.toJSON() });
        };

        // One peer that can't get through is that peer's problem: drop the
        // half-built connection and keep hosting. If the channel had opened,
        // the link's own onclose tells the game the seat is free.
        pc.onconnectionstatechange = () => {
          if (pc.connectionState !== "failed") return;
          peers.delete(peerId);
          pc.close();
        };

        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          wsSend(ws, peerId, { sdp: offer });
        } catch (err) {
          console.warn("barrow: offer to peer failed", err);
          peers.delete(peerId);
          pc.close();
        }
        return;
      }

      if (msg.type === "signal") {
        const peer = peers.get(msg.from);
        if (!peer) return;
        // Relayed from another browser: never trust it to be well-formed SDP.
        try {
          await applySignal(peer.pc, peer.iceQueue, msg.payload);
        } catch (err) {
          console.warn("barrow: dropping bad signal payload", err);
        }
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
    diagnose(pc, "joiner");

    /** Give up: tear the half-built connection down and tell the lobby. */
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pc.close();
      ws.close();
      reject(new Error(message));
    };

    const succeed = (link: PeerLink) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(link);
    };

    const timer = setTimeout(() => fail("couldn't connect"), JOIN_TIMEOUT_MS);

    ws.onopen = () => ws.send(JSON.stringify({ type: "join", code }));

    ws.onerror = () => fail("signal connection failed");

    // ICE gave up: no candidate pair works (symmetric NAT with only STUN, say).
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") fail("couldn't connect");
    };

    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      console.info(`[barrow rtc] joiner: local ${candidateType(ev.candidate)}`);
      wsSend(ws, 0, { ice: ev.candidate.toJSON() });
    };

    pc.ondatachannel = (ev) => {
      const channel = ev.channel;
      channel.onopen = () => succeed(wrapChannel(channel, pc));
    };

    ws.onmessage = async (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }

      if (msg.type === "error") {
        fail(msg.reason);
        return;
      }

      if (msg.type === "signal") {
        // Relayed SDP/ICE is whatever the other side sent; a malformed payload
        // must not surface as an unhandled rejection out of this handler.
        try {
          await applySignal(pc, iceQueue, msg.payload, async () => {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            wsSend(ws, 0, { sdp: answer });
          });
        } catch (err) {
          console.warn("barrow: dropping bad signal payload", err);
        }
      }
    };
  });
}
