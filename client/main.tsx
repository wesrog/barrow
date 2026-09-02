import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { TICK_RATE } from "../sim/tick";
import { zoneDepth, zoneOf, type GameState, type PlayerInput } from "../sim/state";
import { locationTitle, regionTitle, inRect, worldCampRect } from "../sim/surface";
import { localId, localPlayer, setLocalId } from "./local";
import type { NetDriver } from "./net/driver";
import type { EquipSlot } from "../sim/character";
import { SKILLS, type SkillId } from "../sim/skills";
import { assignHotbar, loadHotbar, type Hotbar } from "./hotbar";
import { play, unlock } from "./audio";
import { loadAssets, type GameAssets } from "./render/models";
import { createScene } from "./render/scene";
import { saveToStorage, wipeStorage } from "./save";
import { BottomBar } from "./ui/BottomBar";
import { Lobby } from "./ui/Lobby";
import { MiniMap } from "./ui/MiniMap";
import { PartyStrip } from "./ui/PartyStrip";
import { ShopPanel } from "./ui/ShopPanel";
import { HealerPanel } from "./ui/HealerPanel";
import { DialoguePanel } from "./ui/DialoguePanel";
import { LorePanel, type LoreText } from "./ui/LorePanel";
import { landmarkAt } from "../sim/landmarks";
import type { NpcId } from "../sim/npcs";
import { InventoryPanel } from "./ui/InventoryPanel";
import { QuestTracker } from "./ui/QuestTracker";
import { QuestLogPanel } from "./ui/QuestLogPanel";
import { QUESTS, type QuestId } from "../sim/quests";
import { SkillPanel } from "./ui/SkillPanel";
import { SystemMenu } from "./ui/SystemMenu";
import { Toasts, type ToastMsg } from "./ui/Toasts";
import { WaypointPanel } from "./ui/WaypointPanel";
import { ZoneBanner } from "./ui/ZoneBanner";
import { ZoneIntro, type ZoneIntroMsg } from "./ui/ZoneIntro";
import { Reveal } from "./ui/Reveal";

const TICK_MS = 1000 / TICK_RATE;

let nextToastId = 1;
let nextIntroSeq = 1;

