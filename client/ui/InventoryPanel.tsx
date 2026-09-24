import { localPlayer } from "../local";
import { useState } from "react";
import type { CSSProperties } from "react";
import { INV_H, INV_W, computeStats, isTwoHanded, type EquipSlot } from "../../sim/character";
import { BASES } from "../../sim/items/bases";
import type { Item } from "../../sim/items/generate";
import { ItemHoverDetail, RARITY_CSS, secondRingChoice } from "./ItemHoverDetail";
import { itemValue } from "../../sim/systems/town";
import type { GameState } from "../../sim/state";
import type { GameAssets } from "../render/models";
import { CharacterView } from "./CharacterView";
import { CELL, ItemSlot, slotStyle } from "./ItemSlot";
import { PanelChrome } from "./PanelChrome";
import { SortButton } from "./SortButton";

export { RARITY_CSS } from "./ItemHoverDetail";

/** Equipped gear shows in a small framed slot beside its name. */
const EQUIP_SLOT_PX = 40;

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
  onSort,
  onClose,
  sellMode = false,
  onSell,
  stashMode = false,
  onStash,
}: {
  game: GameState;
  assets: GameAssets | null;
  /** `into` names the second ring slot on a shift-click; otherwise the sim picks. */
  onEquip: (entryId: number, into?: EquipSlot) => void;
  onUnequip: (slot: EquipSlot) => void;
  onDrop: (entryId: number) => void;
  /** Tidy the pack: big gear first, grouped by slot, best rarity leading. */
  onSort: () => void;
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
        <CharacterView assets={assets} equipment={p.equipment} klass={p.klass} width={INV_W * CELL} height={250} />
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
            ["attack speed", `+${computeStats(p.equipment, p.level, p.klass, p.skills).attackSpeedPct}%`],
            ["run speed", `+${computeStats(p.equipment, p.level, p.klass, p.skills).moveSpeedPct}%`],
            ["life regen", `+${p.lifeRegen}/s`],
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

      {/* Equipment: a framed slot per piece, its name and slot beside it */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px", marginBottom: 10 }}>
        {EQUIP_SLOTS.map(({ slot, label }) => {
          const item = p.equipment[slot];
          return (
            <div
              key={slot}
              onClick={() => item && onUnequip(slot)}
              onMouseEnter={() => item && setHovered({ item, fromGrid: false })}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: item ? "pointer" : "default", display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}
              title={item ? "click to unequip" : undefined}
            >
              {item ? (
                <ItemSlot item={item} width={EQUIP_SLOT_PX} height={EQUIP_SLOT_PX} style={{ flex: "none" }} />
              ) : (
                <div style={{ ...slotStyle(EQUIP_SLOT_PX, EQUIP_SLOT_PX, "#3a3442", false), flex: "none", opacity: 0.45 }} />
              )}
              <div style={{ minWidth: 0, lineHeight: 1.3 }}>
                <div style={{ color: "#6b6455", fontSize: 11 }}>{label}</div>
                <div
                  style={{
                    color: item ? RARITY_CSS[item.rarity] : "#494339",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {item ? item.name : "—"}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Grid header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 4,
        }}
      >
        <span style={{ color: "#6b6455" }}>
          pack · {p.inventory.entries.length} item{p.inventory.entries.length === 1 ? "" : "s"}
        </span>
        <SortButton onSort={onSort} hint="tidy the pack: big gear first, grouped by slot" />
      </div>

      {/* Grid */}
      <div
        style={{
          position: "relative",
          width: INV_W * CELL,
          height: INV_H * CELL,
          background:
            `repeating-linear-gradient(0deg, #201d26 0 1px, transparent 1px ${CELL}px),` +
            `repeating-linear-gradient(90deg, #201d26 0 1px, transparent 1px ${CELL}px),` +
            "#16141a",
          border: "1px solid #2c2833",
        }}
      >
        {p.inventory.entries.map((e) => {
          const base = BASES[e.item.baseId]!;
          const classLocked = base.classReq !== undefined && base.classReq !== p.klass;
          const handsFull =
            base.slot === "shield" && p.equipment.weapon !== null && isTwoHanded(p.equipment.weapon);
          const locked = base.levelReq > p.level || classLocked || handsFull;
          const sellPrice = Math.max(1, Math.floor(itemValue(e.item) / 4));
          const ringChoice = secondRingChoice(e.item, p.equipment);
          return (
            <ItemSlot
              key={e.id}
              item={e.item}
              width={base.w * CELL - 2}
              height={base.h * CELL - 2}
              locked={locked}
              onClick={(ev) => {
                if (sellMode && onSell) {
                  setHovered(null);
                  onSell(e.id);
                } else if (stashMode && onStash) {
                  setHovered(null);
                  onStash(e.id);
                } else {
                  onEquip(e.id, ev.shiftKey && ringChoice ? "ring2" : undefined);
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
                    : handsFull
                      ? "both hands are full · right-click to drop"
                    : locked
                      ? `requires level ${base.levelReq} · right-click to drop`
                      : ringChoice
                        ? "click to swap first ring · shift-click for second · right-click to drop"
                        : "click to equip · right-click to drop"
              }
              style={{
                position: "absolute",
                left: e.x * CELL + 1,
                top: e.y * CELL + 1,
                cursor: sellMode || stashMode || !locked ? "pointer" : "not-allowed",
              }}
            />
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
