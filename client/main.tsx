import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { createGame, step, TICK_RATE } from "../sim/tick";
import { starterZone } from "../sim/zone";
import type { PlayerInput } from "../sim/state";
import { createScene } from "./render/scene";

const TICK_MS = 1000 / TICK_RATE;

function Game() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current!;
    const map = starterZone();
    const game = createGame(Date.now() >>> 0, map);
    const scene = createScene(mount, map);

    let pending: PlayerInput = {};
    let prevPlayerPos = { ...game.player.pos };
    let mouseDown = false;
    let lastPointer: { x: number; y: number } | null = null;

    const aimFromPointer = () => {
      if (!lastPointer) return;
      const world = scene.screenToWorld(lastPointer.x, lastPointer.y);
      if (world) pending.moveTo = world;
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      mouseDown = true;
      lastPointer = { x: e.clientX, y: e.clientY };
      aimFromPointer();
    };
    const onPointerMove = (e: PointerEvent) => {
      lastPointer = { x: e.clientX, y: e.clientY };
    };
    const onPointerUp = () => {
      mouseDown = false;
    };
    mount.addEventListener("pointerdown", onPointerDown);
    mount.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      acc += Math.min(now - last, 250); // clamp tab-switch catchup
      last = now;
      while (acc >= TICK_MS) {
        if (mouseDown) aimFromPointer(); // hold-to-walk
        prevPlayerPos = { ...game.player.pos };
        step(game, pending);
        pending = {};
        acc -= TICK_MS;
      }
      scene.render(game, prevPlayerPos, acc / TICK_MS);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      mount.removeEventListener("pointerdown", onPointerDown);
      mount.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      scene.dispose();
    };
  }, []);

  return <div ref={mountRef} style={{ width: "100%", height: "100%" }} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Game />
  </StrictMode>,
);
