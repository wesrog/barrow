import type { Rng } from "../rng";
import { AFFIXES, type Affix } from "./affixes";
import { BASES } from "./bases";
import { UNIQUES } from "./uniques";

export type Rarity = "normal" | "magic" | "rare" | "unique";

export interface ItemMod {
  stat: Affix["mods"][number]["stat"];
  value: number;
}

export interface Item {
  baseId: string;
  rarity: Rarity;
  name: string;
  affixIds: string[];
  mods: ItemMod[];
  ilvl: number;
  uniqueId?: string;
  /** Weapons and armor wear out; at 0 the item goes inert until repaired. */
  durability?: { cur: number; max: number };
}

const DURABLE_SLOTS = new Set(["weapon", "helm", "chest", "boots"]);

export function rollDurability(baseId: string): { cur: number; max: number } | undefined {
  const base = BASES[baseId];
  if (!base || !DURABLE_SLOTS.has(base.slot)) return undefined;
  const max = 24 + base.levelReq * 2;
  return { cur: max, max };
}

const RARE_NAMES_A = ["Doom", "Grim", "Ash", "Bone", "Dusk", "Raven", "Sorrow", "Storm", "Grave", "Wraith"];
const RARE_NAMES_B = ["Shroud", "Bite", "Mark", "Song", "Ward", "Husk", "Brand", "Whisper", "Coil", "Toll"];

function eligibleAffixes(kind: Affix["kind"], baseId: string, ilvl: number, usedGroups: Set<string>): Affix[] {
  const slot = BASES[baseId]!.slot;
  const out: Affix[] = [];
  for (const affix of Object.values(AFFIXES)) {
    if (affix.kind !== kind) continue;
    if (affix.alvl > ilvl) continue;
    if (usedGroups.has(affix.group)) continue;
    if (affix.slots !== "any" && !affix.slots.includes(slot)) continue;
    out.push(affix);
  }
  return out;
}

function rollMods(rng: Rng, ranges: Affix["mods"]): ItemMod[] {
  return ranges.map((r) => ({ stat: r.stat, value: rng.int(r.min, r.max) }));
}

export function rollItem(rng: Rng, baseId: string, ilvl: number, rarity: Rarity): Item {
  const base = BASES[baseId];
  if (!base) throw new Error(`unknown base: ${baseId}`);

  // Potions are consumables: always plain, whatever the rarity roll said.
  if (base.slot === "potion") {
    return { baseId, rarity: "normal", name: base.name, affixIds: [], mods: [], ilvl };
  }

  if (rarity === "unique") {
    const candidates = Object.values(UNIQUES).filter((u) => u.baseId === baseId && u.lvl <= ilvl);
    if (candidates.length === 0) return rollItem(rng, baseId, ilvl, "rare"); // D2-style fallback
    const unique = candidates[rng.int(0, candidates.length - 1)]!;
    return {
      baseId,
      rarity: "unique",
      name: unique.name,
      affixIds: [],
      mods: rollMods(rng, unique.mods),
      ilvl,
      uniqueId: unique.id,
      durability: rollDurability(baseId),
    };
  }

  if (rarity === "normal") {
    return { baseId, rarity, name: base.name, affixIds: [], mods: [], ilvl, durability: rollDurability(baseId) };
  }

  const usedGroups = new Set<string>();
  const picked: Affix[] = [];
  const pickOne = (kind: Affix["kind"]): boolean => {
    const pool = eligibleAffixes(kind, baseId, ilvl, usedGroups);
    if (pool.length === 0) return false;
    const affix = pool[rng.int(0, pool.length - 1)]!;
    usedGroups.add(affix.group);
    picked.push(affix);
    return true;
  };

  if (rarity === "magic") {
    const wantTwo = rng.next() < 0.4;
    const firstKind: Affix["kind"] = rng.next() < 0.5 ? "prefix" : "suffix";
    if (!pickOne(firstKind)) pickOne(firstKind === "prefix" ? "suffix" : "prefix");
    if (wantTwo) pickOne(firstKind === "prefix" ? "suffix" : "prefix");
  } else {
    const want = 3 + rng.int(0, 3);
    let prefixes = 0;
    let suffixes = 0;
    for (let i = 0; i < want; i++) {
      const preferPrefix =
        prefixes < 3 && (suffixes >= 3 || rng.next() < 0.5);
      const kind: Affix["kind"] = preferPrefix ? "prefix" : "suffix";
      if (pickOne(kind)) {
        if (kind === "prefix") prefixes++;
        else suffixes++;
      } else if (pickOne(kind === "prefix" ? "suffix" : "prefix")) {
        if (kind === "prefix") suffixes++;
        else prefixes++;
      }
    }
  }

  const mods = picked.flatMap((affix) => rollMods(rng, affix.mods));
  let name: string;
  if (rarity === "magic") {
    const prefix = picked.find((p) => p.kind === "prefix");
    const suffix = picked.find((p) => p.kind === "suffix");
    name = [prefix?.name, base.name, suffix?.name].filter(Boolean).join(" ");
  } else {
    name = `${RARE_NAMES_A[rng.int(0, RARE_NAMES_A.length - 1)]!} ${RARE_NAMES_B[rng.int(0, RARE_NAMES_B.length - 1)]!}`;
  }

  return { baseId, rarity, name, affixIds: picked.map((p) => p.id), mods, ilvl, durability: rollDurability(baseId) };
}
