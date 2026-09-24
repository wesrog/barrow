import * as THREE from "three";
import { isTwoHanded, type Equipment } from "../../sim/character";
import { BASES } from "../../sim/items/bases";
import type { Item } from "../../sim/items/generate";
import type { Klass } from "../../sim/skills";
import {
  findNode,
  instantiate,
  instantiateKit,
  kitNode,
  type CharacterInstance,
  type CharacterName,
  type GameAssets,
  type KitName,
  type Kits,
  type WeaponName,
} from "./models";
import {
  KAYKIT_RIG,
  SYNTY_DUNGEON_RIG,
  SYNTY_GOBLIN_RIG,
  SYNTY_HUMAN_RIG,
  type BoneRole,
  type ClipId,
  type RigFamily,
  type RigSpec,
} from "./rigSpec";
import { makeMonsterRig as makeProceduralRig, type Rig } from "./rigs";

/**
 * Animated-model rigs. Same Rig contract as the procedural ones:
 * animate(now, phase, speed) each frame; the fx system still owns group-level
 * transforms. The scene speaks in semantic ClipIds and bone roles; each model
 * family's RigSpec translates them, so a KayKit skeleton and a Synty goblin
 * are driven by the same calls.
 */

export interface ModelRig extends Rig {
  readonly family: RigFamily;
  /** Play a one-shot clip (attack, death, taunt), then return to locomotion. */
  oneShot(clip: ClipId, opts?: { hold?: boolean; timeScale?: number; cancelOnMove?: boolean }): void;
  /** Cancel a held one-shot (revive after a held death pose). */
  release(): void;
  /** The named bone for a role, if this rig has it. */
  bone(role: BoneRole): THREE.Object3D | null;
  /** Name of the clip playing now (the asset viewer and tests read it). */
  currentClip(): string | null;
  /** Every clip name this rig can play. */
  clipNames(): string[];
}

export interface HeroModelRig extends ModelRig {
  setEquipment(eq: Equipment): void;
  /** Clip for a basic attack with the current weapon. */
  attackClip(): ClipId;
}

const RARITY_GLOW: Record<string, number> = {
  magic: 0x2a3ea0,
  rare: 0x8a7420,
  unique: 0x8a5010,
};

function applyRarityGlow(obj: THREE.Object3D, item: Item, intensity = 0.35): void {
  const glow = RARITY_GLOW[item.rarity];
  if (glow === undefined) return;
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
      child.material.emissive.setHex(glow);
      child.material.emissiveIntensity = intensity;
    }
  });
}

class AnimRig implements ModelRig {
  group: THREE.Group;
  readonly family: RigFamily;
  private inst: CharacterInstance;
  private spec: RigSpec;
  private lastNow: number | null = null;
  private current: THREE.AnimationAction | null = null;
  private oneShotUntil = 0;
  private idleName: string | undefined;
  private walkName: string | undefined;

  constructor(inst: CharacterInstance, spec: RigSpec, idle: ClipId, walk: ClipId) {
    this.inst = inst;
    this.spec = spec;
    this.family = spec.family;
    this.group = inst.group;
    this.idleName = this.clipName(idle) ?? this.clipName("idle");
    // A family without the requested gait walks normally rather than freezing.
    this.walkName = this.clipName(walk) ?? this.clipName("walk");
    if (this.idleName) this.play(this.idleName);
  }

  /** The first name for a semantic clip that this instance actually has. */
  private clipName(clip: ClipId): string | undefined {
    const choice = this.spec.clips[clip];
    if (!choice) return undefined;
    const names = Array.isArray(choice) ? choice : [choice];
    return names.find((n) => this.inst.actions.has(n));
  }

  currentClip(): string | null {
    return this.current?.getClip().name ?? null;
  }

