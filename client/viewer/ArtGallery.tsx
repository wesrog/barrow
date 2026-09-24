import { useMemo } from "react";
import { filterPieces, pieceFile, prettyName, type ArtManifest, type Variant } from "./art";

/**
 * The 2D art tab's grid: every copied piece as a tile, icons masked and
 * tinted the way the HUD draws them, sprites as they are. Click to select.
 */
export function ArtGallery({
  manifest,
  base,
  query,
  sets,
  tint,
  variant,
  size,
  selectedKey,
  onSelect,
}: {
  manifest: ArtManifest | null;
  base: string;
  query: string;
  sets: ReadonlySet<string>;
  tint: string;
  variant: Variant;
  size: number;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}) {
  const shown = useMemo(() => (manifest ? filterPieces(manifest.pieces, query, sets) : []), [manifest, query, sets]);
  if (!manifest) {
    return (
      <div className="art">
        <div className="art-empty">
          No 2D art copied yet. Unzip the INTERFACE Fantasy Screens source files into
          <code> assets-src/synty/fantasy_screens/</code> and run <code>bun run assets:ui</code>.
        </div>
      </div>
    );
  }
  return (
    <div className="art" onClick={(e) => e.target === e.currentTarget && onSelect(null)}>
      <div className="art-grid">
        {shown.map((p) => {
          const key = `${p.set}/${p.name}`;
          const file = pieceFile(p, variant);
          const url = `${base}/icons/packs/${file}`;
          const isIcon = p.kind === "icon";
          return (
            <button
              key={key}
              className={key === selectedKey ? "tile on" : "tile"}
              style={{ width: size + 28 }}
              title={`${p.set} · ${p.name} · ${p.w}×${p.h}`}
              onClick={() => onSelect(key)}
            >
              {isIcon ? (
                <div
                  className="mask"
                  style={{ width: size, height: size, backgroundColor: tint, WebkitMaskImage: `url(${url})`, maskImage: `url(${url})` }}
                />
              ) : (
                <img src={url} loading="lazy" alt="" style={{ width: size, height: size }} />
              )}
              <span>{prettyName(p.name)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
