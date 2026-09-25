"""Convert Synty POLYGON source FBX into GLB kits the client can load.

Run with Blender (5.0+), from the repo root:

    bun run assets:synty                                  # every pack, every kit
    PACKS=goblin_war_camp KITS=characters bun run assets:synty   # filters, comma separated

Reads  assets-src/synty/<pack>/   (gitignored: Synty EULA, not redistributable)
Writes public/models/synty/<pack>/<kit>.glb (gitignored for the same reason)

Each kit is one GLB: every piece is a top-level node at the origin, named by its
FBX stem without the SM_ / SK_Chr_ / SM_Chr_ prefix, and meshes share one
material per texture so a kit is a handful of atlas uploads. Characters keep
their skeleton; a pack's combined character file is split into one rig per
character. Materials come from the pack's MaterialList text file; a mesh whose
Unity shader has no plain texture (triplanar snow, ice, water) is skipped.

A clip kit is one GLB holding a mesh-less rig and one animation per clip,
retargeted onto the rig of a character pack. Any character sharing that rig's
bone names plays them. Two sources:

- Synty ANIMATION packs: per-clip FBX on a skeleton with the same joints but
  differently oriented joint frames (Unity's Humanoid retargeting hides this).
  Each bone gets a fixed frame offset measured between the two rigs' T-poses:
  the character's bind pose and the clip skeleton with only its joint orients.
- KayKit character GLBs (CC0): a different skeleton, mapped bone by bone. The
  T-poses are both bind poses; each mapped bone's rest direction is aligned
  first, then the same frame-offset trick applies, and hip motion is scaled by
  the ratio of the rigs' hip heights. Unmapped bones (fingers, extra spine
  links) ride rigidly with their parent.
"""

import fnmatch
import math
import os
import re
from pathlib import Path

import bpy
from io_scene_fbx import parse_fbx
from mathutils import Euler, Matrix, Vector

ROOT = Path(__file__).resolve().parent.parent
SRC_ROOT = ROOT / "assets-src" / "synty"
OUT_ROOT = ROOT / "public" / "models" / "synty"

# Without a NORMAL attribute GLTFLoader turns on flatShading, which is the
# game's look anyway, and the exporter no longer splits vertices along hard
# edges: the dungeon weapons kit drops from 4.8 MB to about a third. Set True
# to keep Synty's smooth-shaded curves at that cost.
KEEP_NORMALS = False

# Atlases arrive at 1024 to 4096, but they are flat colour swatches (the
# Dungeon Pack's native atlas is 1024) and a 2048 atlas PNG is 2 MB inside
# every kit that uses it. Leaf cards are seen from an isometric distance.
MAX_TEXTURE = 1024
MAX_CUTOUT_TEXTURE = 1024

# Synty ships each atlas in palette variants _A, _B, _C with the same layout.
# Fold every variant onto _A so a kit carries one copy of each atlas.
PALETTE_VARIANT_RE = re.compile(r"^(.*_\d\d)_[B-Z](\.\w+)$")

# Pieces that use tiling textures, particle stand-ins, culled duplicates, or
# are scene dressing presets rather than placeable props.
EXCLUDE = [
    "*_Texture*", "*_Culled_*", "*_DoubleSided*", "*_Particle*", "*_Godot*", "*_Preset*",
    "*_Optimised_*", "*_Rigged_*", "*_Collision*",
]

# Faces whose vertex colour blue channel is above this are leaves in Synty's
# tree shader; the rest are trunk. Measured on the Alpine pines: trunk 0.0,
# leaves 1.0, with green carrying wind sway.
LEAF_BLUE = 0.5

# KayKit clips reused on Synty rigs (target bone -> KayKit bone). KayKit has
# one fewer spine link and no fingers; those ride with their parents.
SYNTY_FROM_KAYKIT = {
    "Root": "root", "Hips": "hips", "Spine_01": "spine", "Spine_02": "chest", "Head": "head",
    "Shoulder_L": "upperarm.l", "Elbow_L": "lowerarm.l", "Hand_L": "hand.l",
    "Shoulder_R": "upperarm.r", "Elbow_R": "lowerarm.r", "Hand_R": "hand.r",
    "UpperLeg_L": "upperleg.l", "LowerLeg_L": "lowerleg.l", "Ankle_L": "foot.l", "Ball_L": "toes.l",
    "UpperLeg_R": "upperleg.r", "LowerLeg_R": "lowerleg.r", "Ankle_R": "foot.r", "Ball_R": "toes.r",
}
UE_FROM_KAYKIT = {
    "root": "root", "pelvis": "hips", "spine_01": "spine", "spine_02": "chest", "head": "head",
    "upperarm_l": "upperarm.l", "lowerarm_l": "lowerarm.l", "hand_l": "hand.l",
    "upperarm_r": "upperarm.r", "lowerarm_r": "lowerarm.r", "hand_r": "hand.r",
    "thigh_l": "upperleg.l", "calf_l": "lowerleg.l", "foot_l": "foot.l", "ball_l": "toes.l",
    "thigh_r": "upperleg.r", "calf_r": "lowerleg.r", "foot_r": "foot.r", "ball_r": "toes.r",
}

# The KayKit clips worth carrying over: locomotion, every melee and spell
# swing the game uses, reactions, and a few flourishes.
KAYKIT_CLIPS = [
    "Idle", "Idle_B", "Idle_Combat", "Unarmed_Idle", "2H_Melee_Idle",
    "Walking_A", "Walking_B", "Walking_D_Skeletons", "Running_A", "Running_B",
    "1H_Melee_Attack_Chop", "1H_Melee_Attack_Slice_Diagonal", "1H_Melee_Attack_Slice_Horizontal", "1H_Melee_Attack_Stab",
    "2H_Ranged_Aiming", "2H_Ranged_Shoot", "2H_Ranged_Shooting", "2H_Ranged_Reload",
    "2H_Melee_Attack_Chop", "2H_Melee_Attack_Slice", "2H_Melee_Attack_Spin", "2H_Melee_Attack_Stab",
    "Unarmed_Melee_Attack_Punch_A", "Unarmed_Melee_Attack_Punch_B", "Unarmed_Melee_Attack_Kick",
    "Spellcast_Shoot", "Spellcast_Raise", "Spellcast_Long", "Spellcasting",
    "Cheer", "Taunt", "Interact", "PickUp", "Throw", "Block", "Block_Hit",
    "Dodge_Backward", "Dodge_Forward", "Dodge_Left", "Dodge_Right",
    "Jump_Full_Short", "Jump_Full_Long", "Jump_Idle", "Jump_Land",
    "Hit_A", "Hit_B", "Death_A", "Death_B", "Lie_Idle", "Sit_Floor_Idle",
    "Skeletons_Awaken_Standing", "Spawn_Ground",
]
KAYKIT_SOURCES = ["assets-src/kaykit/characters/Skeleton_Warrior.glb", "assets-src/kaykit/characters/Barbarian.glb"]