  clipNames(): string[] {
    return [...this.inst.actions.keys()];
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

  oneShot(clip: ClipId, opts: { hold?: boolean; timeScale?: number; cancelOnMove?: boolean } = {}): void {
    const name = this.clipName(clip);
    if (!name) return;
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

  bone(role: BoneRole): THREE.Object3D | null {
    return findNode(this.group, this.spec.bones[role]);
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
      if (speed > 0.4 && this.walkName) {
        const action = this.play(this.walkName);
        if (action) action.timeScale = Math.max(0.6, Math.min(2.4, speed / this.spec.walkSpeedRef));
      } else if (this.idleName) {
        this.play(this.idleName);
      }
    }
    this.inst.mixer.update(dt);
  }

  private attached: { r: THREE.Object3D | null; l: THREE.Object3D | null } = { r: null, l: null };

  attach(slot: "r" | "l", obj: THREE.Object3D | null): void {
    const socket = slot === "r" ? this.inst.handSlotR : this.inst.handSlotL;
    if (!socket) return;
    // Remove only what we added: the sockets also hold the model's own skinned
    // props (round shield, bundled axes) that equipment toggles by visibility.
    this.attached[slot]?.removeFromParent();
    this.attached[slot] = obj;
    if (!obj) return;
    const grip = this.spec.grip[slot];
    obj.rotation.set(...grip.rotation);
    obj.position.set(...grip.position);
    socket.add(obj);
  }
}

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

/** Object3D.clone shares materials; give each held prop its own so
 * per-instance hit flashes, tints, and rarity glow don't leak. */
function cloneProp(model: THREE.Object3D): THREE.Object3D {
  const clone = model.clone(true);
  clone.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      if (obj.material instanceof THREE.Material) obj.material = obj.material.clone();
    }
  });
  return clone;
}

/** Shared by both hero families: rarity glow on held weapons is stronger than on armor. */
const WEAPON_GLOW = 0.5;

// ---------------------------------------------------------------------------
// KayKit hero (fallback): the chibi barbarian with box-built gear overlays.

/** Weapon base id -> KayKit weapon model + whether it swings two-handed.
 *  `scale` shrinks a model that doubles for a smaller weapon (a staff as a wand). */
const KAYKIT_WEAPONS: Record<string, { model: WeaponName; twoHanded: boolean; scale?: number }> = {
  rusted_blade: { model: "sword_1handed", twoHanded: false },
  hatchet: { model: "axe_1handed", twoHanded: false },
  twin_fang: { model: "dagger", twoHanded: false },
  war_maul: { model: "axe_2handed", twoHanded: true },
  grave_scythe: { model: "sword_2handed", twoHanded: true },
  gnarled_staff: { model: "skeleton_staff", twoHanded: true },
  ember_staff: { model: "skeleton_staff", twoHanded: true },
  wyrmwood_staff: { model: "skeleton_staff", twoHanded: true },
  bone_wand: { model: "skeleton_staff", twoHanded: false, scale: 0.5 },
  willow_wand: { model: "skeleton_staff", twoHanded: false, scale: 0.5 },
  hexwood_wand: { model: "skeleton_staff", twoHanded: false, scale: 0.5 },
  dire_flail: { model: "axe_2handed", twoHanded: true },
  moon_glaive: { model: "axe_2handed", twoHanded: true },
  kingsbane: { model: "sword_1handed", twoHanded: false },
};

/**
 * Armor meshes sized for the KayKit skeleton, attached straight to bones.
 * The chibi head is huge — ~1.08 wide, top at y+0.95 above the head bone —
 * so helms must be dome radius ~0.6+ to sit outside the skull.
 */
