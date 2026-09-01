import * as THREE from "three";
import { isWalkable, type Vec, type ZoneMap } from "../../sim/map";
import {
  allPlayers,
  zoneOf,
  type GameState,
  type PlayerId,
  type SimEvent,
} from "../../sim/state";
import { MONSTER_TYPES } from "../../sim/monsters";
import { potionKind } from "../../sim/items/bases";
import { NPCS, type Npc, type NpcId } from "../../sim/npcs";
import { npcIndicator } from "../../sim/quests";
import { AREAS } from "../../sim/areas";
import { AREA_ORDER, areaAt, areaRect, locationTitle } from "../../sim/surface";
import { localId, localPlayer } from "../local";
import { BIOME_PALETTES } from "./biomes";
import { Effects } from "./fx";
import type { Rig } from "./rigs";
import {
  makeHeroModelRig,
  makeMonsterModelRig,
  monsterAttackClip,
  type HeroModelRig,
  type ModelRig,
} from "./modelRigs";
import type { GameAssets } from "./models";
import { playerCss, playerTint } from "./tints";

const VIEW_HEIGHT = 16; // world units visible vertically

export type PickResult =
  | { kind: "monster"; id: number }
  | { kind: "item"; id: number }
  | { kind: "breakable"; id: number }
  | { kind: "portal"; id: number }
  | { kind: "corpse"; id: number }
  | { kind: "npc"; id: number }
  | { kind: "waypoint"; pos: Vec }
  | { kind: "ground"; world: Vec }
  | null;

export interface SceneHandle {
  /**
   * Draw the current sim state; alpha ∈ [0,1] interpolates from the previous
   * tick. `prevPositions` holds every player's pre-step position, so the whole
   * party moves smoothly, not just the local hero.
   */
  render(state: GameState, prevPositions: Map<PlayerId, Vec>, alpha: number): void;
  /** What is under the pointer: a monster, or a spot on the ground. */
  pick(state: GameState, clientX: number, clientY: number): PickResult;
  /** Spawn a floating damage number at a world position. */
  addDamageNumber(pos: Vec, text: string, color: string): void;
  /** Flash an expanding blast ring at a world position. */
  addExplosion(pos: Vec, radius: number): void;
  /** Play any visual reaction this sim event deserves (swings, hits, deaths...). */
  handleEvent(event: SimEvent, state: GameState): void;
  /** Highlight whatever is under the cursor and set an appropriate cursor. */
  updateHover(state: GameState, clientX: number, clientY: number): void;
  dispose(): void;
}

function flatMat(color: number, roughness = 0.85): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, flatShading: true });
}

