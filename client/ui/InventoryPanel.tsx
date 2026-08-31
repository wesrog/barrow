import { localPlayer } from "../local";
import { useState } from "react";
import type { CSSProperties } from "react";
import { INV_H, INV_W, type EquipSlot } from "../../sim/character";
import { BASES } from "../../sim/items/bases";
import type { Item, ItemMod } from "../../sim/items/generate";
import type { GameState } from "../../sim/state";
import type { GameAssets } from "../render/models";
import { CharacterView } from "./CharacterView";
import { ItemIcon } from "./ItemIcon";
import { PanelChrome } from "./PanelChrome";
import { coarsePointer } from "../coarse";

const CELL = 32;

export const RARITY_CSS: Record<string, string> = {
  normal: "#d6d6d6",
  magic: "#8ba3f5",
  rare: "#f0e68c",
  unique: "#d9a05c",
};

const MOD_LABELS: Record<ItemMod["stat"], (v: number) => string> = {
  dmgMin: (v) => `+${v} to minimum damage`,
  dmgMax: (v) => `+${v} to maximum damage`,
  dmgPct: (v) => `+${v}% enhanced damage`,
  attackRating: (v) => `+${v} to attack rating`,
  defense: (v) => `+${v} defense`,
  life: (v) => `+${v} to life`,
  mana: (v) => `+${v} to mana`,
  attackSpeedPct: (v) => `+${v}% attack speed`,
  moveSpeedPct: (v) => `+${v}% run speed`,
  magicFind: (v) => `+${v}% better chance of magic items`,
};

const EQUIP_SLOTS: { slot: EquipSlot; label: string }[] = [
  { slot: "weapon", label: "weapon" },
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
  // Small screens: never wider than the viewport, scroll instead of clipping.
  maxWidth: "calc(100vw - 60px)",
  maxHeight: "calc(100% - 32px)",
  overflowY: "auto",
  overflowX: "auto",
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

const touchBtnStyle: CSSProperties = {
  padding: "8px 14px",
  border: "1px solid #5a5468",
  borderRadius: 4,
  background: "rgba(48,42,60,.6)",
  color: "#e8dcc0",
  fontFamily: "ui-monospace, monospace",
  fontSize: 12,
  cursor: "pointer",
};

export function itemDetail(item: Item): { lines: string[]; color: string } {
  const base = BASES[item.baseId]!;
  const lines: string[] = [];
  if (base.dmgMin !== undefined) lines.push(`damage ${base.dmgMin}–${base.dmgMax}`);
  if (base.defense !== undefined) lines.push(`defense ${base.defense}`);
  if (base.levelReq > 1) lines.push(`requires level ${base.levelReq}`);
  for (const mod of item.mods) lines.push(MOD_LABELS[mod.stat](mod.value));
  if (item.durability) {
    lines.push(
      item.durability.cur === 0
        ? "BROKEN — repair at the vendor"
        : `durability ${item.durability.cur}/${item.durability.max}`,
    );
  }
  return { lines, color: RARITY_CSS[item.rarity]! };
}

export function InventoryPanel({
  game,
  assets,
  onEquip,
  onUnequip,
  onDrop,
  onClose,
}: {
  game: GameState;
  assets: GameAssets | null;
  onEquip: (entryId: number) => void;
  onUnequip: (slot: EquipSlot) => void;
  onDrop: (entryId: number) => void;
  onClose: () => void;
}) {
  const [hovered, setHovered] = useState<Item | null>(null);
  // Touch has no hover: the first tap selects an item (details + buttons in
  // the footer), the second tap on the same item equips/unequips it.
  const [selected, setSelected] = useState<
    { where: "inv"; entryId: number } | { where: "equip"; slot: EquipSlot } | null
  >(null);
  const p = localPlayer(game);
  const selectedItem: Item | null =
    selected?.where === "inv"
      ? (p.inventory.entries.find((e) => e.id === selected.entryId)?.item ?? null)
      : selected?.where === "equip"
        ? (p.equipment[selected.slot] ?? null)
        : null;
  const shown = coarsePointer ? selectedItem : hovered;

  return (
    <div style={panelStyle}>
      <PanelChrome
        title={`inventory — dmg ${p.dmgMin}–${p.dmgMax} · ar ${p.attackRating} · def ${p.defense} · mf ${p.magicFind}%`}
        onClose={onClose}
      />

      {/* Character */}
      {assets && (
        <CharacterView assets={assets} equipment={p.equipment} width={INV_W * CELL} />
      )}

      {/* Equipment */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 10px", marginBottom: 10 }}>
        {EQUIP_SLOTS.map(({ slot, label }) => {
          const item = p.equipment[slot];
          return (
            <div
              key={slot}
              onClick={() => {
                if (!item) return;
                if (!coarsePointer) {
                  onUnequip(slot);
                  return;
                }
                if (selected?.where === "equip" && selected.slot === slot) {
                  onUnequip(slot);
                  setSelected(null);
                } else {
                  setSelected({ where: "equip", slot });
                }
              }}
              onMouseEnter={() => item && setHovered(item)}
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
              {item && <ItemIcon baseId={item.baseId} color={RARITY_CSS[item.rarity]!} size={14} />}
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
          return (
            <div
              key={e.id}
              onClick={() => {
                if (!coarsePointer) {
                  onEquip(e.id);
                  return;
                }
                if (selected?.where === "inv" && selected.entryId === e.id) {
                  onEquip(e.id);
                  setSelected(null);
                } else {
                  setSelected({ where: "inv", entryId: e.id });
                }
              }}
              onContextMenu={(ev) => {
                ev.preventDefault();
                // Long-press on touch selects (drop lives in the footer buttons);
                // a desktop right-click still drops directly.
                if (coarsePointer) {
                  setSelected({ where: "inv", entryId: e.id });
                  return;
                }
                setHovered(null);
                onDrop(e.id);
              }}
              onMouseEnter={() => setHovered(e.item)}
              onMouseLeave={() => setHovered(null)}
              title="click to equip · right-click to drop"
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
                color={color}
                size={Math.min(base.w, base.h) * CELL - 8}
              />
            </div>
          );
        })}
      </div>

      {/* Hover (mouse) or selection (touch) detail */}
      <div style={{ minHeight: 64, marginTop: 8, lineHeight: 1.45 }}>
        {shown ? (
          <>
            <div style={{ color: itemDetail(shown).color }}>{shown.name}</div>
            {itemDetail(shown).lines.map((line, i) => (
              <div key={i} style={{ color: "#948c7d" }}>
                {line}
              </div>
            ))}
            {coarsePointer && selected && (
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                {selected.where === "inv" ? (
                  <>
                    <button
                      style={touchBtnStyle}
                      onClick={() => {
                        onEquip(selected.entryId);
                        setSelected(null);
                      }}
                    >
                      equip
                    </button>
                    <button
                      style={{ ...touchBtnStyle, color: "#e08a8a" }}
                      onClick={() => {
                        onDrop(selected.entryId);
                        setSelected(null);
                      }}
                    >
                      drop
                    </button>
                  </>
                ) : (
                  <button
                    style={touchBtnStyle}
                    onClick={() => {
                      onUnequip(selected.slot);
                      setSelected(null);
                    }}
                  >
                    unequip
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <div style={{ color: "#55503f" }}>
            {coarsePointer
              ? "tap an item to inspect · tap it again to equip"
              : "click to equip / unequip · right-click to drop · i or esc to close"}
          </div>
        )}
      </div>
    </div>
  );
}
