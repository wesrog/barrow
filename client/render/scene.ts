import * as THREE from "three";
import { isWalkable, type Vec, type ZoneMap } from "../../sim/map";
import type { GameState } from "../../sim/state";

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
  scene.fog = new THREE.Fog(0x0a0a0c, 24, 46);

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

  // --- Ground + walls from the walk grid ---
  const floorGeo = new THREE.BoxGeometry(1, 0.1, 1);
  const wallGeo = new THREE.BoxGeometry(1, 1.4, 1);
  const floors: THREE.Matrix4[] = [];
  const walls: THREE.Matrix4[] = [];
  const m = new THREE.Matrix4();
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      m.makeTranslation(x + 0.5, 0, y + 0.5);
      if (isWalkable(map, x, y)) {
        const jitter = ((x * 7 + y * 13) % 5) * 0.008;
        floors.push(m.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.05 + jitter, 0)));
      } else {
        walls.push(m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.7, 0)));
      }
    }
  }
  const floorMesh = new THREE.InstancedMesh(floorGeo, flatMat(0x232028, 1), floors.length);
  floors.forEach((mat, i) => floorMesh.setMatrixAt(i, mat));
  floorMesh.receiveShadow = true;
  scene.add(floorMesh);
  const wallMesh = new THREE.InstancedMesh(wallGeo, flatMat(0x35303c, 0.95), walls.length);
  walls.forEach((mat, i) => wallMesh.setMatrixAt(i, mat));
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  scene.add(wallMesh);

  // --- Hero ---
  const hero = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.5, 3, 8), flatMat(0x8a4a2c, 0.8));
  body.position.y = 0.55;
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18, 0), flatMat(0xd9b08c, 0.7));
  head.position.y = 1.12;
  head.castShadow = true;
  hero.add(body, head);
  scene.add(hero);

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
  const corpseMeshes: THREE.Mesh[] = [];
  let corpseCount = 0;
  const corpseMatByType: Record<string, THREE.MeshStandardMaterial> = {
    skitter: flatMat(0x3d1d1d),
    shambler: flatMat(0x2c3327),
    gravespit: flatMat(0x352b40),
    tomb_bloat: flatMat(0x4a4028),
    barrow_lord: flatMat(0x272a38),
  };

  // --- Explosions (expanding, fading rings) ---
  const explosions: { mesh: THREE.Mesh; born: number; radius: number }[] = [];

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
      hero.position.set(px, 0, py);
      heroLight.position.set(px, 1.6, py);

      const dx = state.player.pos.x - prevPlayerPos.x;
      const dy = state.player.pos.y - prevPlayerPos.y;
      if (dx * dx + dy * dy > 1e-6) {
        facing.set(dx, 0, dy).normalize();
        hero.rotation.y = Math.atan2(facing.x, facing.z);
      }
      const moving = state.player.path.length > 0;
      hero.position.y = moving ? Math.abs(Math.sin(performance.now() / 90)) * 0.06 : 0;
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
        mesh.position.set(monster.pos.x, 0, monster.pos.y);
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

      // Animate explosion rings
      for (let i = explosions.length - 1; i >= 0; i--) {
        const ex = explosions[i]!;
        const age = (performance.now() - ex.born) / 400;
        if (age >= 1) {
          scene.remove(ex.mesh);
          explosions.splice(i, 1);
          continue;
        }
        const s = 0.2 + age * ex.radius;
        ex.mesh.scale.set(s, 1, s);
        (ex.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - age);
      }

      camera.position.set(px + camOffset.x, camOffset.y, py + camOffset.z);
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
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.7, 1, 24),
        new THREE.MeshBasicMaterial({
          color: 0xe8a44c,
          transparent: true,
          opacity: 0.8,
          side: THREE.DoubleSide,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(pos.x, 0.1, pos.y);
      scene.add(mesh);
      explosions.push({ mesh, born: performance.now(), radius });
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
