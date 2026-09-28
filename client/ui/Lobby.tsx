import { useEffect, useRef, useState, type CSSProperties } from "react";
import { hostDriver, joinDriver, localDriver, type NetDriver } from "../net/driver";
import { createLobbyScene, type LobbySceneHandle } from "../render/lobbyScene";
import type { GameAssets } from "../render/models";
import { SIGNAL_URL } from "../net/config";
import {
  createCharacter,
  currentCharacterId,
  deleteCharacter,
  listCharacters,
  selectCharacter,
  worldSeedOf,
  type CharacterSummary,
} from "../roster";
import { CLASS_STATS } from "../../sim/character";
import { TREES, type Klass } from "../../sim/skills";
import { generateName } from "../names";

import { display, mono } from "./fonts";

function joinCodeFromUrl(): string | null {
  try {
    return new URLSearchParams(window.location.search).get("join");
  } catch {
    return null;
  }
}

const buttonStyle: CSSProperties = {
  padding: "10px 18px",
  border: "1px solid #3a3442",
  borderRadius: 4,
  background: "rgba(20,18,24,.9)",
  color: "#e8dcc0",
  fontFamily: mono,
  fontSize: 13,
  letterSpacing: 1,
  cursor: "pointer",
};

const inputStyle: CSSProperties = {
  padding: "9px 10px",
  border: "1px solid #3a3442",
  borderRadius: 4,
  background: "#141218",
  color: "#e8dcc0",
  fontFamily: mono,
  fontSize: 13,
  letterSpacing: 2,
  width: 130,
  textTransform: "uppercase",
};

const panelStyle: CSSProperties = {
  border: "1px solid #3a3442",
  borderRadius: 6,
  background: "rgba(10,9,13,.9)",
  boxShadow: "0 8px 40px rgba(0,0,0,.6)",
};

/** What the class panel says about each hero at the fire. */
const KLASS_INFO: Record<Klass, { title: string; line: string; lore: string; color: string }> = {
  warrior: {
    title: "Warrior",
    line: "a bruiser — arms, warcries, and fury",
    lore:
      "Steel and stubbornness. The warrior closes the gap, takes the hit, and answers with the blade: arms for damage, warcries for the pack, fury to reach anything that runs.",
    color: "#d9a441",
  },
  witch: {
    title: "Witch",
    line: "a caster — fire, frost, and hexes",
    lore:
      "Fire, frost, and old words. The witch keeps her distance and ends fights before they arrive: flame that burns through packs, cold that holds them still, hexes that soften whatever her spells don't finish.",
    color: "#a47cf0",
  },
};

/** Pre-game overlay: a night camp with one hero of each class at the fire.
 * Click a hero (or a roster entry) to focus that class: the figure performs
 * and the panel below tells you what the class is and lets you forge a new
 * one. The card on the right holds the roster and, once a character is
 * chosen, the ways in: solo, host a room, or join one by code. The chosen
 * character's save rides the join payload; autosaves land back in its roster
 * slot. `?join=CODE` in the URL still auto-joins, but only when a current
 * character already exists; a first-time visitor forges one first, with the
 * code kept in the join field. */
