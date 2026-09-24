import * as THREE from "three";
import { isTwoHanded, type Equipment } from "../../sim/character";
import { BASES } from "../../sim/items/bases";
import type { Item } from "../../sim/items/generate";
import type { Klass } from "../../sim/skills";
import {
  findNode,
  instantiateKit,
  cloneProp, kitMeshes, kitNode,
  type CharacterInstance,
  type GameAssets,
  type KitName,
  type Kits,
} from "./models";
import { captureRestInverses, gripInto, heldModel, wearPiece, wornPlacement } from "./gear";
import {
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
    gripInto(socket, this.spec.grip[slot], obj);
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

/** Shared by both hero families: rarity glow on held weapons is stronger than on armor. */
const WEAPON_GLOW = 0.5;

// ---------------------------------------------------------------------------
const CHEST_LOOKS: Record<string, { color: number; metal: boolean; big: boolean }> = {
  rag_tunic: { color: 0x6a5a44, metal: false, big: false },
  studded_jerkin: { color: 0x4a3a2c, metal: false, big: false },
  grave_plate: { color: 0x8a94a4, metal: true, big: true },
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

// ---------------------------------------------------------------------------
// Synty hero: a Viking Realm human on the goblin locomotion clips, dressed in
// Viking weapons, shields, and helmets from the kits.

/** Which Viking wears each class. */
const SYNTY_HERO_NODES: Record<Klass, string> = {
  warrior: "Warrior_Male_01",
  witch: "Leader_Female_01",
};

/** Heroes stand 1.56 units in the scene (2.17 x 0.72, the height everything was
 * tuned against); Synty humans are authored 1.8 tall. */
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
 * Weapon base id -> Synty weapon node. gear.ts measures each piece's authored
 * axis (Viking swords lie along +Z, most else along +Y) and turns it upright
 * before the grip applies, so the table only says which piece and how big.
 */
interface SyntyWeaponLook {
  kit: KitName;
  node: string;
  twoHanded: boolean;
  scale?: number;
  /** Shift along the upright axis, in hand units, so a piece pivoted mid-shaft
   * is held by its handle end (the wands are cut-down staves). */
  lift?: number;
}

const SYNTY_WEAPONS: Record<string, SyntyWeaponLook> = {
  rusted_blade: { kit: "viking_weapons", node: "Wep_Sword_02", twoHanded: false },
  kingsbane: { kit: "viking_weapons", node: "Wep_Sword_04", twoHanded: false },
  hatchet: { kit: "viking_weapons", node: "Wep_Axe_01", twoHanded: false },
  twin_fang: { kit: "viking_weapons", node: "Wep_Knife_01", twoHanded: false },
  war_maul: { kit: "viking_weapons", node: "Wep_Hammer_01", twoHanded: true },
  grave_scythe: { kit: "viking_weapons", node: "Wep_Axe_04", twoHanded: true },
  dire_flail: { kit: "viking_weapons", node: "Wep_Axe_02", twoHanded: true },
  moon_glaive: { kit: "viking_weapons", node: "Wep_Spear_02", twoHanded: true },
  gnarled_staff: { kit: "goblin_weapons", node: "Wep_Staff_02", twoHanded: true },
  ember_staff: { kit: "goblin_weapons", node: "Wep_Staff_02", twoHanded: true },
  wyrmwood_staff: { kit: "goblin_weapons", node: "Wep_Staff_02", twoHanded: true },
  // The wands: the Dungeon Pack's gem staff at two fifths, lifted so the hand
  // closes on its butt end and the gem rides above the fist.
  bone_wand: { kit: "dungeon_weapons", node: "Wep_Staff_Gem_01", twoHanded: false, scale: 0.4, lift: 0.2 },
  willow_wand: { kit: "dungeon_weapons", node: "Wep_Staff_Gem_01", twoHanded: false, scale: 0.4, lift: 0.2 },
  hexwood_wand: { kit: "dungeon_weapons", node: "Wep_Staff_Gem_01", twoHanded: false, scale: 0.4, lift: 0.2 },
};

/** Helm base id -> Viking attachment nodes stacked on the head. */
const SYNTY_HELMS: Record<string, string[]> = {
  cracked_helm: ["Attach_Helmet_02"],
  bone_visage: ["Attach_Helmet_03", "Attach_Helmet_Horns_01"],
  iron_barbute: ["Attach_Helmet_01"],
  wyrm_skull: ["Attach_Helmet_04", "Attach_Helmet_Wings_01"],
};
const SYNTY_HELM_DEFAULT = ["Attach_Helmet_01"];
/**
 * Chest base id -> Viking fur mantle over the shoulders. Unlike helmets, furs
 * are authored in place over the T-posed character rather than in a bone's
 * frame, so makeSyntyHero re-expresses them in the chest bone's rest frame.
 * The rag tunic wears none; anything unlisted keeps the box pauldrons.
 */
const SYNTY_MANTLES: Record<string, string | null> = {
  rag_tunic: null,
  studded_jerkin: "Attach_Fur_01",
  grave_plate: "Attach_Fur_03",
  lamellar_coat: "Attach_Fur_02",
  bogsteel_plate: "Attach_Fur_04",
};

/** Shield base id -> Viking shield node (round shields share one pivot at the centre back). */
const SYNTY_SHIELDS: Record<string, string> = {
  plank_buckler: "Wep_Shield_Set_02",
  bone_targe: "Wep_Shield_Set_05",
  rimed_kite: "Wep_Shield_01",
  barrow_bulwark: "Wep_Shield_Set_07",
};
const SYNTY_SHIELD_DEFAULT = "Wep_Shield_Set_01";

/**
 * Box overlays for the chest in the Synty rig's bone frames, where X
 * runs along the bone, Y points backward, and Z sideways (measured on the
 * rig). Sizes are in the model's 1.8-unit-tall space.
 */
const SYNTY_OVERLAYS = {
  pauldron: { size: [0.16, 0.16, 0.16] as const, big: [0.2, 0.2, 0.2] as const, offset: [0.03, 0, 0] as const },
  plate: { size: [0.3, 0.18, 0.36] as const, offset: [0.05, -0.04, 0] as const },
};

function makeSyntyHero(inst: CharacterInstance, kits: Kits): HeroModelRig {
  const rig = new AnimRig(inst, SYNTY_HUMAN_RIG, "idle", "run");
  rig.group.scale.setScalar(SYNTY_HERO_SCALE);
  let twoHanded = false;
  let armed = false;

  // Bone rest frames in the character's own space, captured before the first
  // mixer update: pieces authored in place over the bind pose (fur mantles)
  // are re-expressed through them, so equipping one mid-animation lands it
  // where it was authored, not where the bone happens to be.
  const restInverses = captureRestInverses(rig.group);

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
  /** Wear a Viking attachment on the bone its kind rides; false when the kit or bone is missing. */
  const wear = (name: string, item: Item): boolean => {
    const placement = wornPlacement(kits, "viking_attachments", name);
    const bone = placement && rig.bone(placement.role);
    if (!placement || !bone) return false;
    const added = wearPiece(kits, "viking_attachments", name, placement, bone, restInverses.get(bone));
    if (!added) return false;
    for (const piece of added) {
      applyRarityGlow(piece, item);
      gear.push(piece);
    }
    return true;
  };

  const hero = rig as unknown as HeroModelRig;
  hero.setEquipment = (eq: Equipment) => {
    for (const g of gear) g.parent?.remove(g);
    gear.length = 0;

    if (eq.helm) {
      for (const name of SYNTY_HELMS[eq.helm.baseId] ?? SYNTY_HELM_DEFAULT) wear(name, eq.helm);
    }

    if (eq.chest) {
      const look = chestLook(eq.chest.baseId);
      const mat = flatMat(look.color, look.metal ? 0.45 : 0.75);
      const mantle = SYNTY_MANTLES[eq.chest.baseId];
      const furred = mantle ? wear(mantle, eq.chest) : false;
      if (!furred && mantle !== null) {
        const size = look.big ? SYNTY_OVERLAYS.pauldron.big : SYNTY_OVERLAYS.pauldron.size;
        addGear("upperArmL", box(size, SYNTY_OVERLAYS.pauldron.offset, mat), eq.chest);
        addGear("upperArmR", box(size, SYNTY_OVERLAYS.pauldron.offset, mat), eq.chest);
      }
      addGear("chest", box(SYNTY_OVERLAYS.plate.size, SYNTY_OVERLAYS.plate.offset, mat), eq.chest);
    }

    // Boots draw nothing on the model for now: the box greaves hung off the
    // shins, and no pack has boot attachments. The paperdoll's icon carries them.

    const offhand = visibleOffhand(eq);
    if (offhand && isOrb(offhand)) {
      const model = makeOrbModel();
      applyRarityGlow(model, offhand);
      rig.attach("l", model);
    } else if (offhand) {
      const shield = heldModel(kits, "viking_weapons", SYNTY_SHIELDS[offhand.baseId] ?? SYNTY_SHIELD_DEFAULT);
      if (shield) applyRarityGlow(shield, offhand);
      rig.attach("l", shield);
    } else {
      rig.attach("l", null);
    }

    armed = eq.weapon !== null;
    if (eq.weapon) {
      const look = SYNTY_WEAPONS[eq.weapon.baseId] ?? SYNTY_WEAPONS.rusted_blade!;
      twoHanded = look.twoHanded;
      const model = heldModel(kits, look.kit, look.node);
      if (model) {
        if (look.scale !== undefined) model.scale.multiplyScalar(look.scale);
        // The wrapper holds one upright model; lifting it moves the grip down the shaft.
        if (look.lift) model.children[0]!.position.y += look.lift / (look.scale ?? 1);
        applyRarityGlow(model, eq.weapon, WEAPON_GLOW);
      }
      rig.attach("r", model);
    } else {
      twoHanded = false;
      rig.attach("r", null);
    }
  };
  // Every armed swing is the one-handed diagonal slice, two-handers included:
  // the chop read as a windmill on the Viking. Bare hands throw a punch.
  // Skills pick their own clips.
  hero.attackClip = () => (armed ? "attack1h" : "attackUnarmed");
  return hero;
}

/** The player's rig: a Viking from the kits, dressed by equipment. */
export function makeHeroModelRig(assets: GameAssets, klass: Klass): HeroModelRig {
  const inst = instantiateKit(assets.kits, "viking_characters", SYNTY_HERO_NODES[klass], CLIP_KITS.human, SYNTY_HUMAN_RIG);
  if (!inst) throw new Error("The hero needs the viking_characters kit and a clip kit; run bun run assets:synty.");
  return makeSyntyHero(inst, assets.kits);
}

// ---------------------------------------------------------------------------
// Monsters and NPCs

/** How a monster type is drawn: which kit character on which rig, its gaits, size, and prop. */
interface MonsterLook {
  rig: SyntyRigName;
  kit: KitName;
  node: string;
  idle: ClipId;
  walk: ClipId;
  /** Uniform scale bringing the model to the type's in-game height (Synty humanoids are 1.8 tall). */
  scale: number;
  /** Prop held in the right hand, if any. */
  weapon?: string;
  tint?: number;
}

/**
 * Monster type -> look: Dungeon Pack undead and Goblin War Camp raiders.
 * Scales keep the heights the game was tuned at (the hero stands 1.56).
 */
export const MONSTER_LOOKS: Record<string, MonsterLook> = {
  shambler: { rig: "dungeon", kit: "dungeon_characters", node: "Skeleton_Slave_01", idle: "idle", walk: "shamble", scale: 0.89, weapon: "Wep_BrokenSword_01" },
  skitter: { rig: "goblin", kit: "goblin_characters", node: "Prisoner_02", idle: "idle", walk: "run", scale: 0.54, tint: 0x8a5a5a },
  gravespit: { rig: "goblin", kit: "goblin_characters", node: "Shaman_01", idle: "idle", walk: "walk", scale: 0.87, weapon: "Wep_Staff_01", tint: 0x9a8ab8 },
  fen_howler: { rig: "goblin", kit: "goblin_characters", node: "Ranger_01", idle: "idle", walk: "run", scale: 0.7, tint: 0x6a8a4a },
  bog_maw: { rig: "goblin", kit: "goblin_characters", node: "Cook_01", idle: "idle", walk: "walk", scale: 1.13, weapon: "Wep_Cleaver_01", tint: 0x5a7a52 },
  cairn_wight: { rig: "dungeon", kit: "dungeon_characters", node: "Skeleton_Knight", idle: "idleCombat", walk: "walk", scale: 1.18, weapon: "Wep_Straightsword_01", tint: 0xd8d2c0 },
  barrow_lord: { rig: "dungeon", kit: "dungeon_characters", node: "Skeleton_Knight", idle: "idleCombat", walk: "walk", scale: 1.38, weapon: "Wep_Ornate_GreatAxe_01", tint: 0xc9b880 },
  cinder_shade: { rig: "dungeon", kit: "dungeon_characters", node: "Ghost_01", idle: "idle", walk: "run", scale: 0.57, tint: 0xc45a30 },
  ash_revenant: { rig: "dungeon", kit: "dungeon_characters", node: "Skeleton_Soldier_02", idle: "idleCombat", walk: "walk", scale: 1.15, weapon: "Wep_HandAxe_01", tint: 0x8a4a3a },
  ember_hulk: { rig: "dungeon", kit: "dungeon_characters", node: "Rock_Golem", idle: "idle", walk: "shamble", scale: 1.41, tint: 0xd06428 },
  veil_screamer: { rig: "dungeon", kit: "dungeon_characters", node: "Ghost_02", idle: "idle", walk: "walk", scale: 0.98, tint: 0x8a6ab8 },
  crown_sentinel: { rig: "dungeon", kit: "dungeon_characters", node: "Skeleton_Knight", idle: "idleCombat", walk: "walk", scale: 1.32, weapon: "Wep_Ornate_Sword_01", tint: 0x6a7ab0 },
  // The camp vendor: an old knight minding the stall, or a Viking villager.
  __vendor__: { rig: "human", kit: "viking_characters", node: "Peasant_Male_01", idle: "idle", walk: "walk", scale: 0.98 },
  // The camp healer: a pale-robed knight keeping a quiet shrine.
  __healer__: { rig: "human", kit: "viking_characters", node: "Peasant_Female_01", idle: "idle", walk: "walk", scale: 0.93, tint: 0xf0e6c8 },
};

function tintRig(group: THREE.Object3D, tint: number): void {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
      obj.material.color.lerp(new THREE.Color(tint), 0.35);
    }
  });
}

export function makeMonsterModelRig(assets: GameAssets, typeId: string): Rig & Partial<ModelRig> {
  const look = MONSTER_LOOKS[typeId];
  if (!look) return makeProceduralRig(typeId); // tomb_bloat keeps its custom blob
  const inst = instantiateKit(assets.kits, look.kit, look.node, CLIP_KITS[look.rig], RIG_SPECS[look.rig]);
  if (!inst) throw new Error(`Monster "${typeId}" needs the ${look.kit} kit and a clip kit; run bun run assets:synty.`);
  const rig = new AnimRig(inst, RIG_SPECS[look.rig], look.idle, look.walk);
  rig.group.scale.setScalar(look.scale);
  if (look.weapon) rig.attach("r", heldModel(assets.kits, WEAPON_KITS[look.rig], look.weapon));
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
