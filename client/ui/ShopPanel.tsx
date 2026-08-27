import { localPlayer } from "../local";
import type { CSSProperties } from "react";
import { BASES } from "../../sim/items/bases";
import { itemValue } from "../../sim/systems/town";
import { repairAllCost } from "../../sim/systems/inventory";
import type { GameState } from "../../sim/state";
import { RARITY_CSS } from "./InventoryPanel";

const panelStyle: CSSProperties = {
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: 460,
  background: "rgba(12, 11, 15, 0.95)",
  border: "1px solid #3a3442",
  borderRadius: 4,
  padding: 14,
  fontFamily: "ui-monospace, monospace",
  fontSize: 12,
  color: "#c9c2b8",
  zIndex: 6,
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
  onSell,
  onRepair,
}: {
  game: GameState;
  onBuy: (index: number) => void;
  onSell: (entryId: number) => void;
  onRepair: () => void;
}) {
  const p = localPlayer(game);
  const repairCost = repairAllCost(game, p);

  return (
    <div style={panelStyle}>
      <div style={{ color: "#c9a84c", marginBottom: 10, letterSpacing: 1 }}>
        maren the smith — your gold: {p.gold}
      </div>

      <div style={{ display: "flex", gap: 16 }}>
        {/* Wares */}
        <div style={{ flex: 1 }}>
          <div style={{ color: "#8f8778", marginBottom: 4 }}>wares (click to buy)</div>
          {game.shop.length === 0 && <div style={{ color: "#55503f" }}>sold out</div>}
          {game.shop.map((entry, i) => {
            const affordable = p.gold >= entry.price;
            return (
              <div
                key={i}
                onClick={() => affordable && onBuy(i)}
                style={{
                  ...rowStyle,
                  opacity: affordable ? 1 : 0.45,
                  background: "rgba(38,34,46,.5)",
                  marginBottom: 3,
                }}
                title={entry.item.mods.map((m) => `${m.stat} +${m.value}`).join(", ") || undefined}
              >
                <span style={{ color: RARITY_CSS[entry.item.rarity] }}>{entry.item.name}</span>
                <span style={{ color: "#c9a84c" }}>{entry.price}g</span>
              </div>
            );
          })}
        </div>

        {/* Your pack */}
        <div style={{ flex: 1 }}>
          <div style={{ color: "#8f8778", marginBottom: 4 }}>your pack (click to sell)</div>
          {p.inventory.entries.length === 0 && <div style={{ color: "#55503f" }}>empty</div>}
          {p.inventory.entries.map((e) => (
            <div
              key={e.id}
              onClick={() => onSell(e.id)}
              style={{ ...rowStyle, background: "rgba(30,28,36,.5)", marginBottom: 3 }}
            >
              <span style={{ color: RARITY_CSS[e.item.rarity] }}>
                {BASES[e.item.baseId]!.name}
              </span>
              <span style={{ color: "#8f8778" }}>
                +{Math.max(1, Math.floor(itemValue(e.item) / 4))}g
              </span>
            </div>
          ))}
        </div>
      </div>

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
        v to close · step on the blue ring to return below
      </div>
    </div>
  );
}
