import { findPath, smoothPath } from "../path";
import type { GameState, Player, PlayerInput, ZoneState } from "../state";

/** How close you must stand before an NPC will talk. */
export const NPC_TALK_RANGE = 1.4;

/** Click an NPC: start walking over for a word. */
export function applyTalkNpcInput(state: GameState, p: Player, input: PlayerInput): void {
  if (input.talkNpc === undefined) return;
  const zone = state.zones.get(p.zoneId);
  if (!zone?.npcs.has(input.talkNpc)) return;
  p.npcTarget = input.talkNpc;
  p.attackTarget = null;
  p.pickupTarget = null;
  p.smashTarget = null;
  p.portalTarget = null;
  p.reclaimTarget = null;
  p.path = [];
}

/** Walk toward the targeted NPC; within range, the conversation opens.
 * Sera also mends in full — her trade since the camp's founding. */
export function npcSystem(state: GameState, zone: ZoneState, players: Player[]): void {
  for (const p of players) {
    if (p.npcTarget === null) continue;
    const npc = zone.npcs.get(p.npcTarget);
    if (!npc) {
      p.npcTarget = null;
      continue;
    }
    const d = Math.hypot(p.pos.x - npc.pos.x, p.pos.y - npc.pos.y);
    if (d <= NPC_TALK_RANGE) {
      p.npcTarget = null;
      p.path = [];
      if (npc.npcId === "sera") {
        p.life = p.maxLife;
        p.mana = p.maxMana;
        state.events.push({ type: "healed", playerId: p.id });
      }
      state.events.push({ type: "npc_talk", playerId: p.id, npcId: npc.npcId });
    } else if (p.path.length === 0) {
      const cells = findPath(
        zone.map,
        { x: Math.floor(p.pos.x), y: Math.floor(p.pos.y) },
        { x: Math.floor(npc.pos.x), y: Math.floor(npc.pos.y) },
      );
      if (cells === null) {
        p.npcTarget = null;
        continue;
      }
      p.path = smoothPath(zone.map, p.pos, cells);
      p.path.push({ x: npc.pos.x, y: npc.pos.y });
    }
  }
}
