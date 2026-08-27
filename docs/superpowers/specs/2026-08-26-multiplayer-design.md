# Multiplayer — design spec

2026-08-26. Approved direction: 2–4 player drop-in co-op via host-relayed
P2P lockstep, D2-style independent areas in one shared world.

> **Addendum 2026-08-27 — transport changed to a WebSocket relay.** Real-world
> testing showed STUN-only WebRTC fails in common topologies (same-NAT
> hairpin, mDNS candidates without macOS Local Network permission) and would
> have needed a TURN relay anyway. Since lockstep traffic is tiny, all game
> traffic now rides the signaling server as opaque `relay` messages instead;
> `client/net/rtc.ts` was replaced by `client/net/ws.ts` behind the same
> `PeerLink` seam. WebRTC references below describe the original design.

## Goals

- 2–4 players per game; drop-in join at any time via room code / link.
- One shared persistent world per session: camp + lazily generated floors.
- Players roam independently (one shops in camp while another fights on
  floor 3).
- FFA loot, split XP, corpse-run death. Classic D2 shapes, our numbers.
- Gameplay traffic is pure P2P (WebRTC DataChannel); the only backend is a
  tiny WebSocket signaling server for the handshake.
- Single-player remains the degenerate case: one player, no netcode, no
  behavior change.

## Non-goals (v1)

- Host migration (host disconnect ends the session with a clear screen).
- TURN relay (hostile-NAT pairs get "couldn't connect").
- Desync *recovery* (we detect and surface, not repair).
- Instanced loot, PvP, chat.

## Architecture overview

Host-relayed lockstep, star topology. The host is a **sequencer, not an
authority**: it collects every player's per-tick `PlayerInput`, stamps an
ordered frame per tick, and broadcasts it. Every client — host included —
runs the identical deterministic sim on the identical frame stream. Same
seed + same frames ⇒ identical state on all machines. Bandwidth is inputs
only.

New code layout:

- `net/` — pure protocol logic (frames, snapshot codec, state hash). No
  DOM, no WebRTC imports. Unit-tested like `sim/`.
- `client/net/` — WebRTC + signaling plumbing (DataChannels, handshake).
- `signal/` — standalone WebSocket signaling server (Bun-runnable, own
  tests, deployed to a free tier).

## Sim restructure

### Zones

`GameState` reorganizes around zones; the `TownState` freeze/restore
mechanism is deleted.

```ts
type ZoneId = "camp" | `floor:${number}`;

interface ZoneState {
  id: ZoneId;
  map: ZoneMap;
  monsters: Map<number, Monster>;
  groundItems: Map<number, GroundItem>;
  goldPiles: Map<number, GoldPile>;
  breakables: Map<number, Breakable>;
  corpses: Corpse[];          // monster corpses and player corpses
  portals: Portal[];          // portal endpoints standing in this zone
}

interface GameState {
  tick: number;
  rng: Rng;                   // one world RNG, stepped identically everywhere
  zones: Map<ZoneId, ZoneState>;
  players: Map<PlayerId, Player>;   // Player gains zoneId: ZoneId
  events: SimEvent[];
  nextId: number;
}
```

- Camp always exists. Floors generate lazily: the first time anyone takes
  the stairs to floor N, the sim generates it deterministically from the
  world seed, and it persists for the session.
- Per tick, systems run over every zone containing at least one player;
  empty zones are frozen.
- Global `depth` is gone; a player's floor derives from their `zoneId`.
  Monster/loot scaling stays keyed off floor number, unchanged.
- "New run" wipes all floor zones and puts everyone in camp; trigger UI
  decided during implementation (no longer tied to death).

### Players and inputs

- `PlayerId` = 0–3, assigned by the host.
- `step(state, frame)` where
  `frame = { inputs: Map<PlayerId, PlayerInput>, joins?: PlayerJoin[], leaves?: PlayerId[] }`.
  Joins/leaves ride the tick stream so all clients apply them on the same
  tick. `PlayerJoin` carries id + the existing `CharacterSave` shape;
  joiners spawn in camp with their saved gear.
- Per-player systems iterate players in ascending id order (fixed order =
  determinism) and interact only with entities in that player's zone:
  targeting, pickup, collision, monster AI are all zone-scoped.
- Monster AI targets the nearest living player in its zone.
- Contested pickups resolve by id order within the tick (deterministic
  first-come).
- Player-specific `SimEvent`s gain a `playerId` field so the HUD/renderer
  can filter to the local player and their zone.

### Travel: stairs and portals

