import * as THREE from "three";
import { isWalkable, type Vec, type ZoneMap } from "../../sim/map";
import type { GameState, SimEvent } from "../../sim/state";
import { Effects } from "./fx";

const VIEW_HEIGHT = 16; // world units visible vertically

export type PickResult =
  | { kind: "monster"; id: number }
  | { kind: "item"; id: number }
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
  dispose(): void;
}

function flatMat(color: number, roughness = 0.85): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, flatShading: true });
}

function makeMonsterMesh(typeId: string): THREE.Group {
  const g = new THREE.Group();
  if (typeId === "gravespit") {
    // Hunched spitter: thin cone body, glowing maw
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.8, 6), flatMat(0x5a4a6e));
    body.position.y = 0.4;
    body.rotation.x = 0.25;
    body.castShadow = true;
    const maw = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.09, 0),
      new THREE.MeshStandardMaterial({ color: 0x9be07a, emissive: 0x6fbf4a, emissiveIntensity: 1.6 }),
    );
    maw.position.set(0, 0.62, 0.2);
    g.add(body, maw);
  } else if (typeId === "tomb_bloat") {
    // Swollen and about to pop
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.38, 0), flatMat(0x7a6a3a, 0.7));
    body.position.y = 0.4;
    body.scale.set(1, 0.85, 1);
    body.castShadow = true;
    const boil = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.1, 0),
      new THREE.MeshStandardMaterial({ color: 0xd9b04c, emissive: 0xb9842c, emissiveIntensity: 1.1 }),
    );
    boil.position.set(0.18, 0.62, 0.12);
    g.add(body, boil);
  } else if (typeId === "barrow_lord") {
    // The boss: tall, crowned, wrong
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.25, 0.5), flatMat(0x3a3f52, 0.9));
    body.position.y = 0.72;
    body.castShadow = true;
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), flatMat(0xb8b4c9, 0.6));
    head.position.y = 1.55;
    head.castShadow = true;
    const crown = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.28, 5),
      new THREE.MeshStandardMaterial({ color: 0xc9a84c, emissive: 0x8a6a1c, emissiveIntensity: 0.8 }),
    );
    crown.position.y = 1.82;
    g.add(body, head, crown);
  } else if (typeId === "skitter") {
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), flatMat(0x7a2f2f));
    body.position.y = 0.24;
    body.castShadow = true;
    const eye = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.05, 0),
      new THREE.MeshStandardMaterial({
        color: 0xffcf6a,
        emissive: 0xffb340,
        emissiveIntensity: 1.4,
      }),
    );
    eye.position.set(0, 0.3, 0.18);
    g.add(body, eye);
  } else {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.38), flatMat(0x4d5a44));
    body.position.y = 0.45;
    body.rotation.z = 0.06;
    body.castShadow = true;
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 0), flatMat(0x66735a));
    head.position.set(0.05, 0.95, 0.08);
    head.castShadow = true;
    g.add(body, head);
  }
  return g;
}

