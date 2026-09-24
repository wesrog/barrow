import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import type { Item } from "../../sim/items/generate";
import { potionKind } from "../../sim/items/bases";
import { RARITY_CSS } from "./ItemHoverDetail";
import { ItemIcon } from "./ItemIcon";
import { uiSprite } from "./itemIcons";

/**
 * One framed inventory slot, the way the Fantasy Warrior HUD lays its
 * inventories out: a slate box with the pack's thin gilt frame around it (a
 * nine-slice of Frame_Box12 when the art was copied, a plain rarity-coloured
 * border when not) and the item's render filling it. Every grid in the HUD
 * builds its cells from this so items look the same everywhere.
 */

/** Pixels per inventory cell. Renders need room: a sword in a one-cell-wide
 * slot is only as thick as the cell allows, so cells are generous. */
export const CELL = 56;

/** The frame sprite, by manifest key. */
export const SLOT_FRAME = "fw-warrior/Frame_Box12";

/** Width of the frame's edge in the 512px sprite, and on screen. */
const FRAME_SLICE = 56;
const FRAME_WIDTH = 7;

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

/** The slot's box: frame art over a slate fill, with the rarity as an inner glow. */
export function slotStyle(width: number, height: number, color: string, locked: boolean): CSSProperties {
  const frame = uiSprite(SLOT_FRAME);
  const glow = locked ? "#8a4640" : color;
  const base: CSSProperties = {
    width,
    height,
    boxSizing: "border-box",
    // Slate, lighter than the panel, so dark iron and leather read against it.
    background: locked
      ? "radial-gradient(ellipse at 50% 40%, #4a2c2e 0%, #2c1c1f 100%)"
      : "radial-gradient(ellipse at 50% 40%, #3d444e 0%, #262b33 100%)",
    boxShadow: `inset 0 0 0 1px ${glow}66, inset 0 0 ${Math.round(Math.min(width, height) / 4)}px ${glow}2e`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
  if (!frame) return { ...base, border: `1px solid ${glow}`, borderRadius: 2 };
  return {
    ...base,
    borderStyle: "solid",
    borderWidth: FRAME_WIDTH,
    borderImageSource: `url(${frame})`,
    borderImageSlice: `${FRAME_SLICE} fill`,
    borderImageWidth: FRAME_WIDTH,
    borderImageRepeat: "stretch",
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
  const pad = Math.max(2, Math.round(Math.min(width, height) / 14));
  return (
    <div {...rest} style={{ ...slotStyle(width, height, color, locked), opacity: locked ? 0.6 : 1, ...style }}>
      <ItemIcon baseId={item.baseId} color={iconColor(item)} size={width - pad * 2 - 2} height={height - pad * 2 - 2} />
      {children}
    </div>
  );
}
