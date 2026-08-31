import { localPlayer } from "../local";
import { display } from "./fonts";
import { zoneDepth, zoneOf, type GameState } from "../../sim/state";
import { isAreaId } from "../../sim/areas";
import { CAMP_TITLE, zoneTitle } from "../../sim/zone";
import { inCamp } from "../../sim/map";

/** Top-center banner: where you are, and how deep. */
export function ZoneBanner({ game }: { game: GameState }) {
  const p = localPlayer(game);
  const zoneId = p.zoneId;
  const depth = zoneDepth(zoneId);
  const underground = !isAreaId(zoneId);
  const onCampGround = zoneId === "overworld" && inCamp(zoneOf(game, p).map, p.pos);
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
        {onCampGround ? CAMP_TITLE : zoneTitle(zoneId)}
      </div>
      {underground && (
        <div style={{ fontSize: 11, color: "#7fb8c9", marginTop: 2, letterSpacing: 2 }}>
          depth {depth}
        </div>
      )}
    </div>
  );
}
