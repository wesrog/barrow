import * as THREE from "three";
import { isWalkable, type Vec, type ZoneMap } from "../../sim/map";
import type { GameState } from "../../sim/state";

const VIEW_HEIGHT = 16; // world units visible vertically

export type PickResult =
  | { kind: "monster"; id: number }
  | { kind: "ground"; world: Vec }
  | null;

export interface SceneHandle {
  /** Draw the current sim state; alpha ∈ [0,1] interpolates from the previous tick. */
  render(state: GameState, prevPlayerPos: Vec, alpha: number): void;
  /** What is under the pointer: a monster, or a spot on the ground. */
  pick(state: GameState, clientX: number, clientY: number): PickResult;
  /** Spawn a floating damage number at a world position. */
  addDamageNumber(pos: Vec, text: string, color: string): void;
  dispose(): void;
}

function flatMat(color: number, roughness = 0.85): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, flatShading: true });
}

function makeMonsterMesh(typeId: string): THREE.Group {
  const g = new THREE.Group();
  if (typeId === "skitter") {
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

export function createScene(mount: HTMLElement, map: ZoneMap): SceneHandle {
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

  // --- Monsters & corpses ---
  const monsterMeshes = new Map<number, THREE.Group>();
  const corpseMeshes: THREE.Mesh[] = [];
  let corpseCount = 0;
  const corpseMatByType: Record<string, THREE.MeshStandardMaterial> = {
    skitter: flatMat(0x3d1d1d),
    shambler: flatMat(0x2c3327),
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
      if (!raycaster.ray.intersectPlane(groundPlane, hit)) return null;
      return { kind: "ground", world: { x: hit.x, y: hit.z } };
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
