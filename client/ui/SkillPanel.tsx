import { localPlayer } from "../local";
import type { CSSProperties } from "react";
import { SKILLS, type SkillId } from "../../sim/skills";
import type { GameState } from "../../sim/state";

const DESCRIPTIONS: Record<SkillId, string> = {
  cleave: "sweep every enemy in reach · +25%/rank · +10% per warcry rank",
  crush: "guaranteed heavy blow · 200% +50%/rank",
  warcry: "battle shout, +damage for 20s · also empowers cleave",
  leap: "jump to a spot, stunning enemies where you land",
};

const HOTKEYS: Record<SkillId, string> = { cleave: "1", crush: "2", warcry: "3", leap: "4" };

const panelStyle: CSSProperties = {
  position: "absolute",
  top: 16,
  left: 16,
  width: 330,
  background: "rgba(12, 11, 15, 0.93)",
  border: "1px solid #3a3442",
  borderRadius: 4,
  padding: 12,
  fontFamily: "ui-monospace, monospace",
  fontSize: 12,
  color: "#c9c2b8",
  zIndex: 5,
  pointerEvents: "auto",
  boxShadow: "0 8px 30px rgba(0,0,0,.6)",
};

export function SkillPanel({
  game,
  onSpend,
}: {
  game: GameState;
  onSpend: (skill: SkillId) => void;
}) {
  const p = localPlayer(game);
  return (
    <div style={panelStyle}>
      <div style={{ color: "#8f8778", marginBottom: 8, letterSpacing: 1 }}>
        skills — level {p.level} · {p.skillPoints} point{p.skillPoints === 1 ? "" : "s"} to spend
      </div>
      {Object.values(SKILLS).map((def) => {
        const rank = p.skills[def.id];
        const locked = p.level < def.levelReq;
        const canSpend = !locked && p.skillPoints > 0;
        return (
          <div
            key={def.id}
            onClick={() => canSpend && onSpend(def.id)}
            title={canSpend ? "click to spend a point" : undefined}
            style={{
              padding: "6px 8px",
              marginBottom: 4,
              border: `1px solid ${rank > 0 ? "#5a5468" : "#2c2833"}`,
              borderRadius: 3,
              cursor: canSpend ? "pointer" : "default",
              opacity: locked ? 0.45 : 1,
              background: rank > 0 ? "rgba(48,42,60,.5)" : "transparent",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: rank > 0 ? "#e8dcc0" : "#948c7d" }}>
                [{HOTKEYS[def.id]}] {def.name}
              </span>
              <span style={{ color: "#8f8778" }}>
                {locked ? `lvl ${def.levelReq}` : `rank ${rank}`} · {def.manaCost} mana
              </span>
            </div>
            <div style={{ color: "#6b6455", marginTop: 2 }}>{DESCRIPTIONS[def.id]}</div>
          </div>
        );
      })}
      <div style={{ color: "#55503f", marginTop: 6 }}>s to close · 1–4 to cast</div>
    </div>
  );
}