# KayKit's chibi holds its short arms out at about 27 degrees below horizontal
# while standing; on a human that reads as a zombie stance. Calm clips get the
# upper arms turned down further about the body's forward axis; swings, casts
# and reactions keep their authored arcs.
ARM_RELAX_DEGREES = 32
CALM_CLIPS = ["Idle", "Idle_B", "Unarmed_Idle", "Walking_A", "Walking_B", "Walking_D_Skeletons", "Running_A", "Running_B", "Interact", "PickUp"]

# pack -> layout, texture rules, and kits. `root` is a subfolder some zips
# add above FBX/ and Textures/. `static_scale` undoes Blender's FBX unit
# conversion for packs whose static meshes were authored in metres inside a
# centimetre file (the 2018 Dungeon Pack); newer packs import at true size.
# `albedo`/`emissive` are the fallbacks when the material list has no entry;
# the emissive map only applies to meshes on that atlas.
PACKS = {
    "dungeon": {
        "material_lists": ["MaterialList_PolygonDungeon.txt"],
        "static_scale": 100,
        "albedo": "Dungeons_Texture_01.png",
        "emissive": "Emmisive_01.png",
        # Names the material list uses that shipped under other file names.
        "aliases": {
            "PolygonDungeon_01.png": "Dungeons_Texture_01.png",
            "PolygonDungeon_02.png": "Dungeons_Texture_02.png",
            "Ghosts_01.tif": "Dungeons_Texture_Ghosts.tif",
        },
        "translucent": ["Ghost_01", "Ghost_02"],
        "kits": {
            "characters": {
                "include": ["FBX/Characters/Unreal_Characters/SK_Chr_*.fbx"],
                "rigged": True,
                "emissive": True,
            },
            "dungeon": {
                "include": [
                    "FBX/SM_Env_Wall_*.fbx", "FBX/SM_Env_Tiles_*.fbx", "FBX/SM_Env_Pillar_*.fbx",
                    "FBX/SM_Env_Rune_*.fbx", "FBX/SM_Env_Stairs_*.fbx", "FBX/SM_Env_Ceiling_Arch_*.fbx",
                    "FBX/SM_Env_Door*.fbx", "FBX/SM_Env_Entrance_*.fbx", "FBX/SM_Env_Bone*.fbx",
                    "FBX/SM_Env_Rubble_*.fbx", "FBX/SM_Env_GlowingOrb_*.fbx", "FBX/SM_Env_Cave_*.fbx",
                    "FBX/SM_Env_Stalagmite_*.fbx", "FBX/SM_Env_Stalactite_*.fbx", "FBX/SM_Env_Rock_*.fbx",
                    "FBX/SM_Env_RockPile_*.fbx", "FBX/SM_Env_Mushroom_*.fbx", "FBX/SM_Env_Wood_*.fbx",
                    "FBX/SM_Env_Railing_*.fbx",
                ],
                "emissive": True,
            },
            "props": {"include": ["FBX/SM_Prop_*.fbx", "FBX/SM_Item_*.fbx"], "emissive": True},
            # No emissive on weapons: the client paints rarity glow as a flat
            # emissive colour, which an emissive map would mask to its bright spots.
            "weapons": {"include": ["FBX/SM_Wep_*.fbx"], "emissive": False},
        },
    },
    "goblin_war_camp": {
        "material_lists": ["MaterialList_PolygonGoblinWarCamp.txt"],
        "static_scale": 1,
        "albedo": "PolygonGoblinWarCamp_Texture_01_A.png",
        "emissive": "PolygonGoblinWarCamp_Emissive_01_A.png",
        "aliases": {},
        "translucent": [],
        "kits": {
            # One armature with every goblin as a child mesh; split per mesh.
            "characters": {
                "include": ["FBX/Characters/Characters.fbx", "FBX/Characters/CharactersBR.fbx"],
                "rigged": True,
                "split": True,
                "emissive": True,
            },
            "attachments": {"include": ["FBX/Characters/Attachments/*.fbx"], "emissive": True},
            "camp": {
                "include": [
                    "FBX/Buildings/*.fbx", "FBX/Vehicles/*.fbx",
                    "FBX/Environment/SM_Env_Barrier_Base_*.fbx", "FBX/Environment/SM_Env_Bones_*.fbx",
                    "FBX/Environment/SM_Env_Bush_*.fbx", "FBX/Environment/SM_Env_Fern_*.fbx",
                    "FBX/Environment/SM_Env_Log_*.fbx", "FBX/Environment/SM_Env_Mushroom_*.fbx",
                    "FBX/Environment/SM_Env_Pebbles_*.fbx", "FBX/Environment/SM_Env_Ramp_*.fbx",
                    "FBX/Environment/SM_Env_Rock_*.fbx", "FBX/Environment/SM_Env_Root_*.fbx",
                    "FBX/Environment/SM_Env_Stump_*.fbx", "FBX/Environment/SM_Env_Swamp_Mound_*.fbx",
                    "FBX/Environment/SM_Env_Tree_Marsh_*.fbx", "FBX/Environment/SM_Env_Vine_*.fbx",
                ],
                "emissive": True,
            },
            "props": {"include": ["FBX/Props/*.fbx"], "emissive": True},
            "weapons": {"include": ["FBX/Weapons/SM_Wep_*.fbx"], "emissive": False},
        },
    },
    "alpine_mountain": {
        "material_lists": ["MaterialList_PNB_Alpine_Mountain.txt"],
        "static_scale": 1,
        "albedo": "PolygonNatureBiomesS2_Alpine_Texture_01.png",
        "emissive": None,
        "aliases": {},
        "translucent": [],
        "kits": {
            "nature": {
                "include": [
                    "FBX/Environment/SM_Env_Pine_*.fbx", "FBX/Environment/SM_Env_Rock_*.fbx",
                    "FBX/Environment/SM_Env_Bush_*.fbx", "FBX/Environment/SM_Env_Branch_*.fbx",
                    "FBX/Environment/SM_Env_Flowers_*.fbx", "FBX/Environment/SM_Env_Grass_01.fbx",
                    "FBX/Environment/SM_Env_GroundCover_*.fbx", "FBX/Environment/SM_Env_Ground_Mound_*.fbx",
                    "FBX/Environment/SM_Env_Moss_Lumps_*.fbx", "FBX/Environment/SM_Env_Snow_Mound_*.fbx",
                    "FBX/Environment/SM_Env_Stalactite_*.fbx",
                ],
                "emissive": False,
            },
            "props": {"include": ["FBX/Props/*.fbx"], "emissive": False},
        },
    },
    "viking_realm": {
        "root": "SourceFiles",
        "material_lists": ["MaterialList_PolygonVikingRealm.txt"],
        "static_scale": 1,
        "albedo": "PolygonVikingRealm_Texture_01_A.png",
        "emissive": "PolygonVikingRealm_Emissive_01_A.png",
        "aliases": {},
        "translucent": [],
        "kits": {
            # Same rig as the goblins (50 bones, same names), so the goblin
            # locomotion clips play on these too.
            "characters": {
                "include": ["FBX/VikingRealm_Characters.fbx"],
                "rigged": True,
                "split": True,
                "emissive": True,
            },
            "attachments": {"include": ["FBX/SM_Chr_Attach_*.fbx"], "emissive": True},
            "village": {
                "include": ["FBX/SM_Bld_*.fbx", "FBX/SM_Veh_*.fbx", "FBX/SM_Env_Rock_*.fbx"],
                "emissive": True,
            },
            # The outdoor scatter set, kept lean because the game loads it for every
            # surface region: single-material pines (1 to 2k triangles), berry bushes,
            # standing stones, and the roof grass tufts, which double as ground tufts.
            # The pre-grouped pine clumps are 10k-triangle set pieces and stay out.
            "nature": {
                "include": [
                    "FBX/SM_Env_Tree_*.fbx", "FBX/SM_Env_Bush_*.fbx", "FBX/SM_Env_Stone_*.fbx",
                    "FBX/SM_Bld_House_Roof_Grass_Tuft*.fbx",
                ],
                "exclude": ["SM_Env_Tree_Pine_Group_*"],
                "emissive": False,
            },
            "props": {"include": ["FBX/SM_Prop_*.fbx"], "emissive": True},
            # Small building parts the game raises on the map itself (hut walls,
            # fences, pillars, doors), kept apart from the full village kit.
            "structures": {
                "include": [
                    "FBX/SM_Bld_Wall_Logs_*.fbx", "FBX/SM_Bld_Pillar_*.fbx", "FBX/SM_Bld_Fence_*.fbx",
                    "FBX/SM_Bld_Door_*.fbx", "FBX/SM_Bld_Step_01.fbx", "FBX/SM_Bld_Roof_Cap_*.fbx",
                ],
                "emissive": False,
            },
            # 80 shield designs share one texture; the *_Optimised_* copies are excluded.
            "weapons": {"include": ["FBX/SM_Wep_*.fbx"], "emissive": False},
        },
    },
    "kaykit_clips": {
        "kits": {
            "goblin_rig": {
                "rig": {"pack": "goblin_war_camp", "file": "FBX/Characters/Characters.fbx"},
                "source": KAYKIT_SOURCES,
                "bone_map": SYNTY_FROM_KAYKIT,
                "translate": ["Root", "Hips"],
                "relax": {"bones": {"Shoulder_L": 1, "Shoulder_R": -1}, "degrees": ARM_RELAX_DEGREES, "clips": CALM_CLIPS},
                "clips": KAYKIT_CLIPS,
            },
            "dungeon_rig": {
                "rig": {"pack": "dungeon", "file": "FBX/Characters/Unreal_Characters/SK_Chr_Skeleton_Soldier_01.fbx"},
                "source": KAYKIT_SOURCES,
                "bone_map": UE_FROM_KAYKIT,
                "translate": ["root", "pelvis"],
                "relax": {"bones": {"upperarm_l": 1, "upperarm_r": -1}, "degrees": ARM_RELAX_DEGREES, "clips": CALM_CLIPS},
                "clips": KAYKIT_CLIPS,
            },
        },
    },
    "goblin_locomotion": {
        "root": "SourceFiles",
        "kits": {
            "clips": {
                # The rig the clips were authored for; bones are matched by name.
                "rig": {"pack": "goblin_war_camp", "file": "FBX/Characters/Characters.fbx"},
                # In-place (non root-motion) clips only: the sim moves entities.
                "clips": [
                    "Idle_Standing", "Idle_Fidget_Menacing", "Idle_Fidget_Scratching", "Idle_Fidget_Swipe",
                    "Walk_F", "Run_F", "Sprint_F", "Run_F_Stumble",
                    "Shuffle_Standing_F", "Shuffle_Standing_B", "Shuffle_Standing_L", "Shuffle_Standing_R",
                    "Turn_Standing_90L", "Turn_Standing_90R", "Turn_Standing_180L", "Turn_Standing_180R",
                    "Idle_ToRun_F", "Idle_ToWalk_F", "Run_ToIdle_LFoot", "Run_ToIdle_RFoot",
                    "Walk_ToIdle_FL", "Walk_ToIdle_FR",
                    "Jump_Idle", "InAir_Fall_Short", "Land_IdleSoft", "Land_IdleMedium", "Land_IdleHard",
                ],
                "clip_file": "A_POLY_GBL_{name}_Neut.fbx",
            },
        },
    },
}

