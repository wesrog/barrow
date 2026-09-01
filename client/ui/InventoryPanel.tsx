import { localPlayer } from "../local";
import { useState } from "react";
import type { CSSProperties } from "react";
import { INV_H, INV_W, computeStats, slotForItem, type EquipSlot } from "../../sim/character";
import { BASES, potionKind } from "../../sim/items/bases";
import type { Item, ItemMod } from "../../sim/items/generate";
import { equipDelta, type StatDelta } from "./itemCompare";
import type { GameState } from "../../sim/state";
import type { GameAssets } from "../render/models";
import { CharacterView } from "./CharacterView";
import { ItemIcon } from "./ItemIcon";
import { PanelChrome } from "./PanelChrome";

const CELL = 32;

export const RARITY_CSS: Record<string, string> = {
  normal: "#d6d6d6",
  magic: "#8ba3f5",
  rare: "#f0e68c",
  unique: "#d9a05c",
};

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

function itemDetail(item: Item, playerLevel: number): {
  lines: { text: string; color?: string }[];
  color: string;
} {
  const base = BASES[item.baseId]!;
  const lines: { text: string; color?: string }[] = [];
  if (base.dmgMin !== undefined) lines.push({ text: `damage ${base.dmgMin}–${base.dmgMax}` });
  if (base.defense !== undefined) lines.push({ text: `defense ${base.defense}` });
  if (base.levelReq > 1) {
    const unmet = base.levelReq > playerLevel;
    lines.push({
      text: `requires level ${base.levelReq}${unmet ? " — cannot equip yet" : ""}`,
      color: unmet ? "#d6675c" : undefined,
    });
  }
  for (const mod of item.mods) lines.push({ text: MOD_LABELS[mod.stat](mod.value) });
  if (item.durability) {
    lines.push({
      text:
        item.durability.cur === 0
          ? "BROKEN — repair at the vendor"
          : `durability ${item.durability.cur}/${item.durability.max}`,
    });
  }
  return { lines, color: RARITY_CSS[item.rarity]! };
}

const DELTA_LABELS: [keyof StatDelta, string][] = [
  ["defense", "defense"],
  ["attackRating", "attack rating"],
  ["maxLife", "life"],
  ["maxMana", "mana"],
  ["magicFind", "% magic find"],
];

/** Nonzero character-stat changes if `item` were equipped, as signed colored lines. */
function deltaLines(delta: StatDelta): { text: string; color: string }[] {
  const signed = (v: number) => (v > 0 ? `+${v}` : `${v}`);
  const color = (v: number) => (v > 0 ? "#7fc978" : "#d6675c");
  const out: { text: string; color: string }[] = [];
  if (delta.dmgMin !== 0 || delta.dmgMax !== 0) {
    out.push({
      text: `${signed(delta.dmgMin)} min / ${signed(delta.dmgMax)} max damage`,
      color: color(delta.dmgMax !== 0 ? delta.dmgMax : delta.dmgMin),
    });
  }
  for (const [stat, label] of DELTA_LABELS) {
    if (delta[stat] !== 0) out.push({ text: `${signed(delta[stat])} ${label}`, color: color(delta[stat]) });
  }
  return out;
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
  const [hovered, setHovered] = useState<{ item: Item; fromGrid: boolean } | null>(null);
  const p = localPlayer(game);

  return (
    <div style={panelStyle}>
      <PanelChrome title="inventory" onClose={onClose} />

      {/* Character */}
      {assets && (
        <CharacterView assets={assets} equipment={p.equipment} width={INV_W * CELL} />
      )}

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
          const locked = base.levelReq > p.level;
          return (
            <div
              key={e.id}
              onClick={() => onEquip(e.id)}
              onContextMenu={(ev) => {
                ev.preventDefault();
                setHovered(null);
                onDrop(e.id);
              }}
              onMouseEnter={() => setHovered({ item: e.item, fromGrid: true })}
              onMouseLeave={() => setHovered(null)}
              title={
                locked
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
                cursor: locked ? "not-allowed" : "pointer",
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
          (() => {
            const detail = itemDetail(hovered.item, p.level);
            const base = BASES[hovered.item.baseId]!;
            const comparable = hovered.fromGrid && base.slot !== "potion";
            const replaces = comparable
              ? p.equipment[slotForItem(hovered.item, p.equipment)]
              : null;
            const deltas = comparable
              ? deltaLines(equipDelta(p.equipment, hovered.item, p.level, p.klass))
              : [];
            return (
              <>
                <div style={{ color: detail.color }}>{hovered.item.name}</div>
                {detail.lines.map((line, i) => (
                  <div key={i} style={{ color: line.color ?? "#948c7d" }}>
                    {line.text}
                  </div>
                ))}
                {comparable && (
                  <div style={{ marginTop: 4, paddingTop: 4, borderTop: "1px solid #2c2833" }}>
                    <span style={{ color: "#6b6455" }}>
                      {replaces ? "replaces " : "fills empty slot"}
                    </span>
                    {replaces && (
                      <span style={{ color: RARITY_CSS[replaces.rarity] }}>{replaces.name}</span>
                    )}
                    {deltas.length === 0 ? (
                      <div style={{ color: "#6b6455" }}>no stat change</div>
                    ) : (
                      deltas.map((line, i) => (
                        <div key={i} style={{ color: line.color }}>
                          {line.text}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </>
            );
          })()
        ) : (
          <div style={{ color: "#55503f" }}>
            click to equip / unequip · right-click to drop · i or esc to close
          </div>
        )}
      </div>
    </div>
  );
}
