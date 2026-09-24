import type { CSSProperties } from "react";
import { itemIconUrl } from "./itemIcons";

/**
 * Monochrome silhouette rendered as a CSS mask so it can be tinted by rarity
 * color: the Fantasy Screens icon when the pack was copied, else the
 * game-icons.net SVG (one per base id in public/icons/items/).
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
  const mask = `url(${itemIconUrl(baseId)})`;
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
