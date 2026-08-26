import * as THREE from "three";
import type { Equipment } from "../../sim/character";
import { instantiate, type CharacterInstance, type GameAssets, type WeaponName } from "./models";
import { makeMonsterRig as makeProceduralRig, type Rig } from "./rigs";

/**
 * Animated-model rigs on top of the KayKit characters. Same Rig contract as
 * the procedural ones: animate(now, phase, speed) each frame; the fx system
 * still owns group-level transforms.
 */

export interface ModelRig extends Rig {
  /** Play a one-shot clip (attack, death, taunt), then return to locomotion. */
  oneShot(name: string, opts?: { hold?: boolean; timeScale?: number }): void;
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

  oneShot(name: string, opts: { hold?: boolean; timeScale?: number } = {}): void {
    // Force a restart so back-to-back identical attacks replay from the top.
    const action = this.play(name, 0.08, false, true);
    if (!action) return;
    action.timeScale = opts.timeScale ?? 1;
    const dur = (action.getClip().duration / action.timeScale) * 1000;
    this.oneShotUntil = opts.hold ? Number.POSITIVE_INFINITY : performance.now() + dur * 0.85;
  }

  release(): void {
    this.oneShotUntil = 0;
  }

  animate(now: number, _phase: number, speed: number): void {
    const dt = this.lastNow === null ? 1 / 60 : Math.min(0.1, (now - this.lastNow) / 1000);
    this.lastNow = now;
    if (now >= this.oneShotUntil) {
      this.oneShotUntil = 0;
      if (speed > 0.4) {
        const action = this.play(this.walkName);
        if (action) action.timeScale = Math.max(0.6, Math.min(1.6, speed / this.walkSpeedRef));
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

export function makeHeroModelRig(assets: GameAssets): HeroModelRig {
  const inst = instantiate(assets.characters.barbarian);
  const rig = new AnimRig(inst, "Idle", "Running_A", 4.2);
  rig.group.scale.setScalar(0.72);
  let twoHanded = false;

  const hero = rig as unknown as HeroModelRig;
  hero.setEquipment = (eq: Equipment) => {
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
