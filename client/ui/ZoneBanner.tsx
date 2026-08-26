import type { GameState } from "../../sim/state";
import { zoneName } from "../../sim/zone";

/** Top-center banner: where you are, and how deep. */
export function ZoneBanner({ game }: { game: GameState }) {
  const inTown = game.town !== null;
  return (
    <div
      style={{
        position: "absolute",
        top: 10,
        left: "50%",
        transform: "translateX(-50%)",
        textAlign: "center",
        fontFamily: "ui-monospace, monospace",
        color: "#c9bfa8",
        textShadow: "0 1px 3px #000",
        letterSpacing: 3,
        pointerEvents: "none",
        userSelect: "none",
      }}
    >
      <div style={{ fontSize: 15 }}>{inTown ? "The Camp" : zoneName(game.depth)}</div>
      {!inTown && (
        <div style={{ fontSize: 11, color: "#7fb8c9", marginTop: 2, letterSpacing: 2 }}>
          depth {game.depth}
        </div>
      )}
    </div>
  );
}
