import { localPlayer } from "../local";
import type { CSSProperties } from "react";
import { CLASS_SKILLS, type SkillId } from "../../sim/skills";
import type { GameState } from "../../sim/state";
import { PanelChrome } from "./PanelChrome";

const DESCRIPTIONS: Record<SkillId, string> = {
  cleave: "sweep every enemy in reach · +25%/rank · +10% per warcry rank",
  crush: "guaranteed heavy blow · 200% +50%/rank",
  warcry: "battle shout, +damage for 20s · also empowers cleave",
  leap: "jump to a spot, crushing and stunning enemies where you land",
  firebolt: "hurl fire at a distant enemy · never misses · +10% per focus rank",
  frostnova: "icy burst around you, chilling everything it touches",
  focus: "gather your will, +spell damage for 20s · also empowers firebolt",
  blink: "step through shadow to a spot you can see",
};

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
  onClose,
}: {
  game: GameState;
  onSpend: (skill: SkillId) => void;
  onClose: () => void;
}) {
  const p = localPlayer(game);
  return (
    <div style={panelStyle}>
      <PanelChrome
        title={`skills — level ${p.level} · ${p.skillPoints} point${p.skillPoints === 1 ? "" : "s"} to spend`}
        onClose={onClose}
      />
      {CLASS_SKILLS(p.klass).map((def, i) => {
        const rank = p.skills[def.id];
        const hotkey = String(i + 1);
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
                [{hotkey}] {def.name}
              </span>
              <span style={{ color: "#8f8778" }}>
                {locked ? `lvl ${def.levelReq}` : `rank ${rank}`} · {def.manaCost} mana
              </span>
            </div>
            <div style={{ color: "#6b6455", marginTop: 2 }}>{DESCRIPTIONS[def.id]}</div>
          </div>
        );
      })}
      <div style={{ color: "#55503f", marginTop: 6 }}>s or esc to close · 1–4 to cast</div>
    </div>
  );
}
