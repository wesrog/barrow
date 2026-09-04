import { CLASS_TREES, SKILLS, TREE_SKILLS, type Klass, type SkillId } from "../sim/skills";

/** The six cast slots in bar order: the right mouse button first, then five
 * keys under the left hand. Purely client-side — the sim only ever sees the
 * resolved skill id, so assignments never touch lockstep state. */
export const HOTBAR_KEYS = ["rmb", "q", "w", "e", "r", "f"] as const;
export type HotbarKey = (typeof HOTBAR_KEYS)[number];

export const HOTBAR_SIZE = HOTBAR_KEYS.length;

/** What the bar and the panel print for each slot. */
export const SLOT_LABELS: Record<HotbarKey, string> = {
  rmb: "mouse",
  q: "q",
  w: "w",
  e: "e",
  r: "r",
  f: "f",
};

/** Keyboard keys to slot index; the mouse slot is 0 and has no key. */
export function slotForKey(key: string): number {
  const i = (HOTBAR_KEYS as readonly string[]).indexOf(key);
  return i > 0 ? i : -1;
}

export type Hotbar = (SkillId | null)[];

const storageKey = (klass: Klass) => `barrow:hotbar:${klass}`;

/** The default loadout: the first tree's opener on the mouse, then each
 * tree's remaining actives dealt out across the keys. */
export function defaultHotbar(klass: Klass): Hotbar {
  const trees = CLASS_TREES(klass).map((t) => TREE_SKILLS(t.id).filter((d) => d.kind === "active"));
  const picks = [trees[0]?.[0], trees[1]?.[0], trees[2]?.[0], trees[0]?.[1], trees[1]?.[1], trees[2]?.[1]];
  return Array.from({ length: HOTBAR_SIZE }, (_, i) => picks[i]?.id ?? null);
}

/** Turn whatever storage held into a valid bar for this class. Unknown or
 * off-class ids drop out. A four-slot bar from before the mouse slot existed
 * shifts onto the keys and the mouse takes the default opener. */
export function normalizeHotbar(raw: unknown, klass: Klass): Hotbar {
  if (!Array.isArray(raw)) return defaultHotbar(klass);
  const valid = (id: unknown): SkillId | null =>
    typeof id === "string" && id in SKILLS && SKILLS[id as SkillId].klass === klass && SKILLS[id as SkillId].kind === "active"
      ? (id as SkillId)
      : null;
  const ids = raw.map(valid);
  if (raw.length === HOTBAR_SIZE) return ids;
  // Legacy four-key bar: q w e r become slots 1–4; the mouse gets the opener
  // unless it is already bound to a key.
  const bar: Hotbar = [null, ids[0] ?? null, ids[1] ?? null, ids[2] ?? null, ids[3] ?? null, null];
  const opener = defaultHotbar(klass)[0];
  if (opener && !bar.includes(opener)) bar[0] = opener;
  return bar;
}

export function loadHotbar(klass: Klass): Hotbar {
  try {
    const raw = localStorage.getItem(storageKey(klass));
    if (!raw) return defaultHotbar(klass);
    return normalizeHotbar(JSON.parse(raw), klass);
  } catch {
    return defaultHotbar(klass);
  }
}

function persist(klass: Klass, bar: Hotbar): void {
  try {
    localStorage.setItem(storageKey(klass), JSON.stringify(bar));
  } catch {
    // Private-mode storage failures just lose persistence, not the session.
  }
}

/** Assign a skill to a slot (evicting it from any other slot) and persist. */
export function assignHotbar(klass: Klass, slot: number, skill: SkillId): Hotbar {
  const bar = loadHotbar(klass);
  for (let i = 0; i < bar.length; i++) {
    if (bar[i] === skill) bar[i] = null;
  }
  bar[slot] = skill;
  persist(klass, bar);
  return bar;
}

/** Back to the default loadout (after a respec) and persist it. */
export function resetHotbar(klass: Klass): Hotbar {
  const bar = defaultHotbar(klass);
  persist(klass, bar);
  return bar;
}