# Bones whose position a clip drives; every other bone keeps its rest offset.
TRANSLATED_BONES = ("Root", "Hips")


LOD_RE = re.compile(r"_LOD[1-9]\b")
SHADOW_RE = re.compile(r"_Shadow\b", re.IGNORECASE)
NAME_PREFIX_RE = re.compile(r"^(SK_Chr_|SM_Chr_|SM_)", re.IGNORECASE)
BLENDER_SUFFIX_RE = re.compile(r"\.\d{3}$")


def node_name(stem: str) -> str:
    return NAME_PREFIX_RE.sub("", stem)


# --- material lists -------------------------------------------------------

def parse_material_lists(pack_dir: Path, names: list[str]) -> dict[str, list[tuple[str, list[dict[str, str]]]]]:
    """mesh name -> every (prefab, ordered slots) listing of it.

    A combined character FBX gets listed under every prefab built from it,
    often with a generic material, so the caller picks the best occurrence.
    """
    meshes: dict[str, list[tuple[str, list[dict[str, str]]]]] = {}
    prefab = ""
    slots: list[dict[str, str]] | None = None
    for name in names:
        for raw in (pack_dir / name).read_text(errors="replace").splitlines():
            line = raw.strip()
            if line.startswith("Prefab Name:"):
                prefab = line.split(":", 1)[1].strip()
            elif line.startswith("Mesh Name:"):
                slots = []
                meshes.setdefault(line.split(":", 1)[1].strip(), []).append((prefab, slots))
            elif line.startswith("Slot:") and slots is not None:
                slot: dict[str, str] = {}
                # Newer lists name the texture on the slot line itself:
                # "Slot: Mat_01_A (Pack_Texture_01_A)". Sentinels like
                # "(No Albedo Texture)" contain spaces and are left unresolved.
                m = re.search(r"\(([^)]+)\)\s*$", line)
                if m and " " not in m.group(1).strip():
                    slot["Albedo"] = m.group(1).strip()
                slots.append(slot)
            elif slots and ":" in line and not line.startswith(("Folder", "----")):
                prop, value = line.split(":", 1)
                value = re.sub(r"\s*\(.*\)\s*$", "", value).strip()
                if value:
                    slots[-1][prop.strip()] = value
    return meshes


