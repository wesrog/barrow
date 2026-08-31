import { localPlayer } from "../local";
import { useState } from "react";
import type { CSSProperties } from "react";
import { BASES } from "../../sim/items/bases";
import { itemValue } from "../../sim/systems/town";
import { repairAllCost } from "../../sim/systems/inventory";
import type { GameState } from "../../sim/state";
import type { Item } from "../../sim/items/generate";
import { itemDetail, RARITY_CSS } from "./InventoryPanel";
import { PanelChrome } from "./PanelChrome";
import { coarsePointer } from "../coarse";

const panelStyle: CSSProperties = {
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: 460,
  // Phones: shrink to the viewport and scroll rather than clip.
  maxWidth: "calc(100vw - 44px)",
  maxHeight: "calc(100% - 32px)",
  overflowY: "auto",
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
  padding: coarsePointer ? "8px 8px" : "4px 6px",
  borderRadius: 3,
  cursor: "pointer",
};

/** Mods and stats for the tapped row — touch's answer to the hover tooltip. */
function RowDetail({ item }: { item: Item }) {
  return (
    <div style={{ padding: "2px 8px 6px", lineHeight: 1.4 }}>
      {itemDetail(item).lines.map((line, i) => (
        <div key={i} style={{ color: "#948c7d" }}>
          {line}
        </div>
      ))}
    </div>
  );
}

export function ShopPanel({
  game,
  onBuy,
  onSell,
  onRepair,
  onClose,
}: {
  game: GameState;
  onBuy: (index: number) => void;
  onSell: (entryId: number) => void;
  onRepair: () => void;
  onClose: () => void;
}) {
  const p = localPlayer(game);
  const repairCost = repairAllCost(game, p);
  // Touch: first tap inspects a row (mods shown inline), second tap buys/sells.
  const [selected, setSelected] = useState<
    { kind: "ware"; i: number } | { kind: "pack"; id: number } | null
  >(null);

  return (
    <div style={panelStyle}>
      <PanelChrome
        title={`maren the smith — your gold: ${p.gold}`}
        color="#c9a84c"
        onClose={onClose}
      />

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {/* Wares */}
        <div style={{ flex: "1 1 190px", minWidth: 0 }}>
          <div style={{ color: "#8f8778", marginBottom: 4 }}>
            {coarsePointer ? "wares (tap twice to buy)" : "wares (click to buy)"}
          </div>
          {game.shop.length === 0 && <div style={{ color: "#55503f" }}>sold out</div>}
          {game.shop.map((entry, i) => {
            const affordable = p.gold >= entry.price;
            const isSelected = selected?.kind === "ware" && selected.i === i;
            return (
              <div key={i} style={{ background: "rgba(38,34,46,.5)", borderRadius: 3, marginBottom: 3 }}>
                <div
                  onClick={() => {
                    if (!coarsePointer) {
                      if (affordable) onBuy(i);
                      return;
                    }
                    if (isSelected) {
                      if (affordable) onBuy(i);
                      setSelected(null);
                    } else {
                      setSelected({ kind: "ware", i });
                    }
                  }}
                  style={{ ...rowStyle, opacity: affordable ? 1 : 0.45 }}
                  title={entry.item.mods.map((m) => `${m.stat} +${m.value}`).join(", ") || undefined}
                >
                  <span style={{ color: RARITY_CSS[entry.item.rarity] }}>{entry.item.name}</span>
                  <span style={{ color: "#c9a84c" }}>{entry.price}g</span>
                </div>
                {isSelected && <RowDetail item={entry.item} />}
              </div>
            );
          })}
        </div>

        {/* Your pack */}
        <div style={{ flex: "1 1 190px", minWidth: 0 }}>
          <div style={{ color: "#8f8778", marginBottom: 4 }}>
            {coarsePointer ? "your pack (tap twice to sell)" : "your pack (click to sell)"}
          </div>
          {p.inventory.entries.length === 0 && <div style={{ color: "#55503f" }}>empty</div>}
          {p.inventory.entries.map((e) => {
            const isSelected = selected?.kind === "pack" && selected.id === e.id;
            return (
              <div key={e.id} style={{ background: "rgba(30,28,36,.5)", borderRadius: 3, marginBottom: 3 }}>
                <div
                  onClick={() => {
                    if (!coarsePointer) {
                      onSell(e.id);
                      return;
                    }
                    if (isSelected) {
                      onSell(e.id);
                      setSelected(null);
                    } else {
                      setSelected({ kind: "pack", id: e.id });
                    }
                  }}
                  style={rowStyle}
                >
                  <span style={{ color: RARITY_CSS[e.item.rarity] }}>
                    {BASES[e.item.baseId]!.name}
                  </span>
                  <span style={{ color: "#8f8778" }}>
                    +{Math.max(1, Math.floor(itemValue(e.item) / 4))}g
                  </span>
                </div>
                {isSelected && <RowDetail item={e.item} />}
              </div>
            );
          })}
        </div>
      </div>

      <div
        onClick={() => repairCost > 0 && p.gold >= repairCost && onRepair()}
        style={{
          marginTop: 12,
          padding: coarsePointer ? "10px 8px" : "6px 8px",
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
        {coarsePointer
          ? "step on the blue ring to return below"
          : "v or esc to close · step on the blue ring to return below"}
      </div>
    </div>
  );
}
