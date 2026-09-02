import * as THREE from "three";
import type { Klass } from "../../sim/skills";
import { createEquipment } from "../../sim/character";
import type { Item } from "../../sim/items/generate";
import { makeHeroModelRig } from "./modelRigs";
import { findNode, instantiate, type GameAssets } from "./models";

/**
 * The lobby diorama: a small barrow-entrance vignette rendered live behind the
 * start menu — broken walls, a dark stairwell, flickering torches, a skeleton
 * standing watch, and a showcase hero on each flank wearing endgame gear.
 * Self-contained: own renderer, own rAF loop, no sim coupling.
 */

export interface LobbySceneHandle {
  /** Make the showcase figure for a class react (picking it on the card). */
  cheer(klass: Klass): void;
  dispose(): void;
}

/** A display-only unique for dressing the showcase heroes; never enters play. */
function showpiece(baseId: string, name: string): Item {
  return { baseId, rarity: "unique", name, affixIds: [], mods: [], ilvl: 30 };
}

// Tighter framing than the game's 16 — this is a vignette, not a battlefield.
const VIEW_HEIGHT = 9;
const WALL_SCALE = { x: 0.25, y: 0.35, z: 0.35 };
const FLOOR_SCALE = { x: 0.5, y: 0.45, z: 0.5 };

