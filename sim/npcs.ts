import type { AreaId } from "./areas";
import type { Vec } from "./map";
import type { QuestId, QuestLog } from "./quests";

export type NpcId = "maren" | "sera" | "betha" | "corvin" | "aldous";

/** One state-keyed line of idle chatter: shown when its condition holds.
 * Rows are checked in order and the first match wins, so list the
 * latest-game reactions first. */
export interface ReactiveLines {
  when: { questDone?: QuestId; questActive?: QuestId };
  lines: string[];
}

/** One NPC as data: content growth is new rows here, not new code. `pos` is
 * area-local (like AreaDef.markers); spawning translates to world coords. */
export interface NpcDef {
  id: NpcId;
  name: string;
  title: string;
  area: AreaId;
  pos: Vec;
  /** Offered in chain order, one at a time. Filled in by the campaign task. */
  quests: QuestId[];
  /** Lines when they have nothing for you. */
  idle: string[];
  /** State-keyed idle chatter — the camp acknowledging what you've done. */
  reactive?: ReactiveLines[];
  /** Stamped structure at `home`: a hut gets four walls and a doorway. */
  dwelling?: "hut";
}

export const NPCS: Record<NpcId, NpcDef> = {
  maren: {
    id: "maren", name: "Maren", title: "Camp Trader", area: "overworld",
    pos: { x: 4.5, y: 29.5 }, // the V marker's spot
    quests: ["moor_wights", "find_redfen", "clearing_roads"], idle: ["Buying or selling, it's all the same coin."],
    reactive: [
      { when: { questDone: "barrow_lord" }, lines: [
        "Word's gone round: the thing under the barrow is dead, and you did it.",
        "Prices are the same, mind. Heroes eat too.",
      ] },
      { when: { questDone: "find_redfen" }, lines: [
        "So Betha's still out there. Stubborn as the fen itself.",
        "You want anything before you head back east?",
      ] },
    ],
  },
  sera: {
    id: "sera", name: "Sera", title: "Camp Healer", area: "overworld",
    pos: { x: 4.5, y: 35.5 }, // the H marker's spot
    quests: ["grave_moss", "bloat_harvest"], idle: ["Hold still. There. Good as dawn."],
    reactive: [
      { when: { questDone: "barrow_lord" }, lines: [
        "The fever tents are empty for the first time since spring.",
        "Whatever you killed down there, the sickness went with it.",
      ] },
      { when: { questDone: "grave_moss" }, lines: [
        "That moss you brought is half gone already. It works. Hold still.",
      ] },
    ],
  },
  betha: {
    id: "betha", name: "Odd Betha", title: "Hermit of the Redfen", area: "redfen",
    pos: { x: 42.5, y: 22.5 }, dwelling: "hut",
    quests: ["meet_betha", "howler_cull", "fen_hearts"], idle: ["The fen keeps what it takes."],
    reactive: [
      { when: { questDone: "barrow_lord" }, lines: [
        "The water's gone quiet. Not empty — quiet. There's a difference, and it's yours.",
      ] },
      { when: { questDone: "fen_hearts" }, lines: [
        "Four hearts on my shelf and the fen hasn't sent anything to take them back.",
        "Corvin's waiting, past the Gallowmire. Don't keep a soldier waiting.",
      ] },
    ],
  },
  corvin: {
    id: "corvin", name: "Corvin", title: "Last of the Ninth", area: "gallowmire",
    pos: { x: 30.5, y: 22.5 },
    quests: ["soldiers_due", "ninth_sigils"], idle: ["Keep your voice down. They hear everything here."],
    reactive: [
      { when: { questDone: "ninth_sigils" }, lines: [
        "The sigils go home with the next trader heading south. Three families sleep tonight.",
        "You can raise your voice now, a little.",
      ] },
      { when: { questDone: "soldiers_due" }, lines: [
        "Eight of mine at rest. The mire feels lighter. Or I do.",
      ] },
    ],
  },
  aldous: {
    id: "aldous", name: "Aldous", title: "Sentinel of the Barrow", area: "overworld",
    pos: { x: 55.5, y: 53.5 }, // beside the barrow mouth ('>' at 58.5,56.5)
    quests: ["descend_barrow", "barrow_lord", "old_bones"], idle: ["None who went down have come back up. Yet."],
    reactive: [
      { when: { questDone: "barrow_lord" }, lines: [
        "I stood this post twelve years waiting for something to come up those stairs.",
        "You went down instead. I can stop counting the steps now.",
      ] },
      { when: { questActive: "barrow_lord" }, lines: [
        "It knows you're coming now. The air off the stairs has changed.",
      ] },
      { when: { questDone: "descend_barrow" }, lines: [
        "Three floors down and back. You're the first. Don't let it make you careless.",
      ] },
    ],
  },
};

export const NPC_IDS = Object.keys(NPCS) as NpcId[];

export function isNpcId(s: string): s is NpcId {
  return s in NPCS;
}

/** Idle chatter for this hero's world: the first reactive row whose condition
 * holds, else the NPC's plain idle lines. Pure lookup — the HUD calls it. */
export function npcIdleLines(quests: QuestLog, npcId: NpcId): string[] {
  for (const r of NPCS[npcId].reactive ?? []) {
    const met = r.when.questDone
      ? quests[r.when.questDone]?.stage === "done"
      : r.when.questActive
        ? quests[r.when.questActive]?.stage === "active"
        : false;
    if (met) return r.lines;
  }
  return NPCS[npcId].idle;
}

/** An NPC in a zone. They stroll a little around `home` for life, but never
 * fight, die, or leave their spot's neighborhood. */
export interface Npc {
  id: number;
  npcId: NpcId;
  pos: Vec;
  /** The spot they were placed at — wandering never strays far from it. */
  home: Vec;
  /** Cell-center they're currently strolling toward, if any. */
  wanderTarget: Vec | null;
  /** Ticks left standing around before the next stroll. */
  waitTicks: number;
}