def norm_name(name: str) -> str:
    """Strip the SM_/SK_/Chr_/Character_ prefixes so prefab and mesh names compare."""
    return re.sub(r"^(sm_|sk_|chr_|character_)+", "", name.lower())


def slots_for(mesh_key: str, lists: dict) -> list[dict[str, str]] | None:
    occurrences = lists.get(mesh_key)
    if not occurrences:
        return None
    target = norm_name(mesh_key)
    for prefab, slots in occurrences:
        if norm_name(prefab) == target:
            return slots
    # Otherwise the most common listing wins over a one-off generic one.
    counts: dict[str, int] = {}
    for _, slots in occurrences:
        key = repr(slots)
        counts[key] = counts.get(key, 0) + 1
    best = max(counts, key=counts.get)
    return next(slots for _, slots in occurrences if repr(slots) == best)


class TextureIndex:
    """Resolve the names a material list uses to files that actually shipped.

    Lists say `Mud_01.png` for `Env/Mud_Texture_01.png` and
    `Pack_01_A_Emissive.png` for `Emissive/Pack_Emissive_01_A.png`, so after
    aliases and exact names, match on the set of name tokens minus "texture".
    """

    def __init__(self, tex_dir: Path, aliases: dict[str, str]):
        self.aliases = aliases
        self.by_name: dict[str, Path] = {}
        self.by_tokens: dict[frozenset, Path] = {}
        for p in sorted(tex_dir.rglob("*")):
            if p.suffix.lower() not in (".png", ".tga", ".tif", ".tiff", ".jpg", ".jpeg"):
                continue
            self.by_name.setdefault(p.name.lower(), p)
            self.by_tokens.setdefault(self.tokens(p.name), p)

    @staticmethod
    def tokens(name: str) -> frozenset:
        stem = Path(name).stem.lower()
        return frozenset(t for t in re.split(r"[_\s]+", stem) if t and t != "texture")

    def find(self, name: str | None) -> Path | None:
        if not name:
            return None
        name = self.aliases.get(name, name)
        found = self.by_name.get(name.lower()) or self.by_tokens.get(self.tokens(name))
        if found:
            m = PALETTE_VARIANT_RE.match(found.name)
            if m:
                base = found.with_name(m.group(1) + "_A" + m.group(2))
                if base.exists():
                    return base
        return found


# --- materials ------------------------------------------------------------

_materials: dict[tuple, bpy.types.Material] = {}


def load_image(path: Path, colorspace: str, max_size: int = MAX_TEXTURE) -> bpy.types.Image:
    existing = bpy.data.images.get(path.name)
    if existing:
        return existing
    img = bpy.data.images.load(str(path))
    img.name = path.name
    img.colorspace_settings.name = colorspace
    w, h = img.size
    if max(w, h) > max_size:
        f = max_size / max(w, h)
        img.scale(max(1, round(w * f)), max(1, round(h * f)))
    return img


