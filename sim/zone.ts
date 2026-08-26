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
    "#..##...####..####....#......########",
    "#..##......#..#.......#......#......#",
    "#......r...#..#...z...#......#.r....#",
    "#..........#..#.......###..###......#",
    "####..######..####........##....B...#",
    "#........s......s#...z....##........#",
    "#.e...............#......###...##...#",
    "#.........z.......#......#......##..#",
    "######################################",
  ]);
}

/** Placeholder kept for the scaffold-era tests and boot. */
export function starterZone(): ZoneMap {
  return cryptZone();
}
