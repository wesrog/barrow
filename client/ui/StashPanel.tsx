import { localPlayer } from "../local";
import { useState } from "react";
import type { CSSProperties } from "react";
import { STASH_H, STASH_W } from "../../sim/character";
import { BASES, potionKind } from "../../sim/items/bases";
import type { Item } from "../../sim/items/generate";
import type { GameState } from "../../sim/state";
import { ItemHoverDetail, RARITY_CSS } from "./ItemHoverDetail";
import { ItemIcon } from "./ItemIcon";
import { PanelChrome } from "./PanelChrome";

const CELL = 32;

// Potion icons tint by what they restore, not rarity (mirrors InventoryPanel).
const POTION_CSS: Record<"health" | "mana", string> = {
  health: "#d05c5c",
  mana: "#6b8fe8",
};

function iconColor(item: Item): string {
  const kind = potionKind(item.baseId);
  return kind ? POTION_CSS[kind] : RARITY_CSS[item.rarity]!;
}

const panelStyle: CSSProperties = {
  position: "absolute",
  top: 16,
  left: 16,
  width: STASH_W * CELL + 26,
  background: "rgba(12, 11, 15, 0.93)",
  border: "1px solid #3a3442",
  borderRadius: 4,
  padding: 12,
  fontFamily: "ui-monospace, monospace",
  fontSize: 12,
  color: "#c9c2b8",
  zIndex: 5,
  pointerEvents: "auto",
  boxShadow: "0 8px 30px rgba(0,0,0,.6)",
};

export function StashPanel({
  game,
  onTake,
  onClose,
}: {
  game: GameState;
  onTake: (entryId: number) => void;
  onClose: () => void;
}) {
  const [hovered, setHovered] = useState<Item | null>(null);
  const p = localPlayer(game);

  return (
    <div style={panelStyle}>
      <PanelChrome title="stash" color="#c9a84c" onClose={onClose} />

      <div
        style={{
          position: "relative",
          width: STASH_W * CELL,
          height: STASH_H * CELL,
          background:
            "repeating-linear-gradient(0deg, #201d26 0 1px, transparent 1px 32px)," +
            "repeating-linear-gradient(90deg, #201d26 0 1px, transparent 1px 32px)," +
            "#16141a",
          border: "1px solid #2c2833",
        }}
      >
        {p.stash.entries.map((e) => {
          const base = BASES[e.item.baseId]!;
          const color = RARITY_CSS[e.item.rarity]!;
          return (
            <div
              key={e.id}
              onClick={() => {
                setHovered(null);
                onTake(e.id);
              }}
              onMouseEnter={() => setHovered(e.item)}
              onMouseLeave={() => setHovered(null)}
              title="click to take back"
              style={{
                position: "absolute",
                left: e.x * CELL + 1,
                top: e.y * CELL + 1,
                width: base.w * CELL - 3,
                height: base.h * CELL - 3,
                background: "rgba(38,34,46,.9)",
                border: `1px solid ${color}`,
                borderRadius: 2,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ItemIcon
                baseId={e.item.baseId}
                color={iconColor(e.item)}
                size={Math.min(base.w, base.h) * CELL - 8}
              />
            </div>
          );
        })}
      </div>

      <div style={{ minHeight: 64, marginTop: 8, lineHeight: 1.45 }}>
        {hovered ? (
          <ItemHoverDetail
            item={hovered}
            equipment={p.equipment}
            level={p.level}
            klass={p.klass}
            compare
          />
        ) : (
          <div style={{ color: "#55503f" }}>
            click pack items to stow · click stash items to take back · b or esc to close
          </div>
        )}
      </div>
    </div>
  );
}
