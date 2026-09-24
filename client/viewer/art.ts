/**
 * The 2D art the icon script copied (scripts/ui-icons.ts): sets of pieces
 * from the manifest it writes. Pure data helpers for the viewer's art tab.
 */

export interface ArtSet {
  id: string;
  label: string;
  dir: string;
  /** Icons are white silhouettes to mask and tint; sprites are drawn as they are. */
  kind: "icon" | "sprite";
  count: number;
}

export interface ArtPiece {
  set: string;
  name: string;
  w: number;
  h: number;
  /** Variant -> path under /icons/synty/. Icons carry Clean/Stroke/Underlay; sprites one "" entry. */
  files: Record<string, string>;
}

export interface ArtManifest {
  version: number;
  sets: ArtSet[];
  pieces: ArtPiece[];
}

export const VARIANTS = ["Clean", "Stroke", "Underlay"] as const;
export type Variant = (typeof VARIANTS)[number];

/** Colours the HUD tints icons with, plus plain white to see the art itself. */
export const TINTS: { name: string; css: string }[] = [
  { name: "white", css: "#f2ede2" },
  { name: "bone", css: "#d9b85c" },
  { name: "normal", css: "#d6d6d6" },
  { name: "magic", css: "#8ba3f5" },
  { name: "rare", css: "#f0e68c" },
  { name: "unique", css: "#d9a05c" },
  { name: "health", css: "#e06060" },
  { name: "mana", css: "#5a8ae0" },
];

export async function loadArtManifest(base: string): Promise<ArtManifest | null> {
  try {
    const res = await fetch(`${base}/icons/synty/manifest.json`);
    if (!res.ok) return null;
    const json = (await res.json()) as ArtManifest;
    return json.version === 2 ? json : null;
  } catch {
    return null;
  }
}

export function filterPieces(pieces: readonly ArtPiece[], query: string, sets: ReadonlySet<string>): ArtPiece[] {
  const q = query.trim().toLowerCase();
  return pieces.filter((p) => sets.has(p.set) && (q === "" || p.name.toLowerCase().includes(q) || p.set.includes(q)));
}

/** The file to show for a piece: the asked variant, else the cleanest one it has. */
export function pieceFile(piece: ArtPiece, variant: Variant): string | null {
  const own = piece.files[variant];
  if (own) return own;
  for (const v of ["Clean", "Underlay", "Stroke", ""]) {
    const f = piece.files[v];
    if (f) return f;
  }
  const first = Object.values(piece.files)[0];
  return first ?? null;
}

export function prettyName(name: string): string {
  return name.replace(/_/g, " ");
}

/** Pieces per set among a filtered list, for the sidebar counts. */
export function setCounts(pieces: readonly ArtPiece[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of pieces) counts.set(p.set, (counts.get(p.set) ?? 0) + 1);
  return counts;
}
