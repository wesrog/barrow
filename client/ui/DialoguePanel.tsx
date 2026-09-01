import { localPlayer } from "../local";
import type { CSSProperties } from "react";
import type { GameState } from "../../sim/state";
import type { NpcId } from "../../sim/npcs";
import { NPCS } from "../../sim/npcs";
import type { QuestId } from "../../sim/quests";
import { QUESTS, questOffered, questReadyToTurnIn, questActiveAt } from "../../sim/quests";
import { PanelChrome } from "./PanelChrome";

const panelStyle: CSSProperties = {
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: 380,
  background: "rgba(12, 11, 15, 0.95)",
  border: "1px solid #3a3442",
  borderRadius: 4,
  padding: 12,
  fontFamily: "ui-monospace, monospace",
  fontSize: 12,
  color: "#c9c2b8",
  zIndex: 6,
  pointerEvents: "auto",
  boxShadow: "0 8px 30px rgba(0,0,0,.7)",
};

const lineStyle: CSSProperties = { marginBottom: 4, color: "#c9c2b8" };

const buttonRowStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  marginTop: 10,
  justifyContent: "flex-end",
};

function actionButtonStyle(color: string): CSSProperties {
  return {
    padding: "6px 12px",
    border: `1px solid ${color}`,
    borderRadius: 3,
    color,
    cursor: "pointer",
    background: "rgba(38,34,46,.5)",
  };
}

/** One conversation with an NPC: quest offer, turn-in, progress nudge, or
 * idle chatter — whichever the sim's pure helpers say applies right now. */
export function DialoguePanel({
  game,
  npcId,
  onAccept,
  onTurnIn,
  onTrade,
  onWares,
  onClose,
}: {
  game: GameState;
  npcId: NpcId;
  onAccept: (q: QuestId) => void;
  onTurnIn: (q: QuestId) => void;
  onTrade: () => void;
  onWares: () => void;
  onClose: () => void;
}) {
  const p = localPlayer(game);
  const npc = NPCS[npcId];

  const turnin = questReadyToTurnIn(p, npcId);
  const offer = turnin ? null : questOffered(p, npcId);
  const progress = turnin || offer ? null : questActiveAt(p, npcId);

  let lines: string[];
  let questName: string | null = null;
  if (turnin) {
    lines = QUESTS[turnin].dialogue.done;
    questName = QUESTS[turnin].name;
  } else if (offer) {
    lines = QUESTS[offer].dialogue.offer;
    questName = QUESTS[offer].name;
  } else if (progress) {
    lines = QUESTS[progress].dialogue.progress;
    questName = QUESTS[progress].name;
  } else {
    lines = [npc.idle[0]!];
  }

  return (
    <div style={panelStyle}>
      <PanelChrome title={`${npc.name} — ${npc.title}`} color="#c9a84c" onClose={onClose} />
      {questName && <div style={{ color: "#8f8778", marginBottom: 6 }}>{questName}</div>}
      {lines.map((line, i) => (
        <div key={i} style={lineStyle}>
          {line}
        </div>
      ))}
      <div style={buttonRowStyle}>
        {npcId === "maren" && (
          <span style={actionButtonStyle("#8f8778")} onClick={onTrade}>
            Trade
          </span>
        )}
        {npcId === "sera" && (
          <span style={actionButtonStyle("#7fa3f5")} onClick={onWares}>
            Wares
          </span>
        )}
        {turnin && (
          <span style={actionButtonStyle("#7de08a")} onClick={() => onTurnIn(turnin)}>
            Complete
          </span>
        )}
        {offer && (
          <span style={actionButtonStyle("#c9a84c")} onClick={() => onAccept(offer)}>
            Accept
          </span>
        )}
        <span style={actionButtonStyle("#6b6455")} onClick={onClose}>
          Leave
        </span>
      </div>
    </div>
  );
}
