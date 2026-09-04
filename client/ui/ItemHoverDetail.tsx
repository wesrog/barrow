import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { isTwoHanded, slotForItem, type Equipment } from "../../sim/character";
import { BASES, type Slot } from "../../sim/items/bases";
import type { Item, ItemMod } from "../../sim/items/generate";
import type { Klass } from "../../sim/skills";
import { equipDelta, isComparable, type StatDelta } from "./itemCompare";

export const RARITY_CSS: Record<string, string> = {
  normal: "#d6d6d6",
  magic: "#8ba3f5",
  rare: "#f0e68c",
  unique: "#d9a05c",
};

/** Human-readable category shown under the item name. */
const SLOT_LABELS: Record<Slot, string> = {
  weapon: "weapon",
  shield: "shield",
  helm: "helm",
  chest: "body armor",
  boots: "boots",
  ring: "ring",
  amulet: "amulet",
  potion: "potion",
  quest: "quest item",
};

/**
 * What kind of thing this is: the base type plus its category. Magic, rare and
 * unique names bury or replace the base name, so spell it out — "Kingsbane"
 * alone doesn't say whether it's a sword you can even hold.
 */
export function typeLine(item: Item): string {
  const base = BASES[item.baseId]!;
  const slot = SLOT_LABELS[base.slot];
  return item.name === base.name ? slot : `${base.name} — ${slot}`;
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
  lifeRegen: (v) => `replenish life +${v}`,
};

/** `equipment` lets two-handers name the shield they'd evict, and shields warn
 *  when a two-hander already fills both hands. */
export function itemDetail(
  item: Item,
  playerLevel: number,
  playerKlass?: Klass,
  equipment?: Equipment,
): {
  lines: { text: string; color?: string }[];
  color: string;
} {
  const base = BASES[item.baseId]!;
  const lines: { text: string; color?: string }[] = [];
  lines.push({ text: typeLine(item), color: "#6b6455" });
  if (base.dmgMin !== undefined) lines.push({ text: `damage ${base.dmgMin}–${base.dmgMax}` });
  if (base.defense !== undefined) lines.push({ text: `defense ${base.defense}` });
  if (base.twoHanded) {
    const shield = equipment?.shield;
    lines.push({ text: shield ? `two-handed — unequips ${shield.name}` : "two-handed" });
  }
  if (base.slot === "shield" && equipment?.weapon && isTwoHanded(equipment.weapon)) {
    lines.push({ text: "cannot hold with a two-handed weapon", color: "#d6675c" });
  }
  if (base.levelReq > 1) {
    const unmet = base.levelReq > playerLevel;
    lines.push({
      text: `requires level ${base.levelReq}${unmet ? " — cannot equip yet" : ""}`,
      color: unmet ? "#d6675c" : undefined,
    });
  }
  if (base.classReq) {
    const unmet = playerKlass !== undefined && playerKlass !== base.classReq;
    lines.push({
      text: `${base.classReq} only${unmet ? " — your class cannot equip this" : ""}`,
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
export function deltaLines(delta: StatDelta): { text: string; color: string }[] {
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

/**
 * Floating tooltip near the cursor. Fixed-position and mouse-transparent so it
 * never affects layout — hover detail inside a centered panel would otherwise
 * resize it and shift the hovered row out from under the cursor (flicker).
 */
export function ItemTooltip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  const w = 240;
  const left = x + 16 + w > window.innerWidth ? x - 16 - w : x + 16;
  // Portal to <body>: a transformed ancestor (e.g. a translate-centered panel)
  // would otherwise become the containing block for position: fixed.
  return createPortal(
    <div
      style={{
        position: "fixed",
        left,
        top: Math.min(y + 12, window.innerHeight - 180),
        width: w,
        background: "rgba(12, 11, 15, 0.96)",
        border: "1px solid #3a3442",
        borderRadius: 4,
        padding: "8px 10px",
        fontFamily: "ui-monospace, monospace",
        fontSize: 12,
        lineHeight: 1.45,
        color: "#c9c2b8",
        zIndex: 20,
        pointerEvents: "none",
        boxShadow: "0 8px 30px rgba(0,0,0,.7)",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

/** The "replaces X / +N stat" block for one candidate slot. */
function CompareBlock({
  lead,
  replaces,
  deltas,
}: {
  lead: string;
  replaces: Item | null;
  deltas: { text: string; color: string }[];
}) {
  return (
    <div style={{ marginTop: 4, paddingTop: 4, borderTop: "1px solid #2c2833" }}>
      <span style={{ color: "#6b6455" }}>{replaces ? lead : "fills empty slot"}</span>
      {replaces && <span style={{ color: RARITY_CSS[replaces.rarity] }}>{replaces.name}</span>}
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
  );
}

/** A ring hovered while both fingers are full: shift-click targets the second ring. */
export function secondRingChoice(item: Item, equipment: Equipment): boolean {
  return BASES[item.baseId]!.slot === "ring" && !!equipment.ring1 && !!equipment.ring2;
}

/** Item name, base stats, mods, and (when comparable) the equip diff vs current gear. */
export function ItemHoverDetail({
  item,
  equipment,
  level,
  klass,
  compare,
}: {
  item: Item;
  equipment: Equipment;
  level: number;
  klass: Klass;
  compare: boolean;
}) {
  const detail = itemDetail(item, level, klass, compare ? equipment : undefined);
  const comparable = compare && isComparable(item);
  const replaces = comparable ? equipment[slotForItem(item, equipment)] : null;
  const deltas = comparable ? deltaLines(equipDelta(equipment, item, level, klass)) : [];
  const secondRing = comparable && secondRingChoice(item, equipment);
  return (
    <>
      <div style={{ color: detail.color }}>{item.name}</div>
      {detail.lines.map((line, i) => (
        <div key={i} style={{ color: line.color ?? "#948c7d" }}>
          {line.text}
        </div>
      ))}
      {comparable && <CompareBlock lead="replaces " replaces={replaces} deltas={deltas} />}
      {secondRing && (
        <CompareBlock
          lead="shift-click replaces "
          replaces={equipment.ring2}
          deltas={deltaLines(equipDelta(equipment, item, level, klass, "ring2"))}
        />
      )}
    </>
  );
}
