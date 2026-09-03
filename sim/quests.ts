import type { AreaId } from "./areas";
import type { NpcId } from "./npcs";
import type { Rarity } from "./items/generate";
import type { Player, ZoneId } from "./state";
import { dungeonZoneId, zoneDungeon, zoneFloor } from "./state";
import type { DungeonId } from "./dungeons";
import { NPCS } from "./npcs";

export type QuestId =
  | "moor_wights" | "grave_moss" | "find_redfen"
  | "meet_betha" | "howler_cull" | "fen_hearts"
  | "soldiers_due" | "descend_barrow" | "barrow_lord";

export type QuestObjective =
  | { kind: "kill"; typeId: string; count: number; zone?: ZoneId }
  | { kind: "collect"; itemBaseId: string; count: number; dropFrom: string; chance: number }
  | { kind: "reach"; area?: AreaId; dungeon?: DungeonId; floor?: number }
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
  find_redfen: {
    id: "find_redfen", giver: "maren", turnIn: "maren", name: "Into the Redfen",
    requires: "grave_moss",
    objective: { kind: "reach", area: "redfen" },
    dialogue: {
      offer: [
        "East of the moors, past the crooked willow, the ground turns to fen. Find it.",
        "There's a woman out there who doesn't come to camp. See that she's still standing.",
      ],
      progress: ["You'll know the redfen by the smell."],
      done: ["So you made it back. Good. Now tell me you saw more than mud."],
    },
    reward: { gold: 80, xp: 90 },
  },
  meet_betha: {
    id: "meet_betha", giver: "betha", turnIn: "betha", name: "Odd Betha",
    requires: "find_redfen",
    objective: { kind: "talk", npc: "betha" },
    dialogue: {
      offer: [
        "So. Maren finally sent someone.",
        "Sit still a moment. Let me look at you before the fen does.",
      ],
      progress: ["Well? Speak up."],
      done: ["Hm. You'll do. The fen keeps what it takes — try not to be taken."],
    },
    reward: { gold: 60, xp: 120 },
  },
  howler_cull: {
    id: "howler_cull", giver: "betha", turnIn: "betha", name: "The Baying",
    requires: "meet_betha",
    objective: { kind: "kill", typeId: "fen_howler", count: 10, zone: "surface" },
    dialogue: {
      offer: [
        "The howlers have been circling closer every dusk.",
        "Thin their number — ten will quiet the fen a while.",
      ],
      progress: ["Still baying out there? Good ears, bad manners."],
      done: ["Ten silenced. The fen breathes easier. Take this — better than what you're swinging."],
    },
    reward: { gold: 200, xp: 220, item: { baseId: "hatchet", rarity: "magic" } },
  },
  fen_hearts: {
    id: "fen_hearts", giver: "betha", turnIn: "betha", name: "Four Hearts",
    requires: "howler_cull",
    objective: { kind: "collect", itemBaseId: "fen_heart", count: 4, dropFrom: "bog_maw", chance: 0.6 },
    dialogue: {
      offer: [
        "The bog-maws carry something older than meat in their chests.",
        "Bring me four fen hearts, still warm if you can manage it.",
      ],
      progress: ["You'll feel it stop beating when it's ready to come out."],
      done: [
        "Four hearts, four fewer maws grinning at travelers.",
        "Now — Corvin, out past the Gallowmire, has work of his own. Go find him.",
      ],
    },
    reward: { gold: 250, xp: 280 },
  },
  soldiers_due: {
    id: "soldiers_due", giver: "corvin", turnIn: "corvin", name: "What's Owed the Ninth",
    requires: "fen_hearts",
    objective: { kind: "kill", typeId: "cairn_wight", count: 8, zone: "surface" },
    dialogue: {
      offer: [
        "The cairn-wights were men once. Mine, some of them.",
        "Eight of them still wear the Ninth's colors. Put them down proper.",
      ],
      progress: ["Any luck putting my old company to rest?"],
      done: ["Eight fewer ghosts wearing my dead friends' faces. Wear this — it held once, it'll hold again."],
    },
    reward: { gold: 350, xp: 420, item: { baseId: "studded_jerkin", rarity: "rare" } },
  },
  descend_barrow: {
    id: "descend_barrow", giver: "aldous", turnIn: "aldous", name: "The Barrow Mouth",
    requires: "soldiers_due",
    objective: { kind: "reach", dungeon: "barrow", floor: 3 },
    dialogue: {
      offer: [
        "This is the barrow mouth. None who went down have come back up — yet.",
        "Go down three floors and prove me wrong.",
      ],
      progress: ["Still counting floors, are you? Keep going."],
      done: ["Three floors down and still breathing. I didn't think I'd see that."],
    },
    reward: { gold: 300, xp: 500 },
  },
  barrow_lord: {
    id: "barrow_lord", giver: "aldous", turnIn: "aldous", name: "The Lord Below",
    requires: "descend_barrow",
    objective: { kind: "kill", typeId: "barrow_lord", count: 1, zone: dungeonZoneId("barrow", 5) },
    dialogue: {
      offer: [
        "Deeper still, something wears a crown of rust and calls itself lord of the dead.",
        "Kill it. Bring me proof, or don't bother coming back.",
      ],
      progress: ["Is it dead yet? The moors won't rest until it is."],
      done: ["You did it. Take this — it's older than the barrow itself, and it's earned."],
    },
    reward: { gold: 600, xp: 900, item: { baseId: "grave_scythe", rarity: "unique" } },
  },
};

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

/** Live standing check for a reach objective — has the player arrived, right now?
 * Used only to trigger the one-time progress bump; completion itself (below)
 * remembers that bump rather than requiring the player to still be standing
 * there when they walk back to report in. */
export function reachedNow(p: Player, o: Extract<QuestObjective, { kind: "reach" }>): boolean {
  if (o.floor !== undefined) {
    return o.dungeon !== undefined && zoneDungeon(p.zoneId) === o.dungeon && zoneFloor(p.zoneId) >= o.floor;
  }
  return p.zoneId === "surface" && p.region === o.area;
}

export function objectiveMet(p: Player, id: QuestId): boolean {
  const q = QUESTS[id];
  const prog = p.quests[id];
  if (!prog || prog.stage !== "active") return false;
  const o = q.objective;
  switch (o.kind) {
    case "kill": return prog.count >= o.count;
    case "collect": return collectCount(p, o.itemBaseId) >= o.count;
    case "reach": return prog.count >= 1;
    case "talk": return prog.count >= 1;
  }
}

export function questOffered(p: Player, npcId: NpcId): QuestId | null {
  for (const id of NPCS[npcId].quests) {
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
