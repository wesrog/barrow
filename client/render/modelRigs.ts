import * as THREE from "three";
import type { Equipment } from "../../sim/character";
import { BASES } from "../../sim/items/bases";
import type { Item } from "../../sim/items/generate";
import {
  findNode,
  instantiate,
  type CharacterInstance,
  type GameAssets,
  type WeaponName,
} from "./models";
import { makeMonsterRig as makeProceduralRig, type Rig } from "./rigs";

/**
 * Animated-model rigs on top of the KayKit characters. Same Rig contract as
 * the procedural ones: animate(now, phase, speed) each frame; the fx system
 * still owns group-level transforms.
 */

export interface ModelRig extends Rig {
  /** Play a one-shot clip (attack, death, taunt), then return to locomotion. */
  oneShot(name: string, opts?: { hold?: boolean; timeScale?: number; cancelOnMove?: boolean }): void;
  /** Cancel a held one-shot (revive after a held death pose). */
  release(): void;
}

export interface HeroModelRig extends ModelRig {
  setEquipment(eq: Equipment): void;
  /** Clip name for a basic attack with the current weapon. */
  attackClip(): string;
}

const RARITY_GLOW: Record<string, number> = {
  magic: 0x2a3ea0,
  rare: 0x8a7420,
  unique: 0x8a5010,
};

function applyRarityGlow(obj: THREE.Object3D, item: Item): void {
  const glow = RARITY_GLOW[item.rarity];
  if (glow === undefined) return;
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
      child.material.emissive.setHex(glow);
      child.material.emissiveIntensity = 0.35;
    }
  });
}

class AnimRig implements ModelRig {
  group: THREE.Group;
  private inst: CharacterInstance;
  private lastNow: number | null = null;
  private current: THREE.AnimationAction | null = null;
  private oneShotUntil = 0;
  private idleName: string;
  private walkName: string;
  private walkSpeedRef: number;

  constructor(inst: CharacterInstance, idleName: string, walkName: string, walkSpeedRef = 3.5) {
    this.inst = inst;
    this.group = inst.group;
    this.idleName = idleName;
    this.walkName = walkName;
    this.walkSpeedRef = walkSpeedRef;
    this.play(idleName);
  }

  private play(name: string, fade = 0.18, loop = true, force = false): THREE.AnimationAction | null {
    const action = this.inst.actions.get(name);
    if (!action) return null;
    const restarting = this.current === action;
    if (restarting && !force) return action;
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = !loop;
    if (this.current && !restarting) {
      action.crossFadeFrom(this.current, fade, false);
    }
    action.play();
    this.current = action;
    return action;
  }

  private moveCancels = true;

  oneShot(name: string, opts: { hold?: boolean; timeScale?: number; cancelOnMove?: boolean } = {}): void {
    // Force a restart so back-to-back identical attacks replay from the top.
    const action = this.play(name, 0.08, false, true);
    if (!action) return;
    action.timeScale = opts.timeScale ?? 1;
    this.moveCancels = !opts.hold && (opts.cancelOnMove ?? true);
    const dur = (action.getClip().duration / action.timeScale) * 1000;
    this.oneShotUntil = opts.hold ? Number.POSITIVE_INFINITY : performance.now() + dur * 0.85;
  }

  release(): void {
    this.oneShotUntil = 0;
  }

  animate(now: number, _phase: number, speed: number): void {
    const dt = this.lastNow === null ? 1 / 60 : Math.min(0.1, (now - this.lastNow) / 1000);
    this.lastNow = now;
    // Running cancels an attack pose — feet beat frozen swings.
    if (this.oneShotUntil > 0 && this.oneShotUntil !== Number.POSITIVE_INFINITY && this.moveCancels && speed > 1.0) {
      this.oneShotUntil = 0;
    }
    if (now >= this.oneShotUntil) {
      this.oneShotUntil = 0;
      if (speed > 0.4) {
        const action = this.play(this.walkName);
        if (action) action.timeScale = Math.max(0.6, Math.min(2.4, speed / this.walkSpeedRef));
      } else {
        this.play(this.idleName);
      }
    }
    this.inst.mixer.update(dt);
  }

