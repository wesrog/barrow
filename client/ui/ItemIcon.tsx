import type { CSSProperties } from "react";

/**
 * Monochrome game-icons.net SVG rendered as a CSS mask so it can be tinted
 * by rarity color. One icon per base id lives in public/icons/items/.
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
  const mask = `url(${import.meta.env.BASE_URL.replace(/\/$/, "")}/icons/items/${baseId}.svg)`;
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