function kaykitHelm(baseId: string): THREE.Group {
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

function chestLook(baseId: string) {
  return CHEST_LOOKS[baseId] ?? CHEST_LOOKS.rag_tunic!;
}

/** Whether an off-hand item is a caster orb (a shield-slot item that deals damage). */
function isOrb(item: Item): boolean {
  return BASES[item.baseId]!.dmgMin !== undefined;
}

/** The off-hand item that shows: a two-hander fills both hands, so the sim keeps
 * the shield slot empty beside one and anything stale in it (an old save) is inert. */
function visibleOffhand(eq: Equipment): Item | null {
  return eq.weapon && isTwoHanded(eq.weapon) ? null : eq.shield;
}

function makeKayKitHero(assets: GameAssets): HeroModelRig {
  const spec = KAYKIT_RIG;
  const inst = instantiate(assets.characters.barbarian, spec);
  // Low ref speed = fast cadence: at 4.5 cells/s the run cycle plays ~1.8x,
  // matching feet to the ground actually covered.
  const rig = new AnimRig(inst, { ...spec, walkSpeedRef: 2.5 }, "idle", "run");
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

  const gear: THREE.Object3D[] = [];
  const addGear = (role: BoneRole, mesh: THREE.Object3D, item: Item) => {
    const bone = rig.bone(role);
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
    if (eq.helm) addGear("head", kaykitHelm(eq.helm.baseId), eq.helm);

    // Chest: pauldrons on the shoulders, a plate over the chest bone
    if (eq.chest) {
      const look = chestLook(eq.chest.baseId);
      const size = look.big ? 0.34 : 0.26;
      for (const side of ["upperArmL", "upperArmR"] as const) {
        const pauldron = new THREE.Mesh(
          new THREE.BoxGeometry(size, size * 0.7, size),
          flatMat(look.color, look.metal ? 0.45 : 0.75),
        );
        pauldron.castShadow = true;
        pauldron.position.y = 0.06;
        addGear(side, pauldron, eq.chest);
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
      for (const side of ["lowerLegL", "lowerLegR"] as const) {
        const greave = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.22), flatMat(color, 0.7));
        greave.castShadow = true;
        greave.position.y = -0.12;
        addGear(side, greave, eq.boots);
      }
    }
    // Orbs share the shield slot but float over the off hand instead of
    // un-hiding the skinned shield prop.
    const offhand = visibleOffhand(eq);
    const offhandOrb = offhand && isOrb(offhand) ? offhand : null;
    if (shieldProp) {
      shieldProp.visible = !!offhand && !offhandOrb;
      const glow = offhand && !offhandOrb ? RARITY_GLOW[offhand.rarity] : undefined;
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
      const look = KAYKIT_WEAPONS[eq.weapon.baseId] ?? KAYKIT_WEAPONS.rusted_blade!;
      twoHanded = look.twoHanded;
      const model = cloneProp(assets.weapons[look.model]);
      if (look.scale !== undefined) model.scale.multiplyScalar(look.scale);
      applyRarityGlow(model, eq.weapon, WEAPON_GLOW);
      rig.attach("r", model);
    } else {
      twoHanded = false;
      rig.attach("r", null);
    }
  };
  hero.attackClip = () => (twoHanded ? "attack2h" : "attack1h");
  return hero;
}

// ---------------------------------------------------------------------------
// Synty hero: a Viking Realm human on the goblin locomotion clips, dressed in
// Viking weapons, shields, and helmets from the kits.

/** Which Viking wears each class. */
const SYNTY_HERO_NODES: Record<Klass, string> = {
  warrior: "Warrior_Male_01",
  witch: "Leader_Female_01",
};

/** The KayKit barbarian stands 2.17 units bare-headed before his 0.72 scale; Synty humans stand 1.8. */
const SYNTY_HERO_SCALE = (2.17 * 0.72) / 1.8;

/** Clip kits each Synty rig draws on, most wanted first (see rigSpec). */
export const CLIP_KITS = {
  human: ["goblin_kaykit_clips", "goblin_clips"],
  goblin: ["goblin_clips", "goblin_kaykit_clips"],
  dungeon: ["dungeon_kaykit_clips"],
} as const satisfies Record<string, readonly KitName[]>;
type SyntyRigName = keyof typeof CLIP_KITS;
export const RIG_SPECS: Record<SyntyRigName, RigSpec> = { human: SYNTY_HUMAN_RIG, goblin: SYNTY_GOBLIN_RIG, dungeon: SYNTY_DUNGEON_RIG };
/** Where each rig's held props come from; weapons are authored in the same conventions per pack. */
export const WEAPON_KITS: Record<SyntyRigName, KitName> = { human: "viking_weapons", goblin: "goblin_weapons", dungeon: "dungeon_weapons" };

/**
 * Weapon base id -> Synty weapon node. `axis` is the direction the weapon was
 * authored along: most run along +Y (handle up), but Viking swords and knives
 * lie along +Z and get turned onto Y before the grip applies.
 */
interface SyntyWeaponLook {
  kit: KitName;
  node: string;
  twoHanded: boolean;
  axis: "y" | "z";
  scale?: number;
}

