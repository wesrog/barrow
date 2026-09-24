import type { CSSProperties } from "react";
import { itemIcon } from "./itemIcons";

/**
 * An item's icon in a box of `size` by `height` (square when `height` is
 * omitted). Silhouettes (the SVGs, the packs' white icons) render as a CSS
 * mask filled with the rarity colour. The packs' coloured renders draw as
 * images with the rarity as a soft glow; a render that has a side view uses
 * it in tall boxes, turned upright, so a sword fills a 1x3 slot instead of
 * lying diagonally across a corner of it.
 */
export function ItemIcon({
  baseId,
  color,
  size,
  height = size,
  style,
}: {
  baseId: string;
  color: string;
  size: number;
  height?: number;
  style?: CSSProperties;
}) {
  const icon = itemIcon(baseId);
  const width = size;
  if (icon.kind === "image") {
    const tall = height > width * 1.3 && icon.side !== undefined;
    const wide = width > height * 1.3 && icon.side !== undefined;
    const glow = `drop-shadow(0 0 ${Math.max(1, Math.min(width, height) / 12)}px ${color})`;
    if (tall || wide) {
      // Side views are square PNGs with the weapon lying across the middle, so
      // the image is sized by the box's long side and the box clips the
      // transparent margins; in a tall box a quarter turn stands it up.
      const long = Math.max(width, height);
      return (
        <div style={{ width, height, flexShrink: 0, display: "grid", placeItems: "center", overflow: "hidden", ...style }}>
          <img
            src={icon.side}
            alt=""
            draggable={false}
            style={{
              width: long,
              height: long,
              flexShrink: 0,
              objectFit: "contain",
              transform: tall ? "rotate(-90deg)" : undefined,
              filter: glow,
              pointerEvents: "none",
            }}
          />
        </div>
      );
    }
    return (
      <img
        src={icon.url}
        alt=""
        draggable={false}
        style={{ width, height, flexShrink: 0, objectFit: "contain", filter: glow, ...style }}
      />
    );
  }
  const mask = `url(${icon.url})`;
  return (
    <div
      style={{
        width,
        height,
        flexShrink: 0,
        backgroundColor: color,
        WebkitMaskImage: mask,
        maskImage: mask,
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        ...style,
      }}
    />
  );
}