export function createLobbyScene(mount: HTMLElement, assets: GameAssets): LobbySceneHandle {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.cssText = "position:absolute;inset:0;";
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const bg = 0x0a0a0c;
  scene.background = new THREE.Color(bg);
  // The camera sits ~27 units out along the iso offset, so fog banding is set
  // just past it: the apron reads clear, the walls dissolve into black behind.
  scene.fog = new THREE.Fog(bg, 26, 36);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  // Nudged toward the doorway so the wall run sits balanced behind the card.
  const camTarget = new THREE.Vector3(0.9, 0.5, -0.9);
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

  // --- Lights: dimmer than in-game, torchlight carries the mood ---
  scene.add(new THREE.AmbientLight(0x6a6a80, 0.5));
  const moon = new THREE.DirectionalLight(0xb8c4e0, 1.1);
  moon.position.set(18, 30, 8);
  moon.castShadow = true;
  moon.shadow.mapSize.set(1024, 1024);
  const s = 12;
  moon.shadow.camera.left = -s;
  moon.shadow.camera.right = s;
  moon.shadow.camera.top = s;
  moon.shadow.camera.bottom = -s;
  moon.shadow.camera.far = 80;
  scene.add(moon);
  scene.add(moon.target);

  // --- Composition ---
  const place = (
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
    scene.add(clone);
    return clone;
  };

  // Floor: a wide tile apron (the menu card covers the middle, so the
  // composition spreads to both flanks), worn through in spots.
  const hash = (x: number, z: number) => ((x + 7) * 73856093 ^ (z + 7) * 19349663) >>> 0;
  for (let z = -2; z <= 2; z++) {
    for (let x = -6; x <= 5; x++) {
      const h = hash(x, z) % 23;
      const tile =
        h < 3 ? assets.dungeon.floor_broken : h < 6 ? assets.dungeon.floor_weeds : assets.dungeon.floor;
      place(tile, x + 0.5, z + 0.5, ((hash(x, z) >> 4) % 4) * (Math.PI / 2), FLOOR_SCALE);
    }
  }

  // Back wall along z = -2 with a one-cell doorway gap at x = 0.
  const wallAt = (x: number, piece: THREE.Group) => place(piece, x + 0.5, -1.9, 0, WALL_SCALE);
  wallAt(-6, assets.dungeon.wall_broken);
  wallAt(-5, assets.dungeon.wall);
  wallAt(-4, assets.dungeon.wall);
  wallAt(-3, assets.dungeon.wall);
  wallAt(-2, assets.dungeon.wall_cracked);
  wallAt(-1, assets.dungeon.wall);
  wallAt(1, assets.dungeon.wall);
  wallAt(2, assets.dungeon.wall);
  wallAt(3, assets.dungeon.wall_cracked);
  wallAt(4, assets.dungeon.wall);
  wallAt(5, assets.dungeon.wall_broken);
  place(assets.dungeon.pillar, -0.55, -1.9, 0, { x: 0.3, y: 0.34, z: 0.3 });
  place(assets.dungeon.pillar, 1.55, -1.9, 0, { x: 0.3, y: 0.34, z: 0.3 });

  // The doorway: a lightless shaft with steps descending into it.
  const shaft = new THREE.Mesh(
    new THREE.BoxGeometry(0.98, 1.4, 0.98),
    new THREE.MeshBasicMaterial({ color: 0x030308 }),
  );
  shaft.position.set(0.5, -0.72, -1.9);
  scene.add(shaft);
  const stairs = place(assets.dungeon.stairs, 0.5, -1.9, 0, FLOOR_SCALE);
  const bb = new THREE.Box3().setFromObject(stairs);
  stairs.position.y = -bb.max.y + 0.02;
  // A cold glow breathing up from below, like the in-game stairwells.
  const stairGlow = new THREE.PointLight(0x6fb0d9, 1.8, 4, 1.7);
  stairGlow.position.set(0.5, 0.45, -1.9);
  scene.add(stairGlow);

  // Dressing on the flanks the card leaves visible: a lone column, stores by
  // the wall, a chest in the half-shadow.
  place(assets.dungeon.column, -4.6, 1.6, 0.4, { x: 0.3, y: 0.34, z: 0.3 });
  place(assets.dungeon.barrel, -4.4, -1.3, 0, { x: 0.3, y: 0.3, z: 0.3 });
  place(assets.dungeon.crates, -3.7, -1.35, 0.3, { x: 0.3, y: 0.3, z: 0.3 });
  place(assets.dungeon.chest, 4.3, -1.2, -0.5, { x: 0.4, y: 0.4, z: 0.4 });
  place(assets.dungeon.barrel, 3.5, 1.8, 0.9, { x: 0.3, y: 0.3, z: 0.3 });

  // --- Torches: flanking the doorway and lighting each visible flank ---
  const torches: { flame: THREE.Mesh; light: THREE.PointLight; seed: number }[] = [];
  for (const [i, tx] of [-0.9, 1.9, -4.9, 3.9].entries()) {
    const sconce = assets.dungeon.torch_mounted.clone(true);
    sconce.position.set(tx, 0.75, -1.72);
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
    flame.position.set(tx, 1.15, -1.66);
    scene.add(flame);
    const light = new THREE.PointLight(0xff9a45, 3.2, 6.5, 1.8);
    light.position.set(tx, 1.2, -1.5);
    scene.add(light);
    torches.push({ flame, light, seed: i * 37 });
  }

  // --- A skeleton standing watch beside the doorway ---
  const sentry = instantiate(assets.characters.skeleton_warrior);
  sentry.group.position.set(-1.7, 0, -0.6);
  sentry.group.rotation.y = Math.PI * 0.8;
  sentry.group.scale.setScalar(0.9);
  const idle = sentry.actions.get("Idle_Combat") ?? sentry.actions.get("Idle");
  idle?.play();
  if (sentry.handSlotR) {
    const axe = assets.weapons.skeleton_axe.clone(true);
    sentry.handSlotR.add(axe);
  }
  scene.add(sentry.group);
  // A low warm glow so the sentry reads in the doorway's half-shadow.
  const sentryGlow = new THREE.PointLight(0xffb35c, 2.0, 4, 1.7);
  sentryGlow.position.set(-1.7, 1.0, 0.2);
  scene.add(sentryGlow);

  // --- Showcase heroes: what a decked-out warrior and witch look like ---
  // Both use the real hero rig + equipment path, so the gear here is the gear
  // you'd actually wear; the witch's robe, hat, and orb are lobby-side dressing
  // (no robe/orb item bases exist yet).
  const warrior = makeHeroModelRig(assets);
  {
    const eq = createEquipment();
    eq.weapon = showpiece("kingsbane", "Kingsbane");
    eq.shield = showpiece("barrow_bulwark", "Barrow Bulwark");
    eq.helm = showpiece("wyrm_skull", "Wyrm Skull");
    eq.chest = showpiece("bogsteel_plate", "Bogsteel Plate");
    eq.boots = showpiece("cragwalkers", "Cragwalkers");
    warrior.setEquipment(eq);
  }
  warrior.group.position.set(-3.4, 0, 1.3);
  warrior.group.rotation.y = Math.PI / 4 + 0.25; // face the camera, angled inward
  scene.add(warrior.group);
  const warriorGlow = new THREE.PointLight(0xffb35c, 2.6, 5, 1.6);
  warriorGlow.position.set(-2.9, 1.3, 2.2);
  scene.add(warriorGlow);

  const witch = makeHeroModelRig(assets);
  // Dusk-pale skin and darkened cloth before the robe goes on.
  witch.group.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
      obj.material.color.lerp(new THREE.Color(0x4a3a5e), 0.45);
    }
  });
  {
    const eq = createEquipment();
    eq.weapon = showpiece("gnarled_staff", "Gnarled Staff");
    witch.setEquipment(eq);
  }
  const witchFlat = (color: number, roughness = 0.85) =>
    new THREE.MeshStandardMaterial({ color, roughness, flatShading: true });
  // Robe: a flared skirt from the hips and a mantle over the shoulders.
  const hipsBone = findNode(witch.group, "hips") ?? findNode(witch.group, "chest");
  if (hipsBone) {
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.8, 1.1, 8), witchFlat(0x2e2340));
    skirt.position.y = -0.45;
    skirt.castShadow = true;
    hipsBone.add(skirt);
  }
  const chestBone = findNode(witch.group, "chest");
  if (chestBone) {
    const mantle = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.52, 0.5, 8), witchFlat(0x392b4e));
    mantle.position.y = 0.1;
    mantle.castShadow = true;
    chestBone.add(mantle);
  }
  // Pointed hat with a faintly glowing band — the chibi head is huge (~r0.62).
  const headBone = findNode(witch.group, "head");
  if (headBone) {
    const hat = new THREE.Group();
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.0, 0.09, 8), witchFlat(0x241a30));
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.05, 8), witchFlat(0x241a30));
    cone.position.y = 0.55;
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.56, 0.14, 8),
      new THREE.MeshStandardMaterial({
        color: 0x6a4ae0,
        emissive: 0x5a2ae0,
        emissiveIntensity: 0.6,
        flatShading: true,
      }),
    );
    band.position.y = 0.1;
    brim.castShadow = cone.castShadow = true;
    hat.add(brim, cone, band);
    hat.position.y = 0.55;
    hat.rotation.z = 0.12;
    headBone.add(hat);
  }
  // The off-hand orb: a witchlight hovering over the open left palm.
  const orbSlot = findNode(witch.group, "handslot.l");
  const orb = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.22, 1),
    new THREE.MeshStandardMaterial({
      color: 0xb08af8,
      emissive: 0x7a3ae0,
      emissiveIntensity: 2.4,
      flatShading: true,
    }),
  );
  orb.position.y = 0.25;
  orbSlot?.add(orb);
  witch.group.position.set(3.4, 0, 1.3);
  witch.group.rotation.y = Math.PI / 4 - 0.25;
  scene.add(witch.group);
  const witchGlow = new THREE.PointLight(0x8a5ae8, 2.8, 6, 1.6);
  witchGlow.position.set(3.0, 1.2, 2.2);
  scene.add(witchGlow);

  // --- Loop: idle animation, torch flicker, a slow camera drift ---
  const clock = new THREE.Clock();
  let disposed = false;
  let raf = 0;
  const loop = () => {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    const dt = clock.getDelta();
    const t = clock.elapsedTime;
    sentry.mixer.update(dt);
    // performance.now(), not clock time: oneShot timers are wall-clock based.
    warrior.animate(performance.now(), 0, 0);
    witch.animate(performance.now(), 0, 0);
    // The witchlight breathes: the orb bobs and its glow pulses with it.
    orb.position.y = 0.25 + Math.sin(t * 1.8) * 0.06;
    orb.rotation.y = t * 0.7;
    witchGlow.intensity = 2.8 + Math.sin(t * 1.8) * 0.6;
    for (const torch of torches) {
      torch.light.intensity =
        3.2 + Math.sin(t * 13 + torch.seed) * 0.5 + Math.sin(t * 7.3 + torch.seed * 2) * 0.3;
      const fs = 1 + Math.sin(t * 11 + torch.seed) * 0.12;
      torch.flame.scale.setScalar(fs);
    }
    stairGlow.intensity = 1.8 + Math.sin(t * 1.7) * 0.4;
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
      if (klass === "warrior") warrior.oneShot("Cheer");
      else witch.oneShot("Spellcast_Raise");
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
    },
  };
}
