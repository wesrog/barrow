// Auto-generated character names for the lobby's forge form. Pure syllable
// assembly — names are player input to the sim, so this stays outside the
// seeded sim RNG and defaults to Math.random.

const OPENERS = [
  "bar", "kel", "mor", "thra", "vel", "gor", "ash", "dru", "fen", "hal",
  "isk", "jor", "kaz", "lun", "mag", "nir", "or", "pyr", "rav", "sol",
  "tor", "ul", "vor", "wyn", "yor", "zar", "gris", "hex", "murk", "brand",
];

const MIDDLES = [
  "a", "e", "o", "u", "an", "en", "in", "on", "ar", "or", "il", "ur",
  "ath", "eth", "oth", "and", "end", "old", "ang", "im",
];

const ENDERS = [
  "dric", "gar", "mund", "ric", "wick", "born", "grim", "thane", "vald", "wyn",
  "dor", "mir", "rok", "las", "nna", "ra", "wen", "lyn", "dis", "ka",
];

function pick(items: string[], rand: () => number): string {
  return items[Math.min(items.length - 1, Math.floor(rand() * items.length))] ?? "";
}

/** Roll a fresh name: opener [+ middle] + ender, capitalized, ≤16 chars. */
export function generateName(rand: () => number = Math.random): string {
  const opener = pick(OPENERS, rand);
  const middle = rand() < 0.5 ? pick(MIDDLES, rand) : "";
  const name = opener + middle + pick(ENDERS, rand);
  return name.slice(0, 1).toUpperCase() + name.slice(1);
}