export function Lobby({
  assets,
  onReady,
}: {
  assets: GameAssets | null;
  onReady: (driver: NetDriver, roomCode: string | null) => void;
}) {
  const [chars, setChars] = useState<CharacterSummary[]>(() => listCharacters());
  // The last-played hero (the roster's autosave slot) greets you already chosen.
  const [chosen, setChosen] = useState<CharacterSummary | null>(
    () => listCharacters().find((c) => c.id === currentCharacterId()) ?? null,
  );
  // The class in focus: the figure with the lit ring, the one the panel describes.
  const [focus, setFocus] = useState<Klass | null>(() => {
    const current = listCharacters().find((c) => c.id === currentCharacterId());
    return current ? current.klass : null;
  });
  const [hovered, setHovered] = useState<Klass | null>(null);
  const [newName, setNewName] = useState(() => generateName());
  const [busy, setBusy] = useState<"solo" | "host" | "join" | null>(null);
  const [code, setCode] = useState(() => joinCodeFromUrl() ?? "");
  const [error, setError] = useState<string | null>(null);
  const dioramaRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<LobbySceneHandle | null>(null);
  const [dioramaReady, setDioramaReady] = useState(false);

  // The camp diorama behind the menu, mounted once assets arrive. Its hooks
  // only call state setters, which are stable, so it never needs remounting.
  useEffect(() => {
    if (!assets || !dioramaRef.current) return;
    const handle = createLobbyScene(dioramaRef.current, assets, {
      onPick: (klass) => setFocus(klass),
      onHover: setHovered,
    });
    sceneRef.current = handle;
    const t = requestAnimationFrame(() => setDioramaReady(true));
    return () => {
      cancelAnimationFrame(t);
      setDioramaReady(false);
      sceneRef.current = null;
      handle.dispose();
    };
  }, [assets]);
  useEffect(() => {
    sceneRef.current?.select(focus);
  }, [focus, dioramaReady]);

  /** Focus a class from the card: the figure performs as if clicked. */
  const focusKlass = (klass: Klass) => {
    setFocus(klass);
    sceneRef.current?.cheer(klass);
  };

  /** The chosen character's save payload; selecting also marks its slot as the
   * autosave target. */
  const characterRaw = (of?: CharacterSummary): string | undefined => {
    const target = of ?? chosen;
    return target ? (selectCharacter(target.id) ?? undefined) : undefined;
  };

  /** The chosen hero's saved world, so a reload comes back to the same moors. */
  const worldSeed = (): number => (chosen ? worldSeedOf(chosen.id) : null) ?? (Date.now() >>> 0);

  const startSolo = () => {
    setError(null);
    setBusy("solo");
    onReady(localDriver(worldSeed(), characterRaw()), null);
  };

  const startHost = async () => {
    setError(null);
    setBusy("host");
    try {
      const { driver, code: roomCode } = await hostDriver(
        worldSeed(),
        SIGNAL_URL,
        characterRaw(),
      );
      onReady(driver, roomCode);
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const startJoin = async (joinCode: string, as?: CharacterSummary, cancelled?: () => boolean) => {
    const trimmed = joinCode.trim();
    if (!trimmed) return;
    setError(null);
    setBusy("join");
    try {
      const driver = await joinDriver(SIGNAL_URL, trimmed, characterRaw(as), cancelled);
      if (!driver) return; // cancelled — a fresher attempt owns the lobby now
      onReady(driver, null);
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const forge = () => {
    const name = newName.trim();
    if (!name || !focus) return;
    const created = createCharacter(name, focus);
    setChars(listCharacters());
    setNewName(generateName());
    setChosen(created);
    sceneRef.current?.cheer(focus);
  };

  // Auto-join once, on mount, if the URL carries a code and a character already
  // exists — a first-time visitor still forges one before joining by hand.
  // Never from a prerendered page: Chrome speculatively loads (and runs!) URLs
  // typed in the omnibox, and a hidden prerender that joins seats a zombie
  // player. Join only once this copy of the page is the one the user is
  // looking at. The cleanup cancels the attempt because StrictMode runs every
  // effect twice (mount, cleanup, mount): without it the doomed first run
  // joins too, seating a second copy of the character that nothing drives.
  useEffect(() => {
    const initial = joinCodeFromUrl();
    if (!initial) return;
    const current = listCharacters().find((c) => c.id === currentCharacterId());
    if (!current) return;
    let cancelled = false;
    const autoJoin = () => {
      setChosen(current);
      void startJoin(initial, current, () => cancelled);
    };
    const doc = document as Document & { prerendering?: boolean };
    if (doc.prerendering) {
      doc.addEventListener("prerenderingchange", autoJoin, { once: true });
      return () => {
        cancelled = true;
        doc.removeEventListener("prerenderingchange", autoJoin);
      };
    }
    autoJoin();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const info = focus ? KLASS_INFO[focus] : null;
  const stats = focus ? CLASS_STATS[focus] : null;
  const trees = focus ? Object.values(TREES).filter((t) => t.klass === focus) : [];

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        fontFamily: mono,
        color: "#c9bfa8",
        overflow: "hidden",
      }}
    >
      <div
        ref={dioramaRef}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 0,
          opacity: dioramaReady ? 1 : 0,
          transition: "opacity 1.2s ease",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 0,
          pointerEvents: "none",
          background: "radial-gradient(ellipse at 40% 45%, transparent 45%, rgba(7,9,12,.75) 100%)",
        }}
      />

      {/* Title */}
      <div
        style={{
          position: "absolute",
          top: 28,
          left: 0,
          right: 0,
          zIndex: 1,
          textAlign: "center",
          pointerEvents: "none",
          fontFamily: display,
          fontSize: 40,
          letterSpacing: 6,
          color: "#d8cdb2",
          textShadow: "0 2px 10px #000, 0 0 30px rgba(0,0,0,.8)",
        }}
      >
        The Barrow
        <div style={{ fontFamily: mono, fontSize: 11, letterSpacing: 3, color: "#8f8778", marginTop: 6 }}>
          {hovered && hovered !== focus ? `the ${KLASS_INFO[hovered].title.toLowerCase()}` : focus ? " " : "pick a hero at the fire"}
        </div>
      </div>

      {/* The class panel: who the focused hero is and the forge for a new one */}
      {info && stats && focus && (
        <div
          style={{
            ...panelStyle,
            position: "absolute",
            zIndex: 1,
            left: "50%",
            bottom: 26,
            transform: "translateX(-62%)",
            width: 520,
            maxWidth: "calc(100vw - 380px)",
            padding: "18px 22px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <div style={{ fontFamily: display, fontSize: 24, letterSpacing: 2, color: info.color }}>{info.title}</div>
            <div style={{ fontSize: 11, color: "#8f8778", letterSpacing: 1 }}>{info.line}</div>
            <div style={{ marginLeft: "auto", fontSize: 11, color: "#8f8778" }}>
              <span style={{ color: "#d05c5c" }}>{stats.maxLife}</span> life ·{" "}
              <span style={{ color: "#6b8fe8" }}>{stats.maxMana}</span> mana
            </div>
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.5, color: "#b5ab95" }}>{info.lore}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {trees.map((t) => (
              <div key={t.id} style={{ fontSize: 11, lineHeight: 1.45 }}>
                <div style={{ color: "#e8dcc0", letterSpacing: 1 }}>{t.name}</div>
                <div style={{ color: "#7d766a" }}>{t.blurb}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <input
              style={{ ...inputStyle, flex: 1, boxSizing: "border-box", textTransform: "none" }}
              placeholder="name"
              maxLength={16}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") forge();
              }}
            />
            <button style={{ ...buttonStyle, padding: "8px 12px" }} title="roll a new name" onClick={() => setNewName(generateName())}>
              ↻
            </button>
            <button
              style={{ ...buttonStyle, opacity: newName.trim() ? 1 : 0.5, borderColor: "#8f7a4c" }}
              disabled={!newName.trim()}
              onClick={forge}
            >
              forge a {info.title.toLowerCase()}
            </button>
          </div>
        </div>
      )}

      {/* The roster card: your characters and the ways in */}
      <div
        style={{
          ...panelStyle,
          position: "absolute",
          zIndex: 1,
          right: 32,
          top: "50%",
          transform: "translateY(-50%)",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          padding: "24px 26px",
          width: 290,
          boxSizing: "border-box",
        }}
      >
        {chars.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ color: "#8f8778", fontSize: 11, letterSpacing: 1 }}>your characters</div>
            {chars.map((c) => {
              const active = chosen?.id === c.id;
              return (
                <div key={c.id} style={{ display: "flex", gap: 6 }}>
                  <button
                    style={{
                      ...buttonStyle,
                      flex: 1,
                      textAlign: "left",
                      padding: "8px 12px",
                      borderColor: active ? KLASS_INFO[c.klass].color : "#3a3442",
                      color: active ? "#e8dcc0" : "#c9bfa8",
                    }}
                    disabled={busy !== null}
                    onClick={() => {
                      setChosen(c);
                      focusKlass(c.klass);
                    }}
                  >
                    {c.name}
                    <span style={{ color: "#8f8778" }}>
                      {" "}
                      · {c.klass} · lvl {c.level}
                    </span>
                  </button>
                  <button
                    style={{ ...buttonStyle, padding: "8px 10px", color: "#a06060" }}
                    title="bury this character forever"
                    disabled={busy !== null}
                    onClick={() => {
                      if (!window.confirm(`Bury ${c.name} forever?`)) return;
                      deleteCharacter(c.id);
                      setChars(listCharacters());
                      if (chosen?.id === c.id) setChosen(null);
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ color: "#8f8778", fontSize: 11, lineHeight: 1.6, letterSpacing: 1 }}>
            no one has come to the fire yet. click a hero to learn the class, name one, and forge it.
          </div>
        )}

        {chosen && (
          <>
            <div style={{ fontSize: 12, color: "#8f8778", letterSpacing: 1, borderTop: "1px solid #2a2530", paddingTop: 12 }}>
              {chosen.name} · {chosen.klass} · lvl {chosen.level}
            </div>

            <button
              style={{ ...buttonStyle, width: "100%", opacity: busy && busy !== "solo" ? 0.5 : 1 }}
              disabled={busy !== null}
              onClick={startSolo}
            >
              {busy === "solo" ? "descending…" : "play solo"}
            </button>

            <button
              style={{ ...buttonStyle, width: "100%", opacity: busy && busy !== "host" ? 0.5 : 1 }}
              disabled={busy !== null}
              onClick={() => void startHost()}
            >
              {busy === "host" ? "opening room…" : "host game"}
            </button>

            <div style={{ display: "flex", gap: 8 }}>
              <input
                style={{ ...inputStyle, flex: 1, boxSizing: "border-box", width: "auto" }}
                placeholder="CODE"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                value={code}
                disabled={busy !== null}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void startJoin(code);
                }}
              />
              <button
                style={{ ...buttonStyle, opacity: busy && busy !== "join" ? 0.5 : 1 }}
                disabled={busy !== null}
                onClick={() => void startJoin(code)}
              >
                {busy === "join" ? "joining…" : "join"}
              </button>
            </div>
          </>
        )}

        {error && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              color: "#e08a8a",
              fontSize: 12,
              textAlign: "center",
            }}
          >
            <div>{error}</div>
            <button style={{ ...buttonStyle, fontSize: 11, padding: "6px 12px" }} onClick={() => setError(null)}>
              dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