const SYNTY_WEAPONS: Record<string, SyntyWeaponLook> = {
  rusted_blade: { kit: "viking_weapons", node: "Wep_Sword_02", twoHanded: false, axis: "z" },
  kingsbane: { kit: "viking_weapons", node: "Wep_Sword_04", twoHanded: false, axis: "z" },
  hatchet: { kit: "viking_weapons", node: "Wep_Axe_01", twoHanded: false, axis: "y" },
  twin_fang: { kit: "viking_weapons", node: "Wep_Knife_01", twoHanded: false, axis: "z" },
  war_maul: { kit: "viking_weapons", node: "Wep_Hammer_01", twoHanded: true, axis: "y" },
  grave_scythe: { kit: "viking_weapons", node: "Wep_Axe_04", twoHanded: true, axis: "y" },
  dire_flail: { kit: "viking_weapons", node: "Wep_Axe_02", twoHanded: true, axis: "y" },
  moon_glaive: { kit: "viking_weapons", node: "Wep_Spear_02", twoHanded: true, axis: "y" },
  gnarled_staff: { kit: "goblin_weapons", node: "Wep_Staff_02", twoHanded: true, axis: "y" },
  ember_staff: { kit: "goblin_weapons", node: "Wep_Staff_02", twoHanded: true, axis: "y" },
  wyrmwood_staff: { kit: "goblin_weapons", node: "Wep_Staff_02", twoHanded: true, axis: "y" },
  bone_wand: { kit: "goblin_weapons", node: "Wep_Staff_01", twoHanded: false, axis: "y", scale: 0.5 },
  willow_wand: { kit: "goblin_weapons", node: "Wep_Staff_01", twoHanded: false, axis: "y", scale: 0.5 },
  hexwood_wand: { kit: "goblin_weapons", node: "Wep_Staff_01", twoHanded: false, axis: "y", scale: 0.5 },
};

/** Helm base id -> Viking attachment nodes stacked on the head. */
const SYNTY_HELMS: Record<string, string[]> = {
  cracked_helm: ["Attach_Helmet_02"],
  bone_visage: ["Attach_Helmet_03", "Attach_Helmet_Horns_01"],
  iron_barbute: ["Attach_Helmet_01"],
  wyrm_skull: ["Attach_Helmet_04", "Attach_Helmet_Wings_01"],
};
const SYNTY_HELM_DEFAULT = ["Attach_Helmet_01"];
// Helmets pivot where the head bone sits; a hair's breadth up seats the rim on the brow.
const SYNTY_HELM_OFFSET: [number, number, number] = [0, 0.02, 0];

/** Shield base id -> Viking shield node (round shields share one pivot at the centre back). */
const SYNTY_SHIELDS: Record<string, string> = {
  plank_buckler: "Wep_Shield_Set_02",
  bone_targe: "Wep_Shield_Set_05",
  rimed_kite: "Wep_Shield_01",
  barrow_bulwark: "Wep_Shield_Set_07",
};
const SYNTY_SHIELD_DEFAULT = "Wep_Shield_Set_01";

/**
 * Box overlays for chest and boots in the Synty rig's bone frames, where X
 * runs along the bone, Y points backward, and Z sideways (measured on the
 * rig). Sizes are in the model's 1.8-unit-tall space.
 */
const SYNTY_OVERLAYS = {
  pauldron: { size: [0.16, 0.16, 0.16] as const, big: [0.2, 0.2, 0.2] as const, offset: [0.03, 0, 0] as const },
  plate: { size: [0.3, 0.18, 0.36] as const, offset: [0.05, -0.04, 0] as const },
  greave: { size: [0.26, 0.13, 0.13] as const, offset: [0.2, 0, 0] as const },
};

/** Wrap a Synty weapon so its authored axis lands on +Y, the grip's convention. */
function orientWeapon(model: THREE.Object3D, look: SyntyWeaponLook): THREE.Object3D {
  if (look.scale !== undefined) model.scale.multiplyScalar(look.scale);
  if (look.axis === "y") return model;
  // Measured in Blender: a quarter turn about X brings a +Z blade out the thumb side.
  const wrapper = new THREE.Group();
  model.rotation.x = Math.PI / 2;
  wrapper.add(model);
  return wrapper;
}

