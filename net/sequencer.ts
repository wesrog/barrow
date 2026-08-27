import type { Frame, PlayerId, PlayerInput, PlayerJoin } from "../sim/state";

const MAX_PLAYERS = 4;

/** Pure host-side frame assembly. The caller owns timers and transport. */
export class Sequencer {
  private tick = 0;
  private seats = new Set<PlayerId>();
  private queuedJoins: PlayerJoin[] = [];
  private queuedLeaves: PlayerId[] = [];
  private pending = new Map<number, Map<PlayerId, PlayerInput>>();
  private hashes = new Map<number, Map<PlayerId, number>>();

  /** Seats the host as player 0 via a join in frame 0. */
  constructor(hostCharacter?: string) {
    this.seats.add(0);
    this.queuedJoins.push({ id: 0, character: hostCharacter });
  }

  /** Seat a new peer: returns their id and the join that will ride the next frame. Throws when full (4). */
  addPeer(character?: string): PlayerId {
    if (this.seats.size >= MAX_PLAYERS) {
      throw new Error("Sequencer: no free seats");
    }
    let id = 0;
    while (this.seats.has(id)) id++;
    this.seats.add(id);
    this.queuedJoins.push({ id, character });
    return id;
  }

  removePeer(id: PlayerId): void {
    this.seats.delete(id);
    this.queuedLeaves.push(id);
  }

  /** Record a peer's input for a tick (latest write wins). An input stamped for
   * an already-emitted tick is rescheduled onto the next frame instead of
   * dropped — relayed clients routinely run more than INPUT_DELAY_TICKS behind,
   * and a click must land late rather than never. Hashes are the exception:
   * they attest to one exact tick's state, so a late one is simply discarded. */
  onInput(id: PlayerId, tick: number, input: PlayerInput, hash?: number): void {
    const at = Math.max(tick, this.tick);

    let tickInputs = this.pending.get(at);
    if (!tickInputs) {
      tickInputs = new Map();
      this.pending.set(at, tickInputs);
    }
    tickInputs.set(id, input);

    if (hash !== undefined && tick >= this.tick) {
      let tickHashes = this.hashes.get(tick);
      if (!tickHashes) {
        tickHashes = new Map();
        this.hashes.set(tick, tickHashes);
      }
      tickHashes.set(id, hash);
    }
  }

  /** Assemble the frame for the next tick: inputs received so far, else {}. Advances the tick. */
  nextFrame(): Frame {
    const tick = this.tick;
    const inputs: Partial<Record<PlayerId, PlayerInput>> = {};
    for (const [id, input] of this.pending.get(tick) ?? []) {
      inputs[id] = input;
    }

    const frame: Frame = { tick, inputs };
    if (this.queuedJoins.length > 0) frame.joins = this.queuedJoins;
    if (this.queuedLeaves.length > 0) frame.leaves = this.queuedLeaves;

    this.queuedJoins = [];
    this.queuedLeaves = [];
    this.pending.delete(tick);
    this.hashes.delete(tick);
    this.tick++;

    return frame;
  }

  /** Hashes reported for a tick; caller compares and emits desync. */
  hashesFor(tick: number): Map<PlayerId, number> {
    return this.hashes.get(tick) ?? new Map();
  }
}
