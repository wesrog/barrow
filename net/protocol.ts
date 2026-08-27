import type { Frame, PlayerId, PlayerInput } from "../sim/state";

/** How many ticks of input latency clients buffer before applying, to hide network jitter. */
export const INPUT_DELAY_TICKS = 2;

export type ClientMsg =
  | { type: "hello"; character?: string } // join request (character = CharacterSave JSON)
  | { type: "input"; tick: number; input: PlayerInput; hash?: number };

export type HostMsg =
  | { type: "welcome"; playerId: PlayerId; snapshot: string; snapshotTick: number }
  | { type: "frame"; frame: Frame }
  | { type: "desync"; tick: number; playerId: PlayerId };
