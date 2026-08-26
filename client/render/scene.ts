import * as THREE from "three";
import { isWalkable, type Vec, type ZoneMap } from "../../sim/map";
import type { GameState } from "../../sim/state";

const VIEW_HEIGHT = 16; // world units visible vertically

export interface SceneHandle {
  /** Draw the current sim state; alpha ∈ [0,1] interpolates from the previous tick. */
  render(state: GameState, prevPlayerPos: Vec, alpha: number): void;
  /** Convert a pointer event to sim-space coordinates on the ground plane. */
  screenToWorld(clientX: number, clientY: number): Vec | null;
  dispose(): void;
}

export function createScene(mount: HTMLElement, map: ZoneMap): SceneHandle {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a0c);
  scene.fog = new THREE.Fog(0x0a0a0c, 24, 46);

  // --- Camera: classic isometric orthographic ---
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
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x232028,
    roughness: 1,
    flatShading: true,
  });
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x35303c,
    roughness: 0.95,
    flatShading: true,
  });

  const floorGeo = new THREE.BoxGeometry(1, 0.1, 1);
  const wallGeo = new THREE.BoxGeometry(1, 1.4, 1);
  const floors: THREE.Matrix4[] = [];
  const walls: THREE.Matrix4[] = [];
  const m = new THREE.Matrix4();
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      m.makeTranslation(x + 0.5, 0, y + 0.5);
      if (isWalkable(map, x, y)) {
        // slight per-cell height jitter for a hand-laid stone feel
        const jitter = ((x * 7 + y * 13) % 5) * 0.008;
        floors.push(m.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.05 + jitter, 0)));
      } else {
        walls.push(m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.7, 0)));
      }
    }
  }
  const floorMesh = new THREE.InstancedMesh(floorGeo, floorMat, floors.length);
  floors.forEach((mat, i) => floorMesh.setMatrixAt(i, mat));
  floorMesh.receiveShadow = true;
  scene.add(floorMesh);
  const wallMesh = new THREE.InstancedMesh(wallGeo, wallMat, walls.length);
  walls.forEach((mat, i) => wallMesh.setMatrixAt(i, mat));
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  scene.add(wallMesh);

  // --- Hero: flat-shaded primitive assembly ---
  const hero = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x8a4a2c,
    roughness: 0.8,
    flatShading: true,
  });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.5, 3, 8), bodyMat);
  body.position.y = 0.55;
  body.castShadow = true;
  const head = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.18, 0),
    new THREE.MeshStandardMaterial({ color: 0xd9b08c, roughness: 0.7, flatShading: true }),
  );
  head.position.y = 1.12;
  head.castShadow = true;
  hero.add(body, head);
  scene.add(hero);

  // --- Picking ---
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();

  const facing = new THREE.Vector3(0, 0, 1);

  return {
    render(state, prevPlayerPos, alpha) {
      const px = prevPlayerPos.x + (state.player.pos.x - prevPlayerPos.x) * alpha;
      const py = prevPlayerPos.y + (state.player.pos.y - prevPlayerPos.y) * alpha;
      hero.position.set(px, 0, py);
      heroLight.position.set(px, 1.6, py);

      // Face movement direction
      const dx = state.player.pos.x - prevPlayerPos.x;
      const dy = state.player.pos.y - prevPlayerPos.y;
      if (dx * dx + dy * dy > 1e-6) {
        facing.set(dx, 0, dy).normalize();
        hero.rotation.y = Math.atan2(facing.x, facing.z);
      }
      // Walk bob
      const moving = state.player.path.length > 0;
      hero.position.y = moving ? Math.abs(Math.sin(performance.now() / 90)) * 0.06 : 0;

      camera.position.set(px + camOffset.x, camOffset.y, py + camOffset.z);
      camera.lookAt(px, 0, py);
      moon.target.position.set(px, 0, py);
      moon.position.set(px + 18, 30, py + 8);

      renderer.render(scene, camera);
    },
    screenToWorld(clientX, clientY) {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectPlane(groundPlane, hit)) return null;
      return { x: hit.x, y: hit.z };
    },
    dispose() {
      window.removeEventListener("resize", resize);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    },
  };
}
