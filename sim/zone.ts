import { mapFromStrings, type ZoneMap } from "./map";

/** Map marker characters -> monster types. */
export const MARKER_TYPES: Record<string, string> = {
  z: "shambler",
  s: "skitter",
  r: "gravespit",
  e: "tomb_bloat",
  B: "barrow_lord",
};

/**
 * The crypt under the barrow. '#' wall, '.' floor, '@' spawn,
 * z/s/r/e monsters, B the Barrow Lord in his vault.
 */
export function cryptZone(): ZoneMap {
  return mapFromStrings([
    "######################################",
    "#@........#..........#....z.....#...#",
    "#.........#....s.....#..........#.r.#",
    "#...##....#..........#...####...#...#",
    "#...##....####...#####...#..#.......#",
    "#..............s.........#..#...z...#",
    "#......z..................ss........#",
    "###..#####....#####...#######...#####",
    "#.......#........#....#.............#",
    "#..s....#...e....#....#....e....s...#",
    "#.......#........#.........s........#",
    "#..##...####..####....#......###..###",
    "#..##......#..#.......#......#......#",
    "#......r...#..#...z...#......#.r....#",
    "#..........#..#.......###..###......#",
    "####..######..####........##....B...#",
    "#........s......s#...z....##........#",
    "#.e...............#......###...##.>.#",
    "#.........z.......#......#......##..#",
    "######################################",
  ]);
}

/** What the locals call each stretch of the descent. */
export function zoneName(depth: number): string {
  if (depth <= 2) return "The Barrow Crypt";
  if (depth <= 4) return "The Sunken Halls";
  if (depth <= 6) return "The Bone Vaults";
  return "The Wyrm's Undercroft";
}

/** Placeholder kept for the scaffold-era tests and boot. */
export function starterZone(): ZoneMap {
  return cryptZone();
}

/**
 * The camp above the barrow. Safe ground: V the vendor, P the portal pad
 * back down, @ where the portal drops you.
 */
export function townZone(): ZoneMap {
  return mapFromStrings([
    "################",
    "#..............#",
    "#..V...........#",
    "#..........P...#",
    "#.....@........#",
    "#..............#",
    "#..............#",
    "################",
  ]);
}