- Stairs are per-player: touching `>` moves that player alone to floor
  N+1's spawn (generating the floor on first visit). Zone transitions
  clear transient targets (path, attack/pickup/smash targets), like
  today's `descend`.
- A `Portal` is a linked pair: one endpoint in camp, one where it was
  cast. Casting town portal with a pair already out replaces it (the old
  pair despawns). Any player standing on either endpoint can click to
  travel to the other end. Portals are zone-transition objects using the
  same mechanism as stairs.

### Death and corpse run

- On death, all equipped gear moves onto a player corpse at the death
  spot; inventory, belt, and gold stay with the player. The player
  respawns in camp immediately at full life, unequipped.
- Reclaiming: only the owner can click their corpse; doing so auto-re-
  equips everything into its original slots.
- One corpse per player: dying with a corpse already out merges the old
  corpse's gear onto the new corpse. Gear is never destroyed.
- Corpses persist (floors persist).

### XP split

On a kill: every living player in the killer's zone within ~10 cells
(tunable) of the kill — the killer always included regardless of radius —
splits the XP evenly; each share then gets a per-extra-partier bonus
(shape: partying yields more total XP than soloing, less per kill per
head; exact numbers ours, tuned in tests).

### Loot

FFA, unchanged drop system. Drops visible to everyone in the zone; first
click (lowest id on ties within a tick) takes it. The camp shop stock is
shared; first to buy an entry gets it. Gold, repairs, buying/selling are
per-player.

## Netcode

### Frames and pacing

- Sim stays 25 Hz. Host collects inputs for tick T, broadcasts frame T;
  every client steps only when it holds frame T.
- Missing input from a lagging player ⇒ empty input that tick (their hero
  continues current path; sim already treats absent fields as "no new
  command").
- Clients buffer ~2 frames to absorb jitter; renderer interpolation makes
  this read as ~80 ms input latency.

### Join (drop-in)

1. Joiner completes WebRTC handshake with the host.
2. Host serializes the full `GameState` (JSON; Maps as entry arrays; the
   RNG gains `state(): number` / restore — mulberry32's state is one
   uint32), tags it with its tick, streams it over the DataChannel.
3. Host includes the join in the next frame; joiner restores the snapshot
   and steps forward from the snapshot tick.

### Desync tripwire

Each client sends a cheap state hash (tick, per-player pos/life, monster
count) with its input every ~2 s. Host compares and broadcasts a desync
event on mismatch — surfaced in the HUD, not repaired. Debug aid.

### Leave / host loss

- Peer disconnect ⇒ host emits `leave` in the next frame; the hero
  despawns. Characters save client-side at join and on interval, so
  nothing is lost.
- Host disconnect ⇒ session ends with a "host left" screen (v1).

## Signaling and transport

- `signal/`: ~100-line WebSocket server. Rooms keyed by 4–6 char code;
  relays SDP offers/answers and ICE candidates between host and joiners.
  Never sees game traffic. Deployed on a free tier (Cloudflare Workers
  Durable Objects or Fly.io).
- Flow: "Host game" → room code → share code or `?join=CODE` link →
  joiner enters code → handshake → DataChannel (ordered, reliable) →
  snapshot + frames P2P.
- NAT traversal via public STUN only. Both-NATs-hostile ⇒ "couldn't
  connect" (accepted v1 edge case).

## Client

- Remote hero rigs: same player model, per-player tint; nameplates.
- Camera follows the local player; only the local player's zone renders.
- HUD stays personal (globes, belt, inventory, gold). Additions: party
  strip (portrait, life bar, floor per member; greyed when elsewhere),
  host/join lobby on the title screen, join/leave/death toasts from sim
  events, and clickable portal/corpse objects via the existing raycast.

## Testing

TDD for all sim/net logic:

- Multi-player determinism: two seeds × scripted 2-player runs ⇒
  identical state hashes.
- Zone lifecycle: lazy generation determinism, empty-zone freeze.
- Portal pair semantics (cast, replace, both-direction travel, any-player
  use).
- Corpse run: die → gear on corpse → reclaim re-equips; double-death
  merge; owner-only pickup.
- XP split: radius, killer inclusion, party bonus shape.
- Snapshot round-trip: serialize → restore ⇒ stepping stays identical to
  the original.
- Frame protocol against a fake transport: ordering, missing inputs,
  join-mid-stream, leave.
- Signaling server: socket-level room/relay tests.
- WebRTC plumbing + rendering: verified by playing two browser windows
  against a local signaling server.