  attach(slot: "r" | "l", obj: THREE.Object3D | null): void {
    const socket = slot === "r" ? this.inst.handSlotR : this.inst.handSlotL;
    if (!socket) return;
    socket.clear();
    if (!obj) return;
    // KayKit fits main-hand props yaw-flipped 180° in handslot.r (see the
    // bundled 1H_Axe/1H_Sword nodes); without this an axe head faces backward.
    obj.rotation.set(0, slot === "r" ? Math.PI : 0, 0);
    obj.position.set(0, 0.033, 0);
    socket.add(obj);
  }
}

/** Weapon base id -> KayKit weapon model + whether it swings two-handed. */
const WEAPON_LOOKS: Record<string, { model: WeaponName; twoHanded: boolean }> = {
  rusted_blade: { model: "sword_1handed", twoHanded: false },
  hatchet: { model: "axe_1handed", twoHanded: false },
  twin_fang: { model: "dagger", twoHanded: false },
  war_maul: { model: "axe_2handed", twoHanded: true },
  grave_scythe: { model: "sword_2handed", twoHanded: true },
  gnarled_staff: { model: "skeleton_staff", twoHanded: false },
  ember_staff: { model: "skeleton_staff", twoHanded: false },
  wyrmwood_staff: { model: "skeleton_staff", twoHanded: false },
  dire_flail: { model: "axe_1handed", twoHanded: false },
  moon_glaive: { model: "axe_2handed", twoHanded: true },
  kingsbane: { model: "sword_1handed", twoHanded: false },
};

/** Held caster orb: a flat-shaded sphere floating just above the fist. */
function makeOrbModel(): THREE.Group {
  const g = new THREE.Group();
  const orb = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.11, 1),
    flatMat(0x9db8d9, 0.4),
  );
  orb.castShadow = true;
  orb.position.y = -0.12;
  g.add(orb);
  return g;
}

function flatMat(color: number, roughness = 0.8): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, flatShading: true });
}

/** Object3D.clone shares materials; give each held weapon its own so
 * per-instance hit flashes and tints don't leak across enemies. */
function cloneWeapon(model: THREE.Object3D): THREE.Object3D {
  const clone = model.clone(true);
  clone.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.material instanceof THREE.Material) {
      obj.material = obj.material.clone();
    }
  });
  return clone;
}

/**
 * Armor meshes sized for the KayKit skeleton, attached straight to bones.
 * The chibi head is huge — ~1.08 wide, top at y+0.95 above the head bone —
 * so helms must be dome radius ~0.6+ to sit outside the skull.
 */
function helmMesh(baseId: string): THREE.Group {
  const g = new THREE.Group();
  if (baseId === "bone_visage") {
    const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 0), flatMat(0xd9d4c4, 0.6));
    skull.scale.y = 0.85;
    skull.position.y = 0.5;
    skull.castShadow = true;
    g.add(skull);
    for (const side of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.5, 4), flatMat(0xc4bca8, 0.7));
      horn.position.set(side * 0.56, 0.78, 0);
      horn.rotation.z = -side * 0.8;
      horn.castShadow = true;
      g.add(horn);
    }
  } else {
    const dome = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 0), flatMat(0x7a8086, 0.5));
    dome.scale.y = 0.8;
    dome.position.y = 0.55;
    dome.castShadow = true;
    // A band ringing the dome's lower edge, not a hat brim across the face.
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.63, 0.16, 8), flatMat(0x5a6066, 0.6));
    brim.position.y = 0.34;
    brim.castShadow = true;
    g.add(dome, brim);
  }
  return g;
}

const CHEST_LOOKS: Record<string, { color: number; metal: boolean; big: boolean }> = {
  rag_tunic: { color: 0x6a5a44, metal: false, big: false },
  studded_jerkin: { color: 0x4a3a2c, metal: false, big: false },
  grave_plate: { color: 0x8a94a4, metal: true, big: true },
};

const BOOT_LOOKS: Record<string, number> = {
  worn_boots: 0x5a4530,
  chain_greaves: 0x7a8086,
};