export function createScene(
  mount: HTMLElement,
  map: ZoneMap,
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

  // --- Ground + walls from the walk grid, in a few tones so rooms read as stone ---
  const floorGeo = new THREE.BoxGeometry(1, 0.1, 1);
  const wallGeo = new THREE.BoxGeometry(1, 1.4, 1);
  const tallWallGeo = new THREE.BoxGeometry(1, 1.75, 1);
  const hash = (x: number, y: number) => (x * 73856093 ^ y * 19349663) >>> 0;
  const floorBuckets: THREE.Matrix4[][] = [[], [], []];
  const wallBuckets: { geo: THREE.BufferGeometry; color: number; mats: THREE.Matrix4[] }[] = [
    { geo: wallGeo, color: 0x35303c, mats: [] },
    { geo: wallGeo, color: 0x2e2a36, mats: [] },
    { geo: tallWallGeo, color: 0x3a3546, mats: [] },
  ];
  const m = new THREE.Matrix4();
  const torchSpots: { x: number; y: number; fx: number; fy: number }[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const h = hash(x, y);
      m.makeTranslation(x + 0.5, 0, y + 0.5);
      if (isWalkable(map, x, y)) {
        const jitter = (h % 5) * 0.008;
        floorBuckets[h % 3]!.push(
          m.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.05 + jitter, 0)),
        );
      } else {
        const bucket = h % 7 === 0 ? 2 : h % 2;
        const lift = bucket === 2 ? 0.87 : 0.7;
        wallBuckets[bucket]!.mats.push(
          m.clone().multiply(new THREE.Matrix4().makeTranslation(0, lift, 0)),
        );
        // Torch candidates: wall with open floor to its south, sparse
        if (isWalkable(map, x, y + 1) && h % 17 === 0) {
          torchSpots.push({ x: x + 0.5, y: y + 0.72, fx: x + 0.5, fy: y + 1 });
        }
      }
    }
  }
  const floorTones = [0x232028, 0x201d25, 0x26222c];
  floorBuckets.forEach((mats, i) => {
    const mesh = new THREE.InstancedMesh(floorGeo, flatMat(floorTones[i]!, 1), mats.length);
    mats.forEach((mat, j) => mesh.setMatrixAt(j, mat));
    mesh.receiveShadow = true;
    scene.add(mesh);
  });
  for (const bucket of wallBuckets) {
    const mesh = new THREE.InstancedMesh(bucket.geo, flatMat(bucket.color, 0.95), bucket.mats.length);
    bucket.mats.forEach((mat, j) => mesh.setMatrixAt(j, mat));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // --- Torches: emissive flames, the first few carrying real light ---
  const torches: { flame: THREE.Mesh; light: THREE.PointLight | null; seed: number }[] = [];
  for (let i = 0; i < torchSpots.length && i < 14; i++) {
    const spot = torchSpots[i]!;
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

  // --- Hero: body, head, and a blade on a swinging shoulder pivot ---
  const hero = new THREE.Group();
  const heroBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.5, 3, 8), flatMat(0x8a4a2c, 0.8));
  heroBody.position.y = 0.55;
  heroBody.castShadow = true;
  const heroHead = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18, 0), flatMat(0xd9b08c, 0.7));
  heroHead.position.y = 1.12;
  heroHead.castShadow = true;
  const weaponPivot = new THREE.Group();
  weaponPivot.position.set(0.3, 0.85, 0);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.72, 0.14), flatMat(0xb9bec9, 0.35));
  blade.position.y = 0.42;
  blade.castShadow = true;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.2), flatMat(0x6e5a32, 0.6));
  guard.position.y = 0.1;
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.05), flatMat(0x4a3520, 0.8));
  weaponPivot.add(blade, guard, grip);
  weaponPivot.rotation.z = -0.5; // resting at the side
  hero.add(heroBody, heroHead, weaponPivot);
  scene.add(hero);
  // Renderer-side displacement for lunges; sim position stays authoritative.
  const heroFxOffset = new THREE.Vector3();

  // --- Ground items ---
  const RARITY_COLORS: Record<string, { hex: number; css: string }> = {
    normal: { hex: 0xbdbdbd, css: "#d6d6d6" },
    magic: { hex: 0x5f7fe8, css: "#8ba3f5" },
    rare: { hex: 0xe8d95f, css: "#f0e68c" },
    unique: { hex: 0xc9884c, css: "#d9a05c" },
  };
  const groundItemVisuals = new Map<number, { mesh: THREE.Mesh; label: HTMLDivElement }>();

  // --- Monsters & corpses ---
  const monsterMeshes = new Map<number, THREE.Group>();
  const monsterFxOffsets = new Map<number, THREE.Vector3>();
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

      const dx = state.player.pos.x - prevPlayerPos.x;
      const dy = state.player.pos.y - prevPlayerPos.y;
      if (dx * dx + dy * dy > 1e-6) {
        facing.set(dx, 0, dy).normalize();
        hero.rotation.y = Math.atan2(facing.x, facing.z);
      }
      const moving = state.player.path.length > 0;
      hero.position.y = moving
        ? Math.abs(Math.sin(performance.now() / 90)) * 0.06
        : Math.sin(performance.now() / 700) * 0.015; // idle breath
      hero.rotation.x = state.player.dead ? Math.PI / 2 : 0;

      // Sync monster meshes with sim state
      for (const [id, mesh] of monsterMeshes) {
        if (!state.monsters.has(id)) {
          scene.remove(mesh);
          monsterMeshes.delete(id);
        }
      }
      for (const monster of state.monsters.values()) {
        let mesh = monsterMeshes.get(monster.id);
        if (!mesh) {
          mesh = makeMonsterMesh(monster.typeId);
          monsterMeshes.set(monster.id, mesh);
          scene.add(mesh);
        }
        const off = monsterFxOffsets.get(monster.id);
        mesh.position.set(
          monster.pos.x + (off?.x ?? 0),
          Math.sin((performance.now() + monster.id * 331) / 500) * 0.02,
          monster.pos.y + (off?.z ?? 0),
        );
        const mdx = state.player.pos.x - monster.pos.x;
        const mdy = state.player.pos.y - monster.pos.y;
        if (monster.ai === "chasing") mesh.rotation.y = Math.atan2(mdx, mdy);
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
      for (const mesh of monsterMeshes.values()) targets.push(mesh);
      const hits = raycaster.intersectObjects(targets, true);
      if (hits.length > 0) {
        let obj: THREE.Object3D | null = hits[0]!.object;
        while (obj && obj.parent !== scene) obj = obj.parent;
        for (const [id, mesh] of monsterMeshes) {
          if (mesh === obj) return { kind: "monster", id };
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
      if (!raycaster.ray.intersectPlane(groundPlane, hit)) return null;
      return { kind: "ground", world: { x: hit.x, y: hit.z } };
    },

    addExplosion(pos, radius) {
      ring(pos, radius, 0xe8a44c);
      fx.burst(pos.x, 0.4, pos.y, 0xe8a44c, 14, 3.4);
      fx.shake(0.3);
    },

    handleEvent(event, state) {
      switch (event.type) {
        case "player_swing": {
          const p = state.player.pos;
          const dx = event.to.x - p.x;
          const dy = event.to.y - p.y;
          if (dx * dx + dy * dy > 1e-6) hero.rotation.y = Math.atan2(dx, dy);
          const len = Math.hypot(dx, dy) || 1;
          fx.tween(180, (t) => {
            // Wind up, slash through, settle back to rest
            weaponPivot.rotation.z =
              t < 0.55
                ? -1.7 + (1.0 - -1.7) * (1 - (1 - t / 0.55) ** 2)
                : 1.0 + (-0.5 - 1.0) * ((t - 0.55) / 0.45);
            const lunge = Math.sin(Math.min(t / 0.6, 1) * Math.PI) * 0.16;
            heroFxOffset.set((dx / len) * lunge, 0, (dy / len) * lunge);
          }, () => heroFxOffset.set(0, 0, 0));
          break;
        }
        case "monster_swing": {
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
          const mesh = monsterMeshes.get(event.id);
          if (mesh) {
            fx.flash(mesh, 0xffffff);
            fx.tween(120, (t) => {
              const s = 1 + Math.sin(t * Math.PI) * 0.14;
              mesh.scale.set(s, 2 - s, s);
            }, () => mesh.scale.set(1, 1, 1));
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
          const mesh = monsterMeshes.get(event.id);
          if (mesh) {
            monsterMeshes.delete(event.id);
            const dir = ((event.id * 61) % 2) * 2 - 1;
            fx.tween(300, (t) => {
              mesh.rotation.z = dir * t * (Math.PI / 2);
              mesh.position.y = -t * 0.25;
              const s = 1 - t * 0.25;
              mesh.scale.set(s, s, s);
            }, () => scene.remove(mesh));
          }
          monsterFxOffsets.delete(event.id);
          fx.burst(event.pos.x, 0.5, event.pos.y, 0x6a2a2a, 10, 2.6);
          break;
        }
        case "skill_cast": {
          if (event.skill === "cleave") {
            ring(event.pos, 1.8, 0xd9dde8, 240);
            fx.shake(0.08);
          } else if (event.skill === "warcry") {
            ring(event.pos, 2.6, 0x6a9ad1, 500);
          } else if (event.skill === "leap") {
            ring(event.pos, 1.6, 0x8a8478, 260);
            fx.burst(event.pos.x, 0.15, event.pos.y, 0x8a8478, 10, 2.2);
            fx.shake(0.18);
          } else if (event.skill === "crush") {
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
