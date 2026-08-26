import { useState } from "react";
import type { CSSProperties } from "react";
import { INV_H, INV_W, type EquipSlot } from "../../sim/character";
import { BASES } from "../../sim/items/bases";
import type { Item, ItemMod } from "../../sim/items/generate";
import type { GameState } from "../../sim/state";
import { ItemIcon } from "./ItemIcon";

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
  background: "rgba(12, 11, 15, 0.93)",
  border: "1px solid #3a3442",
  borderRadius: 4,
  padding: 12,
  fontFamily: "ui-monospace, monospace",
  fontSize: 12,
  color: "#c9c2b8",
  zIndex: 5,
  boxShadow: "0 8px 30px rgba(0,0,0,.6)",
};

function itemDetail(item: Item): { lines: string[]; color: string } {
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
  onEquip,
  onUnequip,
  onDrop,
}: {
  game: GameState;
  onEquip: (entryId: number) => void;
  onUnequip: (slot: EquipSlot) => void;
  onDrop: (entryId: number) => void;
}) {
  const [hovered, setHovered] = useState<Item | null>(null);
  const p = game.player;

  return (
    <div style={panelStyle}>
      <div style={{ color: "#8f8778", marginBottom: 8, letterSpacing: 1 }}>
        inventory — dmg {p.dmgMin}–{p.dmgMax} · ar {p.attackRating} · def {p.defense} · mf{" "}
        {p.magicFind}%
      </div>

      {/* Equipment */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 10px", marginBottom: 10 }}>
        {EQUIP_SLOTS.map(({ slot, label }) => {
          const item = p.equipment[slot];
          return (
            <div
              key={slot}
              onClick={() => item && onUnequip(slot)}
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
              onClick={() => onEquip(e.id)}
              onContextMenu={(ev) => {
                ev.preventDefault();
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

      {/* Hover detail */}
      <div style={{ minHeight: 64, marginTop: 8, lineHeight: 1.45 }}>
        {hovered ? (
          <>
            <div style={{ color: itemDetail(hovered).color }}>{hovered.name}</div>
            {itemDetail(hovered).lines.map((line, i) => (
              <div key={i} style={{ color: "#948c7d" }}>
                {line}
              </div>
            ))}
          </>
        ) : (
          <div style={{ color: "#55503f" }}>
            click to equip / unequip · right-click to drop · i to close
          </div>
        )}
      </div>
    </div>
  );
}
