import type { CSSProperties } from "react";
import { itemIcon } from "./itemIcons";

/**
 * An item's icon at a given size. Silhouettes (the SVGs, the packs' white
 * icons) render as a CSS mask filled with the rarity colour; the packs'
 * coloured renders draw as images and carry the rarity as a soft glow.
 */
export function ItemIcon({
  baseId,
  color,
  size,
  style,
}: {
  baseId: string;
  color: string;
  size: number;
  style?: CSSProperties;
}) {
  const icon = itemIcon(baseId);
  if (icon.kind === "image") {
    return (
      <img
        src={icon.url}
        alt=""
        draggable={false}
        style={{
          width: size,
          height: size,
          flexShrink: 0,
          objectFit: "contain",
          filter: `drop-shadow(0 0 ${Math.max(1, size / 12)}px ${color})`,
          ...style,
        }}
      />
    );
  }
  const mask = `url(${icon.url})`;
  return (
    <div
      style={{
        width: size,
        height: size,
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
