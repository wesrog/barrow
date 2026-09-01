import type { AreaId } from "./areas";
import type { Vec } from "./map";

// Replaced by ./quests in the next task.
type QuestId = string;

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
}

export const NPCS: Record<NpcId, NpcDef> = {
  maren: {
    id: "maren", name: "Maren", title: "Camp Trader", area: "overworld",
    pos: { x: 4.5, y: 29.5 }, // the V marker's spot
    quests: [], idle: ["Buying or selling, it's all the same coin."],
  },
  sera: {
    id: "sera", name: "Sera", title: "Camp Healer", area: "overworld",
    pos: { x: 4.5, y: 35.5 }, // the H marker's spot
    quests: [], idle: ["Hold still. There. Good as dawn."],
  },
  betha: {
    id: "betha", name: "Odd Betha", title: "Hermit of the Redfen", area: "redfen",
    pos: { x: 42.5, y: 22.5 },
    quests: [], idle: ["The fen keeps what it takes."],
  },
  corvin: {
    id: "corvin", name: "Corvin", title: "Last of the Ninth", area: "gallowmire",
    pos: { x: 30.5, y: 22.5 },
    quests: [], idle: ["Keep your voice down. They hear everything here."],
  },
  aldous: {
    id: "aldous", name: "Aldous", title: "Sentinel of the Barrow", area: "overworld",
    pos: { x: 55.5, y: 53.5 }, // beside the barrow mouth ('>' at 58.5,56.5)
    quests: [], idle: ["None who went down have come back up. Yet."],
  },
};

export const NPC_IDS = Object.keys(NPCS) as NpcId[];

export function isNpcId(s: string): s is NpcId {
  return s in NPCS;
}

/** An NPC standing in a zone. Static in v1: no moving, fighting, or dying. */
export interface Npc {
  id: number;
  npcId: NpcId;
  pos: Vec;
}
