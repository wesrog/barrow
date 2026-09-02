// Landmark set-pieces: small hand-authored ruins stamped into the procedural
// surface, so every region has places worth walking to. Content growth is new
// rows here, not new code. Stamp legend: '#' wall, '.' floor, ' ' leave the
// grown terrain alone, '$' a treasure chest, 'L' a lore stone (readable),
// 'X' a champion guard. Trails arrive on the stamp's center column, so the
// top and bottom rows keep that column open (locked by a test).

import type { AreaId } from "./areas";
import type { Vec } from "./map";

export type LandmarkId =
  | "ruined_chapel"
  | "standing_stones"
  | "cairn_field"
  | "sunken_causeway"
  | "the_gallows"
  | "wyrm_altar";

export interface LandmarkDef {
  id: LandmarkId;
  name: string;
  rows: string[];
  /** Regions this piece may be stamped into. */
  regions: AreaId[];
  /** What its lore stone reads, out in the world. */
  lore: { title: string; lines: string[] };
}

export const LANDMARKS: Record<LandmarkId, LandmarkDef> = {
  ruined_chapel: {
    id: "ruined_chapel",
    name: "Ruined Chapel",
    rows: [
      "###.....###",
      "#.........#",
      "....X......",
      "#.L.....$.#",
      "#.........#",
      "##.......##",
      "####...####",
    ],
    regions: ["overworld", "redfen"],
    lore: {
      title: "A defaced altar stone",
      lines: [
        "The carving has been scraped away by hands in a hurry, but the base line survives:",
        "\"...raised over the mouth of the old dark, that it stay shut. Keep the candles lit.\"",
        "There are no candles here. There is no roof.",
      ],
    },
  },
  standing_stones: {
    id: "standing_stones",
    name: "Standing Stones",
    rows: [
      "..#...#..",
      ".#.....#.",
      "#.......#",
      "....L....",
      "#...$...#",
      ".#.....#.",
      "..#...#..",
    ],
    regions: ["overworld", "cragmaw"],
    lore: {
      title: "A ring of grey monoliths",
      lines: [
        "Older than the barrow, older than the moors' name. Each stone leans away from the center,",
        "as if something once stood in the middle that the circle did not care to face.",
        "Scratched at knee height, in a newer hand: \"they lean a little more each year\".",
      ],
    },
  },
  cairn_field: {
    id: "cairn_field",
    name: "Cairn Field",
    rows: [
      "#...#...#..",
      "...........",
      ".#..L..#...",
      "........$..",
      "..#...#...#",
    ],
    regions: ["overworld", "gallowmire"],
    lore: {
      title: "A soldier's cairn",
      lines: [
        "A helmet of the Ninth rests on the topmost stone, rust fused to rock.",
        "\"Here lies Tam, who held the ford. We could not carry him farther.\"",
        "Some of the nearby cairns have been opened. From the inside.",
      ],
    },
  },
  sunken_causeway: {
    id: "sunken_causeway",
    name: "Sunken Causeway",
    rows: [
      "#...#...#...#",
      ".............",
      "..L...X...$..",
      ".............",
      "#...#...#...#",
    ],
    regions: ["redfen", "gallowmire"],
    lore: {
      title: "A milestone, waist-deep in fen",
      lines: [
        "A king's road ran here once, wide enough for two carts, before the fen swallowed it.",
        "The milestone still gives distances to towns nobody remembers.",
        "Whatever the road was built to reach, the water got there first.",
      ],
    },
  },
  the_gallows: {
    id: "the_gallows",
    name: "The Gallows",
    rows: [
      ".........",
      "..#...#..",
      "..X.L....",
      "..#...#..",
      "....$....",
      ".........",
    ],
    regions: ["gallowmire"],
    lore: {
      title: "The gallows tree",
      lines: [
        "The mire takes its name from this: a dead oak hung with rotted rope, nine nooses cut, one not.",
        "A tin plate nailed to the trunk lists the hanged men's crimes. The last entry reads only:",
        "\"He dug where he was told not to.\"",
      ],
    },
  },
  wyrm_altar: {
    id: "wyrm_altar",
    name: "Wyrm Altar",
    rows: [
      "..##.##..",
      ".#.....#.",
      ".#..$..#.",
      "....L....",
      ".#..X..#.",
      ".#.....#.",
      "..##.##..",
    ],
    regions: ["cragmaw"],
    lore: {
      title: "An altar of fused scale",
      lines: [
        "Not carved — grown. The slab is one enormous scale, shed or torn, set on end by many hands.",
        "Offerings litter the base: coins, teeth, a child's shoe. All of it old. None of it taken.",
        "Below your feet, very faintly, something is breathing.",
      ],
    },
  },
};

export const LANDMARK_IDS = Object.keys(LANDMARKS) as LandmarkId[];

/** A landmark stamped into a generated map, by its top-left cell. Matches the
 * loosely-typed ZoneMap.landmarks rows (ids there are plain strings). */
export interface PlacedLandmark {
  id: LandmarkId;
  x0: number;
  y0: number;
}

/** The landmark whose stamp footprint contains `pos`, or null. */
export function landmarkAt(
  placed: { id: string; x0: number; y0: number }[],
  pos: Vec,
): LandmarkDef | null {
  for (const p of placed) {
    const def = LANDMARKS[p.id as LandmarkId];
    if (!def) continue;
    const w = def.rows[0]!.length;
    const h = def.rows.length;
    if (pos.x >= p.x0 && pos.x < p.x0 + w && pos.y >= p.y0 && pos.y < p.y0 + h) return def;
  }
  return null;
}
