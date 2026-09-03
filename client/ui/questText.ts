import type { Player } from "../../sim/state";
import { zoneDungeon } from "../../sim/state";
import { DUNGEONS } from "../../sim/dungeons";
import type { QuestDef, QuestId } from "../../sim/quests";
import { QUESTS, collectCount, objectiveMet } from "../../sim/quests";
import { MONSTER_TYPES } from "../../sim/monsters";
import { NPCS } from "../../sim/npcs";
import { BASES } from "../../sim/items/bases";
import { regionTitle } from "../../sim/surface";

/** "The Barrow Lord" pluralizes badly; anything starting with "The" is a
 * single named creature, everything else gets a plain s. */
function monsterPlural(typeId: string, count: number): string {
  const name = MONSTER_TYPES[typeId]?.name ?? typeId;
  return count === 1 || name.startsWith("The ") ? name : `${name}s`;
}

export function objectiveText(q: QuestDef): string {
  const o = q.objective;
  switch (o.kind) {
    case "kill": {
      const where =
        o.zone === undefined
          ? ""
          : o.zone === "surface"
            ? " on the surface"
            : ` in ${DUNGEONS[zoneDungeon(o.zone)!].name}`;
      return `Slay ${o.count === 1 ? "" : `${o.count} `}${monsterPlural(o.typeId, o.count)}${where}`;
    }
    case "collect":
      return `Gather ${o.count} ${BASES[o.itemBaseId]?.name ?? o.itemBaseId} from ${monsterPlural(o.dropFrom, 2)}`;
    case "reach":
      return o.floor !== undefined
        ? `Descend to floor ${o.floor} of ${DUNGEONS[o.dungeon!].name}`
        : `Find ${regionTitle(o.area!)}`;
    case "talk":
      return `Speak with ${NPCS[o.npc].name}`;
  }
}

export function rewardText(q: QuestDef): string {
  const parts: string[] = [];
  if (q.reward.gold) parts.push(`${q.reward.gold} gold`);
  if (q.reward.xp) parts.push(`${q.reward.xp} xp`);
  if (q.reward.item) {
    const name = BASES[q.reward.item.baseId]?.name ?? q.reward.item.baseId;
    parts.push(`${q.reward.item.rarity} ${name}`);
  }
  return parts.join(", ");
}

/** "3 / 8", "✓ return to Maren", or "complete" — the quest's live standing. */
export function progressText(p: Player, id: QuestId): string {
  const prog = p.quests[id];
  if (!prog) return "";
  if (prog.stage === "done") return "complete";
  if (objectiveMet(p, id)) return `✓ return to ${NPCS[QUESTS[id].turnIn].name}`;
  const o = QUESTS[id].objective;
  switch (o.kind) {
    case "kill":
      return `${prog.count} / ${o.count}`;
    case "collect":
      return `${collectCount(p, o.itemBaseId)} / ${o.count}`;
    case "reach":
    case "talk":
      return "in progress";
  }
}
