import { localPlayer } from "../local";
import { useState } from "react";
import type { CSSProperties } from "react";
import type { Item } from "../../sim/items/generate";
import { repairAllCost } from "../../sim/systems/inventory";
import type { GameState } from "../../sim/state";
import { RARITY_CSS } from "./InventoryPanel";
import { ItemHoverDetail, ItemTooltip } from "./ItemHoverDetail";
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
  padding: "4px 6px",
  borderRadius: 3,
  cursor: "pointer",
};

export function ShopPanel({
  game,
  onBuy,
  onRepair,
  onClose,
}: {
  game: GameState;
  onBuy: (index: number) => void;
  onRepair: () => void;
  onClose: () => void;
}) {
  const p = localPlayer(game);
  const repairCost = repairAllCost(game, p);
  const [hovered, setHovered] = useState<{ item: Item; x: number; y: number } | null>(null);

  return (
    <div style={panelStyle}>
      <PanelChrome
        title={`maren the smith — your gold: ${p.gold}`}
        color="#c9a84c"
        onClose={onClose}
      />

      {/* Wares */}
      <div>
        <div style={{ color: "#8f8778", marginBottom: 4 }}>wares (click to buy)</div>
        {game.shop.length === 0 && <div style={{ color: "#55503f" }}>sold out</div>}
        {game.shop.map((entry, i) => {
          const affordable = p.gold >= entry.price;
          return (
            <div
              key={i}
              onClick={() => {
                if (!affordable) return;
                setHovered(null);
                onBuy(i);
              }}
              onMouseEnter={(ev) => setHovered({ item: entry.item, x: ev.clientX, y: ev.clientY })}
              onMouseMove={(ev) => setHovered({ item: entry.item, x: ev.clientX, y: ev.clientY })}
              onMouseLeave={() => setHovered(null)}
              style={{
                ...rowStyle,
                opacity: affordable ? 1 : 0.45,
                background: "rgba(38,34,46,.5)",
                marginBottom: 3,
              }}
            >
              <span style={{ color: RARITY_CSS[entry.item.rarity] }}>{entry.item.name}</span>
              <span style={{ color: "#c9a84c" }}>{entry.price}g</span>
            </div>
          );
        })}
      </div>

      {hovered && (
        <ItemTooltip x={hovered.x} y={hovered.y}>
          <ItemHoverDetail
            item={hovered.item}
            equipment={p.equipment}
            level={p.level}
            klass={p.klass}
            compare
          />
        </ItemTooltip>
      )}

      <div
        onClick={() => repairCost > 0 && p.gold >= repairCost && onRepair()}
        style={{
          marginTop: 12,
          padding: "6px 8px",
          border: "1px solid #5a5468",
          borderRadius: 3,
          textAlign: "center",
          cursor: repairCost > 0 && p.gold >= repairCost ? "pointer" : "default",
          opacity: repairCost === 0 ? 0.4 : p.gold >= repairCost ? 1 : 0.5,
          background: "rgba(48,42,60,.5)",
        }}
      >
        {repairCost === 0 ? "gear is in good shape" : `repair all — ${repairCost}g`}
      </div>
      <div style={{ color: "#55503f", marginTop: 8, textAlign: "center" }}>
        click your pack items to sell · v or esc to close · sister vess sells potions
      </div>
    </div>
  );
}
