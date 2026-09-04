import { localPlayer } from "../local";
import { useState, type CSSProperties } from "react";
import {
  CLASS_TREES,
  MAX_RANK,
  SKILLS,
  TREE_SKILLS,
  type SkillDef,
  type SkillId,
} from "../../sim/skills";
import { canSpendOn } from "../../sim/systems/skills";
import type { GameState, Player } from "../../sim/state";
import { HOTBAR_KEYS, type Hotbar } from "../hotbar";
import { PanelChrome } from "./PanelChrome";

const panelStyle: CSSProperties = {
  position: "absolute",
  top: 16,
  left: 16,
  width: 780,
  maxHeight: "calc(100% - 180px)",
  overflowY: "auto",
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

/** The unspent-point glow: injected once, shared by the panel banner and
 * every learnable skill's + button so they breathe together. */
const PULSE_KEYFRAMES = `@keyframes barrow-skill-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(201,168,76,.0); }
  50% { box-shadow: 0 0 10px 2px rgba(201,168,76,.45); }
}`;

const bannerStyle: CSSProperties = {
  margin: "6px 0 10px",
  padding: "7px 10px",
  border: "1px solid #c9a84c",
  borderRadius: 3,
  background: "rgba(201,168,76,.12)",
  color: "#e8d9a8",
  display: "flex",
  alignItems: "center",
  gap: 8,
  animation: "barrow-skill-pulse 2.2s ease-in-out infinite",
};

const spendButtonStyle: CSSProperties = {
  width: 22,
  height: 22,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 16,
  lineHeight: 1,
  fontWeight: 700,
  border: "1px solid #c9a84c",
  borderRadius: 3,
  color: "#f0c96a",
  background: "rgba(201,168,76,.18)",
  cursor: "pointer",
  userSelect: "none",
  animation: "barrow-skill-pulse 2.2s ease-in-out infinite",
  flexShrink: 0,
};

/** Rank as a row of pips: filled for ranks taken, hollow for room to grow. */
function RankPips({ rank }: { rank: number }) {
  return (
    <span title={`rank ${rank}/${MAX_RANK}`} style={{ display: "inline-flex", gap: 2, letterSpacing: 0 }}>
      {Array.from({ length: MAX_RANK }, (_, i) => (
        <span
          key={i}
          style={{
            width: 5,
            height: 8,
            borderRadius: 1,
            background: i < rank ? "#c9a84c" : "transparent",
            border: `1px solid ${i < rank ? "#c9a84c" : "#3a3442"}`,
          }}
        />
      ))}
    </span>
  );
}

/** Why a cell won't take a point right now, or null when it's open. */
function lockReason(p: Player, def: SkillDef): string | null {
  if (def.pending) return "coming";
  if (p.level < def.tier) return `unlocks at level ${def.tier}`;
  const missing = def.prereqs.filter((pre) => p.skills[pre] <= 0);
  if (missing.length > 0) return `needs ${missing.map((pre) => SKILLS[pre].name).join(", ")}`;
  return null;
}

function SkillCell({
  p,
  def,
  hotbar,
  hovered,
  onHover,
  onSpend,
  onAssign,
}: {
  p: Player;
  def: SkillDef;
  hotbar: Hotbar;
  hovered: boolean;
  onHover: (id: SkillId | null) => void;
  onSpend: (skill: SkillId) => void;
  onAssign: (slot: number, skill: SkillId) => void;
}) {
  const rank = p.skills[def.id];
  const lock = lockReason(p, def);
  const canSpend = canSpendOn(p, def.id);
  const slot = hotbar.indexOf(def.id);
  const edge = rank > 0 ? "#5a5468" : "#2c2833";
  const chained = def.prereqs.length > 0;
  const chainLit = chained && def.prereqs.every((pre) => p.skills[pre] > 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch" }}>
      {/* The prerequisite chain: a short bar from the cell above, gold once it's satisfied. */}
      <div
        style={{
          alignSelf: "center",
          width: 2,
          height: 8,
          background: chained ? (chainLit ? "#c9a84c" : "#3a3442") : "transparent",
        }}
      />
      <div
        onMouseEnter={() => onHover(def.id)}
        onMouseLeave={() => onHover(null)}
        style={{
          padding: "6px 8px",
          // Longhands, not the `border` shorthand: React warns when a
          // shorthand and its longhand (the gold left edge) both change.
          borderStyle: "solid",
          borderWidth: canSpend ? "1px 1px 1px 3px" : 1,
          borderColor: canSpend ? `${edge} ${edge} ${edge} #c9a84c` : edge,
          borderRadius: 3,
          opacity: lock ? 0.45 : 1,
          background: rank > 0 ? "rgba(48,42,60,.5)" : hovered ? "rgba(38,34,46,.4)" : "transparent",
          minHeight: 58,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span style={{ color: rank > 0 ? "#e8dcc0" : "#948c7d", whiteSpace: "nowrap" }}>{def.name}</span>
            {def.kind === "passive" && <span style={{ color: "#6b6455", fontSize: 9.5 }}>passive</span>}
            {rank >= MAX_RANK && <span style={{ color: "#c9a84c", fontSize: 10 }}>maxed</span>}
          </span>
          <span style={{ display: "flex", gap: 3, alignItems: "center", flexShrink: 0 }}>
            {def.kind === "active" &&
              HOTBAR_KEYS.map((key, i) => (
                <span
                  key={key}
                  onClick={() => rank > 0 && onAssign(i, def.id)}
                  title={rank > 0 ? `cast with ${key}` : "learn the skill first"}
                  style={{
                    width: 14,
                    height: 15,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 9.5,
                    border: `1px solid ${slot === i ? "#c9a84c" : "#2c2833"}`,
                    borderRadius: 2,
                    color: slot === i ? "#c9a84c" : "#6b6455",
                    background: slot === i ? "rgba(201,168,76,.15)" : "transparent",
                    cursor: rank > 0 ? "pointer" : "default",
                  }}
                >
                  {key}
                </span>
              ))}
            {canSpend && (
              <span
                role="button"
                onClick={() => onSpend(def.id)}
                title={`spend a point: ${def.name} rank ${rank + 1}`}
                style={{ ...spendButtonStyle, marginLeft: 4 }}
              >
                +
              </span>
            )}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
          <RankPips rank={rank} />
          {def.kind === "active" && <span style={{ color: "#6b6455", fontSize: 10 }}>{def.manaCost} mana</span>}
          {lock && <span style={{ color: lock === "coming" ? "#55503f" : "#8a6a3a", fontSize: 10 }}>{lock}</span>}
        </div>
        <div style={{ color: "#8f8778", marginTop: 3, lineHeight: 1.35 }}>{def.describe(rank)}</div>
        {hovered && rank > 0 && rank < MAX_RANK && (
          <div style={{ color: "#55503f", marginTop: 2, lineHeight: 1.35 }}>next: {def.describe(rank + 1)}</div>
        )}
        {(hovered || rank > 0) &&
          def.synergies.map((s) => (
            <div key={s.from} style={{ color: "#8a6a3a", marginTop: 2, fontSize: 10.5 }}>
              {s.text}
            </div>
          ))}
      </div>
    </div>
  );
}

export function SkillPanel({
  game,
  hotbar,
  onSpend,
  onAssign,
  onClose,
}: {
  game: GameState;
  hotbar: Hotbar;
  onSpend: (skill: SkillId) => void;
  onAssign: (slot: number, skill: SkillId) => void;
  onClose: () => void;
}) {
  const p = localPlayer(game);
  const [hovered, setHovered] = useState<SkillId | null>(null);
  const trees = CLASS_TREES(p.klass);
  return (
    <div style={panelStyle}>
      <style>{PULSE_KEYFRAMES}</style>
      <PanelChrome title={`skills — level ${p.level}`} onClose={onClose} />
      {p.skillPoints > 0 ? (
        <div style={bannerStyle}>
          <span style={{ ...spendButtonStyle, animation: "none", width: 20, height: 20, fontSize: 14, cursor: "default" }}>
            +
          </span>
          <span>
            <b style={{ color: "#f0c96a" }}>
              {p.skillPoints} skill point{p.skillPoints === 1 ? "" : "s"}
            </b>{" "}
            — click <b style={{ color: "#f0c96a" }}>+</b> on a skill to learn it
          </span>
        </div>
      ) : (
        <div style={{ color: "#55503f", margin: "4px 0 8px" }}>no points to spend · gain a level to earn one</div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        {trees.map((tree) => (
          <div key={tree.id}>
            <div style={{ color: "#e8dcc0", fontSize: 13, letterSpacing: 1 }}>{tree.name}</div>
            <div style={{ color: "#6b6455", fontSize: 10, marginBottom: 2, minHeight: 26, lineHeight: 1.3 }}>
              {tree.blurb}
            </div>
            {TREE_SKILLS(tree.id).map((def) => (
              <SkillCell
                key={def.id}
                p={p}
                def={def}
                hotbar={hotbar}
                hovered={hovered === def.id}
                onHover={setHovered}
                onSpend={onSpend}
                onAssign={onAssign}
              />
            ))}
          </div>
        ))}
      </div>
      <div style={{ color: "#55503f", marginTop: 8 }}>
        s or esc to close · q w e r to cast · click a key to bind a learned skill · unlearn everything at Sera's
      </div>
    </div>
  );
}
