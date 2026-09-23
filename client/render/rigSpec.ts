/**
 * What the scene asks a character rig to do, independent of which model set
 * the rig was built from. Each model family maps these to its own clip names,
 * bone names, and weapon grip so swapping KayKit for Synty is a data change.
 */

/** Semantic animation ids. A family missing one plays nothing for it. */
export type ClipId =
  | "idle"
  | "idleCombat"
  | "walk"
  /** The slow undead shuffle; families without one fall back to walk. */
  | "shamble"
  | "run"
  | "attack1h"
  /** A flat one-handed cut, the monsters' default swing. */
  | "slash"
  | "attack2h"
  | "attackUnarmed"
  | "attackSpin"
  | "attackChop"
  | "attackSlice"
  | "cast"
  | "castRaise"
  | "cheer"
  | "jump"
  | "taunt"
  | "death";

export type BoneRole =
  | "handR"
  | "handL"
  | "head"
  | "chest"
  | "hips"
  | "upperArmL"
  | "upperArmR"
  | "lowerLegL"
  | "lowerLegR";

/** How a held prop sits in a hand socket: local euler rotation and offset. */
export interface Grip {
  rotation: [number, number, number];
  position: [number, number, number];
}

export type RigFamily = "kaykit" | "synty";

export interface RigSpec {
  family: RigFamily;
  clips: Partial<Record<ClipId, string>>;
  /** Authored bone names; looked up with the same punctuation-stripping the loader applies. */
  bones: Record<BoneRole, string>;
  grip: { r: Grip; l: Grip };
  /** Cells per second at which the walk clip plays at 1x. */
  walkSpeedRef: number;
}

/** KayKit Adventurers/Skeletons: chibi rigs with handslot sockets and ~80 baked clips. */
export const KAYKIT_RIG: RigSpec = {
  family: "kaykit",
  clips: {
    idle: "Idle",
    idleCombat: "Idle_Combat",
    walk: "Walking_A",
    shamble: "Walking_D_Skeletons",
    run: "Running_A",
    attack1h: "1H_Melee_Attack_Slice_Diagonal",
    slash: "1H_Melee_Attack_Slice_Horizontal",
    attack2h: "2H_Melee_Attack_Chop",
    attackUnarmed: "Unarmed_Melee_Attack_Punch_A",
    attackSpin: "2H_Melee_Attack_Spin",
    attackChop: "2H_Melee_Attack_Chop",
    attackSlice: "2H_Melee_Attack_Slice",
    cast: "Spellcast_Shoot",
    castRaise: "Spellcast_Raise",
    cheer: "Cheer",
    jump: "Jump_Full_Short",
    taunt: "Taunt",
    death: "Death_A",
  },
  bones: {
    handR: "handslot.r",
    handL: "handslot.l",
    head: "head",
    chest: "chest",
    hips: "hips",
    upperArmL: "upperarm.l",
    upperArmR: "upperarm.r",
    lowerLegL: "lowerleg.l",
    lowerLegR: "lowerleg.r",
  },
  // KayKit fits main-hand props yaw-flipped 180° in handslot.r (see the
  // bundled 1H_Axe/1H_Sword nodes); without this an axe head faces backward.
  grip: {
    r: { rotation: [0, Math.PI, 0], position: [0, 0.033, 0] },
    l: { rotation: [0, 0, 0], position: [0, 0.033, 0] },
  },
  walkSpeedRef: 3,
};

/**
 * Synty's humanoid rig (Goblin War Camp, Viking Realm) driven by the Goblin
 * Locomotion clip kit. Only locomotion exists so far: swings and casts borrow
 * the fidget swipe and death borrows the hard landing until Mixamo clips land.
 */
export const SYNTY_RIG: RigSpec = {
  family: "synty",
  clips: {
    idle: "Idle_Standing",
    idleCombat: "Idle_Fidget_Menacing",
    walk: "Walk_F",
    shamble: "Walk_F",
    run: "Run_F",
    attack1h: "Idle_Fidget_Swipe",
    slash: "Idle_Fidget_Swipe",
    attack2h: "Idle_Fidget_Swipe",
    attackUnarmed: "Idle_Fidget_Swipe",
    attackSpin: "Idle_Fidget_Swipe",
    attackChop: "Idle_Fidget_Swipe",
    attackSlice: "Idle_Fidget_Swipe",
    cast: "Idle_Fidget_Swipe",
    castRaise: "Idle_Fidget_Swipe",
    cheer: "Jump_Idle",
    jump: "Jump_Idle",
    taunt: "Idle_Fidget_Menacing",
    death: "Land_IdleHard",
  },
  bones: {
    handR: "Hand_R",
    handL: "Hand_L",
    head: "Head",
    chest: "Spine_02",
    hips: "Hips",
    upperArmL: "Shoulder_L",
    upperArmR: "Shoulder_R",
    lowerLegL: "LowerLeg_L",
    lowerLegR: "LowerLeg_R",
  },
  // Measured on the rig: fingers run along the hand bone's X axis and the
  // knuckle line along Z, so a gripped handle lies along Z with the blade
  // toward the index side (-Z on the right hand, +Z on the left). Weapons are
  // authored blade-up (+Y) with the pivot at the grip; the palm centre sits
  // 0.1 along X from the wrist.
  grip: {
    r: { rotation: [Math.PI, 0, 0], position: [-0.1, 0, 0] },
    l: { rotation: [0, 0, 0], position: [0.1, 0, 0] },
  },
  walkSpeedRef: 1.6,
};
