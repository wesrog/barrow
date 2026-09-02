import type { AreaId } from "./areas";
import type { Vec } from "./map";
import type { QuestId } from "./quests";

export type NpcId = "maren" | "sera" | "betha" | "corvin" | "aldous";

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
  /** Stamped structure at `home`: a hut gets four walls and a doorway. */
  dwelling?: "hut";
}

export const NPCS: Record<NpcId, NpcDef> = {
  maren: {
    id: "maren", name: "Maren", title: "Camp Trader", area: "overworld",
    pos: { x: 4.5, y: 29.5 }, // the V marker's spot
    quests: ["moor_wights", "find_redfen", "clearing_roads"], idle: ["Buying or selling, it's all the same coin."],
  },
  sera: {
    id: "sera", name: "Sera", title: "Camp Healer", area: "overworld",
    pos: { x: 4.5, y: 35.5 }, // the H marker's spot
    quests: ["grave_moss", "bloat_harvest"], idle: ["Hold still. There. Good as dawn."],
  },
  betha: {
    id: "betha", name: "Odd Betha", title: "Hermit of the Redfen", area: "redfen",
    pos: { x: 42.5, y: 22.5 }, dwelling: "hut",
    quests: ["meet_betha", "howler_cull", "fen_hearts"], idle: ["The fen keeps what it takes."],
  },
  corvin: {
    id: "corvin", name: "Corvin", title: "Last of the Ninth", area: "gallowmire",
    pos: { x: 30.5, y: 22.5 },
    quests: ["soldiers_due", "ninth_sigils"], idle: ["Keep your voice down. They hear everything here."],
  },
  aldous: {
    id: "aldous", name: "Aldous", title: "Sentinel of the Barrow", area: "overworld",
    pos: { x: 55.5, y: 53.5 }, // beside the barrow mouth ('>' at 58.5,56.5)
    quests: ["descend_barrow", "barrow_lord", "old_bones"], idle: ["None who went down have come back up. Yet."],
  },
};

export const NPC_IDS = Object.keys(NPCS) as NpcId[];

export function isNpcId(s: string): s is NpcId {
  return s in NPCS;
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
