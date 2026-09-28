import { localPlayer } from "../local";
import { useState } from "react";
import type { CSSProperties } from "react";
import { STASH_H, STASH_W } from "../../sim/character";
import { BASES } from "../../sim/items/bases";
import type { Item } from "../../sim/items/generate";
import type { GameState } from "../../sim/state";
import { ItemHoverDetail } from "./ItemHoverDetail";
import { CELL, ItemSlot } from "./ItemSlot";
import { PanelChrome } from "./PanelChrome";
import { SortButton } from "./SortButton";

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
  onSort,
  onClose,
}: {
  game: GameState;
  onTake: (entryId: number) => void;
  /** Tidy the stash the same way the pack sorts. */
  onSort: () => void;
  onClose: () => void;
}) {
  const [hovered, setHovered] = useState<Item | null>(null);
  const p = localPlayer(game);

  return (
    <div style={panelStyle}>
      <PanelChrome title="stash" color="#c9a84c" onClose={onClose} />

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 4,
        }}
      >
        <span style={{ color: "#6b6455" }}>
          {p.stash.entries.length} item{p.stash.entries.length === 1 ? "" : "s"}
        </span>
        <SortButton onSort={onSort} hint="tidy the stash: big gear first, grouped by slot" />
      </div>

      <div
        style={{
          position: "relative",
          width: STASH_W * CELL,
          height: STASH_H * CELL,
          background:
            `repeating-linear-gradient(0deg, #201d26 0 1px, transparent 1px ${CELL}px),` +
            `repeating-linear-gradient(90deg, #201d26 0 1px, transparent 1px ${CELL}px),` +
            "#16141a",
          border: "1px solid #2c2833",
        }}
      >
        {p.stash.entries.map((e) => {
          const base = BASES[e.item.baseId]!;
          return (
            <ItemSlot
              key={e.id}
              item={e.item}
              width={base.w * CELL - 2}
              height={base.h * CELL - 2}
              onClick={() => {
                setHovered(null);
                onTake(e.id);
              }}
              onMouseEnter={() => setHovered(e.item)}
              onMouseLeave={() => setHovered(null)}
              title="click to take back"
              style={{ position: "absolute", left: e.x * CELL + 1, top: e.y * CELL + 1, cursor: "pointer" }}
            />
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
