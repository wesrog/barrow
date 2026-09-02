import type { CSSProperties } from "react";
import { AREAS, type AreaId } from "../../sim/areas";
import type { GameState } from "../../sim/state";
import { areaAt } from "../../sim/surface";
import { localPlayer } from "../local";
import { PanelChrome } from "./PanelChrome";

const panelStyle: CSSProperties = {
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: 300,
  background: "rgba(12, 11, 15, 0.95)",
  border: "1px solid #3a3442",
  borderRadius: 4,
  padding: 12,
  fontFamily: "ui-monospace, monospace",
  fontSize: 12,
  color: "#c9c2b8",
  zIndex: 6,
  pointerEvents: "auto",
  boxShadow: "0 8px 30px rgba(0,0,0,.7)",
};

const rowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "6px 8px",
  borderRadius: 3,
};

/** The waypoint ring's destination list: every region this hero has attuned. */
export function WaypointPanel({
  game,
  onTravel,
  onClose,
}: {
  game: GameState;
  onTravel: (area: AreaId) => void;
  onClose: () => void;
}) {
  const p = localPlayer(game);
  return (
    <div style={panelStyle}>
      <PanelChrome title="waypoint" color="#c9a84c" onClose={onClose} />
      {p.waypoints.map((id) => {
        const def = AREAS[id];
        const here = p.zoneId === "surface" && id === areaAt(p.pos);
        return (
          <div
            key={id}
            style={{
              ...rowStyle,
              cursor: here ? "default" : "pointer",
              opacity: here ? 0.45 : 1,
            }}
            onMouseEnter={(e) => {
              if (!here) e.currentTarget.style.background = "rgba(201,168,76,.12)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
            onClick={() => {
              if (!here) onTravel(id);
            }}
          >
            <span style={{ color: here ? "#c9c2b8" : "#e8dfc8" }}>{def.title}</span>
            <span style={{ color: "#8a8578", fontSize: 11 }}>
              {here ? "you are here" : `danger ${def.areaLevel}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}