export function makeHeroModelRig(assets: GameAssets): HeroModelRig {
  const inst = instantiate(assets.characters.barbarian);
  // Low ref speed = fast cadence: at 4.5 cells/s the run cycle plays ~1.8x,
  // matching feet to the ground actually covered.
  const rig = new AnimRig(inst, "Idle", "Running_A", 2.5);
  rig.group.scale.setScalar(0.72);
  let twoHanded = false;

  // The model ships with prop meshes (axes, shield, a beer mug) — hide them,
  // our equipment drives what shows.
  for (const prop of [
    "1H_Axe",
    "1H_Axe_Offhand",
    "2H_Axe",
    "Mug",
    "Barbarian_Round_Shield",
    "Barbarian_Hat",
  ]) {
    const node = rig.group.getObjectByName(prop);
    if (node) node.visible = false;
  }
  // The round shield stays part of the skinned model (so it tracks the left
  // arm); equipping any shield base un-hides it. Clone its material so rarity
  // glow doesn't bleed onto the shared character atlas.
  const shieldProp = rig.group.getObjectByName("Barbarian_Round_Shield");
  shieldProp?.traverse((child) => {
    if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
      child.material = child.material.clone();
    }
  });

  const boneOf = (name: string) => findNode(rig.group, name);
  const gear: THREE.Object3D[] = [];
  const addGear = (boneName: string, mesh: THREE.Object3D, item: Item) => {
    const bone = boneOf(boneName);
    if (!bone) return;
    applyRarityGlow(mesh, item);
    bone.add(mesh);
    gear.push(mesh);
  };

  const hero = rig as unknown as HeroModelRig;
  hero.setEquipment = (eq: Equipment) => {
    for (const g of gear) g.parent?.remove(g);
    gear.length = 0;

    // Only an equipped helm puts anything on the head.
    if (eq.helm) addGear("head", helmMesh(eq.helm.baseId), eq.helm);

    // Chest: pauldrons on the shoulders, a plate over the chest bone
    if (eq.chest) {
      const look = CHEST_LOOKS[eq.chest.baseId] ?? CHEST_LOOKS.rag_tunic!;
      const size = look.big ? 0.34 : 0.26;
      for (const side of ["l", "r"] as const) {
        const pauldron = new THREE.Mesh(
          new THREE.BoxGeometry(size, size * 0.7, size),
          flatMat(look.color, look.metal ? 0.45 : 0.75),
        );
        pauldron.castShadow = true;
        pauldron.position.y = 0.06;
        addGear(`upperarm.${side}`, pauldron, eq.chest);
      }
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(0.52, 0.4, 0.34),
        flatMat(look.color, look.metal ? 0.45 : 0.75),
      );
      plate.position.set(0, 0.1, 0.05);
      addGear("chest", plate, eq.chest);
    }

    // Boots: greaves on the lower legs
    if (eq.boots) {
      const color = BOOT_LOOKS[eq.boots.baseId] ?? 0x5a4530;
      for (const side of ["l", "r"] as const) {
        const greave = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.22), flatMat(color, 0.7));
        greave.castShadow = true;
        greave.position.y = -0.12;
        addGear(`lowerleg.${side}`, greave, eq.boots);
      }
    }
    // Orbs share the shield slot but float over the off hand instead of
    // un-hiding the skinned shield prop.
    const offhandOrb = eq.shield && BASES[eq.shield.baseId]!.dmgMin !== undefined ? eq.shield : null;
    if (shieldProp) {
      shieldProp.visible = !!eq.shield && !offhandOrb;
      const glow = eq.shield && !offhandOrb ? RARITY_GLOW[eq.shield.rarity] : undefined;
      shieldProp.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          child.material.emissive.setHex(glow ?? 0x000000);
          child.material.emissiveIntensity = glow !== undefined ? 0.35 : 0;
        }
      });
    }
    if (offhandOrb) {
      const model = makeOrbModel();
      applyRarityGlow(model, offhandOrb);
      rig.attach("l", model);
    } else {
      rig.attach("l", null);
    }

    if (eq.weapon) {
      const look = WEAPON_LOOKS[eq.weapon.baseId] ?? WEAPON_LOOKS.rusted_blade!;
      twoHanded = look.twoHanded;
      const model = cloneWeapon(assets.weapons[look.model]);
      const glow = RARITY_GLOW[eq.weapon.rarity];
      if (glow !== undefined) {
        model.traverse((obj) => {
          if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
            obj.material.emissive.setHex(glow);
            obj.material.emissiveIntensity = 0.5;
          }
        });
      }
      rig.attach("r", model);
    } else {
      twoHanded = false;
      rig.attach("r", null);
    }
  };
  hero.attackClip = () =>
    twoHanded ? "2H_Melee_Attack_Chop" : "1H_Melee_Attack_Slice_Diagonal";
  return hero;
}

