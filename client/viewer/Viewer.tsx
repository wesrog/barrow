import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { gripInto, heldModel, wearPiece, wornPlacement } from "../render/gear";
import { cloneProp, findNode, loadAssets, type GameAssets, type WeaponName } from "../render/models";
import { display, mono } from "../ui/fonts";
import {
  ACTION_IDS,
  buildCatalog,
  clipCounts,
  DEFAULT_ARMS,
  defaultClip,
  filterEntries,
  gearId,
  gridLayout,
  heldOptions,
  PACK_LABELS,
  wornOptions,
  type CatalogEntry,
  type GearOption,
  type PackId,
} from "./catalog";

/**
 * Asset viewer: every character model in a grid, each playing its idle,
 * with search, pack filters, a clip picker that drives all visible figures
 * or just the selected one, speed and pause. Click a figure to select it,
 * then hand it weapons and shields from the kits (seated with its rig's
 * grip), dress it in its pack's attachments, and fire its attack clips.
 */

const ALL_PACKS: PackId[] = ["kaykit", "goblin_war_camp", "viking_realm", "dungeon_pack"];
const IDLE = "(idle)";

/**
 * The URL can open the viewer on a scene: ?q=search&sel=entry id&r=held id
 * &l=held id&wear=id,id&clip=name&arm=1. Handy for sharing a look and for
 * scripted screenshots.
 */
const params = new URLSearchParams(typeof location === "undefined" ? "" : location.search);

interface Live {
  entry: CatalogEntry;
  current: THREE.AnimationAction | null;
  label: HTMLDivElement;
  visible: boolean;
  /** What each hand holds, by option id. */
  held: { r: { id: string; obj: THREE.Object3D } | null; l: { id: string; obj: THREE.Object3D } | null };
  /** Worn pieces by option id, each the objects it added. */
  worn: Map<string, THREE.Object3D[]>;
}

type Hand = "r" | "l";

/** Put an option in a hand (or empty it), seated with the rig's grip. */
function holdItem(assets: GameAssets, live: Live, slot: Hand, option: GearOption | null): void {
  if ((live.held[slot]?.id ?? null) === (option?.id ?? null)) return;
  live.held[slot]?.obj.removeFromParent();
  live.held[slot] = null;
  if (!option) return;
  const socket = slot === "r" ? live.entry.inst.handSlotR : live.entry.inst.handSlotL;
  if (!socket) return;
  const obj =
    option.kit === "kaykit"
      ? cloneProp(assets.weapons[option.node as WeaponName])
      : heldModel(assets.kits, option.kit, option.node);
  if (!obj) return;
  gripInto(socket, live.entry.spec.grip[slot], obj);
  live.held[slot] = { id: option.id, obj };
}

/** Put a worn piece on (or take it off) the bone its kind rides. */
function wearItem(assets: GameAssets, live: Live, option: GearOption, on: boolean): void {
  const have = live.worn.get(option.id);
  if (on === !!have) return;
  if (!on) {
    for (const o of have!) o.removeFromParent();
    live.worn.delete(option.id);
    return;
  }
  if (option.kit === "kaykit") return;
  const placement = wornPlacement(assets.kits, option.kit, option.node);
  const bone = placement && findNode(live.entry.inst.group, live.entry.spec.bones[placement.role]);
  if (!placement || !bone) return;
  const added = wearPiece(assets.kits, option.kit, option.node, placement, bone, live.entry.rest.get(bone));
  if (added) live.worn.set(option.id, added);
}

function play(live: Live, name: string | null): void {
  const next = name ? live.entry.inst.actions.get(name) ?? null : null;
  if (next === live.current) return;
  live.current?.fadeOut(0.2);
  if (next) {
    next.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.2).play();
  }
  live.current = next;
}