function makeSyntyHero(inst: CharacterInstance, kits: Kits): HeroModelRig {
  const rig = new AnimRig(inst, SYNTY_HUMAN_RIG, "idle", "run");
  rig.group.scale.setScalar(SYNTY_HERO_SCALE);
  let twoHanded = false;

  const gear: THREE.Object3D[] = [];
  const addGear = (role: BoneRole, mesh: THREE.Object3D, item: Item) => {
    const bone = rig.bone(role);
    if (!bone) return;
    applyRarityGlow(mesh, item);
    bone.add(mesh);
    gear.push(mesh);
  };
  const box = (size: readonly [number, number, number], offset: readonly [number, number, number], mat: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
    mesh.position.set(...offset);
    mesh.castShadow = true;
    return mesh;
  };

  const hero = rig as unknown as HeroModelRig;
  hero.setEquipment = (eq: Equipment) => {
    for (const g of gear) g.parent?.remove(g);
    gear.length = 0;

    if (eq.helm) {
      for (const name of SYNTY_HELMS[eq.helm.baseId] ?? SYNTY_HELM_DEFAULT) {
        const src = kitNode(kits, "viking_attachments", name);
        if (!src) continue;
        const helm = cloneProp(src);
        helm.position.set(...SYNTY_HELM_OFFSET);
        addGear("head", helm, eq.helm);
      }
    }

    if (eq.chest) {
      const look = chestLook(eq.chest.baseId);
      const mat = flatMat(look.color, look.metal ? 0.45 : 0.75);
      const size = look.big ? SYNTY_OVERLAYS.pauldron.big : SYNTY_OVERLAYS.pauldron.size;
      addGear("upperArmL", box(size, SYNTY_OVERLAYS.pauldron.offset, mat), eq.chest);
      addGear("upperArmR", box(size, SYNTY_OVERLAYS.pauldron.offset, mat), eq.chest);
      addGear("chest", box(SYNTY_OVERLAYS.plate.size, SYNTY_OVERLAYS.plate.offset, mat), eq.chest);
    }

    if (eq.boots) {
      const mat = flatMat(BOOT_LOOKS[eq.boots.baseId] ?? 0x5a4530, 0.7);
      addGear("lowerLegL", box(SYNTY_OVERLAYS.greave.size, SYNTY_OVERLAYS.greave.offset, mat), eq.boots);
      addGear("lowerLegR", box(SYNTY_OVERLAYS.greave.size, SYNTY_OVERLAYS.greave.offset, mat), eq.boots);
    }

    const offhand = visibleOffhand(eq);
    if (offhand && isOrb(offhand)) {
      const model = makeOrbModel();
      applyRarityGlow(model, offhand);
      rig.attach("l", model);
    } else if (offhand) {
      const src = kitNode(kits, "viking_weapons", SYNTY_SHIELDS[offhand.baseId] ?? SYNTY_SHIELD_DEFAULT);
      if (src) {
        // Shields face +Z with the boss forward; a half turn puts the painted
        // face outward over the back of the hand (measured in Blender).
        const shield = cloneProp(src);
        shield.rotation.y = Math.PI;
        const wrapper = new THREE.Group();
        wrapper.add(shield);
        applyRarityGlow(wrapper, offhand);
        rig.attach("l", wrapper);
      } else {
        rig.attach("l", null);
      }
    } else {
      rig.attach("l", null);
    }

    if (eq.weapon) {
      const look = SYNTY_WEAPONS[eq.weapon.baseId] ?? SYNTY_WEAPONS.rusted_blade!;
      twoHanded = look.twoHanded;
      const src = kitNode(kits, look.kit, look.node);
      if (src) {
        const model = orientWeapon(cloneProp(src), look);
        applyRarityGlow(model, eq.weapon, WEAPON_GLOW);
        rig.attach("r", model);
      } else {
        rig.attach("r", null);
      }
    } else {
      twoHanded = false;
      rig.attach("r", null);
    }
  };
  hero.attackClip = () => (twoHanded ? "attack2h" : "attack1h");
  return hero;
}

/**
 * The player's rig: a Viking from the Synty kits when they loaded, else the
 * KayKit barbarian. Both answer the same semantic clips and equipment calls.
 */
export function makeHeroModelRig(assets: GameAssets, klass: Klass): HeroModelRig {
  const inst = instantiateKit(assets.kits, "viking_characters", SYNTY_HERO_NODES[klass], CLIP_KITS.human, SYNTY_HUMAN_RIG);
  return inst ? makeSyntyHero(inst, assets.kits) : makeKayKitHero(assets);
}

// ---------------------------------------------------------------------------
// Monsters and NPCs

