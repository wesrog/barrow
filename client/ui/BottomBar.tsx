import { localPlayer } from "../local";
import type { CSSProperties } from "react";
import { BELT_SIZE, xpForLevel } from "../../sim/character";
import { CLASS_SKILLS, SKILLS, type SkillId } from "../../sim/skills";
import { zoneDepth, zoneOf, type GameState } from "../../sim/state";
import { isAreaId } from "../../sim/areas";
import { zoneTitle } from "../../sim/zone";
import { inCamp } from "../../sim/map";

const mono = "ui-monospace, monospace";

function Globe({
  value,
  max,
  color,
  dark,
  label,
}: {
  value: number;
  max: number;
  color: string;
  dark: string;
  label: string;
}) {
  const pct = Math.max(0, Math.min(1, value / max));
  return (
    <div
      title={`${label} ${Math.floor(value)}/${max}`}
      style={{
        width: 86,
        height: 86,
        borderRadius: "50%",
        border: "3px solid #3a3442",
        background: dark,
        position: "relative",
        overflow: "hidden",
        boxShadow: "inset 0 6px 18px rgba(0,0,0,.7), 0 4px 16px rgba(0,0,0,.6)",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: `${pct * 100}%`,
          background: `linear-gradient(to top, ${color}, ${color}cc)`,
          transition: "height .18s ease-out",
        }}
      />
      {/* liquid shine */}
      <div
        style={{
          position: "absolute",
          top: 8,
          left: 16,
          width: 26,
          height: 14,
          borderRadius: "50%",
          background: "rgba(255,255,255,.14)",
          transform: "rotate(-25deg)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: mono,
          fontSize: 12,
          color: "#f0e9dc",
          textShadow: "0 1px 3px #000",
        }}
      >
        {Math.floor(value)}
      </div>
    </div>
  );
}

const SKILL_SHORT: Record<SkillId, string> = {
  cleave: "clv",
  crush: "crs",
  warcry: "cry",
  leap: "leap",
  firebolt: "bolt",
  frostnova: "nova",
  focus: "foc",
  blink: "blnk",
};

export type HudAction = "inventory" | "skills" | "drink" | "portal" | "vendor";

const ACTION_BUTTONS: { action: HudAction; key: string; label: string; townOnly?: boolean }[] = [
  { action: "drink", key: "q", label: "drink" },
  { action: "inventory", key: "i", label: "inv" },
  { action: "skills", key: "s", label: "skills" },
  { action: "portal", key: "t", label: "portal" },
  { action: "vendor", key: "v", label: "trade", townOnly: true },
];

const barStyle: CSSProperties = {
  position: "absolute",
  bottom: 10,
  left: "50%",
  transform: "translateX(-50%)",
  display: "flex",
  alignItems: "flex-end",
  gap: 14,
  zIndex: 4,
  pointerEvents: "none",
  fontFamily: mono,
};

export function BottomBar({
  game,
  onAction,
}: {
  game: GameState;
  onAction: (action: HudAction) => void;
}) {
  const p = localPlayer(game);
  const xpFloor = xpForLevel(p.level);
  const xpNext = xpForLevel(p.level + 1);
  const xpPct = Math.max(0, Math.min(1, (p.xp - xpFloor) / (xpNext - xpFloor)));

  return (
    <div style={barStyle}>
      <Globe value={p.life} max={p.maxLife} color="#a32222" dark="#2a0d0d" label="life" />

      <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "center" }}>
        {/* Skill hotbar */}
        <div style={{ display: "flex", gap: 5 }}>
          {CLASS_SKILLS(p.klass).map((def, i) => {
            const id = def.id;
            const key = String(i + 1);
            const short = SKILL_SHORT[id];
            const rank = p.skills[id];
            const usable = rank > 0 && p.mana >= SKILLS[id].manaCost;
            return (
              <div
                key={id}
                title={`${SKILLS[id].name} — rank ${rank}`}
                style={{
                  width: 46,
                  height: 40,
                  border: `1px solid ${rank > 0 ? "#5a5468" : "#2c2833"}`,
                  borderRadius: 4,
                  background: "rgba(12,11,15,.88)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  color: usable ? "#e8dcc0" : rank > 0 ? "#5a6f9a" : "#494339",
                  fontSize: 10.5,
                  lineHeight: 1.25,
                }}
              >
                <span style={{ color: "#6b6455" }}>{key}</span>
                <span>{short}</span>
              </div>
            );
          })}
        </div>

        {/* Belt + action buttons */}
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 4 }}>
            {Array.from({ length: BELT_SIZE }, (_, i) => (
              <div
                key={i}
                style={{
                  width: 24,
                  height: 28,
                  border: "1px solid #3a3442",
                  borderRadius: "3px 3px 6px 6px",
                  background:
                    i < p.belt
                      ? "linear-gradient(to top, #a32222 75%, #4a1010 75%)"
                      : "rgba(12,11,15,.8)",
                  boxShadow: i < p.belt ? "0 0 6px rgba(163,34,34,.5)" : "none",
                }}
              />
            ))}
          </div>
          <div style={{ display: "flex", gap: 4, pointerEvents: "auto" }}>
            {ACTION_BUTTONS.filter(
              (b) =>
                !b.townOnly ||
                (localPlayer(game).zoneId === "overworld" &&
                  inCamp(zoneOf(game, localPlayer(game)).map, localPlayer(game).pos)),
            ).map(
              ({ action, key, label }) => (
                <button
                  key={action}
                  onClick={() => onAction(action)}
                  title={`${label} (${key})`}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    padding: "2px 6px",
                    border: "1px solid #3a3442",
                    borderRadius: 4,
                    background: "rgba(12,11,15,.88)",
                    color: "#8f8778",
                    fontFamily: mono,
                    fontSize: 9.5,
                    lineHeight: 1.3,
                    cursor: "pointer",
                  }}
                >
                  <span style={{ color: "#c9a84c" }}>{key}</span>
                  <span>{label}</span>
                </button>
              ),
            )}
          </div>
        </div>

        {/* XP bar */}
        <div
          title={`level ${p.level} — ${p.xp - xpFloor}/${xpNext - xpFloor} xp`}
          style={{
            width: 220,
            height: 5,
            border: "1px solid #3a3442",
            borderRadius: 3,
            background: "#141218",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${xpPct * 100}%`,
              height: "100%",
              background: "linear-gradient(to right, #7a6a34, #c9a84c)",
              transition: "width .3s ease-out",
            }}
          />
        </div>
        <div style={{ color: "#8f8778", fontSize: 11, textShadow: "0 1px 3px #000" }}>
          lvl {p.level} ·{" "}
          {isAreaId(localPlayer(game).zoneId)
            ? inCamp(zoneOf(game, localPlayer(game)).map, localPlayer(game).pos)
              ? "safe ground"
              : zoneTitle(localPlayer(game).zoneId).toLowerCase()
            : `depth ${zoneDepth(localPlayer(game).zoneId)}`}{" "}
          ·{" "}
          <span style={{ color: "#c9a84c" }}>{p.gold}g</span>
          {p.skillPoints > 0 ? ` · ${p.skillPoints} skill pt (s)` : ""}
        </div>
      </div>

      <Globe value={p.mana} max={p.maxMana} color="#22409a" dark="#0d1230" label="mana" />
    </div>
  );
}
