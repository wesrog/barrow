import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createGame, step, TICK_RATE } from "../sim/tick";
import { cryptZone } from "../sim/zone";
import type { GameState, PlayerInput } from "../sim/state";
import type { EquipSlot } from "../sim/character";
import type { SkillId } from "../sim/skills";
import { createScene } from "./render/scene";
import { loadFromStorage, saveToStorage, wipeStorage } from "./save";
import { InventoryPanel } from "./ui/InventoryPanel";
import { SkillPanel } from "./ui/SkillPanel";

const TICK_MS = 1000 / TICK_RATE;

function Game() {
  const mountRef = useRef<HTMLDivElement>(null);
  const lifeRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<GameState | null>(null);
  // Inputs queued by the HUD (equip/unequip clicks), merged into the next tick.
  const uiInputRef = useRef<PlayerInput>({});
  const [invOpen, setInvOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [, setVersion] = useState(0);

  useEffect(() => {
    const mount = mountRef.current!;
    const map = cryptZone();
    const game = createGame(Date.now() >>> 0, map);
    loadFromStorage(game);
    gameRef.current = game;
    const scene = createScene(mount, map, (itemId) => {
      uiInputRef.current.pickup = itemId;
    });

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
      } else if (picked.kind === "item" && allowAttack) {
        pending.pickup = picked.id;
        delete pending.moveTo;
      } else if (picked.kind === "ground") {
        pending.moveTo = picked.world;
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      // Only canvas clicks are world clicks — HUD panels handle their own.
      if (!(e.target instanceof HTMLCanvasElement)) return;
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
    const castAtCursor = (skill: SkillId) => {
      const input = uiInputRef.current;
      if (skill === "warcry" || skill === "cleave") {
        input.cast = { skill };
        return;
      }
      if (!lastPointer) return;
      const picked = scene.pick(game, lastPointer.x, lastPointer.y);
      if (skill === "crush") {
        if (picked?.kind === "monster") input.cast = { skill, target: picked.id };
      } else if (skill === "leap") {
        if (picked?.kind === "ground") input.cast = { skill, at: picked.world };
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "i") setInvOpen((open) => !open);
      else if (e.key === "s") setSkillsOpen((open) => !open);
      else if (e.key === "q") uiInputRef.current.drink = true;
      else if (e.key === "n") uiInputRef.current.newGame = true;
      else if (e.key === "N") {
        // Bury this character and start fresh.
        wipeStorage();
        window.location.reload();
      }
      else if (e.key === "1") castAtCursor("cleave");
      else if (e.key === "2") castAtCursor("crush");
      else if (e.key === "3") castAtCursor("warcry");
      else if (e.key === "4") castAtCursor("leap");
    };
    mount.addEventListener("pointerdown", onPointerDown);
    mount.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
    const saveTimer = setInterval(() => saveToStorage(game), 5000);
    const onUnload = () => saveToStorage(game);
    window.addEventListener("beforeunload", onUnload);

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      acc += Math.min(now - last, 250);
      last = now;
      let sawEvents = false;
      while (acc >= TICK_MS) {
        if (mouseDown && pending.attack === undefined) aimFromPointer(false);
        Object.assign(pending, uiInputRef.current);
        uiInputRef.current = {};
        prevPlayerPos = { ...game.player.pos };
        step(game, pending);
        pending = {};
        for (const e of game.events) {
          scene.handleEvent(e, game);
          if (e.type === "monster_hit") {
            scene.addDamageNumber(e.pos, String(e.amount), "#f4e9c8");
          } else if (e.type === "player_hit") {
            scene.addDamageNumber(game.player.pos, String(e.amount), "#e05252");
          } else if (e.type === "level_up") {
            scene.addDamageNumber(game.player.pos, `level ${e.level}!`, "#f0c96a");
          } else if (e.type === "skill_cast" && e.skill === "warcry") {
            scene.addDamageNumber(game.player.pos, "warcry!", "#9ad1f5");
          } else if (e.type === "potion_drunk") {
            scene.addDamageNumber(game.player.pos, `+${e.healed}`, "#7fd97f");
          } else if (e.type === "exploded") {
            scene.addExplosion(e.pos, e.radius);
          }
        }
        if (game.events.length > 0) sawEvents = true;
        acc -= TICK_MS;
      }
      if (sawEvents) setVersion((v) => v + 1);
      if (lifeRef.current) {
        const p = game.player;
        lifeRef.current.textContent = p.dead
          ? "you have died — press n to rise again"
          : `life ${p.life}/${p.maxLife} · mana ${Math.floor(p.mana)}/${p.maxMana} · potions ${p.belt} (q) · lvl ${p.level}` +
            (p.skillPoints > 0 ? ` · ${p.skillPoints} skill pt (s)` : "");
        lifeRef.current.style.color = p.dead ? "#e05252" : "#c9b896";
      }
      scene.render(game, prevPlayerPos, acc / TICK_MS);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      mount.removeEventListener("pointerdown", onPointerDown);
      mount.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      clearInterval(saveTimer);
      window.removeEventListener("beforeunload", onUnload);
      scene.dispose();
      gameRef.current = null;
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
      {skillsOpen && gameRef.current && (
        <SkillPanel
          game={gameRef.current}
          onSpend={(skill) => {
            uiInputRef.current.spendSkill = skill;
          }}
        />
      )}
      {invOpen && gameRef.current && (
        <InventoryPanel
          game={gameRef.current}
          onEquip={(entryId) => {
            uiInputRef.current.equip = entryId;
          }}
          onUnequip={(slot: EquipSlot) => {
            uiInputRef.current.unequip = slot;
          }}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Game />
  </StrictMode>,
);

// A live game can't hot-swap its module graph — take the full reload instead
// of stacking a second sim + renderer on top of the running one.
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
