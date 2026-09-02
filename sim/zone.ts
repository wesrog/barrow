import { AREAS, type AreaDef, type AreaExit } from "./areas";
import { LANDMARKS, LANDMARK_IDS, type PlacedLandmark } from "./landmarks";
import { mapFromStrings, type MapMarker, type ZoneMap } from "./map";
import { NPCS, NPC_IDS } from "./npcs";
import type { Rng } from "./rng";

/** No monster pack lands within this many cells of an NPC's home — a cleared
 * pocket around each quest giver, without the wilds needing safe ground. */
export const NPC_CLEARING = 8;

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
 * bays and peninsulas instead of hugging the rect. Safe ground (palisaded, gate
 * in its east wall — the town only), fixed markers, and exit openings are
 * stamped at their seed-independent spots, worn trails keep them connected, and
 * monster packs scatter over the open ground beyond. Regions without a fixed W
 * marker hide their waypoint at a seed-random spot deep in the wilds instead.
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

  // Landmark set-pieces: stamp a few of the region's eligible ruins into the
  // wilds, clear of the camp, quest givers, exits, and each other. Their
  // markers (chest, lore stone, champion guard) ride the map like any others,
  // and the gate-trail pass below keeps each site's center column connected.
  const placedLandmarks: PlacedLandmark[] = [];
  const landmarkMarkers: MapMarker[] = [];
  {
    const mouths = def.exits.map((e) => exitMouth(def, e));
    const npcHomesEarly = NPC_IDS.map((n) => NPCS[n]).filter((n) => n.area === def.id);
    const eligible = LANDMARK_IDS.filter((id) => LANDMARKS[id].regions.includes(def.id));
    const wanted = Math.min(def.gen.landmarks, eligible.length);
    // Draw without repeats so one region never hosts the same ruin twice.
    const pool = [...eligible];
    for (let n = 0; n < wanted && pool.length > 0; n++) {
      const lm = LANDMARKS[pool.splice(rng.int(0, pool.length - 1), 1)[0]!];
      const lw = lm.rows[0]!.length;
      const lh = lm.rows.length;
      for (let tries = 0; tries < 300; tries++) {
        const x0 = rng.int(3, w - lw - 3);
        const y0 = rng.int(3, h - lh - 3);
        const cx = x0 + lw / 2;
        const cy = y0 + lh / 2;
        if (
          def.safe &&
          x0 < def.safe.x1 + 3 && def.safe.x0 - 3 < x0 + lw &&
          y0 < def.safe.y1 + 3 && def.safe.y0 - 3 < y0 + lh
        ) continue;
        if (anchors.some((a) => Math.hypot(cx - a.x, cy - a.y) < 8)) continue;
        if (mouths.some((mo) => Math.hypot(cx - mo.x, cy - mo.y) < 10)) continue;
        if (npcHomesEarly.some((np) => Math.hypot(cx - np.pos.x, cy - np.pos.y) < NPC_CLEARING + 3)) continue;
        if (placedLandmarks.some((p) => {
          const od = LANDMARKS[p.id];
          return Math.hypot(cx - (p.x0 + od.rows[0]!.length / 2), cy - (p.y0 + od.rows.length / 2)) < 14;
        })) continue;
        for (let y = 0; y < lh; y++) {
          for (let x = 0; x < lw; x++) {
            const ch = lm.rows[y]![x]!;
            if (ch === " ") continue;
            cells[idx(x0 + x, y0 + y)] = ch === "#" ? 0 : 1;
            if (ch !== "#" && ch !== ".") {
              landmarkMarkers.push({ ch, x: x0 + x + 0.5, y: y0 + y + 0.5 });
            }
          }
        }
        placedLandmarks.push({ id: lm.id, x0, y0 });
        break;
      }
    }
  }

  // Safe ground: the palisade ring sits on the rect's edges, floor inside,
  // open to the wilds through a gap in its east wall at the spawn row.
  const safe = def.safe;
  const gy = Math.floor(def.spawn.y);
  if (safe) {
    for (let y = safe.y0 - 1; y <= safe.y1; y++) {
      for (let x = safe.x0 - 1; x <= safe.x1; x++) {
        const onEdge = x === safe.x0 - 1 || x === safe.x1 || y === safe.y0 - 1 || y === safe.y1;
        cells[idx(x, y)] = onEdge ? 0 : 1;
      }
    }
    for (let y = gy - 1; y <= gy + 1; y++) cells[idx(safe.x1, y)] = 1;
  }

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

  // NPC homes are fixed data points, like markers — terrain must never strand
  // one unreachable and softlock the campaign that depends on talking to them.
  // Carve each home cell and its 8-neighbor ring to guaranteed floor here, and
  // trail to it below. Pure lookup against NPCS; consumes no RNG.
  const npcHomes = NPC_IDS.map((n) => NPCS[n]).filter((n) => n.area === def.id);
  for (const n of npcHomes) {
    const nx = Math.floor(n.pos.x);
    const ny = Math.floor(n.pos.y);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = nx + dx;
        const y = ny + dy;
        if (x < 0 || x >= w || y < 0 || y >= h) continue;
        cells[idx(x, y)] = 1;
      }
    }
  }

  // Worn trails from the gate keep every far feature and exit mouth open.
  // Without safe ground there is no gate — the spawn anchor plays its part.
  const gate = safe ? { x: safe.x1, y: gy } : { x: Math.floor(def.spawn.x), y: gy };
  const inSafe = (x: number, y: number) =>
    safe !== undefined && x >= safe.x0 && x < safe.x1 && y >= safe.y0 && y < safe.y1;
  const targets = [
    ...def.markers
      .map((m) => ({ x: Math.floor(m.x), y: Math.floor(m.y) }))
      .filter((t) => !inSafe(t.x, t.y)),
    ...npcHomes
      .map((n) => ({ x: Math.floor(n.pos.x), y: Math.floor(n.pos.y) }))
      .filter((t) => !inSafe(t.x, t.y)),
    ...def.exits.map((e) => exitMouth(def, e)),
    // Each landmark's center cell — its stamp keeps that column open.
    ...placedLandmarks.map((p) => ({
      x: p.x0 + Math.floor(LANDMARKS[p.id].rows[0]!.length / 2),
      y: p.y0 + Math.floor(LANDMARKS[p.id].rows.length / 2),
    })),
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
    const gx = safe ? safe.x1 + 1 : gate.x;
    for (let label = 0; label < sizes.length; label++) {
      if (label === spawnComp || sizes[label]! < 25) continue;
      const tx = firsts[label]! % w;
      const ty = Math.floor(firsts[label]! / w);
      for (let x = Math.min(tx, gx); x <= Math.max(tx, gx); x++) cells[idx(x, ty)] = 1;
      for (let y = Math.min(ty, gy); y <= Math.max(ty, gy); y++) cells[idx(gx, y)] = 1;
    }
  }

  // Hut dwellers get four walls: the radius-2 ring around home turns solid,
  // except a doorway on the side the gate trail arrives from. Stamped after
  // every carve so nothing breaches the walls; the seal below then treats the
  // interior like any other floor — reachable through the doorway.
  for (const n of npcHomes) {
    if (n.dwelling !== "hut") continue;
    const nx = Math.floor(n.pos.x);
    const ny = Math.floor(n.pos.y);
    const doorY = ny + (gate.y >= ny ? 2 : -2);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== 2) continue;
        const x = nx + dx;
        const y = ny + dy;
        if (x < 0 || x >= w || y < 0 || y >= h) continue;
        cells[idx(x, y)] = x === nx && y === doorY ? 1 : 0;
      }
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

  // Monster packs scattered over the open ground, never crowding safe ground
  // or an NPC's clearing. The scatter retries until the full pack budget is
  // placed, so clearings shift packs elsewhere — they never shrink the count.
  const markers: MapMarker[] = [...def.markers.map((m) => ({ ...m })), ...landmarkMarkers];
  const taken = new Set<number>(
    landmarkMarkers.map((m) => idx(Math.floor(m.x), Math.floor(m.y))),
  );
  const nearNpcHome = (x: number, y: number) =>
    npcHomes.some((n) => Math.hypot(x + 0.5 - n.pos.x, y + 0.5 - n.pos.y) < NPC_CLEARING);

  // The hidden waypoint: regions without a fixed W pad roll one onto a random
  // reachable cell far from every entrance, so finding it is the region's
  // exploration prize — nobody arrives standing on it.
  if (!markers.some((m) => m.ch === "W")) {
    const mouths = def.exits.map((e) => exitMouth(def, e));
    const clearOfMouths = (x: number, y: number, min: number) =>
      mouths.every((mo) => Math.hypot(x + 0.5 - mo.x, y + 0.5 - mo.y) >= min);
    let spot: { x: number; y: number } | null = null;
    for (let tries = 0; spot === null && tries < 4000; tries++) {
      const x = rng.int(3, w - 4);
      const y = rng.int(3, h - 4);
      if (reachable.has(idx(x, y)) && clearOfMouths(x, y, 20) && !nearNpcHome(x, y)) {
        spot = { x, y };
      }
    }
    if (spot === null) {
      // Cramped landmass: settle for the reachable cell farthest into the wilds.
      let bestDist = -1;
      for (const key of reachable) {
        const x = key % w;
        const y = Math.floor(key / w);
        const d = Math.min(...mouths.map((mo) => Math.hypot(x + 0.5 - mo.x, y + 0.5 - mo.y)));
        if (d > bestDist) {
          bestDist = d;
          spot = { x, y };
        }
      }
    }
    if (spot) {
      taken.add(idx(spot.x, spot.y));
      markers.push({ ch: "W", x: spot.x + 0.5, y: spot.y + 0.5 });
    }
  }
  let placed = 0;
  for (let tries = 0; placed < def.gen.packs && tries < 4000; tries++) {
    const x = rng.int(2, w - 3);
    const y = rng.int(2, h - 3);
    const key = idx(x, y);
    if (!reachable.has(key) || taken.has(key)) continue;
    if (inSafe(x + 0.5, y + 0.5)) continue;
    if (Math.hypot(x + 0.5 - def.spawn.x, y + 0.5 - def.spawn.y) < 10) continue;
    if (nearNpcHome(x, y)) continue;
    taken.add(key);
    markers.push({
      ch: def.spawnTable[rng.int(0, def.spawnTable.length - 1)]!,
      x: x + 0.5,
      y: y + 0.5,
    });
    placed++;
  }

  return {
    width: w,
    height: h,
    cells,
    spawn: { ...def.spawn },
    markers,
    camps: safe ? [{ ...safe }] : [],
    landmarks: placedLandmarks,
  };
}

/** The moors above the barrow — the overworld row of the area registry. */
export function overworldZone(rng: Rng): ZoneMap {
  return areaZone(rng, AREAS.overworld);
}