export function createScene(
  mount: HTMLElement,
  map: ZoneMap,
  assets: GameAssets,
  npcs: Npc[],
  onItemClick?: (id: number) => void,
  surface = false,
): SceneHandle {
  const outdoor = surface;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  mount.appendChild(renderer.domElement);

  // DOM overlay for damage numbers
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:absolute;inset:0;pointer-events:none;overflow:hidden;font-family:ui-monospace,monospace;";
  mount.style.position = "relative";
  mount.appendChild(overlay);

  const scene = new THREE.Scene();
  // Regions sit under their biome's night sky; the crypt under dead black.
  // Outdoors the sky starts on the spawn region's palette and the per-frame
  // blend (below) corrects to wherever the hero actually stands.
  const startPal = outdoor ? BIOME_PALETTES[AREAS[areaAt(map.spawn)].biome] : null;
  const bg = startPal ? startPal.bg : 0x0a0a0c;
  scene.background = new THREE.Color(bg);
  scene.fog = startPal
    ? new THREE.Fog(bg, startPal.fogNear, startPal.fogFar)
    : new THREE.Fog(bg, 20, 40);
  const fx = new Effects(scene);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const camOffset = new THREE.Vector3(14, 18, 14);

  const resize = () => {
    const w = mount.clientWidth || window.innerWidth;
    const h = mount.clientHeight || window.innerHeight;
    renderer.setSize(w, h);
    const aspect = w / h;
    camera.top = VIEW_HEIGHT / 2;
    camera.bottom = -VIEW_HEIGHT / 2;
    camera.left = (-VIEW_HEIGHT * aspect) / 2;
    camera.right = (VIEW_HEIGHT * aspect) / 2;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener("resize", resize);

  // --- Lights ---
  const ambient = startPal
    ? new THREE.AmbientLight(startPal.ambient, startPal.ambientIntensity)
    : new THREE.AmbientLight(0x6a6a80, 0.5);
  scene.add(ambient);
  const moon = new THREE.DirectionalLight(0xb8c4e0, outdoor ? 1.3 : 1.1);
  moon.position.set(18, 30, 8);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  const s = 26;
  moon.shadow.camera.left = -s;
  moon.shadow.camera.right = s;
  moon.shadow.camera.top = s;
  moon.shadow.camera.bottom = -s;
  moon.shadow.camera.far = 80;
  scene.add(moon);
  scene.add(moon.target);

  const heroLight = new THREE.PointLight(0xffb35c, 8, 9, 1.6);
  heroLight.position.set(0, 1.6, 0);
  scene.add(heroLight);

  // --- Atmosphere: the surface is one scene, so sky, fog and ambient follow
  // the hero across region borders instead of snapping at a zone change ---
  const BLEND = 10; // cells on each side of a border that participate in the mix
  const bands = AREA_ORDER.map((id) => ({
    rect: areaRect(id),
    pal: BIOME_PALETTES[AREAS[id].biome],
  })).sort((a, b) => a.rect.x0 - b.rect.x0);
  const bgColor = new THREE.Color();
  const ambColor = new THREE.Color();
  const tmpColor = new THREE.Color();

  /** Blend the hero's region palette with a neighbor's near the border. */
  const applyAtmosphere = (x: number) => {
    let i = bands.findIndex((b) => x < b.rect.x1);
    if (i < 0) i = bands.length - 1;
    const cur = bands[i]!;
    let other = cur;
    let t = 0; // 0 = pure current, 0.5 = standing on the border
    if (i > 0 && x - cur.rect.x0 < BLEND) {
      other = bands[i - 1]!;
      t = 0.5 * (1 - (x - cur.rect.x0) / BLEND);
    } else if (i < bands.length - 1 && cur.rect.x1 - x < BLEND) {
      other = bands[i + 1]!;
      t = 0.5 * (1 - (cur.rect.x1 - x) / BLEND);
    }
    bgColor.set(cur.pal.bg).lerp(tmpColor.set(other.pal.bg), t);
    (scene.background as THREE.Color).copy(bgColor);
    const fog = scene.fog as THREE.Fog;
    fog.color.copy(bgColor);
    fog.near = cur.pal.fogNear + (other.pal.fogNear - cur.pal.fogNear) * t;
    fog.far = cur.pal.fogFar + (other.pal.fogFar - cur.pal.fogFar) * t;
    ambColor.set(cur.pal.ambient).lerp(tmpColor.set(other.pal.ambient), t);
    ambient.color.copy(ambColor);
    ambient.intensity =
      cur.pal.ambientIntensity + (other.pal.ambientIntensity - cur.pal.ambientIntensity) * t;
  };

  // --- Environment from the KayKit dungeon set: brick facades over dark cores ---
  const hash = (x: number, y: number) => (x * 73856093 ^ y * 19349663) >>> 0;
  const torchSpots: { x: number; y: number; fx: number; fy: number }[] = [];

  // Dark cores fill wall regions (occlusion + silhouette); facades add the brick.
  if (!outdoor) {
    const coreGeo = new THREE.BoxGeometry(1, 1.5, 1);
    const cores: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4();
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (!isWalkable(map, x, y)) {
          cores.push(m.makeTranslation(x + 0.5, 0.72, y + 0.5).clone());
          if (isWalkable(map, x, y + 1) && hash(x, y) % 17 === 0) {
            torchSpots.push({ x: x + 0.5, y: 0.72, fx: x + 0.5, fy: y + 1 });
          }
        }
      }
    }
    const coreMesh = new THREE.InstancedMesh(coreGeo, flatMat(0x191722, 1), cores.length);
    cores.forEach((mat, i) => coreMesh.setMatrixAt(i, mat));
    coreMesh.receiveShadow = true;
    scene.add(coreMesh);
  }

  const env = new THREE.Group();
  scene.add(env);
  const placePiece = (
    piece: THREE.Group,
    x: number,
    z: number,
    ry: number,
    scale: { x: number; y: number; z: number },
  ) => {
    const clone = piece.clone(true);
    clone.position.set(x, 0, z);
    clone.rotation.y = ry;
    clone.scale.set(scale.x, scale.y, scale.z);
    clone.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    env.add(clone);
    return clone;
  };

  const WALL_SCALE = { x: 0.25, y: 0.35, z: 0.35 };
  const FLOOR_SCALE = { x: 0.5, y: 0.45, z: 0.5 };
  // Stair cells (down and up) get a real stairwell instead of a floor tile.
  const stairCells = new Set(
    map.markers
      .filter((m) => m.ch === ">" || m.ch === "<")
      .map((m) => `${Math.floor(m.x)},${Math.floor(m.y)}`),
  );
  if (!outdoor) {
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const h = hash(x, y);
        if (isWalkable(map, x, y)) {
          if (stairCells.has(`${x},${y}`)) continue;
          // Stone floor tile, occasionally broken or weedy
          const roll = h % 23;
          const floorPiece =
            roll === 0 ? assets.dungeon.floor_broken : roll === 1 ? assets.dungeon.floor_weeds : assets.dungeon.floor;
          placePiece(floorPiece, x + 0.5, y + 0.5, ((h >> 3) % 4) * (Math.PI / 2), FLOOR_SCALE);
        } else {
          // Brick facades on every edge that faces open floor
          const wallRoll = h % 10;
          const piece =
            wallRoll < 7 ? assets.dungeon.wall : wallRoll < 9 ? assets.dungeon.wall_cracked : assets.dungeon.wall_broken;
          if (isWalkable(map, x, y + 1)) placePiece(piece, x + 0.5, y + 1, 0, WALL_SCALE);
          if (isWalkable(map, x, y - 1)) placePiece(piece, x + 0.5, y, Math.PI, WALL_SCALE);
          if (isWalkable(map, x + 1, y)) placePiece(piece, x + 1, y + 0.5, -Math.PI / 2, WALL_SCALE);
          if (isWalkable(map, x - 1, y)) placePiece(piece, x, y + 0.5, Math.PI / 2, WALL_SCALE);
        }
      }
    }

    // --- Crypt dressing: coffins, bone piles, and columns along the walls ---
    // Deterministic from the cell hash, hugging wall-adjacent floor so the
    // walking lanes stay readable. Pure decoration — nothing here collides.
    const markerCells = new Set(
      map.markers.map((m) => `${Math.floor(m.x)},${Math.floor(m.y)}`),
    );
    const coffinBase = flatMat(0x453424, 1);
    const coffinLid = flatMat(0x574433, 1);
    const boneMat = flatMat(0xcfc4a8, 0.9);
    const makeCoffin = (h: number): THREE.Group => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.2, 0.4), coffinBase);
      body.position.y = 0.1;
      g.add(body);
      // The head end is broader — two overlapping boxes fake the casket taper.
      const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.48), coffinBase);
      shoulders.position.set(-0.12, 0.1, 0);
      g.add(shoulders);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.05, 0.44), coffinLid);
      if (h % 5 === 0) {
        // Ajar: the lid slid sideways, whatever rested inside long gone.
        lid.position.set(0.1, 0.23, 0.14);
        lid.rotation.z = 0.12;
      } else {
        lid.position.y = 0.22;
      }
      g.add(lid);
      g.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.castShadow = true;
          obj.receiveShadow = true;
        }
      });
      return g;
    };
    const makeBonePile = (h: number): THREE.Group => {
      const g = new THREE.Group();
      for (let i = 0; i < 3 + (h % 2); i++) {
        const bit = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05 + ((h >> i) % 3) * 0.015, 0), boneMat);
        bit.position.set(((h >> (i * 2)) % 5 - 2) * 0.07, 0.04, ((h >> (i * 2 + 3)) % 5 - 2) * 0.07);
        bit.castShadow = true;
        g.add(bit);
      }
      const shard = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.24, 4), boneMat);
      shard.rotation.set(Math.PI / 2, 0, (h % 628) / 100);
      shard.position.y = 0.04;
      g.add(shard);
      return g;
    };
    const spawnX = map.spawn.x;
    const spawnY = map.spawn.y;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (!isWalkable(map, x, y)) continue;
        const key = `${x},${y}`;
        if (stairCells.has(key) || markerCells.has(key)) continue;
        if (Math.hypot(x + 0.5 - spawnX, y + 0.5 - spawnY) < 2.5) continue;
        const nearWall =
          !isWalkable(map, x, y + 1) ||
          !isWalkable(map, x, y - 1) ||
          !isWalkable(map, x + 1, y) ||
          !isWalkable(map, x - 1, y);
        if (!nearWall) continue;
        const h = hash(x, y);
        const jx = x + 0.5 + ((h >> 9) % 5 - 2) * 0.06;
        const jz = y + 0.5 + ((h >> 12) % 5 - 2) * 0.06;
        if (h % 23 === 3) {
          const coffin = makeCoffin(h);
          coffin.position.set(jx, 0, jz);
          coffin.rotation.y = ((h >> 4) % 4) * (Math.PI / 2) + ((h >> 7) % 20 - 10) * 0.02;
          scene.add(coffin);
        } else if (h % 29 === 5) {
          const bones = makeBonePile(h);
          bones.position.set(jx, 0, jz);
          scene.add(bones);
        } else if (h % 61 === 7) {
          placePiece(assets.dungeon.column, x + 0.5, y + 0.5, ((h >> 5) % 4) * (Math.PI / 2), {
            x: 0.3,
            y: 0.34,
            z: 0.3,
          });
        }
      }
    }
  } else {
    // --- Open ground: every region lays its own biome-tinted plane over its
    // slice of the world, then instanced crags, dead pines and tufts in its
    // own colors. Cell hashes stay keyed on world coordinates, so the scatter
    // is the same wherever a region happens to sit in the layout. ---
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const eul = new THREE.Euler();
    const scl = new THREE.Vector3();
    const addInstanced = (
      geo: THREE.BufferGeometry,
      color: number,
      mats: THREE.Matrix4[],
      shadows: boolean,
    ) => {
      const mesh = new THREE.InstancedMesh(geo, flatMat(color, 1), mats.length);
      mats.forEach((mat, i) => mesh.setMatrixAt(i, mat));
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      scene.add(mesh);
    };
    for (const areaId of AREA_ORDER) {
      const rect = areaRect(areaId);
      const pal = BIOME_PALETTES[AREAS[areaId].biome];
      const rw = rect.x1 - rect.x0;
      const rh = rect.y1 - rect.y0;
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(rw, rh), flatMat(pal.ground, 1));
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(rect.x0 + rw / 2, 0, rect.y0 + rh / 2);
      ground.receiveShadow = true;
      scene.add(ground);

      const rockMats: THREE.Matrix4[] = [];
      const pineMats: THREE.Matrix4[] = [];
      const trunkMats: THREE.Matrix4[] = [];
      const tuftMats: THREE.Matrix4[] = [];
      for (let y = rect.y0; y < rect.y1; y++) {
        for (let x = rect.x0; x < rect.x1; x++) {
          const h = hash(x, y);
          const jx = x + 0.5 + ((h % 7) - 3) * 0.05;
          const jz = y + 0.5 + (((h >> 4) % 7) - 3) * 0.05;
          if (!isWalkable(map, x, y)) {
            if (stairCells.has(`${x},${y}`)) continue;
            const border =
              x === rect.x0 || y === rect.y0 || x === rect.x1 - 1 || y === rect.y1 - 1;
            if (border || h % 5 < 3) {
              const s = 0.6 + ((h >> 6) % 45) / 100;
              eul.set(((h >> 2) % 6) / 10, ((h >> 5) % 628) / 100, ((h >> 8) % 6) / 10);
              m.compose(pos.set(jx, 0.3 * s, jz), quat.setFromEuler(eul), scl.set(s, s * 0.75, s));
              rockMats.push(m.clone());
            } else {
              const s = 0.75 + ((h >> 6) % 55) / 100;
              quat.setFromEuler(eul.set(0, ((h >> 5) % 628) / 100, 0));
              m.compose(pos.set(jx, 0.3 + 0.85 * s, jz), quat, scl.set(s, s, s));
              pineMats.push(m.clone());
              m.compose(pos.set(jx, 0.22, jz), quat, scl.set(1, 1, 1));
              trunkMats.push(m.clone());
            }
          } else if (h % 11 === 0) {
            quat.setFromEuler(eul.set(0, ((h >> 5) % 628) / 100, 0));
            const s = 0.7 + ((h >> 7) % 60) / 100;
            m.compose(pos.set(jx, 0.09 * s, jz), quat, scl.set(s, s, s));
            tuftMats.push(m.clone());
          }
        }
      }
      addInstanced(new THREE.IcosahedronGeometry(0.62, 0), pal.rock, rockMats, true);
      addInstanced(new THREE.ConeGeometry(0.5, 1.7, 5), pal.pine, pineMats, true);
      addInstanced(new THREE.CylinderGeometry(0.08, 0.12, 0.55, 5), pal.trunk, trunkMats, false);
      addInstanced(new THREE.ConeGeometry(0.12, 0.2, 4), pal.tuft, tuftMats, false);
    }
  }

  // --- Stairs down: a real stairwell sinking into a dark shaft ---
  const stairGlows: THREE.PointLight[] = [];
  for (const marker of map.markers) {
    if (marker.ch !== ">") continue;
    const cx = Math.floor(marker.x);
    const cy = Math.floor(marker.y);
    // Steps descend away from the open approach side.
    const approaches = [
      { dx: 0, dy: 1, ry: 0 },
      { dx: 1, dy: 0, ry: Math.PI / 2 },
      { dx: 0, dy: -1, ry: Math.PI },
      { dx: -1, dy: 0, ry: -Math.PI / 2 },
    ];
    const open = approaches.find((a) => isWalkable(map, cx + a.dx, cy + a.dy)) ?? approaches[0]!;
    // The shaft: a lightless block below floor level so the well reads as depth.
    const shaft = new THREE.Mesh(
      new THREE.BoxGeometry(0.98, 1.4, 0.98),
      new THREE.MeshBasicMaterial({ color: 0x030308 }),
    );
    shaft.position.set(marker.x, -0.72, marker.y);
    scene.add(shaft);
    // The steps themselves, top tread flush with the floor.
    const stairs = placePiece(assets.dungeon.stairs, marker.x, marker.y, open.ry, FLOOR_SCALE);
    const bb = new THREE.Box3().setFromObject(stairs);
    stairs.position.y = -bb.max.y + 0.02;
    // A pale rim marks the mouth of the well…
    const rim = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.56, 4),
      new THREE.MeshBasicMaterial({ color: 0x7fb8c9, transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
    );
    rim.rotation.x = -Math.PI / 2;
    rim.rotation.z = Math.PI / 4;
    rim.position.set(marker.x, 0.05, marker.y);
    scene.add(rim);
    // …and a cold glow breathes up out of it.
    const glow = new THREE.PointLight(0x6fb0d9, 2.4, 4.5, 1.7);
    glow.position.set(marker.x, 0.55, marker.y);
    scene.add(glow);
    stairGlows.push(glow);
  }

  // --- Stairs up: stone steps climbing toward a warm daylight glow ---
  for (const marker of map.markers) {
    if (marker.ch !== "<") continue;
    const cx = Math.floor(marker.x);
    const cy = Math.floor(marker.y);
    // You walk in from the open side; the steps rise away from it.
    const approaches = [
      { dx: 0, dy: 1 },
      { dx: 1, dy: 0 },
      { dx: 0, dy: -1 },
      { dx: -1, dy: 0 },
    ];
    const open = approaches.find((a) => isWalkable(map, cx + a.dx, cy + a.dy)) ?? approaches[0]!;
    const rise = { x: -open.dx, y: -open.dy };
    const stepMat = flatMat(0x5c5768, 0.95);
    for (let s = 0; s < 4; s++) {
      const height = 0.14 + s * 0.16;
      const step = new THREE.Mesh(
        new THREE.BoxGeometry(rise.x !== 0 ? 0.24 : 0.78, height, rise.y !== 0 ? 0.24 : 0.78),
        stepMat,
      );
      const along = -0.33 + s * 0.22;
      step.position.set(marker.x + rise.x * along, height / 2, marker.y + rise.y * along);
      step.castShadow = true;
      step.receiveShadow = true;
      scene.add(step);
    }
    // A warm rim and glow: the way back toward the sky.
    const rim = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.56, 4),
      new THREE.MeshBasicMaterial({ color: 0xe8c27a, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
    );
    rim.rotation.x = -Math.PI / 2;
    rim.rotation.z = Math.PI / 4;
    rim.position.set(marker.x, 0.05, marker.y);
    scene.add(rim);
    // A shaft of daylight spilling down the well — tall enough to show over
    // the walls that box the stairs in, so the way out reads from anywhere.
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.4, 2.6, 8, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xf5dfa0,
        transparent: true,
        opacity: 0.15,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    beam.position.set(marker.x, 1.3, marker.y);
    scene.add(beam);
    const glow = new THREE.PointLight(0xf5c877, 3.4, 5.5, 1.7);
    glow.position.set(marker.x, 1.4, marker.y);
    scene.add(glow);
    stairGlows.push(glow);
  }

  const placePieceLater: (() => void)[] = [];

  // --- Travel pads: the waypoint's slowly turning arcane ring ---
  const PAD_COLORS: Record<string, number> = { W: 0xc9a84c };
  const padRings: THREE.Mesh[] = [];
  for (const marker of map.markers) {
    const color = PAD_COLORS[marker.ch];
    if (color === undefined) continue;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.35, 0.55, 6),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(marker.x, 0.08, marker.y);
    scene.add(ring);
    padRings.push(ring);
    const glow = new THREE.PointLight(color, 2.5, 5, 1.8);
    glow.position.set(marker.x, 0.8, marker.y);
    scene.add(glow);
  }

  // --- Market stall (town): crates and a barrel beside the V marker ---
  for (const marker of map.markers) {
    if (marker.ch !== "V") continue;
    placePieceLater.push(() => {
      placePiece(assets.dungeon.crates, marker.x + 0.9, marker.y + 0.3, 0.4, { x: 0.3, y: 0.3, z: 0.3 });
      placePiece(assets.dungeon.barrel, marker.x - 0.8, marker.y + 0.5, 0, { x: 0.3, y: 0.3, z: 0.3 });
      placePiece(assets.dungeon.chest, marker.x + 0.1, marker.y + 0.9, Math.PI, { x: 0.35, y: 0.35, z: 0.35 });
    });
  }
  // --- Candlelit shrine (town): a quiet glow beside the H marker ---
  for (const marker of map.markers) {
    if (marker.ch !== "H") continue;
    const shrineGlow = new THREE.PointLight(0xf5dfa0, 1.8, 4, 1.8);
    shrineGlow.position.set(marker.x, 1.1, marker.y);
    scene.add(shrineGlow);
  }
  for (const fn of placePieceLater) fn();

  // --- NPCs: one knight-model rig per entity, tinted so each reads apart ---
  const NPC_TINTS: Record<NpcId, number> = {
    maren: 0x8a5a2c, // camp trader — warm leather
    sera: 0xd8cfc0, // camp healer — pale cloth
    betha: 0x4a6a4a, // redfen hermit — moss green
    corvin: 0x5a5a6e, // gallowmire soldier — cold steel-blue
    aldous: 0xc9a84c, // barrow sentinel — gilded
  };
  const npcRigs = new Map<number, Rig>();
  for (const npc of npcs) {
    const rig = makeMonsterModelRig(assets, "__vendor__") as Rig;
    scene.add(rig.group);
    rig.group.position.set(npc.pos.x, 0, npc.pos.y);
    // Stable per-entity facing rather than one fixed pose for everyone.
    rig.group.rotation.y = (npc.id * 1.7) % (Math.PI * 2);
    const tint = new THREE.Color(NPC_TINTS[npc.npcId]);
    rig.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
        obj.material.color.lerp(tint, 0.4);
      }
    });
    npcRigs.set(npc.id, rig);
  }

  // --- NPC quest indicators: a floating icon showing what each NPC has for you ---
  const makeIndicatorTexture = (glyph: string, color: string): THREE.CanvasTexture => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.font = "bold 46px sans-serif";
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(glyph, 32, 34);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  };
  const NPC_INDICATOR_TEXTURES: Record<"offer" | "turnin" | "progress", THREE.CanvasTexture> = {
    offer: makeIndicatorTexture("!", "#f0c96a"),
    turnin: makeIndicatorTexture("?", "#f0c96a"),
    progress: makeIndicatorTexture("?", "#8f8778"),
  };
  const npcIndicatorSprites = new Map<number, THREE.Sprite>();
  for (const npc of npcs) {
    const material = new THREE.SpriteMaterial({
      map: NPC_INDICATOR_TEXTURES.offer,
      transparent: true,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(0.5, 0.5, 1);
    sprite.position.set(npc.pos.x, 1.8, npc.pos.y);
    sprite.visible = false;
    sprite.renderOrder = 10;
    scene.add(sprite);
    npcIndicatorSprites.set(npc.id, sprite);
  }

  // --- Gold piles ---
  const goldVisuals = new Map<number, THREE.Group>();
  const makeGoldPile = () => {
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const nug = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.06 + (i % 2) * 0.02, 0),
        new THREE.MeshStandardMaterial({
          color: 0xe8c34c,
          emissive: 0xb98a1c,
          emissiveIntensity: 0.7,
          roughness: 0.35,
        }),
      );
      nug.position.set((i - 1) * 0.09, 0.05 + (i % 2) * 0.04, ((i * 7) % 3 - 1) * 0.07);
      g.add(nug);
    }
    return g;
  };

  // --- Breakables: smashable barrels, crates, and the floor's treasure chest ---
  const breakableVisuals = new Map<number, THREE.Group>();
  const makeBreakable = (kind: string, id: number): THREE.Group => {
    const src =
      kind === "barrel"
        ? assets.dungeon.barrel
        : kind === "crate"
          ? assets.dungeon.crates
          : assets.dungeon.chest_gold;
    const g = src.clone(true);
    g.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
        // Own materials, so hover tints don't bleed across every barrel.
        if (obj.material instanceof THREE.Material) obj.material = obj.material.clone();
      }
    });
    const s = kind === "chest" ? 0.4 : 0.3;
    g.scale.setScalar(s);
    g.rotation.y = ((id * 47) % 8) * (Math.PI / 4);
    return g;
  };

  // --- Torches: emissive flames, the first few carrying real light ---
  const torches: { flame: THREE.Mesh; light: THREE.PointLight | null; seed: number }[] = [];
  for (let i = 0; i < torchSpots.length && i < 14; i++) {
    const spot = torchSpots[i]!;
    // Mounted sconce on the wall face, flame burning above it
    const sconce = assets.dungeon.torch_mounted.clone(true);
    sconce.position.set(spot.x, 0.75, spot.fy + 0.02);
    sconce.scale.setScalar(0.5);
    scene.add(sconce);
    const flame = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.09, 0),
      new THREE.MeshStandardMaterial({
        color: 0xffb35c,
        emissive: 0xff9030,
        emissiveIntensity: 2.2,
      }),
    );
    flame.position.set(spot.x, 1.15, spot.fy + 0.08);
    scene.add(flame);
    const light =
      i < 8 ? new THREE.PointLight(0xff9a45, 3.2, 6.5, 1.8) : null;
    if (light) {
      light.position.set(spot.x, 1.2, spot.fy + 0.25);
      scene.add(light);
    }
    torches.push({ flame, light, seed: (i * 37) % 100 });
  }

  // --- Campfire (camp): stones, crossed logs, and a breathing flame ---
  for (const marker of map.markers) {
    if (marker.ch !== "F") continue;
    const fire = new THREE.Group();
    fire.position.set(marker.x, 0, marker.y);
    const stoneMat = flatMat(0x55524e, 1);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const stone = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09 + (i % 3) * 0.02, 0), stoneMat);
      stone.position.set(Math.cos(a) * 0.42, 0.05, Math.sin(a) * 0.42);
      stone.castShadow = true;
      fire.add(stone);
    }
    const logMat = flatMat(0x3d2c1c, 1);
    for (let i = 0; i < 3; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.55, 5), logMat);
      log.rotation.set(Math.PI / 2 - 0.5, 0, (i / 3) * Math.PI * 2);
      log.position.y = 0.12;
      log.castShadow = true;
      fire.add(log);
    }
    const flame = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.16, 0),
      new THREE.MeshStandardMaterial({ color: 0xffb35c, emissive: 0xff8c28, emissiveIntensity: 2.4 }),
    );
    flame.position.y = 0.32;
    fire.add(flame);
    scene.add(fire);
    const light = new THREE.PointLight(0xff9a45, 5, 8, 1.7);
    light.position.set(marker.x, 1.1, marker.y);
    scene.add(light);
    // Riding the torch flicker keeps the fire breathing with everything else.
    torches.push({ flame, light, seed: 43 });
  }

  // --- Heroes: one animated KayKit barbarian per player standing in this zone ---
  interface HeroEntry {
    rig: HeroModelRig;
    /** Renderer-side displacement for lunges; sim position stays authoritative. */
    fxOffset: THREE.Vector3;
    phase: number;
    lastPos: { x: number; y: number } | null;
    equipSignature: string;
    targetYaw: number;
    wasDead: boolean;
    /** "P2" over the head — remote party members only. */
    nameplate: HTMLDivElement | null;
  }
  const heroes = new Map<PlayerId, HeroEntry>();

  /** Blend a rig's materials toward a seat colour so party members read apart. */
  const tintRig = (root: THREE.Object3D, color: number, amount: number) => {
    const target = new THREE.Color(color);
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
        obj.material.color.lerp(target, amount);
      }
    });
  };

  const makeHero = (id: PlayerId): HeroEntry => {
    const rig = makeHeroModelRig(assets);
    scene.add(rig.group);
    let plate: HTMLDivElement | null = null;
    if (id !== localId()) {
      // Remote heroes wear their seat colour; the local one keeps its own look.
      tintRig(rig.group, playerTint(id), 0.4);
      plate = document.createElement("div");
      plate.textContent = `P${id + 1}`;
      plate.style.cssText = `position:absolute;color:${playerCss(id)};font-size:11.5px;font-weight:700;letter-spacing:1px;transform:translate(-50%,-100%);text-shadow:0 1px 3px #000;`;
      overlay.appendChild(plate);
    }
    const entry: HeroEntry = {
      rig,
      fxOffset: new THREE.Vector3(),
      phase: 0,
      lastPos: null,
      equipSignature: "",
      targetYaw: 0,
      wasDead: false,
      nameplate: plate,
    };
    heroes.set(id, entry);
    return entry;
  };

  const dropHero = (id: PlayerId) => {
    const entry = heroes.get(id);
    if (!entry) return;
    scene.remove(entry.rig.group);
    entry.nameplate?.remove();
    heroes.delete(id);
  };

  /** The rig a player-scoped event should play on, if that player is on screen. */
  const heroOf = (id: PlayerId): HeroEntry | undefined => heroes.get(id);

  // --- Ground items ---
  const RARITY_COLORS: Record<string, { hex: number; css: string }> = {
    normal: { hex: 0xbdbdbd, css: "#d6d6d6" },
    magic: { hex: 0x5f7fe8, css: "#8ba3f5" },
    rare: { hex: 0xe8d95f, css: "#f0e68c" },
    unique: { hex: 0xc9884c, css: "#d9a05c" },
  };
  const groundItemVisuals = new Map<number, { mesh: THREE.Mesh; label: HTMLDivElement }>();

  // --- Monsters & corpses ---
  const monsterRigs = new Map<number, Rig>();
  const monsterFxOffsets = new Map<number, THREE.Vector3>();
  const monsterAnim = new Map<number, { phase: number; last: { x: number; y: number } }>();
  // Per-monster tick interpolation and eased facing.
  const monsterLerp = new Map<number, { px: number; py: number; cx: number; cy: number; yaw: number }>();
  let lastSimTick = -1;
  let lastFrameNow = performance.now();

  /** Ease an angle toward a target along the shortest arc. */
  const approachAngle = (current: number, target: number, maxStep: number): number => {
    let delta = target - current;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    if (Math.abs(delta) <= maxStep) return target;
    return current + Math.sign(delta) * maxStep;
  };
  const healthBars = new Map<number, { wrap: HTMLDivElement; fill: HTMLDivElement }>();

  // --- Hover tooltip: name + what it is, following the cursor ---
  // Static area indicators (stairs, pads, gates) share the tooltip via cursor proximity.
  const AREA_INFO: Record<string, { name: string; role: string }> = {
    ">": { name: "Stairwell", role: "Descends deeper into the barrow" },
    "<": { name: "Stairs Up", role: "Climbs back toward daylight" },
    F: { name: "Campfire", role: "The heart of the camp" },
  };
  const areaIndicators = map.markers
    .filter((m) => m.ch in AREA_INFO)
    .map((m) => ({ pos: { x: m.x, y: m.y }, ...AREA_INFO[m.ch]! }));
  const tooltip = document.createElement("div");
  tooltip.style.cssText =
    "position:absolute;display:none;transform:translate(-50%,-130%);background:rgba(8,8,10,.82);padding:3px 8px;white-space:nowrap;text-align:center;text-shadow:0 1px 2px #000;border:1px solid rgba(200,190,160,.25);";
  const tooltipName = document.createElement("div");
  tooltipName.style.cssText = "color:#e8dfc8;font-size:12px;";
  const tooltipRole = document.createElement("div");
  tooltipRole.style.cssText = "color:#9a917c;font-size:10.5px;";
  tooltip.append(tooltipName, tooltipRole);
  overlay.appendChild(tooltip);

  // --- Hover highlight: brighten the rig under the cursor ---
  // Keyed by kind:id — monster 3 and portal 3 are different things.
  let hoveredKey: string | null = null;
  const hoverTint = (root: THREE.Object3D | undefined, on: boolean) => {
    root?.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
        const mat = obj.material;
        if (on) {
          if (mat.userData.baseColor === undefined) mat.userData.baseColor = mat.color.getHex();
          mat.color.setHex(mat.userData.baseColor).multiplyScalar(1.45);
        } else if (mat.userData.baseColor !== undefined) {
          mat.color.setHex(mat.userData.baseColor);
        }
      }
    });
  };
  const corpseMeshes: THREE.Mesh[] = [];
  let corpseCount = 0;
  const corpseMatByType: Record<string, THREE.MeshStandardMaterial> = {
    skitter: flatMat(0x3d1d1d),
    shambler: flatMat(0x2c3327),
    gravespit: flatMat(0x352b40),
    tomb_bloat: flatMat(0x4a4028),
    barrow_lord: flatMat(0x272a38),
  };

  // --- Town portals: a flat glowing ring you can step into ---
  const portalVisuals = new Map<number, THREE.Group>();
  const makePortalMesh = (): THREE.Group => {
    const g = new THREE.Group();
    const torus = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.08, 6, 18),
      new THREE.MeshStandardMaterial({
        color: 0x7fb8c9,
        emissive: 0x4f9ab0,
        emissiveIntensity: 1.6,
        roughness: 0.4,
        flatShading: true,
      }),
    );
    torus.rotation.x = -Math.PI / 2;
    torus.position.y = 0.12;
    g.add(torus);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 18),
      new THREE.MeshBasicMaterial({
        color: 0x7fb8c9,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide,
      }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.1;
    g.add(disc);
    const light = new THREE.PointLight(0x7fb8c9, 2.6, 5, 1.8);
    light.position.y = 0.8;
    g.add(light);
    return g;
  };

  // --- Player corpses: the owner's hero, face down, still wearing their gear ---
  const playerCorpseVisuals = new Map<number, { rig: HeroModelRig; group: THREE.Group }>();

  // --- Expanding ground rings (explosions, cleave arcs, warcry) ---
  const ring = (pos: Vec, radius: number, color: number, dur = 400) => {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.7, 1, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(pos.x, 0.1, pos.y);
    scene.add(mesh);
    fx.tween(
      dur,
      (t) => {
        const s = 0.2 + t * radius;
        mesh.scale.set(s, 1, s);
        (mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - t);
      },
      () => {
        scene.remove(mesh);
        (mesh.material as THREE.Material).dispose();
      },
    );
  };

  // --- Picking ---
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();
  const facing = new THREE.Vector3(0, 0, 1);
  const proj = new THREE.Vector3();

  const setNdc = (clientX: number, clientY: number) => {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
  };

  const worldToScreen = (pos: Vec, height: number): { x: number; y: number } => {
    proj.set(pos.x, height, pos.y).project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    return {
      x: ((proj.x + 1) / 2) * rect.width,
      y: ((1 - proj.y) / 2) * rect.height,
    };
  };

  return {
    render(state, prevPositions, alpha) {
      const me = localPlayer(state);
      const frameDt = Math.min(0.1, (performance.now() - lastFrameNow) / 1000);
      lastFrameNow = performance.now();
      const frameNow = performance.now();

      // Retire rigs for players who left the game or walked into another zone.
      for (const id of [...heroes.keys()]) {
        const p = state.players.get(id);
        if (!p || p.zoneId !== me.zoneId) dropHero(id);
      }

      let px = me.pos.x;
      let py = me.pos.y;
      for (const p of allPlayers(state)) {
        if (p.zoneId !== me.zoneId) continue;
        const entry = heroes.get(p.id) ?? makeHero(p.id);
        // A player who just arrived (or teleported) has no meaningful previous
        // position — snap rather than sliding across the whole map.
        const prev = prevPositions.get(p.id) ?? p.pos;
        const jumped = Math.hypot(p.pos.x - prev.x, p.pos.y - prev.y) > 1;
        const from = jumped ? p.pos : prev;
        const x = from.x + (p.pos.x - from.x) * alpha;
        const y = from.y + (p.pos.y - from.y) * alpha;
        const group = entry.rig.group;
        // Mid-leap the sim slides the player level with the ground; the arc is ours.
        let airY = 0;
        if (p.leap) {
          const total = Math.hypot(p.leap.to.x - p.leap.from.x, p.leap.to.y - p.leap.from.y);
          if (total > 1e-6) {
            const t = Math.min(1, Math.hypot(x - p.leap.from.x, y - p.leap.from.y) / total);
            const peak = Math.min(2.2, 0.6 + 0.18 * total);
            airY = peak * 4 * t * (1 - t);
          }
        }
        group.position.set(x + entry.fxOffset.x, airY, y + entry.fxOffset.z);

        const dx = p.pos.x - from.x;
        const dy = p.pos.y - from.y;
        if (dx * dx + dy * dy > 1e-6) {
          facing.set(dx, 0, dy).normalize();
          entry.targetYaw = Math.atan2(facing.x, facing.z);
        }
        group.rotation.y = approachAngle(group.rotation.y, entry.targetYaw, frameDt * 14);
        // Death and revival play through animation clips, not a rotation hack.
        if (p.dead && !entry.wasDead) {
          entry.rig.oneShot("Death_A", { hold: true });
        } else if (!p.dead && entry.wasDead) {
          entry.rig.release();
        }
        entry.wasDead = p.dead;

        // Rebuild visible gear when equipment changes.
        const eq = p.equipment;
        const signature = [eq.weapon, eq.helm, eq.chest, eq.boots]
          .map((it) => (it ? `${it.baseId}:${it.rarity}` : "-"))
          .join("|");
        if (signature !== entry.equipSignature) {
          entry.equipSignature = signature;
          entry.rig.setEquipment(eq);
        }

        // Drive the walk cycle from actual movement so feet never slide.
        if (entry.lastPos) {
          const step = Math.hypot(x - entry.lastPos.x, y - entry.lastPos.y);
          entry.phase += step * 7;
          entry.rig.animate(frameNow, entry.phase, step * 60);
        }
        entry.lastPos = { x, y };

        if (entry.nameplate) {
          const at = worldToScreen({ x, y }, 1.9);
          entry.nameplate.style.left = `${at.x}px`;
          entry.nameplate.style.top = `${at.y}px`;
        }
        if (p.id === localId()) {
          px = x;
          py = y;
        }
      }
      heroLight.position.set(px, 1.6, py);
      if (outdoor) applyAtmosphere(px);

      // Sync monster rigs with sim state. Only the hero's neighborhood keeps a
      // skinned rig — the surface holds hundreds of monsters at once — and the
      // drop radius trails the create radius so pacing a border doesn't churn.
      for (const [id, rig] of monsterRigs) {
        const monster = zoneOf(state, me).monsters.get(id);
        if (!monster || Math.hypot(monster.pos.x - me.pos.x, monster.pos.y - me.pos.y) > 32) {
          scene.remove(rig.group);
          monsterRigs.delete(id);
          monsterAnim.delete(id);
          monsterLerp.delete(id);
        }
      }
      const tickAdvanced = state.tick !== lastSimTick;
      lastSimTick = state.tick;
      for (const monster of zoneOf(state, me).monsters.values()) {
        let rig = monsterRigs.get(monster.id);
        if (!rig) {
          if (Math.hypot(monster.pos.x - me.pos.x, monster.pos.y - me.pos.y) > 28) continue;
          rig = makeMonsterModelRig(assets, monster.typeId);
          monsterRigs.set(monster.id, rig);
          monsterAnim.set(monster.id, { phase: monster.id * 3.7, last: { ...monster.pos } });
          monsterLerp.set(monster.id, {
            px: monster.pos.x,
            py: monster.pos.y,
            cx: monster.pos.x,
            cy: monster.pos.y,
            yaw: 0,
          });
          scene.add(rig.group);
        }
        const lerp = monsterLerp.get(monster.id)!;
        if (tickAdvanced) {
          lerp.px = lerp.cx;
          lerp.py = lerp.cy;
          lerp.cx = monster.pos.x;
          lerp.cy = monster.pos.y;
        }
        const mx = lerp.px + (lerp.cx - lerp.px) * alpha;
        const my = lerp.py + (lerp.cy - lerp.py) * alpha;
        const off = monsterFxOffsets.get(monster.id);
        rig.group.position.set(mx + (off?.x ?? 0), 0, my + (off?.z ?? 0));
        // Face travel when actually covering ground; otherwise square up to the player.
        const vx = lerp.cx - lerp.px;
        const vy = lerp.cy - lerp.py;
        const tickDist = Math.hypot(vx, vy); // cells per sim tick — stable between ticks
        if (tickDist > 0.02) {
          lerp.yaw = Math.atan2(vx, vy);
        } else if (monster.ai === "chasing") {
          lerp.yaw = Math.atan2(me.pos.x - monster.pos.x, me.pos.y - monster.pos.y);
        }
        rig.group.rotation.y = approachAngle(rig.group.rotation.y, lerp.yaw, frameDt * 9);
        const anim = monsterAnim.get(monster.id)!;
        // Speed derived from the tick delta stays constant across render frames,
        // so the walk cycle never flickers to idle between sim ticks.
        anim.phase += tickDist * 8 * frameDt * 25;
        rig.animate(frameNow, anim.phase, tickDist * 25);

        // Overhead health bar once wounded
        if (monster.life < monster.maxLife) {
          let bar = healthBars.get(monster.id);
          if (!bar) {
            const wrap = document.createElement("div");
            const boss = monster.typeId === "barrow_lord";
            wrap.style.cssText = `position:absolute;width:${boss ? 60 : 34}px;height:4px;background:rgba(10,8,10,.85);border:1px solid #000;transform:translate(-50%,-50%);`;
            const fill = document.createElement("div");
            fill.style.cssText = "height:100%;background:linear-gradient(to right,#8a1e1e,#c04040);width:100%;";
            wrap.appendChild(fill);
            overlay.appendChild(wrap);
            bar = { wrap, fill };
            healthBars.set(monster.id, bar);
          }
          const height = monster.typeId === "barrow_lord" ? 2.2 : 1.25;
          const at = worldToScreen({ x: mx, y: my }, height);
          bar.wrap.style.left = `${at.x}px`;
          bar.wrap.style.top = `${at.y}px`;
          bar.fill.style.width = `${Math.max(0, (monster.life / monster.maxLife) * 100)}%`;
        }
      }
      for (const [id, bar] of healthBars) {
        // A bar outlives its rig when the monster wanders out of the window;
        // drop it too, or it freezes at the last screen position it had.
        if (!zoneOf(state, me).monsters.has(id) || !monsterRigs.has(id)) {
          bar.wrap.remove();
          healthBars.delete(id);
        }
      }

      // Sync ground items
      for (const [id, v] of groundItemVisuals) {
        if (!zoneOf(state, me).groundItems.has(id)) {
          scene.remove(v.mesh);
          v.label.remove();
          groundItemVisuals.delete(id);
        }
      }
      for (const gi of zoneOf(state, me).groundItems.values()) {
        let v = groundItemVisuals.get(gi.id);
        if (!v) {
          const colors = RARITY_COLORS[gi.item.rarity]!;
          const potion = potionKind(gi.item.baseId);
          const POTION_TINT = {
            health: { color: 0xc93a3a, emissive: 0xa02828 },
            mana: { color: 0x3a55c9, emissive: 0x2838a0 },
          } as const;
          const mesh = new THREE.Mesh(
            potion
              ? new THREE.IcosahedronGeometry(0.11, 0)
              : new THREE.OctahedronGeometry(0.14, 0),
            new THREE.MeshStandardMaterial({
              color: potion ? POTION_TINT[potion].color : colors.hex,
              emissive: potion ? POTION_TINT[potion].emissive : colors.hex,
              emissiveIntensity: potion ? 0.8 : 0.55,
              roughness: 0.4,
              flatShading: true,
            }),
          );
          mesh.position.set(gi.pos.x, 0.16, gi.pos.y);
          scene.add(mesh);
          const label = document.createElement("div");
          label.textContent = gi.item.name;
          label.style.cssText = `position:absolute;color:${colors.css};font-size:11.5px;transform:translate(-50%,-100%);background:rgba(8,8,10,.72);padding:1px 5px;white-space:nowrap;text-shadow:0 1px 2px #000;pointer-events:auto;cursor:pointer;`;
          const id = gi.id;
          label.addEventListener("pointerdown", (e) => {
            e.stopPropagation();
            onItemClick?.(id);
          });
          overlay.appendChild(label);
          v = { mesh, label };
          groundItemVisuals.set(gi.id, v);
        }
        v.mesh.rotation.y = performance.now() / 900;
        const at = worldToScreen(gi.pos, 0.6);
        v.label.style.left = `${at.x}px`;
        v.label.style.top = `${at.y}px`;
      }

      // Sync breakables (smash effects remove theirs via the broken event)
      for (const [id, g] of breakableVisuals) {
        if (!zoneOf(state, me).breakables.has(id)) {
          scene.remove(g);
          breakableVisuals.delete(id);
        }
      }
      for (const b of zoneOf(state, me).breakables.values()) {
        if (!breakableVisuals.has(b.id)) {
          const g = makeBreakable(b.kind, b.id);
          g.position.set(b.pos.x, 0, b.pos.y);
          scene.add(g);
          breakableVisuals.set(b.id, g);
        }
      }

      // Sync gold piles
      for (const [id, g] of goldVisuals) {
        if (!zoneOf(state, me).goldPiles.has(id)) {
          scene.remove(g);
          goldVisuals.delete(id);
        }
      }
      for (const pile of zoneOf(state, me).goldPiles.values()) {
        if (!goldVisuals.has(pile.id)) {
          const g = makeGoldPile();
          g.position.set(pile.pos.x, 0, pile.pos.y);
          scene.add(g);
          goldVisuals.set(pile.id, g);
        }
      }

      // Sync cast portals — both ends of a pair live in their own zone
      for (const [id, g] of portalVisuals) {
        if (!zoneOf(state, me).portals.has(id)) {
          scene.remove(g);
          portalVisuals.delete(id);
        }
      }
      for (const portal of zoneOf(state, me).portals.values()) {
        let g = portalVisuals.get(portal.id);
        if (!g) {
          g = makePortalMesh();
          g.position.set(portal.pos.x, 0, portal.pos.y);
          scene.add(g);
          portalVisuals.set(portal.id, g);
        }
        g.rotation.y = frameNow / 1600;
      }

      // Sync player corpses — a hero lying where they fell, gear and all
      for (const [id, v] of playerCorpseVisuals) {
        if (!zoneOf(state, me).playerCorpses.has(id)) {
          scene.remove(v.group);
          playerCorpseVisuals.delete(id);
        }
      }
      for (const pc of zoneOf(state, me).playerCorpses.values()) {
        let v = playerCorpseVisuals.get(pc.id);
        if (!v) {
          const rig = makeHeroModelRig(assets);
          rig.setEquipment(pc.equipment);
          tintRig(rig.group, playerTint(pc.playerId), 0.4);
          // The death clip ends face down; hold it so the body just lies there.
          rig.oneShot("Death_A", { hold: true });
          rig.group.position.set(pc.pos.x, 0, pc.pos.y);
          rig.group.rotation.y = (pc.id * 1.7) % (Math.PI * 2);
          scene.add(rig.group);
          v = { rig, group: rig.group };
          playerCorpseVisuals.set(pc.id, v);
        }
        v.rig.animate(frameNow, 0, 0);
      }

      // Town dressing: the portal ring turns, the NPCs idle
      for (const [i, ring] of padRings.entries()) ring.rotation.z = performance.now() / 1400 + i;
      for (const rig of npcRigs.values()) rig.animate(frameNow, 0, 0);

      // NPC quest indicators: swap the overhead icon to match this player's
      // standing with each NPC (cheap per-frame work — visibility + texture).
      for (const npc of npcs) {
        const sprite = npcIndicatorSprites.get(npc.id);
        if (!sprite) continue;
        const indicator = npcIndicator(me, npc.npcId);
        sprite.visible = indicator !== null;
        if (indicator !== null) {
          (sprite.material as THREE.SpriteMaterial).map = NPC_INDICATOR_TEXTURES[indicator];
        }
      }

      // Corpses: a run reset empties the sim's list — clear our meshes too
      if (zoneOf(state, me).corpses.length < corpseCount) {
        for (const mesh of corpseMeshes) scene.remove(mesh);
        corpseMeshes.length = 0;
        corpseCount = 0;
      }
      // Corpses: add newly dead
      while (corpseCount < zoneOf(state, me).corpses.length) {
        const c = zoneOf(state, me).corpses[corpseCount++]!;
        const mat = corpseMatByType[c.typeId] ?? flatMat(0x2a2a2a);
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.4), mat);
        mesh.position.set(c.pos.x, 0.04, c.pos.y);
        mesh.rotation.y = (c.pos.x * 7 + c.pos.y * 3) % Math.PI;
        mesh.receiveShadow = true;
        scene.add(mesh);
        corpseMeshes.push(mesh);
        if (corpseMeshes.length > 40) scene.remove(corpseMeshes.shift()!);
      }

      // Torch flicker
      const now = performance.now();
      for (const glow of stairGlows) {
        glow.intensity = 2.2 + Math.sin(now / 650) * 0.7;
      }
      for (const torch of torches) {
        const flicker =
          0.8 +
          0.25 * Math.sin(now / 90 + torch.seed) +
          0.12 * Math.sin(now / 41 + torch.seed * 3);
        torch.flame.scale.setScalar(0.85 + flicker * 0.25);
        if (torch.light) torch.light.intensity = 2.6 * flicker + 0.8;
      }

      const shakeOff = fx.update();
      camera.position.set(px + camOffset.x + shakeOff.x, camOffset.y, py + camOffset.z + shakeOff.z);
      camera.lookAt(px, 0, py);
      moon.target.position.set(px, 0, py);
      moon.position.set(px + 18, 30, py + 8);

      renderer.render(scene, camera);
    },

    pick(state, clientX, clientY) {
      setNdc(clientX, clientY);
      raycaster.setFromCamera(ndc, camera);
      const targets: THREE.Object3D[] = [];
      for (const rig of monsterRigs.values()) targets.push(rig.group);
      const hits = raycaster.intersectObjects(targets, true);
      if (hits.length > 0) {
        let obj: THREE.Object3D | null = hits[0]!.object;
        while (obj && obj.parent !== scene) obj = obj.parent;
        for (const [id, rig] of monsterRigs) {
          if (rig.group === obj) return { kind: "monster", id };
        }
      }
      const zone = zoneOf(state, localPlayer(state));
      const portalHits = raycaster.intersectObjects([...portalVisuals.values()], true);
      if (portalHits.length > 0) {
        let obj: THREE.Object3D | null = portalHits[0]!.object;
        while (obj && obj.parent !== scene) obj = obj.parent;
        for (const [id, g] of portalVisuals) {
          if (g === obj) return { kind: "portal", id };
        }
      }
      const pcHits = raycaster.intersectObjects(
        [...playerCorpseVisuals.values()].map((v) => v.group),
        true,
      );
      if (pcHits.length > 0) {
        let obj: THREE.Object3D | null = pcHits[0]!.object;
        while (obj && obj.parent !== scene) obj = obj.parent;
        for (const [id, v] of playerCorpseVisuals) {
          if (v.group === obj) return { kind: "corpse", id };
        }
      }
      const npcHits = raycaster.intersectObjects([...npcRigs.values()].map((r) => r.group), true);
      if (npcHits.length > 0) {
        let obj: THREE.Object3D | null = npcHits[0]!.object;
        while (obj && obj.parent !== scene) obj = obj.parent;
        for (const [id, rig] of npcRigs) {
          if (rig.group === obj) return { kind: "npc", id };
        }
      }
      const itemMeshes: THREE.Object3D[] = [];
      for (const v of groundItemVisuals.values()) itemMeshes.push(v.mesh);
      const itemHits = raycaster.intersectObjects(itemMeshes, false);
      if (itemHits.length > 0) {
        for (const [id, v] of groundItemVisuals) {
          if (v.mesh === itemHits[0]!.object) return { kind: "item", id };
        }
      }
      const breakableGroups: THREE.Object3D[] = [];
      for (const g of breakableVisuals.values()) breakableGroups.push(g);
      const breakableHits = raycaster.intersectObjects(breakableGroups, true);
      if (breakableHits.length > 0) {
        let obj: THREE.Object3D | null = breakableHits[0]!.object;
        while (obj && obj.parent !== scene) obj = obj.parent;
        for (const [id, g] of breakableVisuals) {
          if (g === obj) return { kind: "breakable", id };
        }
      }
      // Nothing hit dead-on. Forgiving fallback: one shared pool of nearby
      // interactables, nearest normalized screen distance wins — so a monster
      // never steals a click that lands closer to loot, a portal, or a pad.
      {
        const rect = renderer.domElement.getBoundingClientRect();
        const cx = clientX - rect.left;
        const cy = clientY - rect.top;
        let best: PickResult = null;
        let bestScore = 1;
        const consider = (result: PickResult, pos: Vec, height: number, radius: number) => {
          const at = worldToScreen(pos, height);
          const score = Math.hypot(at.x - cx, at.y - cy) / radius;
          if (score < bestScore) {
            bestScore = score;
            best = result;
          }
        };
        for (const [id] of monsterRigs) {
          const monster = zone.monsters.get(id);
          if (monster) consider({ kind: "monster", id }, monster.pos, 0.55, 30);
        }
        // Small standing figures are easy to miss with a precise raycast.
        for (const [id] of npcRigs) {
          const npc = zone.npcs.get(id);
          if (npc) consider({ kind: "npc", id }, npc.pos, 0.9, 30);
        }
        for (const portal of zone.portals.values()) {
          consider({ kind: "portal", id: portal.id }, portal.pos, 0.3, 26);
        }
        for (const pc of zone.playerCorpses.values()) {
          consider({ kind: "corpse", id: pc.id }, pc.pos, 0.2, 24);
        }
        for (const gi of zone.groundItems.values()) {
          consider({ kind: "item", id: gi.id }, gi.pos, 0.2, 24);
        }
        for (const marker of zone.map.markers) {
          if (marker.ch !== "W") continue;
          const pos = { x: marker.x, y: marker.y };
          consider({ kind: "waypoint", pos }, pos, 0.1, 26);
        }
        if (best) return best;
      }
      if (!raycaster.ray.intersectPlane(groundPlane, hit)) return null;
      // The waypoint ring lies flat on the ground — claim clicks landing on it.
      for (const marker of zone.map.markers) {
        if (marker.ch !== "W") continue;
        if (Math.hypot(hit.x - marker.x, hit.z - marker.y) < 1.2) {
          return { kind: "waypoint", pos: { x: marker.x, y: marker.y } };
        }
      }
      return { kind: "ground", world: { x: hit.x, y: hit.z } };
    },

    addExplosion(pos, radius) {
      ring(pos, radius, 0xe8a44c);
      fx.burst(pos.x, 0.4, pos.y, 0xe8a44c, 14, 3.4);
      fx.shake(0.3);
    },

    updateHover(state, clientX, clientY) {
      const picked = this.pick(state, clientX, clientY);
      const HIGHLIGHT = ["monster", "breakable", "portal", "corpse", "npc"];
      const key =
        picked && HIGHLIGHT.includes(picked.kind) && "id" in picked
          ? `${picked.kind}:${picked.id}`
          : null;
      const tintable = (k: string | null): THREE.Object3D | undefined => {
        if (!k) return undefined;
        const [kind, raw] = k.split(":");
        const id = Number(raw);
        if (kind === "monster") return monsterRigs.get(id)?.group;
        if (kind === "breakable") return breakableVisuals.get(id);
        if (kind === "portal") return portalVisuals.get(id);
        if (kind === "npc") return npcRigs.get(id)?.group;
        return playerCorpseVisuals.get(id)?.group;
      };
      if (key !== hoveredKey) {
        hoverTint(tintable(hoveredKey), false);
        hoverTint(tintable(key), true);
        hoveredKey = key;
      }
      renderer.domElement.style.cursor =
        picked && picked.kind !== "ground" ? "pointer" : "default";

      const rect = renderer.domElement.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      let tip: { name: string; role: string } | null = null;
      if (picked?.kind === "npc") {
        const npc = zoneOf(state, localPlayer(state)).npcs.get(picked.id);
        const def = npc && NPCS[npc.npcId];
        if (def) tip = { name: def.name, role: def.title };
      } else if (picked?.kind === "monster") {
        const m = zoneOf(state, localPlayer(state)).monsters.get(picked.id);
        const type = m && MONSTER_TYPES[m.typeId];
        if (m && type) tip = { name: type.name, role: `Monster — level ${m.mlvl}` };
      } else if (picked?.kind === "portal") {
        const portal = zoneOf(state, localPlayer(state)).portals.get(picked.id);
        if (portal) tip = { name: "Town Portal", role: `To ${locationTitle(portal.link.zone, portal.link.pos)}` };
      } else if (!picked || picked.kind === "ground") {
        // Stairs, pads, and gates are flat rings — match by cursor proximity.
        let bestD = 22; // px
        for (const ind of areaIndicators) {
          const at = worldToScreen(ind.pos, 0.3);
          const d = Math.hypot(at.x - px, at.y - py);
          if (d < bestD) {
            bestD = d;
            tip = ind;
          }
        }
        for (const pile of zoneOf(state, localPlayer(state)).goldPiles.values()) {
          const at = worldToScreen(pile.pos, 0.25);
          const d = Math.hypot(at.x - px, at.y - py);
          if (d < bestD) {
            bestD = d;
            tip = { name: `${pile.amount} gold`, role: "walk over to pick up" };
          }
        }
      }
      if (tip) {
        tooltipName.textContent = tip.name;
        tooltipRole.textContent = tip.role;
        tooltip.style.left = `${px}px`;
        tooltip.style.top = `${py}px`;
        tooltip.style.display = "block";
      } else {
        tooltip.style.display = "none";
      }
    },

    handleEvent(event, state) {
      // Nothing happening in another zone is ours to draw.
      if ("zone" in event && event.zone !== localPlayer(state).zoneId) return;
      switch (event.type) {
        case "monster_windup": {
          // The boss telegraphs: a taunt, a growing blood ring, a darkening body.
          const rig = monsterRigs.get(event.id) as (Rig & Partial<ModelRig>) | undefined;
          rig?.oneShot?.("Taunt");
          if (rig) fx.flash(rig.group, 0x7a1010, event.ticks * 40);
          ring(event.pos, 2.0, 0xc03030, event.ticks * 40);
          break;
        }
        case "player_swing": {
          const entry = heroOf(event.playerId);
          const swinger = state.players.get(event.playerId);
          if (!entry || !swinger) break;
          const dx = event.to.x - swinger.pos.x;
          const dy = event.to.y - swinger.pos.y;
          if (dx * dx + dy * dy > 1e-6) entry.targetYaw = Math.atan2(dx, dy);
          const len = Math.hypot(dx, dy) || 1;
          entry.rig.oneShot(entry.rig.attackClip(), { timeScale: 1.6 });
          fx.tween(200, (t) => {
            const lunge = Math.sin(Math.min(t / 0.6, 1) * Math.PI) * 0.16;
            entry.fxOffset.set((dx / len) * lunge, 0, (dy / len) * lunge);
          }, () => entry.fxOffset.set(0, 0, 0));
          break;
        }
        case "monster_swing": {
          const swingRig = monsterRigs.get(event.id) as (Rig & Partial<ModelRig>) | undefined;
          const typeId = zoneOf(state, localPlayer(state)).monsters.get(event.id)?.typeId;
          if (typeId) swingRig?.oneShot?.(monsterAttackClip(typeId), { timeScale: 1.4 });
          if (event.ranged) {
            const glob = new THREE.Mesh(
              new THREE.IcosahedronGeometry(0.09, 0),
              new THREE.MeshStandardMaterial({
                color: 0x9be07a,
                emissive: 0x6fbf4a,
                emissiveIntensity: 2.0,
              }),
            );
            scene.add(glob);
            const from = { ...event.from };
            const to = { ...event.to };
            fx.tween(150, (t) => {
              glob.position.set(
                from.x + (to.x - from.x) * t,
                0.65 + Math.sin(t * Math.PI) * 0.35,
                from.y + (to.y - from.y) * t,
              );
            }, () => {
              scene.remove(glob);
              fx.burst(to.x, 0.5, to.y, 0x9be07a, 5, 1.6);
            });
          } else {
            const off = monsterFxOffsets.get(event.id) ?? new THREE.Vector3();
            monsterFxOffsets.set(event.id, off);
            const dx = event.to.x - event.from.x;
            const dy = event.to.y - event.from.y;
            const len = Math.hypot(dx, dy) || 1;
            fx.tween(160, (t) => {
              const lunge = Math.sin(t * Math.PI) * 0.28;
              off.set((dx / len) * lunge, 0, (dy / len) * lunge);
            }, () => off.set(0, 0, 0));
          }
          break;
        }
        case "monster_hit": {
          const mesh = monsterRigs.get(event.id)?.group;
          if (mesh) {
            fx.flash(mesh, 0xffffff);
            // Squash-pop around the rig's own base scale, not scale 1.
            const base = mesh.scale.x;
            fx.tween(120, (t) => {
              const s = 1 + Math.sin(t * Math.PI) * 0.14;
              mesh.scale.set(base * s, base * (2 - s), base * s);
            }, () => mesh.scale.setScalar(base));
          }
          fx.burst(event.pos.x, 0.55, event.pos.y, 0x8a2a2a, 6, 1.8);
          break;
        }
        case "player_hit": {
          const entry = heroOf(event.playerId);
          const victim = state.players.get(event.playerId);
          if (!entry || !victim) break;
          fx.flash(entry.rig.group, 0xc03030, 110);
          fx.burst(victim.pos.x, 0.7, victim.pos.y, 0xc03030, 5, 1.6);
          if (event.playerId === localId()) fx.shake(0.06);
          break;
        }
        case "monster_died": {
          const rig = monsterRigs.get(event.id) as (Rig & Partial<ModelRig>) | undefined;
          if (rig) {
            monsterRigs.delete(event.id);
            monsterAnim.delete(event.id);
            const mesh = rig.group;
            if (rig.oneShot) {
              // Play the death clip in place, keep the mixer running, then sink away.
              rig.oneShot("Death_A", { hold: true });
              const start = performance.now();
              fx.tween(1400, (t) => {
                rig.animate!(start + t * 1400, 0, 0);
                if (t > 0.7) mesh.position.y = -((t - 0.7) / 0.3) * 0.6;
              }, () => scene.remove(mesh));
            } else {
              const dir = ((event.id * 61) % 2) * 2 - 1;
              fx.tween(300, (t) => {
                mesh.rotation.z = dir * t * (Math.PI / 2);
                mesh.position.y = -t * 0.25;
                const s = 1 - t * 0.25;
                mesh.scale.set(s, s, s);
              }, () => scene.remove(mesh));
            }
          }
          monsterFxOffsets.delete(event.id);
          fx.burst(event.pos.x, 0.5, event.pos.y, 0x6a2a2a, 10, 2.6);
          break;
        }
        case "breakable_broken": {
          const g = breakableVisuals.get(event.id);
          breakableVisuals.delete(event.id);
          const woody = event.kind === "chest" ? 0xd9b04c : 0x8a6a3a;
          fx.burst(event.pos.x, 0.4, event.pos.y, woody, 12, 2.6);
          if (g) {
            const base = g.scale.x;
            fx.tween(180, (t) => {
              const s = base * (1 - t);
              g.scale.set(s * 1.3, s * 0.5, s * 1.3); // crushed flat as it vanishes
            }, () => scene.remove(g));
          }
          break;
        }
        case "skill_cast": {
          const casterEntry = heroOf(event.playerId);
          const caster = casterEntry?.rig;
          // Face the cast's aim point — the swing should never land behind you.
          const casterPos = state.players.get(event.playerId)?.pos;
          if (casterEntry && casterPos && event.at) {
            const dx = event.at.x - casterPos.x;
            const dy = event.at.y - casterPos.y;
            if (dx * dx + dy * dy > 1e-6) casterEntry.targetYaw = Math.atan2(dx, dy);
          }
          // Only the local hero's casts rattle the camera.
          const shake = (amount: number) => {
            if (event.playerId === localId()) fx.shake(amount);
          };
          if (event.skill === "cleave") {
            caster?.oneShot("2H_Melee_Attack_Spin", { timeScale: 1.5 });
            ring(event.pos, 1.8, 0xd9dde8, 240);
            shake(0.08);
          } else if (event.skill === "warcry") {
            caster?.oneShot("Cheer", { timeScale: 1.4 });
            ring(event.pos, 2.6, 0x6a9ad1, 500);
          } else if (event.skill === "leap") {
            // The leap's own motion spike must not cancel its jump clip.
            caster?.oneShot("Jump_Full_Short", { timeScale: 1.3, cancelOnMove: false });
            fx.burst(event.pos.x, 0.15, event.pos.y, 0x8a8478, 6, 1.6); // takeoff kick-up
          } else if (event.skill === "crush") {
            caster?.oneShot("2H_Melee_Attack_Chop", { timeScale: 1.5 });
            shake(0.12);
          } else if (event.skill === "stomp") {
            caster?.oneShot("2H_Melee_Attack_Slice", { timeScale: 1.4 });
            ring(event.pos, 2.2, 0xb5a582, 300);
            fx.burst(event.pos.x, 0.15, event.pos.y, 0x8a8478, 10, 2.2);
            shake(0.16);
          } else if (event.skill === "deathblow") {
            caster?.oneShot("2H_Melee_Attack_Chop", { timeScale: 1.7 });
            if (event.at) fx.burst(event.at.x, 0.5, event.at.y, 0xc03030, 14, 2.8);
            shake(0.2);
          } else if (event.skill === "fireball") {
            caster?.oneShot("Spellcast_Shoot", { timeScale: 1.4 });
            shake(0.08); // the blast itself arrives as an `exploded` event
          } else if (event.skill === "chainbolt") {
            caster?.oneShot("Spellcast_Shoot", { timeScale: 1.6 });
            ring(event.pos, 1.6, 0x9ad1f5, 220);
            shake(0.08);
          } else if (event.skill === "firebolt") {
            caster?.oneShot("Spellcast_Shoot", { timeScale: 1.5 });
            if (event.at) fx.burst(event.at.x, 0.4, event.at.y, 0xe08a3c, 12, 2.4);
            shake(0.06);
          } else if (event.skill === "frostnova") {
            caster?.oneShot("Spellcast_Shoot", { timeScale: 1.3 });
            ring(event.pos, 2.5, 0x9ad8e8, 320);
            shake(0.1);
          } else if (event.skill === "focus") {
            caster?.oneShot("Cheer", { timeScale: 1.4 });
            ring(event.pos, 2.2, 0xb08ad1, 500);
          } else if (event.skill === "blink") {
            caster?.oneShot("Spellcast_Shoot", { timeScale: 1.6, cancelOnMove: false });
            ring(event.pos, 1.4, 0xb08ad1, 240);
            fx.burst(event.pos.x, 0.15, event.pos.y, 0xb08ad1, 10, 2.0);
            shake(0.1);
          }
          break;
        }
        case "leap_land": {
          ring(event.pos, 1.6, 0x8a8478, 260);
          fx.burst(event.pos.x, 0.15, event.pos.y, 0x8a8478, 12, 2.4);
          if (event.playerId === localId()) fx.shake(0.18);
          break;
        }
      }
    },

    addDamageNumber(pos, text, color) {
      const at = worldToScreen(pos, 1.3);
      const el = document.createElement("div");
      el.textContent = text;
      el.style.cssText = `position:absolute;left:${at.x}px;top:${at.y}px;color:${color};font-size:15px;font-weight:700;text-shadow:0 1px 3px #000;transform:translate(-50%,-50%);transition:transform .7s ease-out,opacity .7s ease-out;opacity:1;`;
      overlay.appendChild(el);
      requestAnimationFrame(() => {
        el.style.transform = "translate(-50%,-190%)";
        el.style.opacity = "0";
      });
      setTimeout(() => el.remove(), 750);
    },

    dispose() {
      window.removeEventListener("resize", resize);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      mount.removeChild(overlay);
    },
  };
}