def shared_material(albedo: Path, emissive: Path | None, alpha: str) -> bpy.types.Material:
    """alpha: OPAQUE, MASK (leaf cards, cut at 0.5) or BLEND (ghosts)."""
    key = (albedo, emissive, alpha)
    if key in _materials:
        return _materials[key]
    suffix = {"OPAQUE": "", "MASK": "_cutout", "BLEND": "_blend"}[alpha]
    mat = bpy.data.materials.new(albedo.stem + suffix)
    if not mat.node_tree:  # Blender < 5 materials start without nodes
        mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Metallic"].default_value = 0.0

    tex = nodes.new("ShaderNodeTexImage")
    tex.image = load_image(albedo, "sRGB", MAX_CUTOUT_TEXTURE if alpha == "MASK" else MAX_TEXTURE)
    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    if alpha == "BLEND":
        links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
        mat.surface_render_method = "BLENDED"
    elif alpha == "MASK":
        # The glTF exporter reads a ROUND on the alpha input as alphaMode MASK.
        rnd = nodes.new("ShaderNodeMath")
        rnd.operation = "ROUND"
        links.new(tex.outputs["Alpha"], rnd.inputs[0])
        links.new(rnd.outputs[0], bsdf.inputs["Alpha"])

    if emissive:
        em = nodes.new("ShaderNodeTexImage")
        em.image = load_image(emissive, "sRGB")
        links.new(em.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = 1.0

    _materials[key] = mat
    return mat


def face_is_leaf(me: bpy.types.Mesh, poly: bpy.types.MeshPolygon) -> bool:
    col = me.color_attributes[0]
    if col.domain == "CORNER":
        blues = [col.data[li].color[2] for li in poly.loop_indices]
    else:
        blues = [col.data[vi].color[2] for vi in poly.vertices]
    return sum(blues) / len(blues) > LEAF_BLUE


def assign_materials(obj: bpy.types.Object, ctx: dict) -> bool:
    """Replace the importer's materials from the pack's list. False = skip piece."""
    me = obj.data
    pack, kit, textures, lists = ctx["pack"], ctx["kit"], ctx["textures"], ctx["lists"]
    mesh_key = BLENDER_SUFFIX_RE.sub("", obj.get("fbx_name", obj.name))
    slots = slots_for(mesh_key, lists)
    default_albedo = textures.find(pack["albedo"])
    default_emissive = textures.find(pack["emissive"]) if kit.get("emissive") else None
    translucent = ctx["piece"] in pack["translucent"]

    if not slots:
        print(f"    {mesh_key}: no material list entry, using pack atlas")
        slots = [{"Albedo": pack["albedo"], "Emission": pack["emissive"] or ""}]
    if len(slots) != len(me.materials):
        print(f"    {mesh_key}: list has {len(slots)} slots, mesh has {len(me.materials)}; matching by index")

    new_mats: list[bpy.types.Material | None] = []
    leaf_splits: list[tuple[int, bpy.types.Material]] = []
    for i in range(len(me.materials)):
        slot = slots[i] if i < len(slots) else slots[0]
        albedo = textures.find(slot.get("Albedo"))
        emissive = textures.find(slot.get("Emission")) if kit.get("emissive") else None
        if emissive is None and kit.get("emissive") and albedo == default_albedo:
            emissive = default_emissive
        leaf = textures.find(slot.get("_Leaf_Texture"))
        trunk = textures.find(slot.get("_Trunk_Texture"))
        if albedo:
            new_mats.append(shared_material(albedo, emissive, "BLEND" if translucent else "OPAQUE"))
        elif leaf and trunk and me.color_attributes:
            new_mats.append(shared_material(trunk, None, "OPAQUE"))
            leaf_splits.append((i, shared_material(leaf, None, "MASK")))
        elif leaf:
            new_mats.append(shared_material(leaf, None, "MASK"))
        elif slot.get("Albedo") or slot.get("_Leaf_Texture"):
            print(f"    {mesh_key}: texture {slot.get('Albedo') or slot.get('_Leaf_Texture')!r} not found, using pack atlas")
            new_mats.append(shared_material(default_albedo, emissive, "OPAQUE"))
        else:
            print(f"    {mesh_key}: slot {i} has no plain texture ({', '.join(slot) or 'empty'}), skipping mesh")
            return False

    # Swap slots in place: materials.clear() would also reset every face's
    # material index, undoing the leaf split below.
    for i, m in enumerate(new_mats):
        me.materials[i] = m

    # Leaf faces move to an appended slot so trunk and canopy get their own texture.
    for src_index, leaf_mat in leaf_splits:
        me.materials.append(leaf_mat)
        leaf_index = len(me.materials) - 1
        for poly in me.polygons:
            if poly.material_index == src_index and face_is_leaf(me, poly):
                poly.material_index = leaf_index

    # Synty ships a second (lightmap) UV set and vertex colours (wind, leaf
    # masks); neither is needed once materials are split, and together they
    # were a fifth of the file.
    # (References go stale after each removal, so always remove by index.)
    while len(me.uv_layers) > 1:
        me.uv_layers.remove(me.uv_layers[-1])
    while me.color_attributes:
        me.color_attributes.remove(me.color_attributes[0])
    return True


# --- pieces ---------------------------------------------------------------

def delete_objects(objs) -> None:
    for o in objs:
        data = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if data and data.users == 0:
            if isinstance(data, bpy.types.Mesh):
                bpy.data.meshes.remove(data)
            elif isinstance(data, bpy.types.Armature):
                bpy.data.armatures.remove(data)


def apply_transforms(objs) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def split_rig(arm: bpy.types.Object, meshes: list[bpy.types.Object]) -> list[bpy.types.Object]:
    """One armature per skinned mesh, so each character is its own node."""
    rigs = []
    for m in meshes:
        rig = bpy.data.objects.new(node_name(m.name), arm.data.copy())
        bpy.context.scene.collection.objects.link(rig)
        m.parent = rig
        m.matrix_parent_inverse = Matrix.Identity(4)
        for mod in m.modifiers:
            if mod.type == "ARMATURE":
                mod.object = rig
        rigs.append(rig)
    delete_objects([arm])
    return rigs


def import_piece(path: Path, ctx: dict) -> list[bpy.types.Object]:
    pack, kit = ctx["pack"], ctx["kit"]
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=str(path), use_anim=False)
    new = [o for o in bpy.data.objects if o not in before]
    piece = node_name(path.stem)
    ctx["piece"] = piece
    for o in new:
        o["fbx_name"] = o.name  # material lists key on the FBX mesh name

    # Keep LOD0 only; the other LODs and Unity's shadow-caster proxies are
    # separate objects in the same file.
    extras = [o for o in new if LOD_RE.search(o.name) or SHADOW_RE.search(o.name)]
    delete_objects(extras)
    new = [o for o in new if o not in extras]
    roots = [o for o in new if o.parent is None]

    # Blender puts the FBX unit conversion on root objects. Rigged characters
    # come out right as-is (their bones carry the compensation) and only need
    # the bake below; static meshes need the pack's correction.
    if not kit.get("rigged") and pack["static_scale"] != 1:
        for o in roots:
            o.scale = tuple(s * pack["static_scale"] for s in o.scale)
    apply_transforms(new)

    if kit.get("rigged"):
        arm = next(o for o in new if o.type == "ARMATURE")
        meshes = sorted((o for o in new if o.type == "MESH"), key=lambda o: o.name)
        if kit.get("split"):
            rigs = split_rig(arm, meshes)
            new = rigs + meshes
            roots = rigs
        else:
            arm.name = piece
    elif len(roots) == 1:
        roots[0].name = piece
    else:
        parent = bpy.data.objects.new(piece, None)
        bpy.context.scene.collection.objects.link(parent)
        for o in roots:
            o.parent = parent
        new.append(parent)

    unusable = [o for o in new if o.type == "MESH" and not assign_materials(o, ctx)]
    delete_objects(unusable)
    new = [o for o in new if o not in unusable]
    if not any(o.type == "MESH" for o in new):
        delete_objects(new)
        return []
    return new


