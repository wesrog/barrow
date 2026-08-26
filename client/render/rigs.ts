import * as THREE from "three";
import type { Equipment } from "../../sim/character";
import type { Item, Rarity } from "../../sim/items/generate";

/**
 * Articulated character rigs. Animators only touch named child parts —
 * the fx system owns group-level transforms (lunges, death topples, hit pops).
 */

export interface Rig {
  group: THREE.Group;
  /** phase advances with distance travelled; speed is cells/second-ish. */
  animate(now: number, phase: number, speed: number): void;
}

export interface HeroRig extends Rig {
  weaponPivot: THREE.Group;
  /** Rebuild visible gear (weapon model, helm, armor, boots) from equipment. */
  setEquipment(eq: Equipment): void;
}

const RARITY_GLOW: Record<Rarity, number | null> = {
  normal: null,
  magic: 0x3a5adf,
  rare: 0xc9a83c,
  unique: 0xc97a2c,
};

/** Faint colored glow on magic-or-better gear so good loot reads on the body. */
function applyRarityGlow(obj: THREE.Object3D, item: Item | null): void {
  const glow = item ? RARITY_GLOW[item.rarity] : null;
  if (glow === null) return;
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
      child.material.emissive.setHex(glow);
      child.material.emissiveIntensity = 0.28;
    }
  });
}

function flatMat(color: number, roughness = 0.85): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, flatShading: true });
}

function limb(w: number, h: number, d: number, color: number, pivotY: number): THREE.Group {
  // Pivot at the top of the limb so rotation swings it like a joint.
  const pivot = new THREE.Group();
  pivot.position.y = pivotY;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), flatMat(color));
  mesh.position.y = -h / 2;
  mesh.castShadow = true;
  pivot.add(mesh);
  return pivot;
}

/** Weapon models by base id, hanging from the fist along -y. Oversized on purpose. */
function makeWeaponModel(baseId: string): THREE.Group {
  const g = new THREE.Group();
  const add = (mesh: THREE.Mesh) => {
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };
  const haft = (len: number, color = 0x4a3520) => {
    const mesh = add(new THREE.Mesh(new THREE.BoxGeometry(0.06, len, 0.06), flatMat(color, 0.8)));
    mesh.position.y = -len / 2;
    return mesh;
  };
  switch (baseId) {
    case "hatchet": {
      haft(0.75);
      const head = add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.07), flatMat(0x9aa0ac, 0.4)));
      head.position.set(0.13, -0.6, 0);
      const edge = add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.24, 0.08), flatMat(0xc9ced9, 0.3)));
      edge.position.set(0.29, -0.6, 0);
      break;
    }
    case "war_maul": {
      haft(1.0);
      const head = add(new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.26, 0.3), flatMat(0x6a7076, 0.6)));
      head.position.y = -0.92;
      const band = add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.32), flatMat(0x3a3226, 0.8)));
      band.position.y = -0.92;
      break;
    }
    case "twin_fang": {
      for (const side of [-1, 1]) {
        const blade = add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.55, 0.1), flatMat(0xd9d2c4, 0.35)));
        blade.position.set(side * 0.06, -0.42, 0);
      }
      const guard = add(new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.14), flatMat(0x6e5a32, 0.6)));
      guard.position.y = -0.16;
      break;
    }
    case "grave_scythe": {
      haft(1.15, 0x3a3226);
      const blade = add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.09, 0.12), flatMat(0xb9c4c9, 0.35)));
      blade.position.set(0.24, -1.08, 0);
      const tip = add(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.1), flatMat(0xd9e0e4, 0.3)));
      tip.position.set(0.52, -1.14, 0);
      tip.rotation.z = -0.5;
      break;
    }
    default: {
      // rusted_blade and anything unknown: a straight sword
      const steel = baseId === "rusted_blade" ? 0x9a8a72 : 0xb9bec9;
      const blade = add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.8, 0.16), flatMat(steel, 0.4)));
      blade.position.y = -0.6;
      const guard = add(new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.06, 0.2), flatMat(0x6e5a32, 0.6)));
      guard.position.y = -0.2;
      break;
    }
  }
  return g;
}

