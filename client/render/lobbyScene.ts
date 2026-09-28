import * as THREE from "three";
import type { Klass } from "../../sim/skills";
import { createEquipment } from "../../sim/character";
import type { Item } from "../../sim/items/generate";
import { BIOME_PALETTES } from "./biomes";
import { makeHeroModelRig, type HeroModelRig } from "./modelRigs";
import { kitNode, type GameAssets, type KitName } from "./models";
import { groundGeometry, groundMaterial } from "./ground";

/**
 * The lobby diorama: a night camp on the moor rendered live behind the start
 * menu. A fire burns in the middle, one hero of each class stands at it in
 * endgame gear, pines and a rune stone close the scene behind them. The
 * heroes are the class picker: hovering one lights it, clicking one makes it
 * perform and tells the menu which class was chosen. Self-contained: own
 * renderer, own rAF loop, own pointer handling, no sim coupling.
 */

export interface LobbySceneHandle {
  /** Make the figure for a class perform (picking it on the card or by the fire). */
  cheer(klass: Klass): void;
  /** Mark a class as the chosen one: its ring lights, the other figure dims. */
  select(klass: Klass | null): void;
  dispose(): void;
}

export interface LobbySceneHooks {
  onPick(klass: Klass): void;
  onHover(klass: Klass | null): void;
}

/** A display-only unique for dressing the showcase heroes; never enters play. */
function showpiece(baseId: string, name: string): Item {
  return { baseId, rarity: "unique", name, affixIds: [], mods: [], ilvl: 30 };
}

// Tighter framing than the game's 12: a vignette, not a battlefield.
const VIEW_HEIGHT = 7;
const PROPS: KitName = "viking_props";
const NATURE: KitName = "viking_nature";

/** The two figures at the fire: where they stand, which way they face, and their colours. */
const FIGURES: Record<Klass, { x: number; z: number; ry: number; glow: number; ring: number; perform: readonly ("cheer" | "taunt" | "castRaise" | "attack1h")[] }> = {
  warrior: { x: -1.6, z: 1.1, ry: Math.PI / 4 + 0.45, glow: 0xffb35c, ring: 0xd9a441, perform: ["taunt", "cheer", "attack1h"] },
  witch: { x: 1.6, z: -1.1, ry: Math.PI / 4 - 0.45, glow: 0x9a6ae8, ring: 0xa47cf0, perform: ["castRaise", "cheer"] },
};