/** Is the local player standing on the camp's safe ground? */
function onCampGround(game: GameState): boolean {
  const p = localPlayer(game);
  return p.zoneId === "surface" && inRect(worldCampRect("overworld"), p.pos);
}

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
  const [healerOpen, setHealerOpen] = useState(false);
  const [waypointsOpen, setWaypointsOpen] = useState(false);
  const [questsOpen, setQuestsOpen] = useState(false);
  // Which quest the journal opens on — set by clicking a tracker entry.
  const [questFocus, setQuestFocus] = useState<QuestId | null>(null);
  const [dialogueNpc, setDialogueNpc] = useState<NpcId | null>(null);
  // A landmark's lore, opened by clicking its weathered stone up close.
  const [lore, setLore] = useState<{ site: string; text: LoreText } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // The keydown handler is registered once, so it reads open/closed through
  // refs that re-sync on every render.
  const menuOpenRef = useRef(false);
  menuOpenRef.current = menuOpen;
  const panelsOpenRef = useRef(false);
  panelsOpenRef.current =
    invOpen || skillsOpen || shopOpen || healerOpen || waypointsOpen || questsOpen ||
    dialogueNpc !== null || lore !== null;
  const [intro, setIntro] = useState<ZoneIntroMsg | null>(null);
  const [hotbar, setHotbar] = useState<Hotbar>([null, null, null, null]);
  const hotbarRef = useRef<Hotbar>([null, null, null, null]);
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
      hotbarRef.current = loadHotbar(localPlayer(game).klass);
      setHotbar(hotbarRef.current);
      setReady(true);
      // Dev console hook: poke the sim from the browser console while testing.
      if (import.meta.env.DEV) {
        (window as { __barrow?: unknown }).__barrow = { game, driver, input: uiInputRef };
      }
      const onItemClick = (itemId: number) => {
        uiInputRef.current.pickup = itemId;
      };
      let scene = createScene(
        mount,
        zoneOf(game, localPlayer(game)).map,
        assets,
        [...zoneOf(game, localPlayer(game)).npcs.values()],
        onItemClick,
        localPlayer(game).zoneId === "surface",
      );
      let sceneMap = zoneOf(game, localPlayer(game)).map;

      // A black veil the zone crossing fades out from, so the world swap under
      // it reads as walking through, not teleporting.
      const fadeEl = document.createElement("div");
      fadeEl.style.cssText =
        "position:absolute;inset:0;background:#000;opacity:0;pointer-events:none;z-index:3;";
      mount.appendChild(fadeEl);
      const fadeThrough = () => {
        fadeEl.style.transition = "none";
        fadeEl.style.opacity = "1";
        void fadeEl.offsetHeight; // commit the opaque frame before easing out
        fadeEl.style.transition = "opacity .6s ease-out";
        fadeEl.style.opacity = "0";
      };

    let pending: PlayerInput = {};
    // Every player's position as of the last tick — the scene interpolates the
    // whole party, not just us.
    const snapshotPositions = () =>
      new Map([...game.players].map(([id, p]) => [id, { ...p.pos }] as const));
    let prevPositions = snapshotPositions();
    let mouseDown = false;
    let lastPointer: { x: number; y: number } | null = null;

    let shiftDown = false;
    // What the press started as. A held button re-aims every tick, and without
    // this a click on a portal/waypoint/item got downgraded to a plain walk one
    // tick later (the camera moves, the re-pick lands on ground) — cancelling
    // the target the sim had just started walking toward.
    let holdMode: "move" | "engage" = "move";
    const aimFromPointer = (initial: boolean) => {
      if (!lastPointer) return;
      const picked = scene.pick(game, lastPointer.x, lastPointer.y);
      if (!picked) return;
      if (initial) holdMode = picked.kind === "ground" ? "move" : "engage";
      // While held, each re-aim stays in its lane: a walk-drag doesn't snag on
      // passing targets, and an engaged target isn't downgraded to a walk.
      if (!initial && !shiftDown) {
        if (holdMode === "move" && picked.kind !== "ground") return;
        if (holdMode === "engage" && picked.kind === "ground") return;
      }
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
      if (picked.kind === "monster") {
        pending.attack = picked.id;
        delete pending.moveTo;
      } else if (picked.kind === "item") {
        pending.pickup = picked.id;
        delete pending.moveTo;
      } else if (picked.kind === "breakable") {
        pending.smash = picked.id;
        delete pending.moveTo;
      } else if (picked.kind === "npc") {
        pending.talkNpc = picked.id;
        delete pending.moveTo;
      } else if (picked.kind === "portal") {
        pending.usePortal = picked.id;
        delete pending.moveTo;
      } else if (picked.kind === "corpse") {
        pending.reclaim = picked.id;
        delete pending.moveTo;
      } else if (picked.kind === "waypoint") {
        // Near the clicked ring the panel opens; from afar the click walks you
        // to it — that ring, not whichever waypoint happens to be listed first.
        const me = localPlayer(game);
        if (Math.hypot(me.pos.x - picked.pos.x, me.pos.y - picked.pos.y) <= 2) {
          setWaypointsOpen(true);
        } else {
          pending.moveTo = { ...picked.pos };
        }
        delete pending.attack;
      } else if (picked.kind === "lore") {
        // Same shape as waypoints: read it up close, walk to it from afar.
        const me = localPlayer(game);
        if (Math.hypot(me.pos.x - picked.pos.x, me.pos.y - picked.pos.y) <= 2.2) {
          const def = landmarkAt(zoneOf(game, me).map.landmarks ?? [], picked.pos);
          if (def) setLore({ site: def.name, text: def.lore });
        } else {
          pending.moveTo = { ...picked.pos };
        }
        delete pending.attack;
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
    // Cast keys q/w/e/r fire whatever skill the player bound to each slot;
    // each skill's targeting mode decides what the cursor contributes.
    const castSlot = (slot: number) => {
      const id = hotbarRef.current[slot];
      if (!id) return;
      const def = SKILLS[id];
      if (def.klass !== localPlayer(game).klass) return;
      const input = uiInputRef.current;
      if (def.targeting === "none") {
        input.cast = { skill: def.id };
        return;
      }
      if (!lastPointer) return;
      const picked = scene.pick(game, lastPointer.x, lastPointer.y);
      if (def.targeting === "target") {
        // The sim auto-targets whatever is in reach; the pick is only a hint —
        // except barrels, which are only ever hit on an explicit hover.
        input.cast = {
          skill: def.id,
          target: picked?.kind === "monster" ? picked.id : undefined,
          breakable: picked?.kind === "breakable" ? picked.id : undefined,
        };
      } else if (picked?.kind === "monster") {
        // Point skills aimed at a monster land on the monster, not underneath it.
        const m = zoneOf(game, localPlayer(game)).monsters.get(picked.id);
        if (m) input.cast = { skill: def.id, at: { x: m.pos.x, y: m.pos.y } };
      } else if (picked?.kind === "ground") {
        input.cast = { skill: def.id, at: picked.world };
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Layered like D2: close the menu, else close panels, else open the menu.
        if (menuOpenRef.current) setMenuOpen(false);
        else if (panelsOpenRef.current) {
          setInvOpen(false);
          setSkillsOpen(false);
          setShopOpen(false);
          setHealerOpen(false);
          setWaypointsOpen(false);
          setQuestsOpen(false);
          setDialogueNpc(null);
          setLore(null);
        } else setMenuOpen(true);
      }
      else if (e.key === "i") setInvOpen((open) => !open);
      else if (e.key === "s") setSkillsOpen((open) => !open);
      else if (e.key === "1") uiInputRef.current.drink = "health";
      else if (e.key === "2") uiInputRef.current.drink = "mana";
      else if (e.key === "n") uiInputRef.current.newGame = true;
      else if (e.key === "t") uiInputRef.current.townPortal = true;
      else if (e.key === "v") setShopOpen((open) => !open);
      else if (e.key === "N") {
        // Bury this character and start fresh.
        wipeStorage();
        window.location.reload();
      }
      // Lowercase q casts hotbar slot 0; the quest journal lives on shift+Q,
      // same capital-letter convention as N.
      else if (e.key === "Q") {
        setQuestFocus(null);
        setQuestsOpen((open) => !open);
      }
      else if (e.key === "q") castSlot(0);
      else if (e.key === "w") castSlot(1);
      else if (e.key === "e") castSlot(2);
      else if (e.key === "r") castSlot(3);
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

    let lastNoMana = -1000;

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
                e.zone === "surface"
                  ? `P${e.playerId + 1} fell in ${locationTitle(e.zone, e.pos)}`
                  : depth > 0
                    ? `P${e.playerId + 1} fell on floor ${depth}`
                    : `P${e.playerId + 1} died`,
              );
              // A death moves gear onto a corpse; persist it now so a crash
              // before the next autosave tick can't lose the body.
              if (e.playerId === localId()) save();
              break;
            }
            case "portal_cast":
              pushToast(`P${e.playerId + 1} opened a portal`);
              break;
          }
          // Another zone entirely: neither the scene nor the HUD cares.
          if ("zone" in e && e.zone !== localZone) continue;
          // One shared surface zone means zone-filtering no longer localizes
          // events; anything with a position that isn't ours gets range-culled.
          const me = localPlayer(game);
          if (
            "pos" in e &&
            !("playerId" in e && e.playerId === localId()) &&
            e.type !== "player_died" &&
            Math.hypot(e.pos.x - me.pos.x, e.pos.y - me.pos.y) > 24
          ) {
            continue;
          }
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
              scene.addDamageNumber(
                localPlayer(game).pos,
                `+${e.healed}`,
                e.kind === "mana" ? "#7fa3f5" : "#7fd97f",
              );
              play("potion");
              break;
            case "cast_failed": {
              // Held buttons retry every tick; one fizzle per half-second is plenty.
              const now = performance.now();
              if (now - lastNoMana >= 500) {
                lastNoMana = now;
                scene.addDamageNumber(localPlayer(game).pos, "no mana", "#7fa3f5");
                play("nomana");
              }
              break;
            }
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
              // Any travel leaves the camp behind.
              setShopOpen(false);
              setHealerOpen(false);
              setDialogueNpc(null);
              if (e.playerId === localId()) {
                setWaypointsOpen(false);
                // Every `traveled` is a teleport — stairs, portals, waypoints,
                // a death respawn — so veil the jump here rather than leaning on
                // the scene rebuild below: one stitched surface means a waypoint
                // hop keeps the same map and would otherwise cut with no fade.
                // A stairs descent hits both, in the same frame, so it still
                // reads as a single fade.
                fadeThrough();
                // The big "entering a new land" card, D2-style.
                const title = locationTitle(e.to, localPlayer(game).pos);
                const sub = e.to === "surface" ? undefined : `depth ${zoneDepth(e.to)}`;
                setIntro((prev) =>
                  prev?.title === title && prev?.sub === sub ? prev : { seq: nextIntroSeq++, title, sub },
                );
                save(); // a zone crossing is a moment worth keeping
              }
              break;
            case "region_entered":
              if (e.playerId === localId()) {
                const title = regionTitle(e.area);
                setIntro((prev) =>
                  prev?.title === title && prev?.sub === undefined
                    ? prev
                    : { seq: nextIntroSeq++, title },
                );
                save(); // a border crossing is a moment worth keeping
              }
              break;
            case "waypoint_found":
              if (e.playerId === localId()) {
                pushToast(`waypoint found: ${regionTitle(e.area)}`);
                play("levelup");
                save(); // the new checkpoint survives even an immediate crash
              }
              break;
            case "healed":
              scene.addDamageNumber(localPlayer(game).pos, "restored", "#7de08a");
              play("potion");
              break;
            case "npc_talk":
              setDialogueNpc(e.npcId);
              play("potion"); // any soft cue; a dedicated "talk" sound is optional
              break;
            case "quest_accepted":
              pushToast(`quest taken: ${QUESTS[e.quest].name}`);
              play("levelup");
              break;
            case "quest_completed":
              scene.addDamageNumber(localPlayer(game).pos, "quest complete!", "#f0c96a");
              pushToast(`quest complete: ${QUESTS[e.quest].name}`);
              play("levelup");
              save(); // a finished quest survives even an immediate crash
              break;
            case "inventory_full":
              scene.addDamageNumber(localPlayer(game).pos, "inventory full!", "#e05252");
              play("drop");
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
            case "leap_land":
              play("leapland");
              break;
            case "skill_cast":
              if (e.skill === "warcry") {
                scene.addDamageNumber(localPlayer(game).pos, "warcry!", "#9ad1f5");
                play("warcry");
              } else if (e.skill === "cleave") play("cleave");
              else if (e.skill === "crush") play("crush");
              else if (e.skill === "leap") play("leap");
              else if (e.skill === "stomp") play("leapland");
              else if (e.skill === "deathblow") play("crush");
              else if (e.skill === "firebolt") play("spit");
              else if (e.skill === "fireball") play("spit");
              else if (e.skill === "chainbolt") play("spit");
              else if (e.skill === "frostnova") play("cleave");
              else if (e.skill === "blink") play("leap");
              else if (e.skill === "focus") {
                scene.addDamageNumber(localPlayer(game).pos, "focus!", "#b08ad1");
                play("warcry");
              }
              break;
        }
      }
    };

    /** One lockstep tick: hand this tick's input to the driver, pull the
     * matching frame down, step. False means we're starved — the frame for
     * this tick hasn't arrived yet, so the world holds where it is. */
    const runTick = (gatherInput: boolean): boolean => {
      if (gatherInput) {
        // Holding the button re-aims every tick; the sim clears its target
        // after each swing, so this re-send is what makes hold = auto-attack.
        if (mouseDown && (shiftDown || pending.attack === undefined)) aimFromPointer(false);
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
      // Traveling swaps the zone map — rebuild the whole scene around it,
      // hidden behind a quick fade so the crossing feels continuous.
      const currentMap = zoneOf(game, localPlayer(game)).map;
      if (currentMap !== sceneMap) {
        scene.dispose();
        scene = createScene(
          mount,
          currentMap,
          assets,
          [...zoneOf(game, localPlayer(game)).npcs.values()],
          onItemClick,
          localPlayer(game).zoneId === "surface",
        );
        sceneMap = currentMap;
        prevPositions = snapshotPositions();
        mount.appendChild(fadeEl); // stay above the fresh canvas
        fadeThrough();
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
        fadeEl.remove();
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
            fontFamily: '"IM Fell English", "Times New Roman", serif',
            fontStyle: "italic",
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
      {gameRef.current && (
        <QuestTracker
          game={gameRef.current}
          onOpen={(id) => {
            setQuestFocus(id);
            setQuestsOpen(true);
          }}
        />
      )}
      {gameRef.current && <ZoneIntro intro={intro} />}
      {gameRef.current && <PartyStrip game={gameRef.current} />}
      {gameRef.current && (
        <BottomBar
          game={gameRef.current}
          hotbar={hotbar}
          onAction={(action) => {
            if (action === "inventory") setInvOpen((open) => !open);
            else if (action === "skills") setSkillsOpen((open) => !open);
            else if (action === "drinkHealth") uiInputRef.current.drink = "health";
            else if (action === "drinkMana") uiInputRef.current.drink = "mana";
            else if (action === "portal") uiInputRef.current.townPortal = true;
            else if (action === "vendor") setShopOpen((open) => !open);
          }}
        />
      )}
      {gameRef.current && <MiniMap game={gameRef.current} />}
      <Reveal open={shopOpen && gameRef.current !== null && onCampGround(gameRef.current)}>
        {gameRef.current && onCampGround(gameRef.current) && (
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
            onClose={() => setShopOpen(false)}
          />
        )}
      </Reveal>
      <Reveal open={healerOpen && gameRef.current !== null && onCampGround(gameRef.current)}>
        {gameRef.current && onCampGround(gameRef.current) && (
          <HealerPanel
            game={gameRef.current}
            onBuy={(kind) => {
              uiInputRef.current.buyPotion = kind;
            }}
            onClose={() => setHealerOpen(false)}
          />
        )}
      </Reveal>
      <Reveal open={dialogueNpc !== null && gameRef.current !== null}>
        {gameRef.current && dialogueNpc && (
          <DialoguePanel
            game={gameRef.current}
            npcId={dialogueNpc}
            onAccept={(q) => { uiInputRef.current.acceptQuest = q; }}
            onTurnIn={(q) => { uiInputRef.current.turnInQuest = q; }}
            onTrade={() => { setDialogueNpc(null); setShopOpen(true); }}
            onWares={() => { setDialogueNpc(null); setHealerOpen(true); }}
            onClose={() => setDialogueNpc(null)}
          />
        )}
      </Reveal>
      <Reveal open={lore !== null}>
        {lore && <LorePanel lore={lore.text} site={lore.site} onClose={() => setLore(null)} />}
      </Reveal>
      <Reveal open={questsOpen && gameRef.current !== null}>
        {gameRef.current && (
          <QuestLogPanel
            // Remount on focus change so a tracker click always lands on
            // the clicked quest, even if the journal is already open.
            key={questFocus ?? "log"}
            game={gameRef.current}
            focus={questFocus}
            onClose={() => setQuestsOpen(false)}
          />
        )}
      </Reveal>
      <Reveal open={waypointsOpen && gameRef.current !== null}>
        {gameRef.current && (
          <WaypointPanel
            game={gameRef.current}
            onTravel={(area) => {
              uiInputRef.current.waypointTo = area;
            }}
            onClose={() => setWaypointsOpen(false)}
          />
        )}
      </Reveal>
      <Reveal open={skillsOpen && gameRef.current !== null}>
        {gameRef.current && (
          <SkillPanel
            game={gameRef.current}
            hotbar={hotbar}
            onSpend={(skill) => {
              uiInputRef.current.spendSkill = skill;
            }}
            onAssign={(slot: number, skill: SkillId) => {
              const game = gameRef.current;
              if (!game) return;
              const bar = assignHotbar(localPlayer(game).klass, slot, skill);
              hotbarRef.current = bar;
              setHotbar(bar);
            }}
            onClose={() => setSkillsOpen(false)}
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
            onClose={() => setInvOpen(false)}
          />
        )}
      </Reveal>
      <Reveal open={menuOpen}>
        <SystemMenu
          onResume={() => setMenuOpen(false)}
          onLeave={() => {
            // beforeunload autosaves; the reload lands back in the lobby.
            window.location.reload();
          }}
        />
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
        assets={assets}
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