/** A monster's look in one model family. */
interface MonsterLook {
  idle: ClipId;
  walk: ClipId;
  /** Uniform scale bringing the model to the type's in-game height. */
  scale: number;
  /** Prop held in the right hand, if any. */
  weapon?: string;
  tint?: number;
}

/**
 * Monster type -> how each family draws it. KayKit skeletons are the
 * fallback; with the Synty kits present the crypt fills with Dungeon Pack
 * undead and Goblin War Camp raiders. Scales match the KayKit heights: KayKit
 * characters stand 2.15-2.6 units before their look's scale, Synty humanoids
 * 1.8, the troll 1.82, the Dungeon Pack skeletons 1.8-1.95 and ghosts 1.8-1.9.
 */
interface MonsterLooks {
  kaykit: MonsterLook & { model: CharacterName; weapon?: WeaponName };
  synty?: MonsterLook & { rig: SyntyRigName; kit: KitName; node: string };
}

export const MONSTER_LOOKS: Record<string, MonsterLooks> = {
  shambler: {
    kaykit: { model: "skeleton_warrior", idle: "idle", walk: "shamble", scale: 0.62, weapon: "skeleton_blade" },
    synty: { rig: "dungeon", kit: "dungeon_characters", node: "Skeleton_Slave_01", idle: "idle", walk: "shamble", scale: 0.89, weapon: "Wep_BrokenSword_01" },
  },
  skitter: {
    kaykit: { model: "skeleton_minion", idle: "idle", walk: "run", scale: 0.45, tint: 0x8a5a5a },
    synty: { rig: "goblin", kit: "goblin_characters", node: "Prisoner_02", idle: "idle", walk: "run", scale: 0.54, tint: 0x8a5a5a },
  },
  gravespit: {
    kaykit: { model: "skeleton_mage", idle: "idle", walk: "walk", scale: 0.6, weapon: "skeleton_staff", tint: 0x9a8ab8 },
    synty: { rig: "goblin", kit: "goblin_characters", node: "Shaman_01", idle: "idle", walk: "walk", scale: 0.87, weapon: "Wep_Staff_01", tint: 0x9a8ab8 },
  },
  fen_howler: {
    kaykit: { model: "skeleton_rogue", idle: "idle", walk: "run", scale: 0.55, tint: 0x6a8a4a },
    synty: { rig: "goblin", kit: "goblin_characters", node: "Ranger_01", idle: "idle", walk: "run", scale: 0.7, tint: 0x6a8a4a },
  },
  bog_maw: {
    kaykit: { model: "skeleton_mage", idle: "idle", walk: "walk", scale: 0.78, weapon: "skeleton_staff", tint: 0x5a7a52 },
    synty: { rig: "goblin", kit: "goblin_characters", node: "Cook_01", idle: "idle", walk: "walk", scale: 1.13, weapon: "Wep_Cleaver_01", tint: 0x5a7a52 },
  },
  cairn_wight: {
    kaykit: { model: "skeleton_warrior", idle: "idleCombat", walk: "walk", scale: 0.9, weapon: "skeleton_axe", tint: 0xd8d2c0 },
    synty: { rig: "dungeon", kit: "dungeon_characters", node: "Skeleton_Knight", idle: "idleCombat", walk: "walk", scale: 1.18, weapon: "Wep_Straightsword_01", tint: 0xd8d2c0 },
  },
  barrow_lord: {
    kaykit: { model: "skeleton_warrior", idle: "idleCombat", walk: "walk", scale: 1.05, weapon: "skeleton_axe", tint: 0xc9b880 },
    synty: { rig: "dungeon", kit: "dungeon_characters", node: "Skeleton_Knight", idle: "idleCombat", walk: "walk", scale: 1.38, weapon: "Wep_Ornate_GreatAxe_01", tint: 0xc9b880 },
  },
  cinder_shade: {
    kaykit: { model: "skeleton_minion", idle: "idle", walk: "run", scale: 0.5, tint: 0xc45a30 },
    synty: { rig: "dungeon", kit: "dungeon_characters", node: "Ghost_01", idle: "idle", walk: "run", scale: 0.57, tint: 0xc45a30 },
  },
  ash_revenant: {
    kaykit: { model: "skeleton_warrior", idle: "idleCombat", walk: "walk", scale: 0.8, weapon: "skeleton_blade", tint: 0x8a4a3a },
    synty: { rig: "dungeon", kit: "dungeon_characters", node: "Skeleton_Soldier_02", idle: "idleCombat", walk: "walk", scale: 1.15, weapon: "Wep_HandAxe_01", tint: 0x8a4a3a },
  },
  ember_hulk: {
    kaykit: { model: "skeleton_warrior", idle: "idle", walk: "shamble", scale: 1.0, tint: 0xd06428 },
    synty: { rig: "dungeon", kit: "dungeon_characters", node: "Rock_Golem", idle: "idle", walk: "shamble", scale: 1.41, tint: 0xd06428 },
  },
  veil_screamer: {
    kaykit: { model: "skeleton_mage", idle: "idle", walk: "walk", scale: 0.68, weapon: "skeleton_staff", tint: 0x8a6ab8 },
    synty: { rig: "dungeon", kit: "dungeon_characters", node: "Ghost_02", idle: "idle", walk: "walk", scale: 0.98, tint: 0x8a6ab8 },
  },
  crown_sentinel: {
    kaykit: { model: "skeleton_warrior", idle: "idleCombat", walk: "walk", scale: 1.0, weapon: "skeleton_axe", tint: 0x6a7ab0 },
    synty: { rig: "dungeon", kit: "dungeon_characters", node: "Skeleton_Knight", idle: "idleCombat", walk: "walk", scale: 1.32, weapon: "Wep_Ornate_Sword_01", tint: 0x6a7ab0 },
  },
  // The camp vendor: an old knight minding the stall, or a Viking villager.
  __vendor__: {
    kaykit: { model: "knight", idle: "idle", walk: "walk", scale: 0.72 },
    synty: { rig: "human", kit: "viking_characters", node: "Peasant_Male_01", idle: "idle", walk: "walk", scale: 0.98 },
  },
  // The camp healer: a pale-robed knight keeping a quiet shrine.
  __healer__: {
    kaykit: { model: "knight", idle: "idle", walk: "walk", scale: 0.68, tint: 0xf0e6c8 },
    synty: { rig: "human", kit: "viking_characters", node: "Peasant_Female_01", idle: "idle", walk: "walk", scale: 0.93, tint: 0xf0e6c8 },
  },
};

