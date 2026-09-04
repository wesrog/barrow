import { CLASS_TREES, SKILLS, TREE_SKILLS, type Klass, type SkillId } from "../sim/skills";

/** The four cast keys, in slot order. Purely client-side — the sim only ever
 * sees the resolved skill id, so assignments never touch lockstep state. */
export const HOTBAR_KEYS = ["q", "w", "e", "r"] as const;

export const HOTBAR_SIZE = HOTBAR_KEYS.length;

export type Hotbar = (SkillId | null)[];

const storageKey = (klass: Klass) => `barrow:hotbar:${klass}`;

/** The default loadout: each tree's opener, then the first tree's second active. */
function defaultHotbar(klass: Klass): Hotbar {
  const trees = CLASS_TREES(klass).map((t) => TREE_SKILLS(t.id).filter((d) => d.kind === "active"));
  const picks = [trees[0]?.[0], trees[1]?.[0], trees[2]?.[0], trees[0]?.[1]];
  return Array.from({ length: HOTBAR_SIZE }, (_, i) => picks[i]?.id ?? null);
}

/** Back to the default loadout (after a respec) and persist it. */
export function resetHotbar(klass: Klass): Hotbar {
  const bar = defaultHotbar(klass);
  try {
    localStorage.setItem(storageKey(klass), JSON.stringify(bar));
  } catch {
    // Private-mode storage failures just lose persistence, not the session.
  }
  return bar;
}

export function loadHotbar(klass: Klass): Hotbar {
  try {
    const raw = localStorage.getItem(storageKey(klass));
    if (!raw) return defaultHotbar(klass);
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultHotbar(klass);
    return Array.from({ length: HOTBAR_SIZE }, (_, i) => {
      const id = parsed[i];
      return typeof id === "string" && id in SKILLS && SKILLS[id as SkillId].klass === klass
        ? (id as SkillId)
        : null;
    });
  } catch {
    return defaultHotbar(klass);
  }
}

/** Assign a skill to a slot (evicting it from any other slot) and persist. */
export function assignHotbar(klass: Klass, slot: number, skill: SkillId): Hotbar {
  const bar = loadHotbar(klass);
  for (let i = 0; i < bar.length; i++) {
    if (bar[i] === skill) bar[i] = null;
  }
  bar[slot] = skill;
  try {
    localStorage.setItem(storageKey(klass), JSON.stringify(bar));
  } catch {
    // Private-mode storage failures just lose persistence, not the session.
  }
  return bar;
}
