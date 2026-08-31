import { AREAS, isAreaId, type AreaDef, type AreaExit } from "./areas";
import { mapFromStrings, type MapMarker, type ZoneMap } from "./map";
import type { Rng } from "./rng";
import { zoneDepth, type ZoneId } from "./state";

/** Map marker characters -> monster types. */
export const MARKER_TYPES: Record<string, string> = {
  z: "shambler",
  s: "skitter",
  r: "gravespit",
  e: "tomb_bloat",
  h: "fen_howler",
  m: "bog_maw",
  w: "cairn_wight",
  B: "barrow_lord",
};

/**
 * The crypt under the barrow. '#' wall, '.' floor, '@' spawn, '<' the stairs
 * back up (a dead-end nook so ordinary pathing never trips it),
 * z/s/r/e monsters, B the Barrow Lord in his vault.
 */
export function cryptZone(): ZoneMap {
  return mapFromStrings([
    "######################################",
    "#@........#..........#....z.....#...#",
    "#<#.......#....s.....#..........#.r.#",
    "##..##....#..........#...####...#...#",
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

/** What the locals call each stretch of the descent. Depth 0 is the camp. */
export function zoneName(depth: number): string {
  if (depth <= 0) return "The Camp";
  if (depth <= 2) return "The Barrow Crypt";
  if (depth <= 4) return "The Sunken Halls";
  if (depth <= 6) return "The Bone Vaults";
  return "The Wyrm's Undercroft";
}

/** Display name for a zone id (the depth-based names cover the crypt floors). */
export function zoneTitle(id: ZoneId): string {
  if (isAreaId(id)) return AREAS[id].title;
  return zoneName(zoneDepth(id));
}

/** The camp's display name — a region of the moors, not a zone of its own. */
export const CAMP_TITLE = "The Camp";

/** The mouth of an exit's carved channel, just inside the rim. */
export function exitMouth(def: AreaDef, e: AreaExit): { x: number; y: number } {
  switch (e.edge) {
    case "N":
      return { x: e.at, y: 3 };
    case "S":
      return { x: e.at, y: def.height - 4 };
    case "W":
      return { x: 3, y: e.at };
    case "E":
      return { x: def.width - 4, y: e.at };
  }
}

/**
 * A surface region grown from its AreaDef: an organic landmass — random floor
 * smoothed into an irregular blob by cellular automata, so the coast wanders in
 * bays and peninsulas instead of hugging the rect. The safe ground (palisaded,
 * gate in its east wall), fixed markers, and exit openings are stamped at their
 * seed-independent spots, worn trails keep them connected, and monster packs
 * scatter over the open ground beyond.
 */
export function areaZone(rng: Rng, def: AreaDef): ZoneMap {
  const { width: w, height: h } = def;
  const cells = new Uint8Array(w * h); // all wall until the landmass grows
  const idx = (x: number, y: number) => y * w + x;

  // Seed the landmass inside a 2-cell rim, then smooth it into a blob:
  // a cell survives as floor only in the company of 5+ floor neighbors.
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      if (rng.next() < def.gen.density) cells[idx(x, y)] = 1;
    }
  }
  for (let it = 0; it < def.gen.smooth; it++) {
    const next = new Uint8Array(cells);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let floors = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if ((dx !== 0 || dy !== 0) && cells[idx(x + dx, y + dy)] === 1) floors++;
          }
        }
        next[idx(x, y)] = floors >= 5 ? 1 : 0;
      }
    }
    cells.set(next);
  }

  // Crag/copse blobs: short random walks of wall, steering clear of the anchors.
  const anchors = [def.spawn, ...def.markers];
  const nearAnchor = (x: number, y: number) =>
    anchors.some((a) => Math.hypot(x - a.x, y - a.y) < 4);
  for (let b = 0; b < def.gen.blobs; b++) {
    let x = rng.int(2, w - 3);
    let y = rng.int(2, h - 3);
    const len = rng.int(def.gen.lenMin, def.gen.lenMax);
    for (let i = 0; i < len; i++) {
      if (!nearAnchor(x, y)) cells[idx(x, y)] = 0;
      x = Math.min(w - 3, Math.max(2, x + rng.int(-1, 1)));
      y = Math.min(h - 3, Math.max(2, y + rng.int(-1, 1)));
    }
  }

  // Fixed features sit in small clearings whatever the landmass grew there.
  for (const a of anchors) {
    for (let y = Math.max(1, Math.floor(a.y - 2)); y <= Math.min(h - 2, Math.floor(a.y + 2)); y++) {
      for (let x = Math.max(1, Math.floor(a.x - 2)); x <= Math.min(w - 2, Math.floor(a.x + 2)); x++) {
        if (Math.hypot(x + 0.5 - a.x, y + 0.5 - a.y) < 2.2) cells[idx(x, y)] = 1;
      }
    }
  }

  // Safe ground: the palisade ring sits on the rect's edges, floor inside,
  // open to the wilds through a gap in its east wall at the spawn row.
  const safe = def.safe;
  for (let y = safe.y0 - 1; y <= safe.y1; y++) {
    for (let x = safe.x0 - 1; x <= safe.x1; x++) {
      const onEdge = x === safe.x0 - 1 || x === safe.x1 || y === safe.y0 - 1 || y === safe.y1;
      cells[idx(x, y)] = onEdge ? 0 : 1;
    }
  }
  const gy = Math.floor(def.spawn.y);
  for (let y = gy - 1; y <= gy + 1; y++) cells[idx(safe.x1, y)] = 1;

  // Exits: 3-wide channels carved through the rim toward the neighbor.
  for (const e of def.exits) {
    for (let d = 0; d < 4; d++) {
      for (let off = -1; off <= 1; off++) {
        if (e.edge === "N") cells[idx(e.at + off, d)] = 1;
        else if (e.edge === "S") cells[idx(e.at + off, h - 1 - d)] = 1;
        else if (e.edge === "W") cells[idx(d, e.at + off)] = 1;
        else cells[idx(w - 1 - d, e.at + off)] = 1;
      }
    }
  }

  // Worn trails from the gate keep every far feature and exit mouth open.
  const gate = { x: safe.x1, y: gy };
  const inSafe = (x: number, y: number) =>
    x >= safe.x0 && x < safe.x1 && y >= safe.y0 && y < safe.y1;
  const targets = [
    ...def.markers
      .map((m) => ({ x: Math.floor(m.x), y: Math.floor(m.y) }))
      .filter((t) => !inSafe(t.x, t.y)),
    ...def.exits.map((e) => exitMouth(def, e)),
  ];
  for (const t of targets) {
    for (let x = Math.min(gate.x, t.x); x <= Math.max(gate.x, t.x); x++) cells[idx(x, gate.y)] = 1;
    for (let y = Math.min(gate.y, t.y); y <= Math.max(gate.y, t.y); y++) cells[idx(t.x, y)] = 1;
  }

  // Stitch: the automaton grows the landmass in fragments, and only luck ties
  // them to the spawn network. Carve a trail from every sizable fragment to
  // just outside the gate — the leg along the palisade's east face never cuts
  // through safe ground — so the seal below only ever swallows small islets.
  const sx = Math.floor(def.spawn.x);
  const sy = Math.floor(def.spawn.y);
  {
    const comp = new Int32Array(cells.length).fill(-1);
    const sizes: number[] = [];
    const firsts: number[] = [];
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] !== 1 || comp[i] !== -1) continue;
      const label = sizes.length;
      let size = 0;
      const stack = [i];
      comp[i] = label;
      while (stack.length > 0) {
        const c = stack.pop()!;
        size++;
        const cx = c % w;
        const cy = Math.floor(c / w);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = idx(nx, ny);
          if (cells[n] === 1 && comp[n] === -1) {
            comp[n] = label;
            stack.push(n);
          }
        }
      }
      sizes.push(size);
      firsts.push(i);
    }
    const spawnComp = comp[idx(sx, sy)]!;
    const gx = safe.x1 + 1;
    for (let label = 0; label < sizes.length; label++) {
      if (label === spawnComp || sizes[label]! < 25) continue;
      const tx = firsts[label]! % w;
      const ty = Math.floor(firsts[label]! / w);
      for (let x = Math.min(tx, gx); x <= Math.max(tx, gx); x++) cells[idx(x, ty)] = 1;
      for (let y = Math.min(ty, gy); y <= Math.max(ty, gy); y++) cells[idx(gx, y)] = 1;
    }
  }

  // Seal off any pocket cut away from the trail network.
  const reachable = new Set<number>([idx(sx, sy)]);
  const queue = [{ x: sx, y: sy }];
  while (queue.length > 0) {
    const { x, y } = queue.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const key = idx(nx, ny);
      if (reachable.has(key) || cells[key] !== 1) continue;
      reachable.add(key);
      queue.push({ x: nx, y: ny });
    }
  }
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === 1 && !reachable.has(i)) cells[i] = 0;
  }

  // Monster packs scattered over the open ground, never crowding safe ground.
  const markers: MapMarker[] = def.markers.map((m) => ({ ...m }));
  const taken = new Set<number>();
  let placed = 0;
  for (let tries = 0; placed < def.gen.packs && tries < 4000; tries++) {
    const x = rng.int(2, w - 3);
    const y = rng.int(2, h - 3);
    const key = idx(x, y);
    if (!reachable.has(key) || taken.has(key)) continue;
    if (inSafe(x + 0.5, y + 0.5)) continue;
    if (Math.hypot(x + 0.5 - def.spawn.x, y + 0.5 - def.spawn.y) < 10) continue;
    taken.add(key);
    markers.push({
      ch: def.spawnTable[rng.int(0, def.spawnTable.length - 1)]!,
      x: x + 0.5,
      y: y + 0.5,
    });
    placed++;
  }

  return { width: w, height: h, cells, spawn: { ...def.spawn }, markers, camp: { ...safe } };
}

/** The moors above the barrow — the overworld row of the area registry. */
export function overworldZone(rng: Rng): ZoneMap {
  return areaZone(rng, AREAS.overworld);
}
