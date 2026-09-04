import { localPlayer } from "../local";
import type { CSSProperties } from "react";
import { CLASS_SKILLS, MAX_RANK, SKILLS, type SkillId } from "../../sim/skills";
import type { GameState } from "../../sim/state";
import { HOTBAR_KEYS, type Hotbar } from "../hotbar";
import { PanelChrome } from "./PanelChrome";

const DESCRIPTIONS: Record<SkillId, string> = {
  cleave: "sweep every enemy in reach · +25%/rank · +10% per warcry rank",
  crush: "guaranteed heavy blow · 200% +50%/rank",
  charge: "rush a distant enemy and ram it · 130% +30%/rank · brief stun · never misses",
  warcry: "battle shout, +damage for 20s · also empowers cleave",
  leap: "jump to a spot, crushing and stunning enemies where you land · longer jumps per rank",
  stomp: "slam the ground: damage and stun everything around you · +5% dmg and longer stun per leap rank",
  deathblow: "one executioner's strike · 300% +75%/rank · +15% per crush rank · never misses",
  firebolt: "hurl fire at a distant enemy · never misses · +10% per focus rank",
  frostnova: "icy burst around you, chilling everything it touches",
  focus: "gather your will, +spell damage for 20s · also empowers firebolt",
  blink: "step through shadow to a spot you can see",
  fireball: "a blast at the aimed spot, burning all it engulfs · +8% per firebolt rank",
  chainbolt: "lightning leaps through the three nearest enemies in sight · +8% per fireball rank",
};

const panelStyle: CSSProperties = {
  position: "absolute",
  top: 16,
  left: 16,
  width: 370,
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
  width: 26,
  height: 26,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 18,
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
  const roster = CLASS_SKILLS(p.klass);
  // The tree reads in tiers: one row of the panel per unlock level.
  const tiers = [...new Set(roster.map((d) => d.levelReq))].sort((a, b) => a - b);
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
      {tiers.map((tier) => (
        <div key={tier} style={{ marginBottom: 6 }}>
          <div style={{ color: "#55503f", fontSize: 10, letterSpacing: 2, margin: "2px 0" }}>
            — level {tier} —
          </div>
          {roster
            .filter((def) => def.levelReq === tier)
            .map((def) => {
              const rank = p.skills[def.id];
              const levelLocked = p.level < def.levelReq;
              const prereqLocked = def.prereq !== undefined && p.skills[def.prereq] <= 0;
              const canSpend = !levelLocked && !prereqLocked && p.skillPoints > 0 && rank < MAX_RANK;
              const slot = hotbar.indexOf(def.id);
              const edge = rank > 0 ? "#5a5468" : "#2c2833";
              return (
                <div
                  key={def.id}
                  style={{
                    padding: "6px 8px",
                    marginBottom: 4,
                    // Longhands, not the `border` shorthand: React warns when a
                    // shorthand and its longhand (the gold left edge) both change.
                    borderStyle: "solid",
                    borderWidth: canSpend ? "1px 1px 1px 3px" : 1,
                    borderColor: canSpend ? `${edge} ${edge} ${edge} #c9a84c` : edge,
                    borderRadius: 3,
                    opacity: levelLocked || prereqLocked ? 0.45 : 1,
                    background: rank > 0 ? "rgba(48,42,60,.5)" : "transparent",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: rank > 0 ? "#e8dcc0" : "#948c7d" }}>{def.name}</span>
                      {levelLocked ? (
                        <span style={{ color: "#8f8778", fontSize: 10 }}>unlocks at level {def.levelReq}</span>
                      ) : (
                        <RankPips rank={rank} />
                      )}
                      {rank >= MAX_RANK && <span style={{ color: "#c9a84c", fontSize: 10 }}>maxed</span>}
                    </span>
                    <span style={{ display: "flex", gap: 3, alignItems: "center" }}>
                      <span style={{ color: "#8f8778", marginRight: 4 }}>{def.manaCost} mana</span>
                      {/* Cast-key assignment: click a key to bind this skill there */}
                      {HOTBAR_KEYS.map((key, i) => (
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
                          style={{ ...spendButtonStyle, marginLeft: 6 }}
                        >
                          +
                        </span>
                      )}
                    </span>
                  </div>
                  <div style={{ color: "#6b6455", marginTop: 2 }}>{DESCRIPTIONS[def.id]}</div>
                  {prereqLocked && !levelLocked && (
                    <div style={{ color: "#8a6a3a", marginTop: 2 }}>
                      needs a point in {SKILLS[def.prereq!].name}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      ))}
      <div style={{ color: "#55503f", marginTop: 6 }}>
        s or esc to close · q w e r to cast · click a key to bind a learned skill to it
      </div>
    </div>
  );
}