/** Helm models by base id, sitting over the head. */
function makeHelmModel(baseId: string): THREE.Group {
  const g = new THREE.Group();
  if (baseId === "bone_visage") {
    const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 0), flatMat(0xd9d4c4, 0.6));
    skull.scale.y = 0.85;
    skull.castShadow = true;
    g.add(skull);
    for (const side of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.22, 4), flatMat(0xc4bca8, 0.7));
      horn.position.set(side * 0.2, 0.12, 0);
      horn.rotation.z = -side * 0.7;
      g.add(horn);
    }
  } else {
    // cracked_helm: a dented iron dome with a brim
    const dome = new THREE.Mesh(new THREE.IcosahedronGeometry(0.23, 0), flatMat(0x7a8086, 0.55));
    dome.scale.y = 0.8;
    dome.castShadow = true;
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.42), flatMat(0x5a6066, 0.6));
    brim.position.y = -0.1;
    g.add(dome, brim);
  }
  return g;
}

const SKIN = 0xd9b08c;
const CLOTH = 0x8a4a2c;
const PANTS = 0x4a3524;

const CHEST_LOOKS: Record<string, { torso: number; pauldron: number | null; metal: boolean }> = {
  rag_tunic: { torso: 0x6a5a44, pauldron: null, metal: false },
  studded_jerkin: { torso: 0x4a3a2c, pauldron: 0x3a2e22, metal: false },
  grave_plate: { torso: 0x707a88, pauldron: 0x848e9c, metal: true },
};

const BOOT_LOOKS: Record<string, number> = {
  worn_boots: 0x5a4530,
  chain_greaves: 0x6a7076,
};

export function makeHeroRig(): HeroRig {
  const group = new THREE.Group();

  // Chunky heroic proportions: broad chest, short legs, big fists.
  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.16, 0.3), flatMat(0x3a2e22, 0.8));
  hips.position.y = 0.44;
  hips.castShadow = true;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.52, 0.36), flatMat(CLOTH, 0.8));
  torso.position.y = 0.8;
  torso.castShadow = true;
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.19, 0), flatMat(SKIN, 0.7));
  head.position.y = 1.28;
  head.castShadow = true;

  const legL = limb(0.19, 0.34, 0.22, PANTS, 0.36);
  legL.position.x = -0.14;
  const legR = limb(0.19, 0.34, 0.22, PANTS, 0.36);
  legR.position.x = 0.14;
  const footL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.26), flatMat(0x2c2218, 0.8));
  footL.position.set(0, -0.32, 0.03);
  footL.castShadow = true;
  legL.add(footL);
  const footR = footL.clone();
  legR.add(footR);

  const pauldronL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.24), flatMat(CLOTH, 0.75));
  pauldronL.position.set(-0.38, 1.06, 0);
  pauldronL.castShadow = true;
  const pauldronR = pauldronL.clone();
  pauldronR.position.x = 0.38;

  const armL = limb(0.14, 0.42, 0.16, CLOTH, 1.02);
  armL.position.x = -0.42;
  const fistL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.16), flatMat(SKIN, 0.7));
  fistL.position.y = -0.46;
  fistL.castShadow = true;
  armL.add(fistL);

  // Weapon arm: shoulder pivot, big fist, weapon socket in the fist.
  const weaponPivot = new THREE.Group();
  weaponPivot.position.set(0.42, 1.06, 0);
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.4, 0.17), flatMat(CLOTH, 0.75));
  armR.position.y = -0.2;
  armR.castShadow = true;
  const fistR = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.15, 0.17), flatMat(SKIN, 0.7));
  fistR.position.y = -0.44;
  fistR.castShadow = true;
  const weaponSocket = new THREE.Group();
  weaponSocket.position.y = -0.44;
  weaponPivot.add(armR, fistR, weaponSocket);
  weaponPivot.rotation.z = -0.3;

  const helmSocket = new THREE.Group();
  helmSocket.position.y = 1.32;

  group.add(hips, torso, head, legL, legR, pauldronL, pauldronR, armL, weaponPivot, helmSocket);

  const torsoMat = torso.material as THREE.MeshStandardMaterial;
  const pauldronMatL = pauldronL.material as THREE.MeshStandardMaterial;
  const footMat = footL.material as THREE.MeshStandardMaterial;

  return {
    group,
    weaponPivot,
    setEquipment(eq) {
      // Weapon
      weaponSocket.clear();
      if (eq.weapon) {
        // Models are built hanging along -y, matching the resting arm.
        const model = makeWeaponModel(eq.weapon.baseId);
        applyRarityGlow(model, eq.weapon);
        weaponSocket.add(model);
      }
      // Helm
      helmSocket.clear();
      if (eq.helm) {
        const model = makeHelmModel(eq.helm.baseId);
        applyRarityGlow(model, eq.helm);
        helmSocket.add(model);
      }
      // Chest: recolor torso + pauldrons
      const look = eq.chest ? CHEST_LOOKS[eq.chest.baseId] : undefined;
      torsoMat.color.setHex(look?.torso ?? CLOTH);
      torsoMat.roughness = look?.metal ? 0.45 : 0.8;
      pauldronMatL.color.setHex(look?.pauldron ?? look?.torso ?? CLOTH);
      pauldronMatL.roughness = look?.metal ? 0.45 : 0.75;
      (pauldronR.material as THREE.MeshStandardMaterial).copy(pauldronMatL);
      const scale = look?.metal ? 1.35 : look?.pauldron ? 1.15 : 1;
      pauldronL.scale.setScalar(scale);
      pauldronR.scale.setScalar(scale);
      torsoMat.emissive.setHex(0x000000);
      applyRarityGlow(torso, eq.chest);
      // Boots
      footMat.color.setHex(eq.boots ? BOOT_LOOKS[eq.boots.baseId] ?? 0x5a4530 : 0x2c2218);
      (footR.material as THREE.MeshStandardMaterial).copy(footMat);
    },
    animate(now, phase, speed) {
      const stride = Math.min(1, speed / 4);
      const swing = Math.sin(phase) * 0.65 * stride;
      legL.rotation.x = swing;
      legR.rotation.x = -swing;
      armL.rotation.x = -swing * 0.7;
      torso.rotation.z = Math.sin(phase) * 0.04 * stride;
      torso.rotation.x = 0.07 * stride; // lean into the run
      head.rotation.x = 0.05 * stride;
      if (stride < 0.05) {
        torso.position.y = 0.8 + Math.sin(now / 700) * 0.012;
        armL.rotation.x = Math.sin(now / 700) * 0.05;
      } else {
        torso.position.y = 0.8 + Math.abs(Math.sin(phase)) * 0.035;
      }
    },
  };
}