function tintRig(group: THREE.Object3D, tint: number): void {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
      obj.material.color.lerp(new THREE.Color(tint), 0.35);
    }
  });
}

export function makeMonsterModelRig(assets: GameAssets, typeId: string): Rig & Partial<ModelRig> {
  const looks = MONSTER_LOOKS[typeId];
  if (!looks) return makeProceduralRig(typeId); // tomb_bloat keeps its custom blob

  const synty = looks.synty;
  const inst = synty && instantiateKit(assets.kits, synty.kit, synty.node, CLIP_KITS[synty.rig], RIG_SPECS[synty.rig]);
  if (synty && inst) {
    const rig = new AnimRig(inst, RIG_SPECS[synty.rig], synty.idle, synty.walk);
    rig.group.scale.setScalar(synty.scale);
    const weapon = synty.weapon ? kitNode(assets.kits, WEAPON_KITS[synty.rig], synty.weapon) : null;
    if (weapon) rig.attach("r", cloneProp(weapon));
    if (synty.tint !== undefined) tintRig(rig.group, synty.tint);
    return rig;
  }

  const look = looks.kaykit;
  const rig = new AnimRig(instantiate(assets.characters[look.model], KAYKIT_RIG), KAYKIT_RIG, look.idle, look.walk);
  rig.group.scale.setScalar(look.scale);
  if (look.weapon) rig.attach("r", cloneProp(assets.weapons[look.weapon]));
  if (look.tint !== undefined) tintRig(rig.group, look.tint);
  return rig;
}

/** Attack clip for a monster swing. */
export function monsterAttackClip(typeId: string): ClipId {
  if (typeId === "gravespit" || typeId === "bog_maw" || typeId === "veil_screamer") return "cast";
  if (typeId === "barrow_lord" || typeId === "cairn_wight" || typeId === "crown_sentinel") return "attackSlice";
  if (typeId === "skitter" || typeId === "fen_howler" || typeId === "cinder_shade" || typeId === "ember_hulk")
    return "attackUnarmed";
  return "slash";
}
