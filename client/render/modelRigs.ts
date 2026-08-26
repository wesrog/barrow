import * as THREE from "three";
import type { Equipment } from "../../sim/character";
import type { Item } from "../../sim/items/generate";
import { instantiate, type CharacterInstance, type GameAssets, type WeaponName } from "./models";
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
    if (obj) socket.add(obj);
  }
}

/** Weapon base id -> KayKit weapon model + whether it swings two-handed. */
const WEAPON_LOOKS: Record<string, { model: WeaponName; twoHanded: boolean }> = {
  rusted_blade: { model: "sword_1handed", twoHanded: false },
  hatchet: { model: "axe_1handed", twoHanded: false },
  twin_fang: { model: "dagger", twoHanded: false },
  war_maul: { model: "axe_2handed", twoHanded: true },
  grave_scythe: { model: "sword_2handed", twoHanded: true },
};

function flatMat(color: number, roughness = 0.8): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, flatShading: true });
}

/** Armor meshes sized for the KayKit skeleton, attached straight to bones. */
function helmMesh(baseId: string): THREE.Group {
  const g = new THREE.Group();
  if (baseId === "bone_visage") {
    const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 0), flatMat(0xd9d4c4, 0.6));
    skull.scale.y = 0.8;
    skull.position.y = 0.16;
    skull.castShadow = true;
    g.add(skull);
    for (const side of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 4), flatMat(0xc4bca8, 0.7));
      horn.position.set(side * 0.3, 0.3, 0);
      horn.rotation.z = -side * 0.8;
      g.add(horn);
    }
  } else {
    const dome = new THREE.Mesh(new THREE.IcosahedronGeometry(0.33, 0), flatMat(0x7a8086, 0.5));
    dome.scale.y = 0.75;
    dome.position.y = 0.18;
    dome.castShadow = true;
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.07, 0.6), flatMat(0x5a6066, 0.6));
    brim.position.y = 0.02;
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
  for (const prop of ["1H_Axe", "2H_Axe", "Mug", "Barbarian_Round_Shield"]) {
    const node = rig.group.getObjectByName(prop);
    if (node) node.visible = false;
  }
  const hat = rig.group.getObjectByName("Barbarian_Hat");
  const boneOf = (name: string) => rig.group.getObjectByName(name);
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

    // Helm replaces the hair/hat
    if (hat) hat.visible = !eq.helm;
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
    if (eq.weapon) {
      const look = WEAPON_LOOKS[eq.weapon.baseId] ?? WEAPON_LOOKS.rusted_blade!;
      twoHanded = look.twoHanded;
      const model = assets.weapons[look.model].clone(true);
      const glow = RARITY_GLOW[eq.weapon.rarity];
      if (glow !== undefined) {
        model.traverse((obj) => {
          if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
            obj.material = obj.material.clone();
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
  barrow_lord: {
    model: "skeleton_warrior",
    idle: "Idle_Combat",
    walk: "Walking_A",
    scale: 1.05,
    weapon: "skeleton_axe",
    tint: 0xc9b880,
  },
};

export function makeMonsterModelRig(assets: GameAssets, typeId: string): Rig & Partial<ModelRig> {
  const look = MONSTER_LOOKS[typeId];
  if (!look) return makeProceduralRig(typeId); // tomb_bloat keeps its custom blob
  const inst = instantiate(assets.characters[look.model]);
  const rig = new AnimRig(inst, look.idle, look.walk, 3);
  rig.group.scale.setScalar(look.scale);
  if (look.weapon) rig.attach("r", assets.weapons[look.weapon].clone(true));
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
  if (typeId === "gravespit") return "Spellcast_Shoot";
  if (typeId === "barrow_lord") return "2H_Melee_Attack_Slice";
  if (typeId === "skitter") return "Unarmed_Melee_Attack_Punch_A";
  return "1H_Melee_Attack_Slice_Horizontal";
}
