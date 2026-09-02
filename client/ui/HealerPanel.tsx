import { localPlayer } from "../local";
import type { CSSProperties } from "react";
import { BELT_SIZE } from "../../sim/character";
import { POTION_PRICES } from "../../sim/systems/town";
import type { GameState } from "../../sim/state";
import { PanelChrome } from "./PanelChrome";

const panelStyle: CSSProperties = {
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: 320,
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

const WARES: { kind: "health" | "mana"; name: string; note: string; color: string }[] = [
  { kind: "health", name: "Minor Healing Potion", note: "+35 life", color: "#e07070" },
  { kind: "mana", name: "Minor Mana Potion", note: "+25 mana", color: "#7fa3f5" },
];

/** Sera's stall: an endless shelf of potions at fixed prices. */
export function HealerPanel({
  game,
  onBuy,
  onClose,
}: {
  game: GameState;
  onBuy: (kind: "health" | "mana") => void;
  onClose: () => void;
}) {
  const p = localPlayer(game);
  return (
    <div style={panelStyle}>
      <PanelChrome title={`sister vess — your gold: ${p.gold}`} color="#7de08a" onClose={onClose} />
      <div style={{ color: "#8f8778", marginBottom: 6 }}>
        wounds mended, free of charge · potions for the road:
      </div>
      {WARES.map(({ kind, name, note, color }) => {
        const price = POTION_PRICES[kind];
        const carried = kind === "health" ? p.belt : p.manaBelt;
        const affordable = p.gold >= price;
        return (
          <div
            key={kind}
            onClick={() => affordable && onBuy(kind)}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "6px 8px",
              marginBottom: 4,
              borderRadius: 3,
              cursor: affordable ? "pointer" : "default",
              opacity: affordable ? 1 : 0.45,
              background: "rgba(38,34,46,.5)",
            }}
            title={affordable ? "click to buy" : "not enough gold"}
          >
            <span>
              <span style={{ color }}>{name}</span>
              <span style={{ color: "#6b6455" }}>
                {" "}
                · {note} · belt {carried}/{BELT_SIZE}
              </span>
            </span>
            <span style={{ color: "#c9a84c" }}>{price}g</span>
          </div>
        );
      })}
      <div style={{ color: "#55503f", marginTop: 8, textAlign: "center" }}>
        esc to close · 1 drinks red, 2 drinks blue
      </div>
    </div>
  );
}
