import { useState } from "react";
import { localPlayer } from "../local";
import type { GameState } from "../../sim/state";
import type { QuestId } from "../../sim/quests";
import { QUESTS, QUEST_IDS, collectCount, objectiveMet } from "../../sim/quests";

const mono = "ui-monospace, monospace";

function shorten(s: string, max = 34): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** What line to show under a quest's name — kill/collect are live counts,
 * reach/talk are a checkmark once satisfied, else a short flavor hint. */
function progressLine(game: GameState, id: (typeof QUEST_IDS)[number]): string {
  const p = localPlayer(game);
  const q = QUESTS[id];
  const o = q.objective;
  switch (o.kind) {
    case "kill":
      return `${p.quests[id]?.count ?? 0}/${o.count}`;
    case "collect":
      return `${collectCount(p, o.itemBaseId)}/${o.count}`;
    case "reach":
    case "talk":
      return objectiveMet(p, id) ? "✓" : shorten(q.dialogue.progress[0] ?? "");
  }
}

/** Top-right quest log: every active quest of the local player, name plus
 * a live progress line. Reads state fresh each render off the HUD's 100ms
 * heartbeat — no event handling of its own. Clicking an entry opens the
 * full journal on that quest. */
export function QuestTracker({
  game,
  onOpen,
}: {
  game: GameState;
  onOpen: (id: QuestId) => void;
}) {
  const p = localPlayer(game);
  const active = QUEST_IDS.filter((id) => p.quests[id]?.stage === "active");
  const [hot, setHot] = useState<QuestId | null>(null);
  if (active.length === 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: 44,
        right: 14,
        zIndex: 4,
        padding: "7px 9px",
        border: "1px solid #3a3442",
        borderRadius: 4,
        background: "rgba(12,11,15,.75)",
        color: "#c9bfa8",
        fontFamily: mono,
        fontSize: 11,
        letterSpacing: 0.3,
        userSelect: "none",
        display: "flex",
        flexDirection: "column",
        gap: 5,
        maxWidth: 220,
      }}
    >
      {active.map((id) => (
        <div
          key={id}
          style={{ cursor: "pointer" }}
          title="quest details (Q)"
          onClick={() => onOpen(id)}
          onMouseEnter={() => setHot(id)}
          onMouseLeave={() => setHot((cur) => (cur === id ? null : cur))}
        >
          <div style={{ color: hot === id ? "#f5ecd4" : "#e8dcc0" }}>{QUESTS[id].name}</div>
          <div style={{ color: "#7fb8c9" }}>{progressLine(game, id)}</div>
        </div>
      ))}
    </div>
  );
}