def bbox(objs) -> Vector:
    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        if o.type != "MESH":
            continue
        ev = o.evaluated_get(dg)
        for v in ev.data.vertices:
            w = ev.matrix_world @ v.co
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    return hi - lo


# --- kits -----------------------------------------------------------------

def pack_root(pack_name: str) -> Path:
    return SRC_ROOT / pack_name / PACKS[pack_name].get("root", "")


def list_sources(pack_dir: Path, kit: dict) -> list[Path]:
    files = []
    excludes = EXCLUDE + kit.get("exclude", [])
    for pattern in kit["include"]:
        for f in sorted(pack_dir.glob(pattern)):
            if any(fnmatch.fnmatch(f.name, ex) for ex in excludes):
                continue
            files.append(f)
    return files


def build_kit(pack_name: str, kit_name: str) -> None:
    pack = PACKS[pack_name]
    kit = pack["kits"][kit_name]
    pack_dir = pack_root(pack_name)
    sources = list_sources(pack_dir, kit)
    if not sources:
        raise SystemExit(f"{pack_name}/{kit_name}: no source files matched under {pack_dir}")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    _materials.clear()
    ctx = {
        "pack": pack,
        "kit": kit,
        "textures": TextureIndex(pack_dir / "Textures", pack["aliases"]),
        "lists": parse_material_lists(pack_dir, pack["material_lists"]),
    }

    print(f"== {pack_name}/{kit_name}: {len(sources)} source files")
    pieces = 0
    verts = 0
    for path in sources:
        objs = import_piece(path, ctx)
        if not objs:
            continue
        pieces += len([o for o in objs if o.parent is None])
        verts += sum(len(o.data.vertices) for o in objs if o.type == "MESH")
        if kit.get("rigged"):
            for arm in (o for o in objs if o.type == "ARMATURE"):
                kids = [o for o in objs if o.parent == arm]
                print(f"  {arm.name:32s} bones={len(arm.data.bones):3d} height={bbox(kids).z:.2f}")

    # Drop the importer's broken texture references and throwaway materials.
    bpy.ops.outliner.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)

    out_dir = OUT_ROOT / pack_name
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{kit_name}.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(out),
        export_format="GLB",
        export_apply=True,  # applies mesh modifiers; armature modifiers are kept as skins
        export_yup=True,
        export_animations=False,
        export_normals=KEEP_NORMALS,
        export_skins=bool(kit.get("rigged")),
        export_image_format="AUTO",  # PNG stays PNG; TGA and TIF become PNG
        export_materials="EXPORT",
    )
    print(f"{pack_name}/{kit_name}: {pieces} pieces, {verts} verts, {out.stat().st_size / 1e6:.1f} MB -> {out.relative_to(ROOT)}")


# --- clip kits ------------------------------------------------------------

def clip_name(stem: str, template: str) -> str:
    prefix, suffix = template.replace(".fbx", "").split("{name}")
    return stem[len(prefix):len(stem) - len(suffix)]


def import_rig(pack_name: str, rel: str) -> bpy.types.Object:
    """The clean, scale-1 armature a character kit was exported with."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=str(pack_root(pack_name) / rel), use_anim=False)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == "ARMATURE")
    apply_transforms(new)
    delete_objects([o for o in new if o is not arm])
    arm.name = "Rig"
    return arm


def source_bone(target: bpy.types.Object, src: bpy.types.Object, name: str) -> str | None:
    """Match a clip bone to a rig bone. The clip FBX names both hands' finger
    bones identically, so Blender imports them as Finger_01 and Finger_01_1;
    pick whichever sits where the rig's Finger_01_L / _R rests."""
    if name in src.data.bones:
        return name
    base = re.sub(r"_[LR]$", "", name)
    candidates = [b for b in (base, base + "_1") if b in src.data.bones]
    if not candidates:
        return None
    want = target.matrix_world @ target.data.bones[name].head_local
    return min(candidates, key=lambda b: (src.matrix_world @ src.data.bones[b].head_local - want).length)


def zero_pose(path: Path) -> dict[str, Matrix]:
    """World rotation of every joint in the clip FBX with its animated
    rotation zeroed, leaving only PreRotation (the joint orient). For a
    skeleton oriented in a T-pose that is the T-pose. Blender space (Z up)."""
    root, _ = parse_fbx.parse(str(path))
    objects = next(e for e in root.elems if e.id == b"Objects")
    connections = next(e for e in root.elems if e.id == b"Connections")
    models: dict[int, tuple[str, dict]] = {}
    order: list[int] = []
    seen: dict[str, int] = {}
    for e in objects.elems:
        if e.id != b"Model":
            continue
        uid, name = e.props[0], e.props[1].split(b"\x00")[0].decode()
        if name in seen:  # the importer renames duplicate bones Finger_01 -> Finger_01_1
            seen[name] += 1
            name = f"{name}_{seen[name]}"
        else:
            seen[name] = 0
        props: dict[str, tuple[float, float, float]] = {}
        for sub in e.elems:
            if sub.id == b"Properties70":
                for prop in sub.elems:
                    key = prop.props[0].decode()
                    if key in ("PreRotation", "Lcl Translation"):
                        props[key] = tuple(float(x) for x in prop.props[4:7])
        models[uid] = (name, props)
        order.append(uid)
    parent = {c.props[1]: c.props[2] for c in connections.elems if c.id == b"C" and c.props[0] == b"OO" and c.props[1] in models}
    memo: dict[int, Matrix] = {}

    def world(uid: int) -> Matrix:
        if uid not in memo:
            _, props = models[uid]
            t = Matrix.Translation(Vector(props.get("Lcl Translation", (0, 0, 0))))
            pre = Euler([math.radians(v) for v in props.get("PreRotation", (0, 0, 0))], "XYZ").to_matrix().to_4x4()
            par = parent.get(uid)
            memo[uid] = (world(par) if par in models else Matrix.Identity(4)) @ t @ pre
        return memo[uid]

    y_up_to_z_up = Matrix.Rotation(math.radians(90), 4, "X")
    return {models[uid][0]: (y_up_to_z_up @ world(uid)).to_3x3().normalized() for uid in order}


