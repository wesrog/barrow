import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { createGame, step, TICK_RATE } from "../sim/tick";
import { starterZone } from "../sim/zone";
import { spawnMonster } from "../sim/monsters";
import type { PlayerInput } from "../sim/state";
import { createScene } from "./render/scene";

const TICK_MS = 1000 / TICK_RATE;

function Game() {
  const mountRef = useRef<HTMLDivElement>(null);
  const lifeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current!;
    const map = starterZone();
    const game = createGame(Date.now() >>> 0, map);
    const scene = createScene(mount, map);

    // Placeholder spawns until the zone milestone authors them in the map.
    spawnMonster(game, "shambler", { x: 8.5, y: 4.5 });
    spawnMonster(game, "shambler", { x: 16.5, y: 8.5 });
    spawnMonster(game, "skitter", { x: 12.5, y: 2.5 });
    spawnMonster(game, "skitter", { x: 13.5, y: 3.5 });
    spawnMonster(game, "skitter", { x: 22.5, y: 10.5 });

    let pending: PlayerInput = {};
    let prevPlayerPos = { ...game.player.pos };
    let mouseDown = false;
    let lastPointer: { x: number; y: number } | null = null;

    const aimFromPointer = (allowAttack: boolean) => {
      if (!lastPointer) return;
      const picked = scene.pick(game, lastPointer.x, lastPointer.y);
      if (!picked) return;
      if (picked.kind === "monster" && allowAttack) {
        pending.attack = picked.id;
        delete pending.moveTo;
      } else if (picked.kind === "ground") {
        pending.moveTo = picked.world;
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      mouseDown = true;
      lastPointer = { x: e.clientX, y: e.clientY };
      aimFromPointer(true);
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
      acc += Math.min(now - last, 250);
      last = now;
      while (acc >= TICK_MS) {
        if (mouseDown && pending.attack === undefined) aimFromPointer(false);
        prevPlayerPos = { ...game.player.pos };
        step(game, pending);
        pending = {};
        for (const e of game.events) {
          if (e.type === "monster_hit") {
            scene.addDamageNumber(e.pos, String(e.amount), "#f4e9c8");
          } else if (e.type === "player_hit") {
            scene.addDamageNumber(game.player.pos, String(e.amount), "#e05252");
          }
        }
        acc -= TICK_MS;
      }
      if (lifeRef.current) {
        lifeRef.current.textContent = game.player.dead
          ? "you have died"
          : `life ${game.player.life}/${game.player.maxLife}`;
        lifeRef.current.style.color = game.player.dead ? "#e05252" : "#c9b896";
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

  return (
    <div ref={mountRef} style={{ width: "100%", height: "100%" }}>
      <div
        ref={lifeRef}
        style={{
          position: "absolute",
          bottom: 14,
          left: "50%",
          transform: "translateX(-50%)",
          fontFamily: "ui-monospace, monospace",
          fontSize: 13,
          color: "#c9b896",
          textShadow: "0 1px 3px #000",
          zIndex: 2,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Game />
  </StrictMode>,
);
