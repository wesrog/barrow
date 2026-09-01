import type { AreaId } from "./areas";
import type { NpcId } from "./npcs";
import type { Rarity } from "./items/generate";
import type { Player, ZoneId } from "./state";
import { zoneDepth } from "./state";
import { NPCS } from "./npcs";

export type QuestId =
  | "moor_wights" | "grave_moss" | "find_redfen"
  | "meet_betha" | "howler_cull" | "fen_hearts"
  | "soldiers_due" | "descend_barrow" | "barrow_lord";

export type QuestObjective =
  | { kind: "kill"; typeId: string; count: number; zone?: ZoneId }
  | { kind: "collect"; itemBaseId: string; count: number; dropFrom: string; chance: number }
  | { kind: "reach"; area?: AreaId; floor?: number }
  | { kind: "talk"; npc: NpcId };

export interface QuestDef {
  id: QuestId;
  giver: NpcId;
  turnIn: NpcId;
  name: string;
  requires?: QuestId;
  objective: QuestObjective;
  dialogue: { offer: string[]; progress: string[]; done: string[] };
  reward: { gold?: number; xp?: number; item?: { baseId: string; rarity: Rarity } };
}

export const QUESTS: Record<QuestId, QuestDef> = {
  moor_wights: {
    id: "moor_wights", giver: "maren", turnIn: "maren", name: "The Restless Dead",
    objective: { kind: "kill", typeId: "shambler", count: 8, zone: "surface" },
    dialogue: {
      offer: ["The dead won't stay put on these moors.", "Put eight of the shamblers down and I'll make it worth your while."],
      progress: ["Still shuffling out there, are they?"],
      done: ["That's eight fewer groans in the night. Here."],
    },
    reward: { gold: 100, xp: 80 },
  },
  grave_moss: {
    id: "grave_moss", giver: "sera", turnIn: "sera", name: "Grave-Moss",
    requires: "moor_wights",
    objective: { kind: "collect", itemBaseId: "grave_moss", count: 5, dropFrom: "shambler", chance: 0.5 },
    dialogue: {
      offer: ["The moss that grows on the walking dead — foul stuff, but it draws fever out.", "Bring me five clumps."],
      progress: ["Check the ones you fell. It grows at the collar."],
      done: ["Five, and still damp. The camp owes you."],
    },
    reward: { gold: 120, xp: 100 },
  },
  // ...remaining seven rows land with the campaign task...
} as Record<QuestId, QuestDef>;

export const QUEST_IDS = Object.keys(QUESTS) as QuestId[];

export function isQuestId(s: string): s is QuestId {
  return s in QUESTS;
}

export interface QuestProgress {
  stage: "active" | "done";
  count: number;
}

export type QuestLog = Partial<Record<QuestId, QuestProgress>>;

/** Matching entries in the pack — collect progress is derived, never counted. */
export function collectCount(p: Player, baseId: string): number {
  return p.inventory.entries.filter((e) => e.item.baseId === baseId).length;
}

export function objectiveMet(p: Player, id: QuestId): boolean {
  const q = QUESTS[id];
  const prog = p.quests[id];
  if (!prog || prog.stage !== "active") return false;
  const o = q.objective;
  switch (o.kind) {
    case "kill": return prog.count >= o.count;
    case "collect": return collectCount(p, o.itemBaseId) >= o.count;
    case "reach":
      if (o.floor !== undefined) return p.zoneId !== "surface" && zoneDepth(p.zoneId) >= o.floor;
      return p.zoneId === "surface" && p.region === o.area;
    case "talk": return prog.count >= 1;
  }
}

export function questOffered(p: Player, npcId: NpcId): QuestId | null {
  for (const id of NPCS[npcId].quests) {
    if (!(id in QUESTS)) continue; // not yet implemented
    if (p.quests[id]) continue; // started or done
    const req = QUESTS[id].requires;
    if (req && p.quests[req]?.stage !== "done") return null; // chain waits here
    return id;
  }
  return null;
}

export function questReadyToTurnIn(p: Player, npcId: NpcId): QuestId | null {
  for (const id of QUEST_IDS) {
    if (QUESTS[id].turnIn !== npcId) continue;
    if (p.quests[id]?.stage === "active" && objectiveMet(p, id)) return id;
  }
  return null;
}

export function questActiveAt(p: Player, npcId: NpcId): QuestId | null {
  for (const id of QUEST_IDS) {
    const q = QUESTS[id];
    if (q.giver !== npcId && q.turnIn !== npcId) continue;
    if (p.quests[id]?.stage === "active" && !objectiveMet(p, id)) return id;
  }
  return null;
}

/** What floats over an NPC's head, for this player: ! / ? / grey-? / nothing. */
export function npcIndicator(p: Player, npcId: NpcId): "offer" | "turnin" | "progress" | null {
  if (questReadyToTurnIn(p, npcId)) return "turnin";
  if (questOffered(p, npcId)) return "offer";
  if (questActiveAt(p, npcId)) return "progress";
  return null;
}