def frame_offsets(rig: bpy.types.Object, clip_path: Path, mapping: dict[str, str | None]) -> dict[str, Matrix]:
    """Per rig bone: rotation taking the clip skeleton's frame to the rig's
    frame, measured with both in T-pose. `mapping` names each rig bone's clip
    bone (fingers differ, see source_bone)."""
    zero = zero_pose(clip_path)
    offsets = {}
    for b in rig.data.bones:
        sb = mapping.get(b.name)
        if sb in zero:
            offsets[b.name] = zero[sb].inverted() @ b.matrix_local.to_3x3().normalized()
    return offsets


def bones_parents_first(arm: bpy.types.Object) -> list[bpy.types.Bone]:
    out: list[bpy.types.Bone] = []

    def walk(b: bpy.types.Bone) -> None:
        out.append(b)
        for c in b.children:
            walk(c)

    for b in arm.data.bones:
        if b.parent is None:
            walk(b)
    return out


def first_mapped_descendant(bone: bpy.types.Bone, mapping: dict[str, str | None]) -> bpy.types.Bone | None:
    """Breadth-first: the nearest descendant that has a source bone, so a rig
    with extra spine links still measures its torso direction toward the head."""
    queue = list(bone.children)
    while queue:
        c = queue.pop(0)
        if mapping.get(c.name):
            return c
        queue.extend(c.children)
    return None


def frame_offsets_rest(target: bpy.types.Object, src: bpy.types.Object, mapping: dict[str, str | None]) -> dict[str, Matrix]:
    """Per target bone: rotation taking the source rig's frame to the target's,
    with both rigs in their bind poses. The source's rest direction along each
    bone is first turned onto the target's, so a 5 degree difference in how the
    two T-poses hold their arms does not bake into every clip."""
    offsets = {}
    for b in target.data.bones:
        sb = mapping.get(b.name)
        if not sb or sb not in src.data.bones:
            continue
        s_bone = src.data.bones[sb]
        rest_s = (src.matrix_world @ s_bone.matrix_local).to_3x3().normalized()
        rest_t = (target.matrix_world @ b.matrix_local).to_3x3().normalized()
        child_t = first_mapped_descendant(b, mapping)
        child_s = child_t and src.data.bones.get(mapping[child_t.name])
        if child_t and child_s:
            dir_t = (target.matrix_world @ child_t.head_local - target.matrix_world @ b.head_local).normalized()
            dir_s = (src.matrix_world @ child_s.head_local - src.matrix_world @ s_bone.head_local).normalized()
            rest_s = dir_s.rotation_difference(dir_t).to_matrix() @ rest_s
        offsets[b.name] = rest_s.inverted() @ rest_t
    return offsets


def hip_scale(target: bpy.types.Object, src: bpy.types.Object, mapping: dict[str, str | None], translate: list[str]) -> float:
    """How much taller the target skeleton stands than the source, measured at the hips."""
    hips = next((n for n in translate if target.data.bones[n].parent), None)
    sb = hips and mapping.get(hips)
    if not hips or not sb:
        return 1.0
    t = (target.matrix_world @ target.data.bones[hips].head_local).z
    s = (src.matrix_world @ src.data.bones[sb].head_local).z
    return t / s if s > 1e-6 else 1.0


def retarget_action(
    target: bpy.types.Object,
    src: bpy.types.Object,
    action: bpy.types.Action,
    mapping: dict[str, str | None],
    offsets: dict[str, Matrix],
    translate: list[str],
    pos_scale: float,
    name: str,
    relax: dict | None = None,
) -> tuple[int, int]:
    """Key the target rig frame by frame so each mapped bone's world rotation
    is the source bone's, corrected by its frame offset. Bones keep the rig's
    own rest offsets; only the root and hips take the source's position."""
    anim_src = src.animation_data or src.animation_data_create()
    anim_src.action = action
    if hasattr(anim_src, "action_slot") and action.slots:
        anim_src.action_slot = action.slots[0]
    start, end = (round(f) for f in action.frame_range)
    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = start, end

    baked = bpy.data.actions.new(name)
    anim = target.animation_data or target.animation_data_create()
    anim.action = baked
    anim.action_slot = baked.slots.new(id_type="OBJECT", name=target.name)
    for pb in target.pose.bones:
        pb.rotation_mode = "QUATERNION"

    bones = bones_parents_first(target)
    unmatched = [b.name for b in bones if not mapping.get(b.name) or b.name not in offsets]
    if unmatched and target.get("reported_unmatched") != ",".join(unmatched):
        target["reported_unmatched"] = ",".join(unmatched)  # say it once per rig, not per clip
        print(f"    rest pose kept for {len(unmatched)} bones ({', '.join(unmatched[:6])}{'...' if len(unmatched) > 6 else ''})")
    rest = {b.name: b.matrix_local for b in bones}
    # Extra world-space turn about the forward (Y) axis for chosen bones in calm clips.
    biases: dict[str, Matrix] = {}
    if relax and name in relax["clips"]:
        for bone_name, sign in relax["bones"].items():
            biases[bone_name] = Matrix.Rotation(math.radians(sign * relax["degrees"]), 3, "Y")

    for f in range(start, end + 1):
        scene.frame_set(f)
        posed: dict[str, Matrix] = {}
        for b in bones:
            par = posed[b.parent.name] if b.parent else Matrix.Identity(4)
            from_rest = (par @ rest[b.parent.name].inverted() @ rest[b.name]) if b.parent else rest[b.name]
            sb = mapping.get(b.name)
            if not sb or b.name not in offsets:
                m = from_rest
            else:
                spb = src.pose.bones[sb]
                world = (src.matrix_world @ spb.matrix).to_3x3()
                if abs(world.determinant()) < 1e-9:
                    m = from_rest  # a bone scaled to nothing (spawn effects) has no orientation
                else:
                    rot = world.normalized() @ offsets[b.name]
                    if b.name in biases:
                        rot = biases[b.name] @ rot
                    rot = rot.to_4x4()
                    if b.name in translate:
                        pos = (src.matrix_world @ spb.matrix.translation) * pos_scale
                    else:
                        pos = from_rest.translation
                    m = Matrix.Translation(pos) @ rot
            pb = target.pose.bones[b.name]
            pb.matrix_basis = (rest[b.name].inverted() @ rest[b.parent.name] @ par.inverted() @ m) if b.parent else (rest[b.name].inverted() @ m)
            pb.keyframe_insert("location", frame=f)
            pb.keyframe_insert("rotation_quaternion", frame=f)
            posed[b.name] = m

    track = target.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, start, baked)
    if hasattr(strip, "action_slot") and baked.slots:
        strip.action_slot = baked.slots[0]
    anim.action = None
    anim_src.action = None
    return start, end


