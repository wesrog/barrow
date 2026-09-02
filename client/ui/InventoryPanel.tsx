import { localPlayer } from "../local";
import { useState } from "react";
import type { CSSProperties } from "react";
import { INV_H, INV_W, computeStats, type EquipSlot } from "../../sim/character";
import { BASES, potionKind } from "../../sim/items/bases";
import type { Item } from "../../sim/items/generate";
import { ItemHoverDetail, RARITY_CSS } from "./ItemHoverDetail";
import { itemValue } from "../../sim/systems/town";
import type { GameState } from "../../sim/state";
import type { GameAssets } from "../render/models";
import { CharacterView } from "./CharacterView";
import { ItemIcon } from "./ItemIcon";
import { PanelChrome } from "./PanelChrome";

const CELL = 32;

export { RARITY_CSS } from "./ItemHoverDetail";

// Potion icons tint by what they restore, not rarity.
const POTION_CSS: Record<"health" | "mana", string> = {
  health: "#d05c5c",
  mana: "#6b8fe8",
};

/** Icon tint: potions by kind, everything else by rarity. */
function iconColor(item: Item): string {
  const kind = potionKind(item.baseId);
  return kind ? POTION_CSS[kind] : RARITY_CSS[item.rarity]!;
}

const EQUIP_SLOTS: { slot: EquipSlot; label: string }[] = [
  { slot: "weapon", label: "weapon" },
  { slot: "shield", label: "shield" },
  { slot: "helm", label: "helm" },
  { slot: "chest", label: "chest" },
  { slot: "boots", label: "boots" },
  { slot: "amulet", label: "amulet" },
  { slot: "ring1", label: "ring" },
  { slot: "ring2", label: "ring" },
];

const panelStyle: CSSProperties = {
  position: "absolute",
  top: 16,
  right: 16,
  width: INV_W * CELL + 26,
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

export function InventoryPanel({
  game,
  assets,
  onEquip,
  onUnequip,
  onDrop,
  onClose,
  sellMode = false,
  onSell,
  stashMode = false,
  onStash,
}: {
  game: GameState;
  assets: GameAssets | null;
  onEquip: (entryId: number) => void;
  onUnequip: (slot: EquipSlot) => void;
  onDrop: (entryId: number) => void;
  onClose: () => void;
  /** While the vendor is open, grid clicks sell instead of equipping. */
  sellMode?: boolean;
  onSell?: (entryId: number) => void;
  /** While the stash is open, grid clicks stow instead of equipping. */
  stashMode?: boolean;
  onStash?: (entryId: number) => void;
}) {
  const [hovered, setHovered] = useState<{ item: Item; fromGrid: boolean } | null>(null);
  const p = localPlayer(game);

  return (
    <div style={panelStyle}>
      <PanelChrome title="inventory" onClose={onClose} />

      {/* Character */}
      {assets && (
        <CharacterView assets={assets} equipment={p.equipment} width={INV_W * CELL} />
      )}

      {/* Identity */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <span style={{ color: "#e8dcc0", fontSize: 13 }}>{p.name}</span>
        <span style={{ color: "#6b6455" }}>
          {p.klass} · lvl {p.level}
        </span>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 10px", marginBottom: 10 }}>
        {(
          [
            ["damage", `${p.dmgMin}–${p.dmgMax}`],
            ["attack rating", `${p.attackRating}`],
            ["defense", `${p.defense}`],
            ["magic find", `${p.magicFind}%`],
            ["run speed", `+${computeStats(p.equipment, p.level, p.klass).moveSpeedPct}%`],
            ["life", `${Math.ceil(p.life)}/${p.maxLife}`],
            ["mana", `${Math.floor(p.mana)}/${p.maxMana}`],
          ] as const
        ).map(([label, value]) => (
          <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span style={{ color: "#6b6455" }}>{label}</span>
            <span style={{ color: "#c9c2b8" }}>{value}</span>
          </div>
        ))}
      </div>

      {/* Equipment */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 10px", marginBottom: 10 }}>
        {EQUIP_SLOTS.map(({ slot, label }) => {
          const item = p.equipment[slot];
          return (
            <div
              key={slot}
              onClick={() => item && onUnequip(slot)}
              onMouseEnter={() => item && setHovered({ item, fromGrid: false })}
              onMouseLeave={() => setHovered(null)}
              style={{
                cursor: item ? "pointer" : "default",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
              title={item ? "click to unequip" : undefined}
            >
              <span style={{ color: "#6b6455" }}>{label} </span>
              {item && <ItemIcon baseId={item.baseId} color={iconColor(item)} size={14} />}
              <span
                style={{
                  color: item ? RARITY_CSS[item.rarity] : "#494339",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {item ? item.name : "—"}
              </span>
            </div>
          );
        })}
      </div>

      {/* Grid */}
      <div
        style={{
          position: "relative",
          width: INV_W * CELL,
          height: INV_H * CELL,
          background:
            "repeating-linear-gradient(0deg, #201d26 0 1px, transparent 1px 32px)," +
            "repeating-linear-gradient(90deg, #201d26 0 1px, transparent 1px 32px)," +
            "#16141a",
          border: "1px solid #2c2833",
        }}
      >
        {p.inventory.entries.map((e) => {
          const base = BASES[e.item.baseId]!;
          const color = RARITY_CSS[e.item.rarity]!;
          const classLocked = base.classReq !== undefined && base.classReq !== p.klass;
          const locked = base.levelReq > p.level || classLocked;
          const sellPrice = Math.max(1, Math.floor(itemValue(e.item) / 4));
          return (
            <div
              key={e.id}
              onClick={() => {
                if (sellMode && onSell) {
                  setHovered(null);
                  onSell(e.id);
                } else if (stashMode && onStash) {
                  setHovered(null);
                  onStash(e.id);
                } else {
                  onEquip(e.id);
                }
              }}
              onContextMenu={(ev) => {
                ev.preventDefault();
                setHovered(null);
                onDrop(e.id);
              }}
              onMouseEnter={() => setHovered({ item: e.item, fromGrid: true })}
              onMouseLeave={() => setHovered(null)}
              title={
                sellMode
                  ? `click to sell — ${sellPrice}g`
                  : stashMode
                    ? "click to stow in the stash"
                    : classLocked
                    ? `${base.classReq} only · right-click to drop`
                    : locked
                      ? `requires level ${base.levelReq} · right-click to drop`
                      : "click to equip · right-click to drop"
              }
              style={{
                position: "absolute",
                left: e.x * CELL + 1,
                top: e.y * CELL + 1,
                width: base.w * CELL - 3,
                height: base.h * CELL - 3,
                background: locked ? "rgba(46,26,28,.9)" : "rgba(38,34,46,.9)",
                border: `1px solid ${locked ? "#8a4640" : color}`,
                borderRadius: 2,
                cursor: sellMode || stashMode || !locked ? "pointer" : "not-allowed",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: locked ? 0.55 : 1,
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

      {/* Hover detail */}
      <div style={{ minHeight: 64, marginTop: 8, lineHeight: 1.45 }}>
        {hovered ? (
          <ItemHoverDetail
            item={hovered.item}
            equipment={p.equipment}
            level={p.level}
            klass={p.klass}
            compare={hovered.fromGrid}
          />
        ) : (
          <div style={{ color: "#55503f" }}>
            {sellMode
              ? "vendor open — click pack items to sell"
              : stashMode
                ? "stash open — click pack items to stow"
                : "click to equip / unequip · right-click to drop · i or esc to close"}
          </div>
        )}
      </div>
    </div>
  );
}