export function Viewer() {
  const mountRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const livesRef = useRef<Map<string, Live>>(new Map());
  const cameraRef = useRef<{ camera: THREE.PerspectiveCamera; controls: OrbitControls; center: THREE.Vector3; width: number; depth: number } | null>(null);
  const ringRef = useRef<THREE.Mesh | null>(null);

  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [status, setStatus] = useState("loading models…");
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [packs, setPacks] = useState<Set<PackId>>(new Set(ALL_PACKS));
  const [clip, setClip] = useState(params.get("clip") ?? IDLE);
  const [target, setTarget] = useState<"all" | "selected">("all");
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(params.get("sel"));
  const [tick, setTick] = useState(0); // re-render the sidebar's "playing" readout
  const assetsRef = useRef<GameAssets | null>(null);
  const [armAll, setArmAll] = useState(params.get("arm") === "1");
  /** Explicit hand choices per entry (option ids); unset hands follow "arm everyone". */
  const [hands, setHands] = useState<Map<string, { r?: string | null; l?: string | null }>>(() => {
    const sel = params.get("sel");
    const r = params.get("r");
    const l = params.get("l");
    return sel && (r || l) ? new Map([[sel, { ...(r ? { r } : {}), ...(l ? { l } : {}) }]]) : new Map();
  });
  const [worn, setWorn] = useState<Map<string, Set<string>>>(() => {
    const sel = params.get("sel");
    const wear = params.get("wear");
    return sel && wear ? new Map([[sel, new Set(wear.split(","))]]) : new Map();
  });

  const visible = useMemo(() => filterEntries(entries, query, packs), [entries, query, packs]);
  const selected = entries.find((e) => e.id === selectedId) ?? null;
  const selectedHeld = useMemo(() => (selected && assetsRef.current ? heldOptions(assetsRef.current, selected) : []), [selected, entries]);
  const selectedWorn = useMemo(() => (selected && assetsRef.current ? wornOptions(assetsRef.current, selected) : []), [selected, entries]);
  const clipOptions = useMemo(
    () => (target === "selected" && selected ? selected.clips.map((name) => ({ name, count: 1 })) : clipCounts(visible)),
    [target, selected, visible],
  );

  // --- Scene, renderer, loop: built once ---
  useEffect(() => {
    const mount = mountRef.current!;
    const overlay = overlayRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x14141a);
    scene.add(new THREE.HemisphereLight(0xfff2dc, 0x3a3a4e, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(6, 12, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    scene.add(sun);
    const grid = new THREE.GridHelper(80, 80, 0x2a2a36, 0x1e1e28);
    grid.position.y = -0.01;
    scene.add(grid);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShadowMaterial({ opacity: 0.35 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.65, 32),
      new THREE.MeshBasicMaterial({ color: 0xe8c27a, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    ring.visible = false;
    scene.add(ring);
    ringRef.current = ring;

    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 300);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.49;
    cameraRef.current = { camera, controls, center: new THREE.Vector3(), width: 10, depth: 10 };

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener("resize", resize);

    // Click (not drag) selects the figure under the cursor.
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downAt: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      downAt = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const groups = [...livesRef.current.values()].filter((l) => l.visible).map((l) => l.entry.inst.group);
      const hit = raycaster.intersectObjects(groups, true)[0];
      if (!hit) {
        setSelectedId(null);
        return;
      }
      for (const live of livesRef.current.values()) {
        let o: THREE.Object3D | null = hit.object;
        while (o) {
          if (o === live.entry.inst.group) {
            setSelectedId(live.entry.id);
            return;
          }
          o = o.parent;
        }
      }
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    let disposed = false;
    let raf = 0;
    let last = performance.now();
    let frames = 0;
    const tmp = new THREE.Vector3();
    const loop = (now: number) => {
      if (disposed) return;
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      for (const live of livesRef.current.values()) {
        if (live.visible) live.entry.inst.mixer.update(dt);
      }
      controls.update();
      renderer.render(scene, camera);
      // Labels sit on the floor just in front of their figures (above the
      // head they would land on the row behind); hidden when behind the camera.
      const rect = renderer.domElement.getBoundingClientRect();
      for (const live of livesRef.current.values()) {
        if (!live.visible) continue;
        tmp.copy(live.entry.inst.group.position);
        tmp.z += 0.9;
        tmp.project(camera);
        const behind = tmp.z > 1;
        live.label.style.display = behind ? "none" : "block";
        live.label.style.left = `${((tmp.x + 1) / 2) * rect.width}px`;
        live.label.style.top = `${((1 - tmp.y) / 2) * rect.height}px`;
      }
      if (++frames % 30 === 0) setTick((t) => t + 1);
    };
    raf = requestAnimationFrame(loop);

    let mounted = true;
    loadAssets()
      .then((assets) => {
        if (!mounted) return;
        assetsRef.current = assets;
        const catalog = buildCatalog(assets);
        for (const entry of catalog) {
          entry.inst.group.scale.setScalar(entry.scale);
          entry.inst.group.traverse((o) => {
            if (o instanceof THREE.Mesh) o.castShadow = true;
          });
          scene.add(entry.inst.group);
          const label = document.createElement("div");
          label.className = "label";
          overlay.appendChild(label);
          const live: Live = { entry, current: null, label, visible: true, held: { r: null, l: null }, worn: new Map() };
          play(live, defaultClip(entry));
          livesRef.current.set(entry.id, live);
        }
        setEntries(catalog);
        setStatus(`${catalog.length} characters`);
        // Dev hook: poke held objects and the camera from the console while tuning grips.
        (window as unknown as { __viewer?: unknown }).__viewer = { lives: livesRef.current, camera: cameraRef.current, scene };
      })
      .catch((err: unknown) => {
        console.error(err);
        setStatus("failed to load models; see console");
      });

    return () => {
      mounted = false;
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  // --- Layout follows the filter ---
  useEffect(() => {
    const lives = livesRef.current;
    const positions = gridLayout(visible.length);
    const shown = new Set(visible.map((e) => e.id));
    for (const live of lives.values()) {
      live.visible = shown.has(live.entry.id);
      live.entry.inst.group.visible = live.visible;
      live.label.style.display = live.visible ? "block" : "none";
    }
    visible.forEach((entry, i) => {
      const live = lives.get(entry.id);
      if (!live) return;
      const p = positions[i]!;
      live.entry.inst.group.position.set(p.x, 0, p.z);
      live.label.textContent = entry.label;
    });
    const cam = cameraRef.current;
    if (cam && positions.length) {
      const maxX = Math.max(...positions.map((p) => p.x));
      const maxZ = Math.max(...positions.map((p) => p.z));
      cam.center.set(maxX / 2, 0.8, maxZ / 2);
      cam.width = maxX + 3;
      cam.depth = maxZ + 4;
      if (!cam.controls.target.lengthSq()) resetCamera();
    }
  }, [visible]);

  // --- Clip choice drives all visible figures, or the selected one ---
  useEffect(() => {
    for (const live of livesRef.current.values()) {
      if (!live.visible) continue;
      const mine = target === "all" || live.entry.id === selectedId;
      const wanted = mine && clip !== IDLE && live.entry.inst.actions.has(clip) ? clip : defaultClip(live.entry);
      play(live, wanted);
    }
  }, [clip, target, selectedId, visible]);

  useEffect(() => {
    for (const live of livesRef.current.values()) live.entry.inst.mixer.timeScale = paused ? 0 : speed;
  }, [speed, paused]);

  // --- Hands: an explicit choice wins; otherwise "arm everyone" hands out each rig's defaults ---
  useEffect(() => {
    const assets = assetsRef.current;
    if (!assets) return;
    for (const live of livesRef.current.values()) {
      const options = heldOptions(assets, live.entry);
      const choice = hands.get(live.entry.id) ?? {};
      const defaults = DEFAULT_ARMS[live.entry.rig] ?? {};
      for (const slot of ["r", "l"] as const) {
        const wanted =
          choice[slot] !== undefined ? choice[slot] : armAll && defaults[slot] ? gearId(defaults[slot]!) : null;
        holdItem(assets, live, slot, wanted ? options.find((o) => o.id === wanted) ?? null : null);
      }
    }
  }, [hands, armAll, entries]);

  useEffect(() => {
    const assets = assetsRef.current;
    if (!assets) return;
    for (const live of livesRef.current.values()) {
      const set = worn.get(live.entry.id);
      if (!set && live.worn.size === 0) continue;
      for (const option of wornOptions(assets, live.entry)) wearItem(assets, live, option, set?.has(option.id) ?? false);
    }
  }, [worn, entries]);

  const setHand = (id: string, slot: Hand, option: string | null) =>
    setHands((prev) => {
      const next = new Map(prev);
      next.set(id, { ...(prev.get(id) ?? {}), [slot]: option });
      return next;
    });
  const toggleWorn = (id: string, option: string) =>
    setWorn((prev) => {
      const next = new Map(prev);
      const set = new Set(prev.get(id) ?? []);
      if (set.has(option)) set.delete(option);
      else set.add(option);
      next.set(id, set);
      return next;
    });

  useEffect(() => {
    const ring = ringRef.current;
    const live = selectedId ? livesRef.current.get(selectedId) : null;
    if (!ring) return;
    ring.visible = !!live;
    if (live) ring.position.set(live.entry.inst.group.position.x, 0.02, live.entry.inst.group.position.z);
  }, [selectedId, visible]);

  /** A three-quarter view of the selected figure, close enough to judge a grip. */
  function frameSelected() {
    const cam = cameraRef.current;
    const live = selectedId ? livesRef.current.get(selectedId) : null;
    if (!cam || !live) return;
    const p = live.entry.inst.group.position;
    cam.camera.position.set(p.x - 2.0, 1.4, p.z + 2.2);
    cam.controls.target.set(p.x, 0.8, p.z);
    cam.controls.update();
  }

  // A URL that names a figure opens on it, once the figures exist.
  const framedRef = useRef(false);
  useEffect(() => {
    if (framedRef.current || !params.get("sel") || entries.length === 0) return;
    framedRef.current = true;
    setTarget("selected");
    frameSelected();
  }, [entries]);

  function resetCamera() {
    const cam = cameraRef.current;
    if (!cam) return;
    // Back off until the whole grid fits both ways, with a little margin.
    const vfov = (cam.camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * cam.camera.aspect);
    const dist = Math.max((cam.width / 2) / Math.tan(hfov / 2), (cam.depth / 2) / Math.tan(vfov / 2), 6) * 1.25;
    cam.camera.position.copy(cam.center).addScaledVector(new THREE.Vector3(0, 0.6, 1).normalize(), dist);
    cam.controls.target.copy(cam.center);
    cam.controls.update();
  }

  const togglePack = (p: PackId) =>
    setPacks((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const selectedLive = selectedId ? livesRef.current.get(selectedId) : null;
  const playing = selectedLive?.current?.getClip().name ?? null;
  void tick;

  return (
    <div className="viewer">
      <aside className="panel">
        <h1 style={{ fontFamily: display }}>Barrow models</h1>
        <div className="status">{status}</div>
        <label className="field">
          <span>search</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="name…" />
        </label>
        <div className="field">
          <span>packs</span>
          {ALL_PACKS.map((p) => {
            const n = entries.filter((e) => e.pack === p).length;
            return (
              <label key={p} className="check">
                <input type="checkbox" checked={packs.has(p)} onChange={() => togglePack(p)} disabled={n === 0} />
                {PACK_LABELS[p]} <em>{n}</em>
              </label>
            );
          })}
        </div>
        <div className="field">
          <span>animate</span>
          <label className="check">
            <input type="radio" checked={target === "all"} onChange={() => setTarget("all")} /> all visible
          </label>
          <label className="check">
            <input type="radio" checked={target === "selected"} onChange={() => setTarget("selected")} disabled={!selected} /> selected only
          </label>
          <label className="check">
            <input type="checkbox" checked={armAll} onChange={(e) => setArmAll(e.target.checked)} /> arm everyone
          </label>
        </div>
        <label className="field">
          <span>clip</span>
          <select value={clip} onChange={(e) => setClip(e.target.value)}>
            <option value={IDLE}>each rig's idle</option>
            {clipOptions.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
                {target === "all" ? ` (${c.count})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>speed {speed.toFixed(2)}x</span>
          <input type="range" min={0.1} max={2} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
        </label>
        <div className="row">
          <button onClick={() => setPaused((p) => !p)}>{paused ? "play" : "pause"}</button>
          <button onClick={resetCamera}>reset camera</button>
          <button onClick={frameSelected} disabled={!selected}>
            frame
          </button>
          <button onClick={() => setClip(IDLE)}>idle</button>
        </div>
        {selected && (
          <div className="selected">
            <h2>{selected.label}</h2>
            <div className="meta" style={{ fontFamily: mono }}>
              {PACK_LABELS[selected.pack]} · rig {selected.rig} · {selected.boneCount} bones · {selected.clips.length} clips
              <br />
              playing: {playing ?? "nothing"}
            </div>
            {(["r", "l"] as const).map((slot) => {
              const chosen = hands.get(selected.id)?.[slot];
              const defaults = DEFAULT_ARMS[selected.rig]?.[slot];
              const value = chosen !== undefined ? chosen ?? "" : armAll && defaults ? gearId(defaults) : "";
              const options = slot === "l" ? [...selectedHeld].sort((a, b) => Number(b.kind === "shield") - Number(a.kind === "shield")) : selectedHeld;
              return (
                <label key={slot} className="field">
                  <span>{slot === "r" ? "right hand" : "left hand"}</span>
                  <select value={value} onChange={(e) => setHand(selected.id, slot, e.target.value || null)}>
                    <option value="">empty</option>
                    {options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.kind === "shield" ? "⛨ " : ""}
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
            <div className="field">
              <span>actions</span>
              <div className="chips">
                {ACTION_IDS.map((id) => {
                  const name = defaultClip(selected, id);
                  if (!name) return null;
                  return (
                    <button
                      key={id}
                      className={name === playing ? "chip on" : "chip"}
                      title={name}
                      onClick={() => {
                        setTarget("selected");
                        setClip(name);
                      }}
                    >
                      {id}
                    </button>
                  );
                })}
              </div>
            </div>
            {selectedWorn.length > 0 && (
              <div className="field">
                <span>wear</span>
                <div className="chips">
                  {selectedWorn.map((o) => (
                    <button
                      key={o.id}
                      className={worn.get(selected.id)?.has(o.id) ? "chip on" : "chip"}
                      onClick={() => toggleWorn(selected.id, o.id)}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="field">
              <span>clips</span>
            </div>
            <div className="chips">
              {selected.clips.map((name) => (
                <button
                  key={name}
                  className={name === playing ? "chip on" : "chip"}
                  onClick={() => {
                    setTarget("selected");
                    setClip(name);
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="hint">drag to orbit · wheel to zoom · click a figure to select</div>
      </aside>
      <div className="stage" ref={mountRef}>
        <div className="overlay" ref={overlayRef} />
      </div>
    </div>
  );
}
