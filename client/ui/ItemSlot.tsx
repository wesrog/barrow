import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import type { Item } from "../../sim/items/generate";
import { potionKind } from "../../sim/items/bases";
import { RARITY_CSS } from "./ItemHoverDetail";
import { ItemIcon } from "./ItemIcon";

/**
 * One inventory slot: a plain slate box with a thin gold edge, the rarity as
 * a faint inner glow and the item's icon centred in it. Every grid in the HUD
 * builds its cells from this so items look the same everywhere. Items come
 * in two footprints (1x1 for potions, rings, amulets and quest items, 2x2
 * for gear), so icons show at exactly two sizes.
 */

/** Pixels per inventory cell: small items are one cell, gear four. */
export const CELL = 56;

// Potion icons tint by what they restore, not rarity.
const POTION_CSS: Record<"health" | "mana", string> = {
  health: "#d05c5c",
  mana: "#6b8fe8",
};

/** Icon tint: potions by kind, everything else by rarity. */
export function iconColor(item: Item): string {
  const kind = potionKind(item.baseId);
  return kind ? POTION_CSS[kind] : RARITY_CSS[item.rarity]!;
}

// The slot edge: the HUD's gold, kept faint so it frames without competing with rarity colour.
const SLOT_EDGE = "rgba(201,168,76,.32)";
const SLOT_EDGE_LOCKED = "rgba(138,70,64,.5)";

/** The slot's box: a slate fill with a thin gold edge and the rarity as a faint inner glow.
 * Plain items get no glow at all, so the grid reads as slate with colour only where it means something. */
export function slotStyle(width: number, height: number, color: string, locked: boolean, plain = false): CSSProperties {
  const glow = locked ? "#8a4640" : plain ? "transparent" : color;
  return {
    width,
    height,
    boxSizing: "border-box",
    border: `1px solid ${locked ? SLOT_EDGE_LOCKED : SLOT_EDGE}`,
    borderRadius: 3,
    background: locked
      ? "radial-gradient(ellipse at 50% 40%, #3a2426 0%, #221518 100%)"
      : "radial-gradient(ellipse at 50% 40%, #2a2f38 0%, #1b1f26 100%)",
    boxShadow: glow === "transparent" ? "none" : `inset 0 0 ${Math.round(Math.min(width, height) / 3)}px ${glow}2a`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

export function ItemSlot({
  item,
  width,
  height,
  locked = false,
  style,
  children,
  ...rest
}: {
  item: Item;
  width: number;
  height: number;
  locked?: boolean;
  style?: CSSProperties;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "style" | "children">) {
  const color = RARITY_CSS[item.rarity]!;
  const pad = Math.max(3, Math.round(Math.min(width, height) / 12));
  return (
    <div {...rest} style={{ ...slotStyle(width, height, color, locked, item.rarity === "normal"), opacity: locked ? 0.6 : 1, ...style }}>
      <ItemIcon baseId={item.baseId} color={iconColor(item)} size={width - pad * 2 - 2} height={height - pad * 2 - 2} />
      {children}
    </div>
  );
}
