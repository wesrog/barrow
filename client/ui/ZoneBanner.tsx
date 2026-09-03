import { localPlayer } from "../local";
import { display } from "./fonts";
import { zoneFloor, type GameState } from "../../sim/state";
import { locationTitle, inRect, worldCampRect } from "../../sim/surface";
import { CAMP_TITLE } from "../../sim/zone";

/** Top-center banner: where you are, and how deep. */
export function ZoneBanner({ game }: { game: GameState }) {
  const p = localPlayer(game);
  const zoneId = p.zoneId;
  const floor = zoneFloor(zoneId);
  const underground = zoneId !== "surface";
  const onCampGround = zoneId === "surface" && inRect(worldCampRect("overworld"), p.pos);
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
      <div style={{ fontFamily: display, fontSize: 19 }}>
        {onCampGround ? CAMP_TITLE : locationTitle(zoneId, p.pos)}
      </div>
      {underground && (
        <div style={{ fontSize: 11, color: "#7fb8c9", marginTop: 2, letterSpacing: 2 }}>
          floor {floor}
        </div>
      )}
    </div>
  );
}
