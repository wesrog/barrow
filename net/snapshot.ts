import { createRng } from "../sim/rng";
import type { GameState, ZoneState } from "../sim/state";

const SNAPSHOT_VERSION = 2;

/**
 * JSON string of the entire GameState: Maps as entry arrays, Uint8Array
 * cells as number[], rng as its state word.
 */
export function serializeGame(state: GameState): string {
  const snapshot = {
    version: SNAPSHOT_VERSION,
    tick: state.tick,
    seed: state.seed,
    rng: state.rng.state(),
    zones: [...state.zones.entries()].map(([id, zone]) => [id, encodeZone(zone)]),
    shop: state.shop,
    players: [...state.players.entries()],
    events: state.events,
    nextId: state.nextId,
  };
  return JSON.stringify(snapshot);
}

export function deserializeGame(raw: string): GameState {
  const data = JSON.parse(raw);
  if (data.version !== SNAPSHOT_VERSION) {
    throw new Error(`snapshot version mismatch: expected ${SNAPSHOT_VERSION}, got ${data.version}`);
  }
  if (!data.zones || !data.players || typeof data.tick !== "number") {
    throw new Error("malformed snapshot: missing zones/players/tick");
  }

  const zones = new Map(
    (data.zones as [string, any][]).map(([id, zone]) => [id, decodeZone(zone)]),
  );
  const players = new Map(
    (data.players as [number, any][]).map(([id, player]) => [Number(id), player]),
  );

  return {
    tick: data.tick,
    seed: data.seed,
    rng: createRng(data.rng),
    zones,
    shop: data.shop,
    players,
    events: data.events,
    nextId: data.nextId,
  } as GameState;
}

function encodeZone(zone: ZoneState) {
  return {
    id: zone.id,
    map: {
      ...zone.map,
      cells: Array.from(zone.map.cells),
    },
    monsters: [...zone.monsters.entries()],
    groundItems: [...zone.groundItems.entries()],
    goldPiles: [...zone.goldPiles.entries()],
    breakables: [...zone.breakables.entries()],
    corpses: zone.corpses,
    portals: [...zone.portals.entries()],
    playerCorpses: [...zone.playerCorpses.entries()],
  };
}

function decodeZone(zone: any): ZoneState {
  return {
    id: zone.id,
    map: {
      ...zone.map,
      cells: Uint8Array.from(zone.map.cells),
    },
    monsters: new Map((zone.monsters as [number, any][]).map(([id, m]) => [Number(id), m])),
    groundItems: new Map((zone.groundItems as [number, any][]).map(([id, g]) => [Number(id), g])),
    goldPiles: new Map((zone.goldPiles as [number, any][]).map(([id, g]) => [Number(id), g])),
    breakables: new Map((zone.breakables as [number, any][]).map(([id, b]) => [Number(id), b])),
    corpses: zone.corpses,
    portals: new Map((zone.portals as [number, any][]).map(([id, p]) => [Number(id), p])),
    playerCorpses: new Map(
      (zone.playerCorpses as [number, any][]).map(([id, p]) => [Number(id), p]),
    ),
  };
}
