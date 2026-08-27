import { deserializeGame } from "./snapshot";
import { stateHash, HASH_EVERY_TICKS } from "./hash";
import { INPUT_DELAY_TICKS } from "./protocol";
import type { ClientMsg, HostMsg } from "./protocol";
import { step } from "../sim/tick";
import type { Frame, GameState, PlayerId, PlayerInput } from "../sim/state";

/** Client-side lockstep driver: buffers HostMsg frames, steps the sim when
 * the next frame is available. Transport-agnostic — the caller wires
 * onHostMsg to whatever transport delivers HostMsg, and onSend to whatever
 * transport carries ClientMsg back to the host. The host's own client is
 * just another Session over a loopback transport; no special casing here. */
export class Session {
  state: GameState | null = null;
  localId: PlayerId | null = null;
  desyncAt: number | null = null;

  private frames = new Map<number, Frame>();

  constructor(private onSend: (msg: ClientMsg) => void) {}

  onHostMsg(msg: HostMsg): void {
    switch (msg.type) {
      case "welcome":
        this.state = deserializeGame(msg.snapshot);
        this.localId = msg.playerId;
        break;
      case "frame":
        this.frames.set(msg.frame.tick, msg.frame);
        break;
      case "desync":
        this.desyncAt = msg.tick;
        break;
    }
  }

  /** Queue local input; sent stamped for currentTick + INPUT_DELAY_TICKS,
   * with a hash every HASH_EVERY_TICKS. */
  sendInput(input: PlayerInput): void {
    if (!this.state) throw new Error("Session: sendInput before welcome");
    const tick = this.state.tick + INPUT_DELAY_TICKS;
    const msg: ClientMsg = { type: "input", tick, input };
    if (this.state.tick % HASH_EVERY_TICKS === 0) {
      msg.hash = stateHash(this.state);
    }
    this.onSend(msg);
  }

  /** Step once if the next frame is buffered. Returns whether it stepped. */
  tryStep(): boolean {
    if (!this.state) return false;
    const tick = this.state.tick;
    const frame = this.frames.get(tick);
    if (!frame) return false;
    this.frames.delete(tick);
    step(this.state, frame);
    return true;
  }

  /** How many frames are buffered ahead (render pacing signal). */
  buffered(): number {
    if (!this.state) return 0;
    let count = 0;
    for (const tick of this.frames.keys()) {
      if (tick >= this.state.tick) count++;
    }
    return count;
  }
}
