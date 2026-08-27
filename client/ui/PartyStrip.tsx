import { localId } from "../local";
import { playerCss } from "../render/tints";
import type { GameState } from "../../sim/state";
import { zoneTitle } from "../../sim/zone";

const mono = "ui-monospace, monospace";

/** Top-left column: one row per other player in the session — tint, seat
 * label, life bar, and where they are (greyed when it's not our zone). */
export function PartyStrip({ game }: { game: GameState }) {
  const me = localId();
  const localZone = game.players.get(me)?.zoneId;
  const others = [...game.players.values()]
    .filter((p) => p.id !== me)
    .sort((a, b) => a.id - b.id);

  if (others.length === 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 14,
        left: 14,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        zIndex: 4,
        pointerEvents: "none",
        fontFamily: mono,
      }}
    >
      {others.map((p) => {
        const sameZone = p.zoneId === localZone;
        const pct = Math.max(0, Math.min(1, p.life / Math.max(1, p.maxLife)));
        return (
          <div
            key={p.id}
            style={{ display: "flex", alignItems: "center", gap: 7, opacity: sameZone ? 1 : 0.5 }}
          >
            <div
              style={{
                width: 11,
                height: 11,
                borderRadius: "50%",
                background: playerCss(p.id),
                border: "1px solid rgba(0,0,0,.5)",
                boxShadow: "0 0 4px rgba(0,0,0,.6)",
                flexShrink: 0,
              }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <div style={{ fontSize: 11, color: sameZone ? "#e8dcc0" : "#8f8778" }}>
                {`P${p.id + 1}`}{" "}
                <span style={{ color: sameZone ? "#7fb8c9" : "#5f6a6d" }}>
                  {zoneTitle(p.zoneId)}
                </span>
              </div>
              <div
                style={{
                  width: 96,
                  height: 5,
                  border: "1px solid #3a3442",
                  borderRadius: 3,
                  background: "#141218",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${pct * 100}%`,
                    height: "100%",
                    background: "linear-gradient(to right, #6a1f1f, #a32222)",
                  }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
