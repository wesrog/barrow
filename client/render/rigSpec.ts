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

/**
 * Clip names for a semantic id, most wanted first. Synty rigs draw on more
 * than one clip kit (the KayKit suite retargeted onto them, and the Goblin
 * Locomotion pack), and a kit may be missing on a machine that has not
 * converted it, so a rig plays the first name it actually has.
 */
export type ClipChoice = string | string[];

export interface RigSpec {
  family: RigFamily;
  clips: Partial<Record<ClipId, ClipChoice>>;
  /** Authored bone names; looked up with the same punctuation-stripping the loader applies. */
  bones: Record<BoneRole, string>;
  grip: { r: Grip; l: Grip };
  /** Cells per second at which the walk clip plays at 1x. */
  walkSpeedRef: number;
}

/** The KayKit suite's names, shared by the KayKit rig and its retargeted copies. */
const KAYKIT_CLIPS = {
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
} as const satisfies Record<ClipId, string>;

/** KayKit Adventurers/Skeletons: chibi rigs with handslot sockets and ~80 baked clips. */
export const KAYKIT_RIG: RigSpec = {
  family: "kaykit",
  clips: KAYKIT_CLIPS,
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
 * Synty's humanoid rig (Goblin War Camp, Viking Realm). Bones and grip were
 * measured on the rig: fingers run along the hand bone's X axis and the
 * knuckle line along Z, so a gripped handle lies along Z with the blade
 * toward the index side (-Z on the right hand, +Z on the left). Weapons are
 * authored blade-up (+Y) with the pivot at the grip; the palm centre sits
 * 0.1 along X from the wrist.
 */
const SYNTY_BONES: Record<BoneRole, string> = {
  handR: "Hand_R",
  handL: "Hand_L",
  head: "Head",
  chest: "Spine_02",
  hips: "Hips",
  upperArmL: "Shoulder_L",
  upperArmR: "Shoulder_R",
  lowerLegL: "LowerLeg_L",
  lowerLegR: "LowerLeg_R",
};
const SYNTY_GRIP = {
  r: { rotation: [Math.PI, 0, 0], position: [-0.1, 0, 0] } as Grip,
  l: { rotation: [0, 0, 0], position: [0.1, 0, 0] } as Grip,
};

/** The Goblin Locomotion pack's stand-ins, used when the KayKit copies are absent. */
const GOBLIN_FALLBACKS: Record<ClipId, string> = {
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
};

function withFallbacks(preferred: Partial<Record<ClipId, string>>): Record<ClipId, string[]> {
  const out = {} as Record<ClipId, string[]>;
  for (const id of Object.keys(GOBLIN_FALLBACKS) as ClipId[]) {
    const first = preferred[id] ?? KAYKIT_CLIPS[id];
    out[id] = first === GOBLIN_FALLBACKS[id] ? [first] : [first, GOBLIN_FALLBACKS[id]];
  }
  return out;
}

/** Humans on the Synty rig (Vikings): the KayKit suite retargeted, goblin clips as backup. */
export const SYNTY_HUMAN_RIG: RigSpec = {
  family: "synty",
  clips: withFallbacks({}),
  bones: SYNTY_BONES,
  grip: SYNTY_GRIP,
  walkSpeedRef: 3,
};

/** Goblins keep their own hunched idle and gait; swings, casts and deaths come from the KayKit copies. */
export const SYNTY_GOBLIN_RIG: RigSpec = {
  family: "synty",
  clips: withFallbacks({
    idle: "Idle_Standing",
    idleCombat: "Idle_Fidget_Menacing",
    walk: "Walk_F",
    shamble: "Walk_F",
    run: "Run_F",
  }),
  bones: SYNTY_BONES,
  grip: SYNTY_GRIP,
  walkSpeedRef: 1.6,
};

/**
 * The Dungeon Pack's Unreal-flavoured rig (skeletons, ghosts, the golem):
 * 43 bones with UE mannequin names. Its hand frames mirror the goblin rig's,
 * so the blade points along +Y of the right hand and -Y of the left.
 */
export const SYNTY_DUNGEON_RIG: RigSpec = {
  family: "synty",
  clips: KAYKIT_CLIPS,
  bones: {
    handR: "hand_r",
    handL: "hand_l",
    head: "head",
    chest: "spine_02",
    hips: "pelvis",
    upperArmL: "upperarm_l",
    upperArmR: "upperarm_r",
    lowerLegL: "calf_l",
    lowerLegR: "calf_r",
  },
  grip: {
    r: { rotation: [0, 0, 0], position: [-0.1, 0, 0] },
    l: { rotation: [Math.PI, 0, 0], position: [0.1, 0, 0] },
  },
  walkSpeedRef: 3,
};