/** Kit props around the fire: node, position, yaw, scale. Rows, not code. */
const CAMP: readonly { kit: KitName; node: string; x: number; z: number; ry: number; scale: number }[] = [
  { kit: PROPS, node: "Prop_Fire_Pit_02", x: 0, z: 0, ry: 0, scale: 0.6 },
  { kit: PROPS, node: "Prop_Fire_Pit_02_Insert_01", x: 0, z: 0, ry: 0, scale: 0.6 },
  { kit: PROPS, node: "Prop_Log_01", x: -0.6, z: -1.7, ry: 0.35, scale: 0.55 },
  { kit: PROPS, node: "Prop_Log_02", x: 1.5, z: 1.3, ry: 1.2, scale: 0.55 },
  { kit: PROPS, node: "Prop_Pelt_02", x: -0.6, z: 2.8, ry: 0.6, scale: 0.42 },
  { kit: PROPS, node: "Prop_Wood_Pile_01", x: -3.4, z: -2.4, ry: 0.4, scale: 0.6 },
  { kit: PROPS, node: "Prop_Log_Holder_01", x: -4.6, z: -1.0, ry: 0.8, scale: 0.6 },
  { kit: PROPS, node: "Prop_Weapon_Rack_01", x: 3.2, z: -3.6, ry: 0.5, scale: 0.6 },
  { kit: PROPS, node: "Prop_Tanning_Rack_01", x: -1.4, z: -4.4, ry: 0.2, scale: 0.6 },
  { kit: PROPS, node: "Prop_Sack_Pile_01", x: 4.4, z: -1.2, ry: 0, scale: 0.6 },
  { kit: PROPS, node: "Prop_Barrel_02", x: 4.9, z: -0.2, ry: 0, scale: 0.6 },
  { kit: PROPS, node: "Prop_Chest_01", x: -4.2, z: 1.6, ry: 1.0, scale: 0.6 },
  { kit: PROPS, node: "Prop_Flag_03", x: 0.8, z: -4.9, ry: 0.3, scale: 0.6 },
  { kit: PROPS, node: "Prop_Cairn_01", x: 2.4, z: -3.0, ry: 0, scale: 0.6 },
  { kit: PROPS, node: "Prop_Torch_01", x: -3.0, z: 3.2, ry: 0, scale: 0.6 },
  { kit: NATURE, node: "Env_Stone_Engraved_01", x: -3.6, z: -4.0, ry: 0.5, scale: 0.6 },
  { kit: NATURE, node: "Env_Stone_02", x: 4.6, z: 2.6, ry: 1.3, scale: 0.6 },
  { kit: NATURE, node: "Env_Bush_Berries_02", x: -5.0, z: 0.6, ry: 0, scale: 0.6 },
  { kit: NATURE, node: "Env_Bush_Berries_04", x: 3.6, z: 3.6, ry: 2.0, scale: 0.6 },
  { kit: NATURE, node: "Env_Bush_Berries_01", x: -2.4, z: -5.6, ry: 1.0, scale: 0.6 },
  { kit: NATURE, node: "Env_Tree_Pine_02", x: -5.4, z: -5.2, ry: 0.4, scale: 0.42 },
  { kit: NATURE, node: "Env_Tree_Pine_04", x: -1.4, z: -7.4, ry: 1.8, scale: 0.46 },
  { kit: NATURE, node: "Env_Tree_Pine_01", x: 2.8, z: -6.8, ry: 2.6, scale: 0.4 },
  { kit: NATURE, node: "Env_Tree_Pine_05", x: 6.4, z: -5.4, ry: 0.9, scale: 0.44 },
  { kit: NATURE, node: "Env_Tree_Pine_03", x: -7.6, z: -1.4, ry: 2.2, scale: 0.38 },
  { kit: NATURE, node: "Env_Tree_Pine_06", x: -7.0, z: 3.8, ry: 0.2, scale: 0.34 },
  { kit: NATURE, node: "Env_Tree_Pine_02", x: 6.8, z: 1.4, ry: 1.5, scale: 0.36 },
];

