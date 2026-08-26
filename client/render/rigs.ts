import * as THREE from "three";

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

export function makeHeroRig(): HeroRig {
  const group = new THREE.Group();

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.28), flatMat(0x8a4a2c, 0.8));
  torso.position.y = 0.78;
  torso.castShadow = true;
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 0), flatMat(0xd9b08c, 0.7));
  head.position.y = 1.2;
  head.castShadow = true;

  const legL = limb(0.13, 0.5, 0.16, 0x4a3524, 0.52);
  legL.position.x = -0.11;
  const legR = limb(0.13, 0.5, 0.16, 0x4a3524, 0.52);
  legR.position.x = 0.11;

  const armL = limb(0.1, 0.42, 0.12, 0x7a4226, 1.0);
  armL.position.x = -0.27;

  // Weapon arm: pivot at the shoulder, blade in the fist.
  const weaponPivot = new THREE.Group();
  weaponPivot.position.set(0.28, 1.0, 0);
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.38, 0.12), flatMat(0x7a4226));
  armR.position.y = -0.19;
  armR.castShadow = true;
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.72, 0.14), flatMat(0xb9bec9, 0.35));
  blade.position.y = -0.62;
  blade.rotation.x = Math.PI; // point away from the arm
  blade.castShadow = true;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.2), flatMat(0x6e5a32, 0.6));
  guard.position.y = -0.38;
  weaponPivot.add(armR, guard, blade);
  weaponPivot.rotation.z = -0.35;

  group.add(torso, head, legL, legR, armL, weaponPivot);

  return {
    group,
    weaponPivot,
    animate(now, phase, speed) {
      const stride = Math.min(1, speed / 4);
      const swing = Math.sin(phase) * 0.7 * stride;
      legL.rotation.x = swing;
      legR.rotation.x = -swing;
      armL.rotation.x = -swing * 0.7;
      torso.rotation.z = Math.sin(phase) * 0.04 * stride;
      torso.rotation.x = 0.06 * stride; // lean into the run
      if (stride < 0.05) {
        // Idle: breathe
        torso.position.y = 0.78 + Math.sin(now / 700) * 0.012;
        armL.rotation.x = Math.sin(now / 700) * 0.05;
      } else {
        torso.position.y = 0.78 + Math.abs(Math.sin(phase)) * 0.03;
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