def retarget_clip(target: bpy.types.Object, offsets: dict[str, Matrix], path: Path, name: str) -> tuple[int, int]:
    """One Synty ANIMATION-pack FBX onto the rig. `offsets` is filled on the
    first call; every clip in a pack shares one skeleton."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=str(path), use_anim=True)
    src = next(o for o in bpy.data.objects if o not in before and o.type == "ARMATURE")
    mapping = {b.name: source_bone(target, src, b.name) for b in target.data.bones}
    if not offsets:
        offsets.update(frame_offsets(target, path, mapping))
    result = retarget_action(target, src, src.animation_data.action, mapping, offsets, list(TRANSLATED_BONES), 1.0, name)
    delete_objects([o for o in bpy.data.objects if o not in before])
    return result


def import_gltf_rigs(paths: list[str]) -> list[bpy.types.Object]:
    """KayKit character files: each brings its armature and every clip as an action."""
    rigs = []
    for rel in paths:
        before = set(bpy.data.objects)
        actions_before = set(bpy.data.actions)
        bpy.ops.import_scene.gltf(filepath=str(ROOT / rel))
        new = [o for o in bpy.data.objects if o not in before]
        arm = next(o for o in new if o.type == "ARMATURE")
        arm["clips"] = [a.name for a in bpy.data.actions if a not in actions_before]
        # Keep it visible: a hidden armature is not evaluated, so its pose
        # would sit at rest while we sample it.
        arm.hide_render = True
        delete_objects([o for o in new if o.type == "MESH"])  # only the skeleton and its actions matter
        rigs.append(arm)
    return rigs


def build_clip_kit(pack_name: str, kit_name: str) -> None:
    pack = PACKS[pack_name]
    kit = pack["kits"][kit_name]
    pack_dir = pack_root(pack_name)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rig = import_rig(kit["rig"]["pack"], kit["rig"]["file"])
    print(f"== {pack_name}/{kit_name}: {len(kit['clips'])} clips onto {kit['rig']['pack']} rig ({len(rig.data.bones)} bones)")

    done = 0
    if "source" in kit:
        # KayKit GLBs: the first file that has a clip provides it.
        sources = import_gltf_rigs(kit["source"])
        mapping = {b.name: kit["bone_map"].get(b.name) for b in rig.data.bones}
        for name in kit["clips"]:
            src = next((r for r in sources if name in r["clips"]), None)
            if src is None:
                print(f"    {name}: not in {', '.join(kit['source'])}")
                continue
            offsets = frame_offsets_rest(rig, src, mapping)
            scale = hip_scale(rig, src, mapping, kit["translate"])
            start, end = retarget_action(rig, src, bpy.data.actions[name], mapping, offsets, kit["translate"], scale, name, kit.get("relax"))
            print(f"  {name:28s} frames {start}-{end}  hips x{scale:.2f}")
            done += 1
        delete_objects(sources)
    else:
        offsets: dict[str, Matrix] = {}
        for name in kit["clips"]:
            matches = sorted(pack_dir.rglob(kit["clip_file"].format(name=name)))
            if not matches:
                print(f"    {name}: no file named {kit['clip_file'].format(name=name)}")
                continue
            start, end = retarget_clip(rig, offsets, matches[0], name)
            print(f"  {name:28s} frames {start}-{end}")
            done += 1

    bpy.ops.outliner.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
    out_dir = OUT_ROOT / pack_name
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{kit_name}.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(out),
        export_format="GLB",
        export_yup=True,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_anim_slide_to_zero=True,
        export_skins=False,
        export_materials="NONE",
    )
    print(f"{pack_name}/{kit_name}: {done} clips, {out.stat().st_size / 1e6:.1f} MB -> {out.relative_to(ROOT)}")


def main() -> None:
    # Filters come from the environment: npm and bun disagree on passing "--"
    # through, and Blender needs its own "--" before script arguments.
    def wanted(var: str) -> list[str]:
        return [k for k in os.environ.get(var, "").replace(",", " ").split() if k]

    packs = wanted("PACKS") or list(PACKS)
    kits = wanted("KITS")
    for name in packs:
        if name not in PACKS:
            raise SystemExit(f"unknown pack {name!r}; packs: {', '.join(PACKS)}")
        for kit_name in PACKS[name]["kits"]:
            if kits and kit_name not in kits:
                continue
            if "clips" in PACKS[name]["kits"][kit_name]:
                build_clip_kit(name, kit_name)
            else:
                build_kit(name, kit_name)


main()
