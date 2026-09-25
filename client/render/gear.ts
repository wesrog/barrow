import * as THREE from "three";
import { cloneProp, kitMeshes, type KitName, type Kits } from "./models";
import type { BoneRole, Grip } from "./rigSpec";

/**
 * Held and worn kit pieces on any rig.
 *
 * Weapons are measured for the axis they were authored along and turned so it
 * runs up +Y, the convention every RigSpec grip assumes (Viking swords and
 * knives lie along +Z, nearly everything else along +Y); shields get the half
 * turn that faces them outward. Worn pieces (helmets, hair, furs, pouches)
 * come in two kinds, told apart by height: authored in the bone's own frame
 * (a helmet pivots where the head bone sits) or in place over the T-posed
 * character (a fur mantle sits at shoulder height in character space) and
 * re-expressed through the bone's rest frame.
 */

export type Axis = "x" | "y" | "z";

export interface AuthoredAxis {
  axis: Axis;
  sign: 1 | -1;
}

/** Pieces whose bounds mislead (a head wider than the haft is long), by kit node. */
export const HELD_AXIS_OVERRIDES: Partial<Record<string, AuthoredAxis>> = {};

/** Bounds of a kit piece in kit space; null when the kit lacks it. */
export function pieceBounds(kits: Kits, kit: KitName, node: string): THREE.Box3 | null {
  const parts = kitMeshes(kits, kit, node);
  if (!parts || parts.length === 0) return null;
  const box = new THREE.Box3();
  const part = new THREE.Box3();
  for (const { mesh, matrix } of parts) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    box.union(part.copy(mesh.geometry.boundingBox!).applyMatrix4(matrix));
  }
  return box;
}

/** The axis a piece is longest along and which way it extends from its pivot. */
export function measureAxis(kits: Kits, kit: KitName, node: string): AuthoredAxis | null {
  const box = pieceBounds(kits, kit, node);
  if (!box) return null;
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const axis: Axis = size.x >= size.y && size.x >= size.z ? "x" : size.y >= size.z ? "y" : "z";
  return { axis, sign: centre[axis] >= 0 ? 1 : -1 };
}

/** The turn that brings an authored length axis onto +Y. */
export function uprightRotation({ axis, sign }: AuthoredAxis): THREE.Euler {
  if (axis === "y") return new THREE.Euler(sign > 0 ? 0 : Math.PI, 0, 0);
  if (axis === "z") return new THREE.Euler(sign > 0 ? -Math.PI / 2 : Math.PI / 2, 0, 0);
  return new THREE.Euler(0, 0, sign > 0 ? Math.PI / 2 : -Math.PI / 2);
}

export function isShieldNode(node: string): boolean {
  return /shield/i.test(node);
}

/**
 * A kit piece ready for a grip: cloned, its length turned up +Y (a shield:
 * faced outward), inside a wrapper the grip may pose. Null when the kit lacks it.
 */
export function heldModel(kits: Kits, kit: KitName, node: string): THREE.Object3D | null {
  const parts = kitMeshes(kits, kit, node);
  if (!parts || parts.length === 0) return null;
  const model = new THREE.Group();
  model.name = node;
  for (const { mesh, matrix } of parts) {
    const clone = cloneProp(mesh);
    matrix.decompose(clone.position, clone.quaternion, clone.scale);
    model.add(clone);
  }
  if (isShieldNode(node)) {
    // Shields face +Z with the boss forward; a half turn puts the painted
    // face outward over the back of the hand (measured in Blender).
    model.rotation.y = Math.PI;
  } else {
    const authored = HELD_AXIS_OVERRIDES[node] ?? measureAxis(kits, kit, node);
    if (authored) model.rotation.copy(uprightRotation(authored));
  }
  const wrapper = new THREE.Group();
  wrapper.name = `held:${node}`;
  wrapper.add(model);
  return wrapper;
}

/** Seat an object in a hand socket with the rig's grip. */
export function gripInto(socket: THREE.Object3D, grip: Grip, obj: THREE.Object3D): void {
  obj.rotation.set(...grip.rotation);
  obj.position.set(...grip.position);
  socket.add(obj);
}

/**
 * A hand-tuned correction on top of a rig's grip, for a piece the measured
 * grip does not seat well: a turn (degrees, XYZ Euler) and a shift, both in
 * the hand bone's frame, and a scale. Tuned in the asset viewer's grip tuner,
 * which prints these numbers; the game applies them with `applyGripAdjust`.
 */
export interface GripAdjust {
  rot: [number, number, number];
  pos: [number, number, number];
  scale: number;
}

