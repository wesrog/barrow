import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { TICK_RATE } from "../sim/tick";
import { zoneDepth, zoneOf, type GameState, type PlayerInput } from "../sim/state";
import { localId, localPlayer, setLocalId } from "./local";
import type { NetDriver } from "./net/driver";
import type { EquipSlot } from "../sim/character";
import type { SkillId } from "../sim/skills";
import { play, unlock } from "./audio";
import { loadAssets, type GameAssets } from "./render/models";
import { createScene } from "./render/scene";
import { saveToStorage, wipeStorage } from "./save";
import { BottomBar } from "./ui/BottomBar";
import { Lobby } from "./ui/Lobby";
import { MiniMap } from "./ui/MiniMap";
import { PartyStrip } from "./ui/PartyStrip";
import { ShopPanel } from "./ui/ShopPanel";
import { InventoryPanel } from "./ui/InventoryPanel";
import { SkillPanel } from "./ui/SkillPanel";
import { Toasts, type ToastMsg } from "./ui/Toasts";
import { ZoneBanner } from "./ui/ZoneBanner";
import { Reveal } from "./ui/Reveal";

const TICK_MS = 1000 / TICK_RATE;

let nextToastId = 1;

function Game({
  driver,
  assets,
  roomCode,
}: {
  driver: NetDriver;
  assets: GameAssets;
  roomCode: string | null;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<GameState | null>(null);
  // Inputs queued by the HUD (equip/unequip clicks), merged into the next tick.
  const uiInputRef = useRef<PlayerInput>({});
  const [invOpen, setInvOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [, setVersion] = useState(0);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [desync, setDesync] = useState(false);
  const [hostLeft, setHostLeft] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const mount = mountRef.current!;
    let disposed = false;
    let cleanup: (() => void) | null = null;

    void (async () => {
      const session = driver.session;
      setLocalId(session.localId!);
      driver.onClose?.(() => {
        if (!disposed) setHostLeft(true);
      });
      // Frame 0 carries the local hero's join — nothing can read the roster
      // (or build a scene around it) until that first frame has landed. Solo
      // manufactures it on request; a host's timer and a joiner's transport
      // both deliver it a tick or two after welcome.
      await new Promise<void>((resolve) => {
        const pump = () => {
          if (disposed) return;
          driver.requestTick?.();
          if (session.tryStep()) {
            resolve();
            return;
          }
          requestAnimationFrame(pump);
        };
        pump();
      });
      if (disposed) return;
      const game = session.state!;
      gameRef.current = game;
      setReady(true);
      // Dev console hook: poke the sim from the browser console while testing.
      if (import.meta.env.DEV) {
        (window as { __barrow?: unknown }).__barrow = { game, driver, input: uiInputRef };
      }
      const onItemClick = (itemId: number) => {
        uiInputRef.current.pickup = itemId;
      };
      let scene = createScene(mount, zoneOf(game, localPlayer(game)).map, assets, onItemClick);
      let sceneMap = zoneOf(game, localPlayer(game)).map;

    let pending: PlayerInput = {};
    // Every player's position as of the last tick — the scene interpolates the
    // whole party, not just us.
    const snapshotPositions = () =>
      new Map([...game.players].map(([id, p]) => [id, { ...p.pos }] as const));
    let prevPositions = snapshotPositions();
    let mouseDown = false;
    let lastPointer: { x: number; y: number } | null = null;

    let shiftDown = false;
    const aimFromPointer = (allowAttack: boolean) => {
      if (!lastPointer) return;
      const picked = scene.pick(game, lastPointer.x, lastPointer.y);
      if (!picked) return;
      if (shiftDown) {
        // Stand ground and swing toward the cursor, D2-style.
        const at =
          picked.kind === "ground"
            ? picked.world
            : picked.kind === "monster"
              ? zoneOf(game, localPlayer(game)).monsters.get(picked.id)?.pos
              : undefined;
        if (at) {
          pending.swingAt = { ...at };
          delete pending.moveTo;
        }
        return;
      }
      if (picked.kind === "monster" && allowAttack) {
        pending.attack = picked.id;
        delete pending.moveTo;
      } else if (picked.kind === "item" && allowAttack) {
        pending.pickup = picked.id;
        delete pending.moveTo;
      } else if (picked.kind === "breakable" && allowAttack) {
        pending.smash = picked.id;
        delete pending.moveTo;
      } else if (picked.kind === "vendor" && allowAttack) {
        pending.talkVendor = true;
        delete pending.moveTo;
      } else if (picked.kind === "portal" && allowAttack) {
        pending.usePortal = picked.id;
        delete pending.moveTo;
      } else if (picked.kind === "corpse" && allowAttack) {
        pending.reclaim = picked.id;
        delete pending.moveTo;
      } else if (picked.kind === "ground") {
        pending.moveTo = picked.world;
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      unlock(); // first gesture wakes the audio engine
      if (e.button !== 0) return;
      // Only canvas clicks are world clicks — HUD panels handle their own.
      if (!(e.target instanceof HTMLCanvasElement)) return;
      mouseDown = true;
      shiftDown = e.shiftKey;
      lastPointer = { x: e.clientX, y: e.clientY };
      aimFromPointer(true);
    };
    const onPointerMove = (e: PointerEvent) => {
      lastPointer = { x: e.clientX, y: e.clientY };
      shiftDown = e.shiftKey;
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
      else if (e.key === "t") uiInputRef.current.townPortal = true;
      else if (e.key === "v") setShopOpen((open) => !open);
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
    const save = () => {
      if (session.state) saveToStorage(session.state, localId());
    };
    const saveTimer = setInterval(save, 5000);
    // The bottom bar re-reads game state on a light heartbeat; the same tick
    // watches for a desync verdict from the session.
    const hudTimer = setInterval(() => {
      setVersion((v) => v + 1);
      if (session.desyncAt !== null) setDesync(true);
    }, 100);
    const onUnload = () => save();
    window.addEventListener("beforeunload", onUnload);

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let sawEvents = false;
    let lastSentTick = -1;

    const pushToast = (text: string) => {
      setToasts((cur) => [...cur, { id: nextToastId++, text }]);
    };

    const drainEvents = () => {
      if (game.events.length > 0) sawEvents = true;
      const localZone = localPlayer(game).zoneId;
      for (const e of game.events) {
          // Toasts are party-wide broadcast info — they fire off the raw
          // stream, unlike the scene/sound effects below which only care
          // about the local player's own zone.
          switch (e.type) {
            case "player_joined":
              if (e.playerId !== localId()) pushToast(`P${e.playerId + 1} joined`);
              break;
            case "player_left":
              pushToast(`P${e.playerId + 1} left`);
              break;
            case "player_died": {
              const depth = zoneDepth(e.zone);
              pushToast(
                depth > 0 ? `P${e.playerId + 1} fell on floor ${depth}` : `P${e.playerId + 1} died`,
              );
              break;
            }
            case "portal_cast":
              pushToast(`P${e.playerId + 1} opened a portal`);
              break;
          }
          // Another zone entirely: neither the scene nor the HUD cares.
          if ("zone" in e && e.zone !== localZone) continue;
          // The scene animates every hero on screen; the HUD and the sound
          // effects only react to the local one.
          scene.handleEvent(e, game);
          if ("playerId" in e && e.playerId !== localId()) continue;
          switch (e.type) {
            case "monster_hit":
              scene.addDamageNumber(e.pos, String(e.amount), "#f4e9c8");
              play("hit");
              break;
            case "player_hit":
              scene.addDamageNumber(localPlayer(game).pos, String(e.amount), "#e05252");
              play("hurt");
              break;
            case "player_swing":
              play("swing");
              break;
            case "monster_swing":
              if (e.ranged) play("spit");
              break;
            case "monster_windup":
              play("windup");
              break;
            case "monster_died":
              play("die");
              break;
            case "breakable_broken":
              play("hit");
              break;
            case "item_dropped":
              play(e.rarity === "normal" ? "drop" : "drop_rare");
              break;
            case "item_picked":
              play("pickup");
              break;
            case "potion_drunk":
              scene.addDamageNumber(localPlayer(game).pos, `+${e.healed}`, "#7fd97f");
              play("potion");
              break;
            case "level_up":
              scene.addDamageNumber(localPlayer(game).pos, `level ${e.level}!`, "#f0c96a");
              play("levelup");
              break;
            case "exploded":
              scene.addExplosion(e.pos, e.radius);
              play("explode");
              break;
            case "gold_picked":
              play("coin");
              break;
            case "traveled":
              play("portal");
              if (e.to !== "camp") setShopOpen(false);
              break;
            case "shop_opened":
              setShopOpen(true);
              break;
            case "item_broke":
              scene.addDamageNumber(localPlayer(game).pos, `${e.name} broke!`, "#e05252");
              play("die");
              break;
            case "repaired":
              scene.addDamageNumber(localPlayer(game).pos, `repaired (-${e.cost}g)`, "#c9a84c");
              play("coin");
              break;
            case "bought":
            case "sold":
              play("coin");
              break;
            case "skill_cast":
              if (e.skill === "warcry") {
                scene.addDamageNumber(localPlayer(game).pos, "warcry!", "#9ad1f5");
                play("warcry");
              } else if (e.skill === "cleave") play("cleave");
              else if (e.skill === "crush") play("crush");
              else if (e.skill === "leap") play("leap");
              break;
        }
      }
    };

    /** One lockstep tick: hand this tick's input to the driver, pull the
     * matching frame down, step. False means we're starved — the frame for
     * this tick hasn't arrived yet, so the world holds where it is. */
    const runTick = (gatherInput: boolean): boolean => {
      if (gatherInput) {
        if (mouseDown && (shiftDown || pending.attack === undefined)) aimFromPointer(shiftDown);
        Object.assign(pending, uiInputRef.current);
        uiInputRef.current = {};
      }
      // Input is stamped for a tick INPUT_DELAY_TICKS out. Re-sending for the
      // same tick would only overwrite itself, so send once per tick.
      if (game.tick !== lastSentTick) {
        driver.sendInput(pending);
        lastSentTick = game.tick;
        pending = {};
      }
      driver.requestTick?.(); // solo: we are our own frame source
      prevPositions = snapshotPositions();
      if (!session.tryStep()) return false;
      drainEvents();
      return true;
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      acc += Math.min(now - last, 250);
      last = now;
      sawEvents = false;
      let starved = false;
      while (acc >= TICK_MS) {
        if (!runTick(true)) {
          starved = true;
          break;
        }
        acc -= TICK_MS;
      }
      // Frames piled up while we were behind: burn through the backlog so the
      // world catches up to the host instead of drifting further adrift.
      let catchUp = 8;
      while (!starved && session.buffered() > 4 && catchUp-- > 0) {
        if (!runTick(false)) break;
      }
      // Waiting on the network: don't let the accumulator hoard the stall.
      if (starved) acc = Math.min(acc, TICK_MS);
      if (sawEvents) setVersion((v) => v + 1);
      // Traveling swaps the zone map — rebuild the whole scene around it.
      const currentMap = zoneOf(game, localPlayer(game)).map;
      if (currentMap !== sceneMap) {
        scene.dispose();
        scene = createScene(mount, currentMap, assets, onItemClick);
        sceneMap = currentMap;
        prevPositions = snapshotPositions();
      }
      if (lastPointer) scene.updateHover(game, lastPointer.x, lastPointer.y);
      scene.render(game, prevPositions, acc / TICK_MS);
    };
    raf = requestAnimationFrame(frame);

      cleanup = () => {
        cancelAnimationFrame(raf);
        mount.removeEventListener("pointerdown", onPointerDown);
        mount.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("keydown", onKeyDown);
        clearInterval(saveTimer);
        clearInterval(hudTimer);
        window.removeEventListener("beforeunload", onUnload);
        driver.stop();
        scene.dispose();
        gameRef.current = null;
      };
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
    // driver/assets/roomCode are set once by the lobby and never change identity
    // for the lifetime of this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={mountRef} style={{ width: "100%", height: "100%" }}>
      {!ready && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "ui-monospace, monospace",
            color: "#8f8778",
            letterSpacing: 2,
          }}
        >
          descending into the barrow…
        </div>
      )}
      {hostLeft && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 10,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            background: "rgba(8,7,10,.92)",
            fontFamily: "ui-monospace, monospace",
            color: "#c9bfa8",
          }}
        >
          <div style={{ fontSize: 15, letterSpacing: 2 }}>the host left</div>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "10px 18px",
              border: "1px solid #3a3442",
              borderRadius: 4,
              background: "rgba(20,18,24,.9)",
              color: "#e8dcc0",
              fontFamily: "ui-monospace, monospace",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            reload
          </button>
        </div>
      )}
      {roomCode && (
        <div
          style={{
            position: "absolute",
            top: 14,
            right: 14,
            zIndex: 4,
            padding: "5px 9px",
            border: "1px solid #3a3442",
            borderRadius: 4,
            background: "rgba(12,11,15,.75)",
            color: "#7fb8c9",
            fontFamily: "ui-monospace, monospace",
            fontSize: 11,
            letterSpacing: 1,
            cursor: "pointer",
            userSelect: "none",
          }}
          title="click to copy the join link"
          onClick={() => {
            void navigator.clipboard?.writeText(
              `${location.origin}${location.pathname}?join=${roomCode}`,
            );
          }}
        >
          room {roomCode}
        </div>
      )}
      <Toasts
        toasts={toasts}
        desync={desync}
        onExpire={(id) => setToasts((cur) => cur.filter((t) => t.id !== id))}
      />
      {gameRef.current && <ZoneBanner game={gameRef.current} />}
      {gameRef.current && <PartyStrip game={gameRef.current} />}
      {gameRef.current && (
        <BottomBar
          game={gameRef.current}
          onAction={(action) => {
            if (action === "inventory") setInvOpen((open) => !open);
            else if (action === "skills") setSkillsOpen((open) => !open);
            else if (action === "drink") uiInputRef.current.drink = true;
            else if (action === "portal") uiInputRef.current.townPortal = true;
            else if (action === "vendor") setShopOpen((open) => !open);
          }}
        />
      )}
      {gameRef.current && <MiniMap game={gameRef.current} />}
      <Reveal
        open={
          shopOpen && gameRef.current !== null && localPlayer(gameRef.current).zoneId === "camp"
        }
      >
        {gameRef.current && localPlayer(gameRef.current).zoneId === "camp" && (
          <ShopPanel
            game={gameRef.current}
            onBuy={(index) => {
              uiInputRef.current.buy = index;
            }}
            onSell={(entryId) => {
              uiInputRef.current.sell = entryId;
            }}
            onRepair={() => {
              uiInputRef.current.repair = true;
            }}
          />
        )}
      </Reveal>
      <Reveal open={skillsOpen && gameRef.current !== null}>
        {gameRef.current && (
          <SkillPanel
            game={gameRef.current}
            onSpend={(skill) => {
              uiInputRef.current.spendSkill = skill;
            }}
          />
        )}
      </Reveal>
      <Reveal open={invOpen && gameRef.current !== null}>
        {gameRef.current && (
          <InventoryPanel
            game={gameRef.current}
            assets={assets}
            onEquip={(entryId) => {
              uiInputRef.current.equip = entryId;
            }}
            onUnequip={(slot: EquipSlot) => {
              uiInputRef.current.unequip = slot;
            }}
            onDrop={(entryId) => {
              uiInputRef.current.dropItem = entryId;
            }}
          />
        )}
      </Reveal>
    </div>
  );
}

/** Top-level: loads assets in the background while the lobby lets the player
 * choose solo/host/join. The game loop (Game, below) only mounts once both a
 * driver and the assets exist — whichever finishes last gates the start. */
function App() {
  const [assets, setAssets] = useState<GameAssets | null>(null);
  const [driver, setDriver] = useState<NetDriver | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const loaded = await loadAssets();
      if (!disposed) setAssets(loaded);
    })();
    return () => {
      disposed = true;
    };
  }, []);

  if (!driver) {
    return (
      <Lobby
        onReady={(d, code) => {
          setDriver(d);
          setRoomCode(code);
        }}
      />
    );
  }

  if (!assets) {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "ui-monospace, monospace",
          color: "#8f8778",
          letterSpacing: 2,
        }}
      >
        descending into the barrow…
      </div>
    );
  }

  return <Game driver={driver} assets={assets} roomCode={roomCode} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// A live game can't hot-swap its module graph — take the full reload instead
// of stacking a second sim + renderer on top of the running one.
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