/** Monster type -> character model, locomotion clips, scale, weapon. */
const MONSTER_LOOKS: Record<
  string,
  {
    model: keyof GameAssets["characters"];
    idle: string;
    walk: string;
    scale: number;
    weapon?: WeaponName;
    tint?: number;
  }
> = {
  shambler: {
    model: "skeleton_warrior",
    idle: "Idle",
    walk: "Walking_D_Skeletons",
    scale: 0.62,
    weapon: "skeleton_blade",
  },
  skitter: {
    model: "skeleton_minion",
    idle: "Idle",
    walk: "Running_A",
    scale: 0.45,
    tint: 0x8a5a5a,
  },
  gravespit: {
    model: "skeleton_mage",
    idle: "Idle",
    walk: "Walking_A",
    scale: 0.6,
    weapon: "skeleton_staff",
    tint: 0x9a8ab8,
  },
  fen_howler: {
    model: "skeleton_rogue",
    idle: "Idle",
    walk: "Running_A",
    scale: 0.55,
    tint: 0x6a8a4a,
  },
  bog_maw: {
    model: "skeleton_mage",
    idle: "Idle",
    walk: "Walking_A",
    scale: 0.78,
    weapon: "skeleton_staff",
    tint: 0x5a7a52,
  },
  cairn_wight: {
    model: "skeleton_warrior",
    idle: "Idle_Combat",
    walk: "Walking_A",
    scale: 0.9,
    weapon: "skeleton_axe",
    tint: 0xd8d2c0,
  },
  barrow_lord: {
    model: "skeleton_warrior",
    idle: "Idle_Combat",
    walk: "Walking_A",
    scale: 1.05,
    weapon: "skeleton_axe",
    tint: 0xc9b880,
  },
  // The camp vendor: an old knight minding the stall.
  __vendor__: {
    model: "knight",
    idle: "Idle",
    walk: "Walking_A",
    scale: 0.72,
  },
  // The camp healer: a pale-robed knight keeping a quiet shrine.
  __healer__: {
    model: "knight",
    idle: "Idle",
    walk: "Walking_A",
    scale: 0.68,
    tint: 0xf0e6c8,
  },
};

export function makeMonsterModelRig(assets: GameAssets, typeId: string): Rig & Partial<ModelRig> {
  const look = MONSTER_LOOKS[typeId];
  if (!look) return makeProceduralRig(typeId); // tomb_bloat keeps its custom blob
  const inst = instantiate(assets.characters[look.model]);
  const rig = new AnimRig(inst, look.idle, look.walk, 3);
  rig.group.scale.setScalar(look.scale);
  if (look.weapon) rig.attach("r", cloneWeapon(assets.weapons[look.weapon]));
  if (look.tint !== undefined) {
    rig.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
        obj.material.color.multiplyScalar(1).lerp(new THREE.Color(look.tint!), 0.35);
      }
    });
  }
  return rig;
}

/** Attack clip for a monster swing. */
export function monsterAttackClip(typeId: string): string {
  if (typeId === "gravespit" || typeId === "bog_maw") return "Spellcast_Shoot";
  if (typeId === "barrow_lord" || typeId === "cairn_wight") return "2H_Melee_Attack_Slice";
  if (typeId === "skitter" || typeId === "fen_howler") return "Unarmed_Melee_Attack_Punch_A";
  return "1H_Melee_Attack_Slice_Horizontal";
}