export const NO_ADJUST: GripAdjust = { rot: [0, 0, 0], pos: [0, 0, 0], scale: 1 };

const DEG = Math.PI / 180;
const adjustQuat = new THREE.Quaternion();
const adjustEuler = new THREE.Euler();

/**
 * Set a held wrapper to the rig's grip, then the adjustment: the turn applied
 * in the hand's frame (premultiplied), the shift added to the grip's offset,
 * and the scale on top of `baseScale` (the weapon look's own scale).
 */
export function applyGripAdjust(obj: THREE.Object3D, grip: Grip, adjust: GripAdjust | undefined, baseScale = 1): void {
  const a = adjust ?? NO_ADJUST;
  obj.rotation.set(...grip.rotation);
  adjustQuat.setFromEuler(adjustEuler.set(a.rot[0] * DEG, a.rot[1] * DEG, a.rot[2] * DEG));
  obj.quaternion.premultiply(adjustQuat);
  obj.position.set(grip.position[0] + a.pos[0], grip.position[1] + a.pos[1], grip.position[2] + a.pos[2]);
  obj.scale.setScalar(baseScale * a.scale);
}

// ---------------------------------------------------------------------------
// Worn pieces

export type WornFrame = "bone" | "character";

export interface WornPlacement {
  role: BoneRole;
  frame: WornFrame;
  /** Offset in the bone's frame, for bone-frame pieces. */
  offset: readonly [number, number, number];
}

/** Which bone a worn piece rides, by its name. Anything unlisted rides the head. */
const WORN_ROLES: readonly [RegExp, BoneRole][] = [
  [/Fur|Collar|Cape|Backpack|Glider/i, "chest"],
  [/Pouch|Bag|Bottle|Rope|Skull/i, "hips"],
];

// Helmets pivot where the head bone sits; a hair's breadth up seats the rim on the brow.
const HELMET_OFFSET: readonly [number, number, number] = [0, 0.02, 0];
const NO_OFFSET: readonly [number, number, number] = [0, 0, 0];

/**
 * Above this authored height a piece was modelled in place over the T-pose
 * (furs and hoods start at 1.2) rather than in its bone's frame (the tallest
 * hat tops out at 1.0).
 */
export const IN_PLACE_HEIGHT = 1.1;

export function wornPlacement(kits: Kits, kit: KitName, node: string): WornPlacement | null {
  const box = pieceBounds(kits, kit, node);
  if (!box) return null;
  const frame: WornFrame = box.max.y > IN_PLACE_HEIGHT ? "character" : "bone";
  const role = WORN_ROLES.find(([re]) => re.test(node))?.[1] ?? "head";
  const offset = frame === "bone" && /Helmet/i.test(node) ? HELMET_OFFSET : NO_OFFSET;
  return { role, frame, offset };
}

/**
 * Rest-pose frames of a character's bones, inverted, in the character's own
 * space. Capture before the first mixer update, while the skeleton still
 * stands in its bind pose.
 */
export function captureRestInverses(group: THREE.Object3D): Map<THREE.Object3D, THREE.Matrix4> {
  group.updateMatrixWorld(true);
  const groupInverse = group.matrixWorld.clone().invert();
  const out = new Map<THREE.Object3D, THREE.Matrix4>();
  group.traverse((obj) => {
    if (obj instanceof THREE.Bone) out.set(obj, groupInverse.clone().multiply(obj.matrixWorld).invert());
  });
  return out;
}

/**
 * Put a worn piece on a bone: bone-frame pieces sit at the bone with their
 * offset; in-place pieces go through the bone's rest frame so they land where
 * authored whatever the current pose. Returns what was added, for removal;
 * null when the kit lacks the piece or an in-place piece has no rest frame.
 */
export function wearPiece(
  kits: Kits,
  kit: KitName,
  node: string,
  placement: WornPlacement,
  bone: THREE.Object3D,
  restInverse: THREE.Matrix4 | undefined,
): THREE.Object3D[] | null {
  const parts = kitMeshes(kits, kit, node);
  if (!parts || parts.length === 0) return null;
  if (placement.frame === "character" && !restInverse) return null;
  const added: THREE.Object3D[] = [];
  for (const { mesh, matrix } of parts) {
    const clone = cloneProp(mesh);
    const local = placement.frame === "character" ? restInverse!.clone().multiply(matrix) : matrix;
    local.decompose(clone.position, clone.quaternion, clone.scale);
    if (placement.frame === "bone") clone.position.add(new THREE.Vector3(...placement.offset));
    bone.add(clone);
    added.push(clone);
  }
  return added;
}
