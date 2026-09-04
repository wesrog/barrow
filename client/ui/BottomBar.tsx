import { localPlayer } from "../local";
import type { CSSProperties } from "react";
import { BELT_CAPACITY, BELT_SIZE, xpForLevel } from "../../sim/character";
import { SKILLS, type SkillId } from "../../sim/skills";
import { zoneFloor, type GameState } from "../../sim/state";
import { locationTitle, inRect, worldCampRect } from "../../sim/surface";
import { HOTBAR_KEYS, type Hotbar } from "../hotbar";

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

export const SKILL_SHORT: Record<SkillId, string> = {
  cleave: "clv",
  crush: "crs",
  charge: "chg",
  warcry: "cry",
  leap: "leap",
  stomp: "stmp",
  deathblow: "dblw",
  firebolt: "bolt",
  frostnova: "nova",
  focus: "foc",
  blink: "blnk",
  fireball: "fbal",
  chainbolt: "chn",
};

export type HudAction =
  | "inventory"
  | "skills"
  | "drinkHealth"
  | "drinkMana"
  | "portal"
  | "vendor"
  | "stash";

const ACTION_BUTTONS: { action: HudAction; key: string; label: string; townOnly?: boolean }[] = [
  { action: "inventory", key: "i", label: "inv" },
  { action: "skills", key: "s", label: "skills" },
  { action: "portal", key: "t", label: "portal" },
  { action: "vendor", key: "v", label: "trade", townOnly: true },
  { action: "stash", key: "b", label: "stash", townOnly: true },
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

const BELT_LOOK = {
  health: {
    full: "linear-gradient(to top, #a32222 70%, #4a1010 70%)",
    glow: "rgba(163,34,34,.5)",
    key: "1",
    action: "drinkHealth" as const,
    name: "healing",
  },
  mana: {
    full: "linear-gradient(to top, #22409a 70%, #101c4a 70%)",
    glow: "rgba(34,64,154,.55)",
    key: "2",
    action: "drinkMana" as const,
    name: "mana",
  },
} as const;

/** The belt: one pool of BELT_CAPACITY slots drawn as rows of BELT_SIZE, healing potions
 * first, then mana. Click a potion to drink it; the 1/2 keys beside it drink by kind. */
function Belt({
  belt,
  manaBelt,
  onAction,
}: {
  belt: number;
  manaBelt: number;
  onAction: (action: HudAction) => void;
}) {
  const slots: ("health" | "mana" | null)[] = Array.from({ length: BELT_CAPACITY }, (_, i) =>
    i < belt ? "health" : i < belt + manaBelt ? "mana" : null,
  );
  const rows = Array.from({ length: BELT_CAPACITY / BELT_SIZE }, (_, r) =>
    slots.slice(r * BELT_SIZE, (r + 1) * BELT_SIZE),
  );
  return (
    <div
      title={`belt ${belt + manaBelt}/${BELT_CAPACITY} — 1 drinks healing (${belt}), 2 drinks mana (${manaBelt})`}
      style={{ display: "flex", gap: 4, alignItems: "center", pointerEvents: "auto" }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {(["health", "mana"] as const).map((kind) => (
          <span
            key={kind}
            onClick={() => onAction(BELT_LOOK[kind].action)}
            title={`press ${BELT_LOOK[kind].key} — drink a ${BELT_LOOK[kind].name} potion`}
            style={{
              color: kind === "health" ? "#b04a4a" : "#4a62b0",
              fontSize: 10,
              width: 8,
              height: 13,
              lineHeight: "13px",
              cursor: "pointer",
            }}
          >
            {BELT_LOOK[kind].key}
          </span>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {rows.map((row, r) => (
          <div key={r} style={{ display: "flex", gap: 4 }}>
            {row.map((kind, i) => (
              <div
                key={i}
                onClick={() => kind && onAction(BELT_LOOK[kind].action)}
                style={{
                  width: 24,
                  height: 13,
                  border: "1px solid #3a3442",
                  borderRadius: "3px 3px 5px 5px",
                  background: kind ? BELT_LOOK[kind].full : "rgba(12,11,15,.8)",
                  boxShadow: kind ? `0 0 6px ${BELT_LOOK[kind].glow}` : "none",
                  cursor: kind ? "pointer" : "default",
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function BottomBar({
  game,
  hotbar,
  onAction,
}: {
  game: GameState;
  hotbar: Hotbar;
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
        {/* Skill hotbar — assignments live in the skill panel */}
        <div style={{ display: "flex", gap: 5 }}>
          {HOTBAR_KEYS.map((key, i) => {
            const id = hotbar[i] ?? null;
            const rank = id ? p.skills[id] : 0;
            const usable = id !== null && rank > 0 && p.mana >= SKILLS[id].manaCost;
            return (
              <div
                key={key}
                title={id ? `${SKILLS[id].name} — rank ${rank}` : "assign a skill in the skill panel (s)"}
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
                <span>{id ? SKILL_SHORT[id] : "·"}</span>
              </div>
            );
          })}
        </div>

        {/* Belt + action buttons */}
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Belt belt={p.belt} manaBelt={p.manaBelt} onAction={onAction} />
          <div style={{ display: "flex", gap: 4, pointerEvents: "auto" }}>
            {ACTION_BUTTONS.filter(
              (b) =>
                !b.townOnly ||
                (localPlayer(game).zoneId === "surface" &&
                  inRect(worldCampRect("overworld"), localPlayer(game).pos)),
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
          {localPlayer(game).zoneId === "surface"
            ? inRect(worldCampRect("overworld"), localPlayer(game).pos)
              ? "safe ground"
              : locationTitle("surface", localPlayer(game).pos).toLowerCase()
            : `floor ${zoneFloor(localPlayer(game).zoneId)}`}{" "}
          ·{" "}
          <span style={{ color: "#c9a84c" }}>{p.gold}g</span>
          {p.skillPoints > 0 ? ` · ${p.skillPoints} skill pt (s)` : ""}
        </div>
      </div>

      <Globe value={p.mana} max={p.maxMana} color="#22409a" dark="#0d1230" label="mana" />
    </div>
  );
}