export function createLobbyScene(mount: HTMLElement, assets: GameAssets, hooks: LobbySceneHooks): LobbySceneHandle {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.cssText = "position:absolute;inset:0;";
  mount.appendChild(renderer.domElement);

  const pal = BIOME_PALETTES.moor;
  const scene = new THREE.Scene();
  const bg = 0x07090c;
  scene.background = new THREE.Color(bg);
  // The camera sits ~27 units out along the iso offset; the pines behind the
  // camp stand a few units past the target, so the far band starts beyond them.
  scene.fog = new THREE.Fog(bg, 30, 44);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  // The fire sits left of centre: the menu card takes the right of the screen.
  const camTarget = new THREE.Vector3(0.85, 0.5, -0.85);
  const camBase = camTarget.clone().add(new THREE.Vector3(14, 18, 14));
  // Screen-right at this iso angle, for the slow drift below.
  const camRight = new THREE.Vector3(1, 0, -1).normalize();

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

  // --- Lights: a cold moon, the fire carries the warmth ---
  scene.add(new THREE.AmbientLight(0x56648a, 1.1));
  const moon = new THREE.DirectionalLight(0x8fa3d0, 1.3);
  moon.position.set(-12, 24, -8);
  moon.castShadow = true;
  moon.shadow.mapSize.set(1024, 1024);
  const s = 14;
  moon.shadow.camera.left = -s;
  moon.shadow.camera.right = s;
  moon.shadow.camera.top = s;
  moon.shadow.camera.bottom = -s;
  moon.shadow.camera.far = 80;
  scene.add(moon);
  scene.add(moon.target);

  // --- Ground: the moor's turf with a few stones in it ---
  const ground = new THREE.Mesh(
    groundGeometry(60, 60, pal.groundTile),
    groundMaterial(assets.ground[pal.groundTexture], assets.groundNormals[pal.groundTexture], pal),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const shadows = (obj: THREE.Object3D) =>
    obj.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  /** A kit prop in a wrapper group, so a node's own authored offset survives. */
  const prop = (kit: KitName, node: string, x: number, z: number, ry: number, scale: number): THREE.Group | null => {
    const src = kitNode(assets.kits, kit, node);
    if (!src) return null;
    const wrap = new THREE.Group();
    wrap.add(src.clone(true));
    wrap.position.set(x, 0, z);
    wrap.rotation.y = ry;
    wrap.scale.setScalar(scale);
    shadows(wrap);
    scene.add(wrap);
    return wrap;
  };
  for (const row of CAMP) prop(row.kit, row.node, row.x, row.z, row.ry, row.scale);
  // A few stones in the turf; the ground texture carries the grass itself.
  const hash = (i: number) => ((i + 1) * 2654435761) >>> 0;
  for (let i = 0; i < 10; i++) {
    const h = hash(i);
    const a = ((h % 360) / 360) * Math.PI * 2;
    const r = 3.2 + ((h >> 9) % 60) / 10;
    prop(NATURE, "Env_Stone_04", Math.cos(a) * r, Math.sin(a) * r, ((h >> 12) % 628) / 100, 0.2);
  }

  // --- The fire: a breathing flame over the kit's pit, its light on everything ---
  const flame = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.2, 0),
    new THREE.MeshStandardMaterial({ color: 0xffb35c, emissive: 0xff8c28, emissiveIntensity: 2.4 }),
  );
  // The kit pit's logs top out at 0.56 (0.93 authored x 0.6 scale).
  flame.position.set(0, 0.62, 0);
  scene.add(flame);
  const ember = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.11, 0),
    new THREE.MeshStandardMaterial({ color: 0xffe0a0, emissive: 0xffc060, emissiveIntensity: 3 }),
  );
  ember.position.set(0.05, 0.9, -0.04);
  scene.add(ember);
  const fireLight = new THREE.PointLight(0xff9a45, 9, 14, 1.6);
  fireLight.position.set(0, 1.2, 0);
  scene.add(fireLight);
  const torchLight = new THREE.PointLight(0xff9a45, 2.4, 6, 1.8);
  torchLight.position.set(-3.0, 1.3, 3.2);
  scene.add(torchLight);

  // --- The heroes: the real hero rig and equipment path, so the gear here is
  // gear you could wear; the witch's orb is lobby-side dressing ---
  interface Figure {
    klass: Klass;
    rig: HeroModelRig;
    glow: THREE.PointLight;
    ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
    performIndex: number;
  }
  const figures: Figure[] = [];
  const makeFigure = (klass: Klass, rig: HeroModelRig): Figure => {
    const spec = FIGURES[klass];
    rig.group.position.set(spec.x, 0, spec.z);
    rig.group.rotation.y = spec.ry;
    scene.add(rig.group);
    const glow = new THREE.PointLight(spec.glow, 2.0, 5, 1.6);
    glow.position.set(spec.x + 0.5, 1.4, spec.z + 0.8);
    scene.add(glow);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.72, 40),
      new THREE.MeshBasicMaterial({ color: spec.ring, transparent: true, opacity: 0, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(spec.x, 0.03, spec.z);
    scene.add(ring);
    const figure = { klass, rig, glow, ring, performIndex: 0 };
    figures.push(figure);
    return figure;
  };

  const warrior = makeHeroModelRig(assets, "warrior");
  {
    const eq = createEquipment();
    eq.weapon = showpiece("kingsbane", "Kingsbane");
    eq.shield = showpiece("barrow_bulwark", "Barrow Bulwark");
    eq.helm = showpiece("wyrm_skull", "Wyrm Skull");
    eq.chest = showpiece("bogsteel_plate", "Bogsteel Plate");
    eq.boots = showpiece("cragwalkers", "Cragwalkers");
    warrior.setEquipment(eq);
  }
  makeFigure("warrior", warrior);

  const witch = makeHeroModelRig(assets, "witch");
  {
    const eq = createEquipment();
    eq.weapon = showpiece("bone_wand", "Bone Wand");
    witch.setEquipment(eq);
  }
  const witchFigure = makeFigure("witch", witch);

  // --- Pointer: the figures are buttons ---
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hovered: Klass | null = null;
  let selected: Klass | null = null;
  const figureAt = (clientX: number, clientY: number): Klass | null => {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    let best: { klass: Klass; d: number } | null = null;
    for (const f of figures) {
      const hit = raycaster.intersectObject(f.rig.group, true)[0];
      if (hit && (!best || hit.distance < best.d)) best = { klass: f.klass, d: hit.distance };
    }
    return best?.klass ?? null;
  };
  const onMove = (e: PointerEvent) => {
    const k = figureAt(e.clientX, e.clientY);
    if (k === hovered) return;
    hovered = k;
    renderer.domElement.style.cursor = k ? "pointer" : "default";
    hooks.onHover(k);
  };
  const onLeave = () => {
    if (hovered === null) return;
    hovered = null;
    renderer.domElement.style.cursor = "default";
    hooks.onHover(null);
  };
  const perform = (klass: Klass) => {
    const f = figures.find((x) => x.klass === klass)!;
    const clips = FIGURES[klass].perform;
    f.rig.oneShot(clips[f.performIndex % clips.length]!);
    f.performIndex++;
  };
  const onClick = (e: PointerEvent) => {
    const k = figureAt(e.clientX, e.clientY);
    if (!k) return;
    perform(k);
    hooks.onPick(k);
  };
  renderer.domElement.addEventListener("pointermove", onMove);
  renderer.domElement.addEventListener("pointerleave", onLeave);
  renderer.domElement.addEventListener("pointerdown", onClick);

  // --- Loop: idle animation, fire flicker, ring pulses, a slow camera drift ---
  const clock = new THREE.Clock();
  let disposed = false;
  let raf = 0;
  const loop = () => {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    clock.getDelta();
    const t = clock.elapsedTime;
    // performance.now(), not clock time: oneShot timers are wall-clock based.
    for (const f of figures) f.rig.animate(performance.now(), 0, 0);
    const flicker = 0.8 + 0.25 * Math.sin(t * 11) + 0.12 * Math.sin(t * 24.3);
    flame.scale.set(0.85 + flicker * 0.25, 0.7 + flicker * 0.5, 0.85 + flicker * 0.25);
    ember.position.y = 0.9 + Math.sin(t * 5.1) * 0.08;
    ember.scale.setScalar(0.7 + Math.abs(Math.sin(t * 3.3)) * 0.5);
    fireLight.intensity = 7 + flicker * 2.6;
    torchLight.intensity = 2.0 + Math.sin(t * 13 + 2) * 0.3 + Math.sin(t * 7.3) * 0.2;
    for (const f of figures) {
      const isSel = f.klass === selected;
      const isHov = f.klass === hovered;
      // Chosen: a steady lit ring and a bright glow; hovered: a faint ring; the
      // rest stand in the firelight only.
      const targetRing = isSel ? 0.75 + Math.sin(t * 2.4) * 0.15 : isHov ? 0.35 : 0;
      f.ring.material.opacity += (targetRing - f.ring.material.opacity) * 0.15;
      const targetGlow = isSel ? 3.6 : isHov ? 3.0 : selected ? 1.2 : 2.0;
      f.glow.intensity += (targetGlow - f.glow.intensity) * 0.1;
    }
    witchFigure.glow.intensity += Math.sin(t * 1.8) * 0.05;
    camera.position
      .copy(camBase)
      .addScaledVector(camRight, Math.sin(t * 0.08) * 0.4)
      .add(new THREE.Vector3(0, Math.sin(t * 0.11) * 0.15, 0));
    camera.lookAt(camTarget);
    renderer.render(scene, camera);
  };
  loop();

  return {
    cheer(klass) {
      perform(klass);
    },
    select(klass) {
      selected = klass;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      renderer.domElement.removeEventListener("pointerdown", onClick);
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
    },
  };
}
