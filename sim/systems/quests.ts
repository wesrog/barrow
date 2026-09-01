import { findPath, smoothPath } from "../path";
import type { GameState, Player, PlayerInput, ZoneState } from "../state";
import { allPlayers, getZone } from "../state";
import type { Npc, NpcId } from "../npcs";
import {
  QUESTS, QUEST_IDS, collectCount, objectiveMet, questOffered, questReadyToTurnIn, type QuestDef, type QuestId,
} from "../quests";
import { grantXp } from "./xp";
import { rollItem } from "../items/generate";
import { placeItem, removeEntry } from "../character";
import { dropSpot } from "./combat";

/** How close you must stand before an NPC will talk. */
export const NPC_TALK_RANGE = 1.4;

/** The npc entity for `npcId` within talk range of p, in p's zone — or null. */
function npcInRange(state: GameState, p: Player, npcId: NpcId): Npc | null {
  const zone = state.zones.get(p.zoneId);
  if (!zone) return null;
  for (const npc of zone.npcs.values()) {
    if (npc.npcId !== npcId) continue;
    if (Math.hypot(p.pos.x - npc.pos.x, p.pos.y - npc.pos.y) <= NPC_TALK_RANGE) return npc;
  }
  return null;
}

/** Accept the offered quest from its giver, if in range and the chain allows it. */
export function applyAcceptQuestInput(state: GameState, p: Player, input: PlayerInput): void {
  const id = input.acceptQuest;
  if (!id || !(id in QUESTS)) return;
  const q = QUESTS[id];
  if (questOffered(p, q.giver) !== id) return;
  if (!npcInRange(state, p, q.giver)) return;
  // Introducing yourself to the giver IS the errand — met on the spot.
  const count = q.objective.kind === "talk" && q.objective.npc === q.giver ? 1 : 0;
  p.quests[id] = { stage: "active", count };
  state.events.push({ type: "quest_accepted", playerId: p.id, quest: id });
}

/** Pay out a quest's (or shop's) reward: gold, an item (pack, or the ground if full), and xp. */
export function deliverQuestReward(
  state: GameState,
  p: Player,
  reward: QuestDef["reward"],
): void {
  if (reward.gold) p.gold += reward.gold;
  if (reward.item) {
    const item = rollItem(state.rng, reward.item.baseId, Math.max(1, p.level), reward.item.rarity);
    if (!placeItem(p.inventory, state.nextId++, item)) {
      const pos = dropSpot(state.rng, state.zones.get(p.zoneId)!.map, p.pos);
      const gid = state.nextId++;
      state.zones.get(p.zoneId)!.groundItems.set(gid, { id: gid, item, pos });
      state.events.push({ type: "item_dropped", id: gid, name: item.name, rarity: item.rarity, pos, zone: p.zoneId });
    }
  }
  if (reward.xp) grantXp(state, p, reward.xp);
}

/** Turn in a completed quest at its turn-in npc: hand over collect goods, pay the reward. */
export function applyTurnInQuestInput(state: GameState, p: Player, input: PlayerInput): void {
  const id = input.turnInQuest;
  if (!id || !(id in QUESTS)) return;
  const q = QUESTS[id];
  if (questReadyToTurnIn(p, q.turnIn) !== id) return;
  if (!npcInRange(state, p, q.turnIn)) return;
  if (q.objective.kind === "collect") {
    // Hand the goods over: remove exactly `count` matching entries.
    let left = q.objective.count;
    for (const e of [...p.inventory.entries]) {
      if (left === 0) break;
      if (e.item.baseId === q.objective.itemBaseId) { removeEntry(p.inventory, e.id); left--; }
    }
  }
  p.quests[id] = { stage: "done", count: p.quests[id]!.count };
  deliverQuestReward(state, p, q.reward);
  state.events.push({ type: "quest_completed", playerId: p.id, quest: id });
}

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

/** Advance every player's active objectives off this tick's events and
 * standing state. Runs after the zone systems, before xpSystem. */
export function questProgressSystem(state: GameState): void {
  const bump = (p: Player, id: QuestId, to: number, needed: number) => {
    const prog = p.quests[id]!;
    if (to === prog.count) return;
    prog.count = to;
    state.events.push({ type: "quest_progress", playerId: p.id, quest: id, count: to, needed });
  };
  // Kill credit: every in-zone player with the quest active shares each kill.
  for (const e of state.events) {
    if (e.type === "monster_died") {
      // Collect quests: the sought thing has a chance to be on the corpse
      // whenever anyone in the zone still needs it.
      for (const id of QUEST_IDS) {
        const o = QUESTS[id].objective;
        if (o.kind !== "collect" || o.dropFrom !== e.typeId) continue;
        const wanted = allPlayers(state).some(
          (p) =>
            !p.dead && p.zoneId === e.zone &&
            p.quests[id]?.stage === "active" &&
            collectCount(p, o.itemBaseId) < o.count,
        );
        if (!wanted || state.rng.next() >= o.chance) continue;
        const zone = getZone(state, e.zone);
        const pos = dropSpot(state.rng, zone.map, e.pos);
        const gid = state.nextId++;
        const item = rollItem(state.rng, o.itemBaseId, 1, "normal");
        zone.groundItems.set(gid, { id: gid, item, pos });
        state.events.push({ type: "item_dropped", id: gid, name: item.name, rarity: item.rarity, pos, zone: e.zone });
      }
      for (const p of allPlayers(state)) {
        if (p.dead || p.zoneId !== e.zone) continue;
        for (const id of QUEST_IDS) {
          const o = QUESTS[id].objective;
          const prog = p.quests[id];
          if (!prog || prog.stage !== "active" || o.kind !== "kill") continue;
          if (o.typeId !== e.typeId) continue;
          if (o.zone !== undefined && o.zone !== e.zone) continue;
          bump(p, id, Math.min(o.count, prog.count + 1), o.count);
        }
      }
    } else if (e.type === "npc_talk") {
      const p = state.players.get(e.playerId);
      if (!p) continue;
      for (const id of QUEST_IDS) {
        const o = QUESTS[id].objective;
        const prog = p.quests[id];
        if (!prog || prog.stage !== "active" || o.kind !== "talk") continue;
        if (o.npc !== e.npcId) continue;
        bump(p, id, 1, 1);
      }
    }
  }
  // Reach: a standing check — no event archaeology, just where they are now.
  for (const p of allPlayers(state)) {
    if (p.dead) continue;
    for (const id of QUEST_IDS) {
      const o = QUESTS[id].objective;
      const prog = p.quests[id];
      if (!prog || prog.stage !== "active" || o.kind !== "reach" || prog.count >= 1) continue;
      if (objectiveMet(p, id)) bump(p, id, 1, 1);
    }
  }
}
