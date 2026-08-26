import * as THREE from "three";
import { isWalkable, type Vec, type ZoneMap } from "../../sim/map";
import type { GameState, SimEvent } from "../../sim/state";
import { Effects } from "./fx";
import type { Rig } from "./rigs";
import {
  makeHeroModelRig,
  makeMonsterModelRig,
  monsterAttackClip,
  type ModelRig,
} from "./modelRigs";
import type { GameAssets } from "./models";

const VIEW_HEIGHT = 16; // world units visible vertically

export type PickResult =
  | { kind: "monster"; id: number }
  | { kind: "item"; id: number }
  | { kind: "breakable"; id: number }
  | { kind: "vendor" }
  | { kind: "ground"; world: Vec }
  | null;

export interface SceneHandle {
  /** Draw the current sim state; alpha ∈ [0,1] interpolates from the previous tick. */
  render(state: GameState, prevPlayerPos: Vec, alpha: number): void;
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
  onItemClick?: (id: number) => void,
): SceneHandle {
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
  scene.background = new THREE.Color(0x0a0a0c);
  scene.fog = new THREE.Fog(0x0a0a0c, 20, 40);
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
  scene.add(new THREE.AmbientLight(0x6a6a80, 0.5));
  const moon = new THREE.DirectionalLight(0xb8c4e0, 1.1);
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

  // --- Environment from the KayKit dungeon set: brick facades over dark cores ---
  const hash = (x: number, y: number) => (x * 73856093 ^ y * 19349663) >>> 0;
  const torchSpots: { x: number; y: number; fx: number; fy: number }[] = [];

  // Dark cores fill wall regions (occlusion + silhouette); facades add the brick.
  {
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
  // Stair cells get a real stairwell instead of a floor tile.
  const stairCells = new Set(
    map.markers.filter((m) => m.ch === ">").map((m) => `${Math.floor(m.x)},${Math.floor(m.y)}`),
  );
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

  const placePieceLater: (() => void)[] = [];

  // --- Portal pad (town): a slowly turning arcane ring ---
  let portalRing: THREE.Mesh | null = null;
  for (const marker of map.markers) {
    if (marker.ch !== "P") continue;
    portalRing = new THREE.Mesh(
      new THREE.RingGeometry(0.35, 0.55, 6),
      new THREE.MeshBasicMaterial({ color: 0x7fb8f5, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
    );
    portalRing.rotation.x = -Math.PI / 2;
    portalRing.position.set(marker.x, 0.08, marker.y);
    scene.add(portalRing);
    const glow = new THREE.PointLight(0x7fb8f5, 2.5, 5, 1.8);
    glow.position.set(marker.x, 0.8, marker.y);
    scene.add(glow);
  }

  // --- Vendor (town): a knight minding the stall ---
  let vendorRig: Rig | null = null;
  for (const marker of map.markers) {
    if (marker.ch !== "V") continue;
    vendorRig = makeMonsterModelRig(assets, "__vendor__") as Rig;
    scene.add(vendorRig.group);
    vendorRig.group.position.set(marker.x, 0, marker.y);
    vendorRig.group.rotation.y = Math.PI * 0.75;
    // A market stall: crates and a barrel beside the knight
    placePieceLater.push(() => {
      placePiece(assets.dungeon.crates, marker.x + 0.9, marker.y + 0.3, 0.4, { x: 0.3, y: 0.3, z: 0.3 });
      placePiece(assets.dungeon.barrel, marker.x - 0.8, marker.y + 0.5, 0, { x: 0.3, y: 0.3, z: 0.3 });
      placePiece(assets.dungeon.chest, marker.x + 0.1, marker.y + 0.9, Math.PI, { x: 0.35, y: 0.35, z: 0.35 });
    });
  }
  for (const fn of placePieceLater) fn();

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

  // --- Hero: animated KayKit barbarian with weapon in the hand slot ---
  const heroRig = makeHeroModelRig(assets);
  const hero = heroRig.group;
  scene.add(hero);
  let heroWasDead = false;
  // Renderer-side displacement for lunges; sim position stays authoritative.
  const heroFxOffset = new THREE.Vector3();
  let heroPhase = 0;
  let lastHeroPos: { x: number; y: number } | null = null;
  let equipSignature = "";

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
  let heroTargetYaw = 0;

  /** Ease an angle toward a target along the shortest arc. */
  const approachAngle = (current: number, target: number, maxStep: number): number => {
    let delta = target - current;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    if (Math.abs(delta) <= maxStep) return target;
    return current + Math.sign(delta) * maxStep;
  };
  const healthBars = new Map<number, { wrap: HTMLDivElement; fill: HTMLDivElement }>();

  // --- Hover highlight: brighten the rig under the cursor ---
  let hoveredId: number | null = null;
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
    render(state, prevPlayerPos, alpha) {
      const px = prevPlayerPos.x + (state.player.pos.x - prevPlayerPos.x) * alpha;
      const py = prevPlayerPos.y + (state.player.pos.y - prevPlayerPos.y) * alpha;
      hero.position.set(px + heroFxOffset.x, 0, py + heroFxOffset.z);
      heroLight.position.set(px, 1.6, py);

      const frameDt = Math.min(0.1, (performance.now() - lastFrameNow) / 1000);
      lastFrameNow = performance.now();

      const dx = state.player.pos.x - prevPlayerPos.x;
      const dy = state.player.pos.y - prevPlayerPos.y;
      if (dx * dx + dy * dy > 1e-6) {
        facing.set(dx, 0, dy).normalize();
        heroTargetYaw = Math.atan2(facing.x, facing.z);
      }
      hero.rotation.y = approachAngle(hero.rotation.y, heroTargetYaw, frameDt * 14);
      // Death and revival play through animation clips, not a rotation hack.
      if (state.player.dead && !heroWasDead) {
        heroRig.oneShot("Death_A", { hold: true });
      } else if (!state.player.dead && heroWasDead) {
        heroRig.release();
      }
      heroWasDead = state.player.dead;

      // Rebuild visible gear when equipment changes.
      const eq = state.player.equipment;
      const signature = [eq.weapon, eq.helm, eq.chest, eq.boots]
        .map((it) => (it ? `${it.baseId}:${it.rarity}` : "-"))
        .join("|");
      if (signature !== equipSignature) {
        equipSignature = signature;
        heroRig.setEquipment(eq);
      }

      // Drive the walk cycle from actual movement so feet never slide.
      const frameNow = performance.now();
      if (lastHeroPos) {
        const step = Math.hypot(px - lastHeroPos.x, py - lastHeroPos.y);
        heroPhase += step * 7;
        heroRig.animate(frameNow, heroPhase, step * 60);
      }
      lastHeroPos = { x: px, y: py };

      // Sync monster rigs with sim state
      for (const [id, rig] of monsterRigs) {
        if (!state.monsters.has(id)) {
          scene.remove(rig.group);
          monsterRigs.delete(id);
          monsterAnim.delete(id);
          monsterLerp.delete(id);
        }
      }
      const tickAdvanced = state.tick !== lastSimTick;
      lastSimTick = state.tick;
      for (const monster of state.monsters.values()) {
        let rig = monsterRigs.get(monster.id);
        if (!rig) {
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
          lerp.yaw = Math.atan2(state.player.pos.x - monster.pos.x, state.player.pos.y - monster.pos.y);
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
        if (!state.monsters.has(id)) {
          bar.wrap.remove();
          healthBars.delete(id);
        }
      }

      // Sync ground items
      for (const [id, v] of groundItemVisuals) {
        if (!state.groundItems.has(id)) {
          scene.remove(v.mesh);
          v.label.remove();
          groundItemVisuals.delete(id);
        }
      }
      for (const gi of state.groundItems.values()) {
        let v = groundItemVisuals.get(gi.id);
        if (!v) {
          const colors = RARITY_COLORS[gi.item.rarity]!;
          const isPotion = gi.item.baseId === "minor_potion";
          const mesh = new THREE.Mesh(
            isPotion
              ? new THREE.IcosahedronGeometry(0.11, 0)
              : new THREE.OctahedronGeometry(0.14, 0),
            new THREE.MeshStandardMaterial({
              color: isPotion ? 0xc93a3a : colors.hex,
              emissive: isPotion ? 0xa02828 : colors.hex,
              emissiveIntensity: isPotion ? 0.8 : 0.55,
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
        if (!state.breakables.has(id)) {
          scene.remove(g);
          breakableVisuals.delete(id);
        }
      }
      for (const b of state.breakables.values()) {
        if (!breakableVisuals.has(b.id)) {
          const g = makeBreakable(b.kind, b.id);
          g.position.set(b.pos.x, 0, b.pos.y);
          scene.add(g);
          breakableVisuals.set(b.id, g);
        }
      }

      // Sync gold piles
      for (const [id, g] of goldVisuals) {
        if (!state.goldPiles.has(id)) {
          scene.remove(g);
          goldVisuals.delete(id);
        }
      }
      for (const pile of state.goldPiles.values()) {
        if (!goldVisuals.has(pile.id)) {
          const g = makeGoldPile();
          g.position.set(pile.pos.x, 0, pile.pos.y);
          scene.add(g);
          goldVisuals.set(pile.id, g);
        }
      }

      // Town dressing: the portal ring turns, the vendor idles
      if (portalRing) portalRing.rotation.z = performance.now() / 1400;
      vendorRig?.animate(frameNow, 0, 0);

      // Corpses: a run reset empties the sim's list — clear our meshes too
      if (state.corpses.length < corpseCount) {
        for (const mesh of corpseMeshes) scene.remove(mesh);
        corpseMeshes.length = 0;
        corpseCount = 0;
      }
      // Corpses: add newly dead
      while (corpseCount < state.corpses.length) {
        const c = state.corpses[corpseCount++]!;
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
      // Forgiving fallback: nearest monster within a generous screen radius.
      {
        const rect = renderer.domElement.getBoundingClientRect();
        const cx = clientX - rect.left;
        const cy = clientY - rect.top;
        let bestId: number | null = null;
        let bestD = 30; // px
        for (const [id] of monsterRigs) {
          const monster = state.monsters.get(id);
          if (!monster) continue;
          const at = worldToScreen(monster.pos, 0.55);
          const d = Math.hypot(at.x - cx, at.y - cy);
          if (d < bestD) {
            bestD = d;
            bestId = id;
          }
        }
        if (bestId !== null) return { kind: "monster", id: bestId };
      }
      const itemMeshes: THREE.Object3D[] = [];
      for (const v of groundItemVisuals.values()) itemMeshes.push(v.mesh);
      const itemHits = raycaster.intersectObjects(itemMeshes, false);
      if (itemHits.length > 0) {
        for (const [id, v] of groundItemVisuals) {
          if (v.mesh === itemHits[0]!.object) return { kind: "item", id };
        }
      }
      if (vendorRig) {
        const vendorHits = raycaster.intersectObject(vendorRig.group, true);
        if (vendorHits.length > 0) return { kind: "vendor" };
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
      if (!raycaster.ray.intersectPlane(groundPlane, hit)) return null;
      return { kind: "ground", world: { x: hit.x, y: hit.z } };
    },

    addExplosion(pos, radius) {
      ring(pos, radius, 0xe8a44c);
      fx.burst(pos.x, 0.4, pos.y, 0xe8a44c, 14, 3.4);
      fx.shake(0.3);
    },

    updateHover(state, clientX, clientY) {
      const picked = this.pick(state, clientX, clientY);
      const id = picked?.kind === "monster" || picked?.kind === "breakable" ? picked.id : null;
      const tintable = (targetId: number | null) =>
        targetId === null
          ? undefined
          : (monsterRigs.get(targetId)?.group ?? breakableVisuals.get(targetId));
      if (id !== hoveredId) {
        hoverTint(tintable(hoveredId), false);
        hoverTint(tintable(id), true);
        hoveredId = id;
      }
      renderer.domElement.style.cursor =
        picked?.kind === "monster" || picked?.kind === "item" || picked?.kind === "breakable"
          ? "pointer"
          : "default";
    },

    handleEvent(event, state) {
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
          const p = state.player.pos;
          const dx = event.to.x - p.x;
          const dy = event.to.y - p.y;
          if (dx * dx + dy * dy > 1e-6) heroTargetYaw = Math.atan2(dx, dy);
          const len = Math.hypot(dx, dy) || 1;
          heroRig.oneShot(heroRig.attackClip(), { timeScale: 1.6 });
          fx.tween(200, (t) => {
            const lunge = Math.sin(Math.min(t / 0.6, 1) * Math.PI) * 0.16;
            heroFxOffset.set((dx / len) * lunge, 0, (dy / len) * lunge);
          }, () => heroFxOffset.set(0, 0, 0));
          break;
        }
        case "monster_swing": {
          const swingRig = monsterRigs.get(event.id) as (Rig & Partial<ModelRig>) | undefined;
          const typeId = state.monsters.get(event.id)?.typeId;
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
          fx.flash(hero, 0xc03030, 110);
          fx.burst(state.player.pos.x, 0.7, state.player.pos.y, 0xc03030, 5, 1.6);
          fx.shake(0.06);
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
          if (event.skill === "cleave") {
            heroRig.oneShot("2H_Melee_Attack_Spin", { timeScale: 1.5 });
            ring(event.pos, 1.8, 0xd9dde8, 240);
            fx.shake(0.08);
          } else if (event.skill === "warcry") {
            heroRig.oneShot("Cheer", { timeScale: 1.4 });
            ring(event.pos, 2.6, 0x6a9ad1, 500);
          } else if (event.skill === "leap") {
            // The leap's own motion spike must not cancel its jump clip.
            heroRig.oneShot("Jump_Full_Short", { timeScale: 1.3, cancelOnMove: false });
            ring(event.pos, 1.6, 0x8a8478, 260);
            fx.burst(event.pos.x, 0.15, event.pos.y, 0x8a8478, 10, 2.2);
            fx.shake(0.18);
          } else if (event.skill === "crush") {
            heroRig.oneShot("2H_Melee_Attack_Chop", { timeScale: 1.5 });
            fx.shake(0.12);
          }
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
