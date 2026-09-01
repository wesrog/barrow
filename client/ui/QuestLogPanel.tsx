import { useState } from "react";
import type { CSSProperties } from "react";
import { localPlayer } from "../local";
import type { GameState } from "../../sim/state";
import type { QuestId } from "../../sim/quests";
import { QUESTS, QUEST_IDS, objectiveMet } from "../../sim/quests";
import { NPCS } from "../../sim/npcs";
import { objectiveText, progressText, rewardText } from "./questText";
import { PanelChrome } from "./PanelChrome";

const panelStyle: CSSProperties = {
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: 440,
  maxHeight: "70vh",
  display: "flex",
  flexDirection: "column",
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

function rowStyle(selected: boolean, done: boolean): CSSProperties {
  return {
    padding: "5px 8px",
    borderRadius: 3,
    cursor: "pointer",
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    background: selected ? "rgba(48,42,60,.6)" : "transparent",
    color: done ? "#6b6455" : "#e8dcc0",
    userSelect: "none",
  };
}

/** The journal: every quest the player has taken, in log order, with the
 * selected one opened up — giver, the words that sent you, the objective,
 * live progress, and what's waiting at the end. */
export function QuestLogPanel({
  game,
  focus,
  onClose,
}: {
  game: GameState;
  focus: QuestId | null;
  onClose: () => void;
}) {
  const p = localPlayer(game);
  const taken = QUEST_IDS.filter((id) => p.quests[id]);
  const active = taken.filter((id) => p.quests[id]!.stage === "active");
  const done = taken.filter((id) => p.quests[id]!.stage === "done");
  const ordered = [...active, ...done];
  const [selected, setSelected] = useState<QuestId | null>(focus ?? ordered[0] ?? null);
  const sel = selected && p.quests[selected] ? QUESTS[selected] : null;

  return (
    <div style={panelStyle}>
      <PanelChrome title="Quest Log" color="#c9a84c" onClose={onClose} />
      {ordered.length === 0 && (
        <div style={{ color: "#8f8778", padding: "6px 2px" }}>
          No quests yet — the camp folk may have work for you.
        </div>
      )}
      <div style={{ overflowY: "auto", flex: "none", maxHeight: 180 }}>
        {ordered.map((id) => (
          <div
            key={id}
            style={rowStyle(id === selected, p.quests[id]!.stage === "done")}
            onClick={() => setSelected(id)}
          >
            <span>{QUESTS[id].name}</span>
            <span style={{ color: p.quests[id]!.stage === "done" ? "#6b6455" : "#7fb8c9" }}>
              {progressText(p, id)}
            </span>
          </div>
        ))}
      </div>
      {sel && (
        <div
          style={{
            marginTop: 8,
            paddingTop: 8,
            borderTop: "1px solid #2c2833",
            overflowY: "auto",
          }}
        >
          <div style={{ color: "#c9a84c", marginBottom: 2 }}>{sel.name}</div>
          <div style={{ color: "#8f8778", marginBottom: 6 }}>
            {NPCS[sel.giver].name}, {NPCS[sel.giver].title}
          </div>
          {sel.dialogue.offer.map((line, i) => (
            <div key={i} style={{ color: "#a89f92", fontStyle: "italic", marginBottom: 3 }}>
              “{line}”
            </div>
          ))}
          <div style={{ marginTop: 7 }}>
            <span style={{ color: "#8f8778" }}>objective: </span>
            {objectiveText(sel)}
          </div>
          <div>
            <span style={{ color: "#8f8778" }}>progress: </span>
            <span
              style={{
                color:
                  p.quests[sel.id]!.stage === "done" || objectiveMet(p, sel.id)
                    ? "#7de08a"
                    : "#7fb8c9",
              }}
            >
              {progressText(p, sel.id)}
            </span>
          </div>
          <div>
            <span style={{ color: "#8f8778" }}>reward: </span>
            {rewardText(sel)}
          </div>
        </div>
      )}
    </div>
  );
}