export function makeMonsterRig(typeId: string): Rig {
  const group = new THREE.Group();

  if (typeId === "skitter") {
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), flatMat(0x7a2f2f));
    body.position.y = 0.22;
    body.castShadow = true;
    const eye = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.05, 0),
      new THREE.MeshStandardMaterial({ color: 0xffcf6a, emissive: 0xffb340, emissiveIntensity: 1.4 }),
    );
    eye.position.set(0, 0.28, 0.16);
    const legs: THREE.Group[] = [];
    for (let i = 0; i < 6; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const leg = limb(0.035, 0.2, 0.035, 0x5a2222, 0.18);
      leg.position.set(side * 0.18, 0, -0.12 + Math.floor(i / 2) * 0.12);
      leg.rotation.z = side * 0.5;
      legs.push(leg);
      group.add(leg);
    }
    group.add(body, eye);
    return {
      group,
      animate(now, phase, speed) {
        const scur = Math.min(1, speed / 4);
        legs.forEach((leg, i) => {
          leg.rotation.x = Math.sin(phase * 2 + i * 1.7) * 0.6 * scur;
        });
        body.position.y = 0.22 + Math.abs(Math.sin(phase * 2)) * 0.02 * scur;
      },
    };
  }

  if (typeId === "gravespit") {
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.8, 6), flatMat(0x5a4a6e));
    body.position.y = 0.4;
    body.rotation.x = 0.25;
    body.castShadow = true;
    const maw = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.09, 0),
      new THREE.MeshStandardMaterial({ color: 0x9be07a, emissive: 0x6fbf4a, emissiveIntensity: 1.6 }),
    );
    maw.position.set(0, 0.62, 0.2);
    group.add(body, maw);
    return {
      group,
      animate(now, phase, speed) {
        const hop = Math.min(1, speed / 3);
        body.position.y = 0.4 + Math.abs(Math.sin(phase * 1.5)) * 0.12 * hop;
        maw.position.y = 0.62 + Math.abs(Math.sin(phase * 1.5)) * 0.12 * hop;
        const pulse = 1 + Math.sin(now / 300) * 0.15;
        maw.scale.setScalar(pulse);
      },
    };
  }

  if (typeId === "tomb_bloat") {
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.38, 0), flatMat(0x7a6a3a, 0.7));
    body.position.y = 0.4;
    body.castShadow = true;
    const boil = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.1, 0),
      new THREE.MeshStandardMaterial({ color: 0xd9b04c, emissive: 0xb9842c, emissiveIntensity: 1.1 }),
    );
    boil.position.set(0.18, 0.62, 0.12);
    group.add(body, boil);
    return {
      group,
      animate(now, phase, speed) {
        // Perpetually swelling; waddles when it moves
        const swell = 1 + Math.sin(now / 450) * 0.06;
        const waddle = Math.sin(phase) * 0.12 * Math.min(1, speed / 2);
        body.scale.set(swell, 0.85 / swell + Math.abs(waddle) * 0.15, swell);
        body.rotation.z = waddle;
        boil.scale.setScalar(1 + Math.sin(now / 220) * 0.2);
      },
    };
  }

  if (typeId === "barrow_lord") {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.05, 0.5), flatMat(0x3a3f52, 0.9));
    body.position.y = 0.95;
    body.castShadow = true;
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), flatMat(0xb8b4c9, 0.6));
    head.position.y = 1.62;
    head.castShadow = true;
    const crown = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.28, 5),
      new THREE.MeshStandardMaterial({ color: 0xc9a84c, emissive: 0x8a6a1c, emissiveIntensity: 0.8 }),
    );
    crown.position.y = 1.89;
    const legL = limb(0.2, 0.45, 0.26, 0x2c3040, 0.45);
    legL.position.x = -0.18;
    const legR = limb(0.2, 0.45, 0.26, 0x2c3040, 0.45);
    legR.position.x = 0.18;
    const armL = limb(0.14, 0.7, 0.18, 0x333849, 1.35);
    armL.position.x = -0.44;
    const armR = limb(0.14, 0.7, 0.18, 0x333849, 1.35);
    armR.position.x = 0.44;
    group.add(body, head, crown, legL, legR, armL, armR);
    return {
      group,
      animate(now, phase, speed) {
        const stride = Math.min(1, speed / 2.5);
        const swing = Math.sin(phase * 0.7) * 0.45 * stride;
        legL.rotation.x = swing;
        legR.rotation.x = -swing;
        armL.rotation.x = -swing * 0.8;
        armR.rotation.x = swing * 0.8;
        body.rotation.z = Math.sin(phase * 0.7) * 0.06 * stride;
        body.position.y = 0.95 + Math.sin(now / 900) * 0.02; // looming breath
      },
    };
  }

  // Shambler (default humanoid): hanging arms, lurching gait
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.6, 0.3), flatMat(0x4d5a44));
  body.position.y = 0.62;
  body.rotation.z = 0.06;
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 0), flatMat(0x66735a));
  head.position.set(0.05, 1.0, 0.08);
  head.castShadow = true;
  const legL = limb(0.12, 0.35, 0.14, 0x3a4534, 0.35);
  legL.position.x = -0.12;
  const legR = limb(0.12, 0.35, 0.14, 0x3a4534, 0.35);
  legR.position.x = 0.12;
  const armL = limb(0.09, 0.5, 0.11, 0x445041, 0.95);
  armL.position.x = -0.28;
  armL.rotation.x = 0.5; // reaching forward, zombie-style
  const armR = limb(0.09, 0.5, 0.11, 0x445041, 0.95);
  armR.position.x = 0.28;
  armR.rotation.x = 0.6;
  group.add(body, head, legL, legR, armL, armR);
  return {
    group,
    animate(now, phase, speed) {
      const lurch = Math.min(1, speed / 2.5);
      const swing = Math.sin(phase) * 0.5 * lurch;
      legL.rotation.x = swing;
      legR.rotation.x = -swing;
      armL.rotation.x = 0.5 + Math.sin(phase + 1.3) * 0.25 * lurch;
      armR.rotation.x = 0.6 + Math.sin(phase + 2.1) * 0.25 * lurch;
      body.rotation.z = 0.06 + Math.sin(phase * 0.5) * 0.1 * lurch;
      head.rotation.z = Math.sin(now / 1100) * 0.12; // uneasy head sway
    },
  };
}
