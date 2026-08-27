import { useEffect, useState, type CSSProperties } from "react";
import { hostDriver, joinDriver, localDriver, type NetDriver } from "../net/driver";
import { SIGNAL_URL } from "../net/config";
import {
  createCharacter,
  currentCharacterId,
  deleteCharacter,
  listCharacters,
  selectCharacter,
  type CharacterSummary,
} from "../roster";
import type { Klass } from "../../sim/skills";
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

const KLASS_BLURB: Record<Klass, string> = {
  warrior: "a bruiser — cleave, crush, warcry, leap",
  witch: "a caster — firebolt, frost nova, focus, blink",
};

/** Pre-game overlay, now in two acts: pick (or forge) a character, then play
 * solo, host a room, or join one by code. The chosen character's save rides the
 * join payload; autosaves land back in its roster slot. `?join=CODE` in the URL
 * still auto-joins — but only when a current character already exists; a
 * first-time visitor forges one first, with the code kept in the join field. */
export function Lobby({
  onReady,
}: {
  onReady: (driver: NetDriver, roomCode: string | null) => void;
}) {
  const [chars, setChars] = useState<CharacterSummary[]>(() => listCharacters());
  const [chosen, setChosen] = useState<CharacterSummary | null>(null);
  const [newName, setNewName] = useState(() => generateName());
  const [newKlass, setNewKlass] = useState<Klass>("warrior");
  const [busy, setBusy] = useState<"solo" | "host" | "join" | null>(null);
  const [code, setCode] = useState(() => joinCodeFromUrl() ?? "");
  const [error, setError] = useState<string | null>(null);

  /** The chosen character's save payload; selecting also marks its slot as the
   * autosave target. */
  const characterRaw = (of?: CharacterSummary): string | undefined => {
    const target = of ?? chosen;
    return target ? (selectCharacter(target.id) ?? undefined) : undefined;
  };

  const startSolo = () => {
    setError(null);
    setBusy("solo");
    onReady(localDriver(Date.now() >>> 0, characterRaw()), null);
  };

  const startHost = async () => {
    setError(null);
    setBusy("host");
    try {
      const { driver, code: roomCode } = await hostDriver(
        Date.now() >>> 0,
        SIGNAL_URL,
        characterRaw(),
      );
      onReady(driver, roomCode);
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const startJoin = async (joinCode: string, as?: CharacterSummary) => {
    const trimmed = joinCode.trim();
    if (!trimmed) return;
    setError(null);
    setBusy("join");
    try {
      const driver = await joinDriver(SIGNAL_URL, trimmed, characterRaw(as));
      onReady(driver, null);
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const forge = () => {
    const name = newName.trim();
    if (!name) return;
    const created = createCharacter(name, newKlass);
    setChars(listCharacters());
    setNewName(generateName());
    setChosen(created);
  };

  // Auto-join once, on mount, if the URL carries a code and a character already
  // exists — a first-time visitor still forges one before joining by hand.
  // Never from a prerendered page: Chrome speculatively loads (and runs!) URLs
  // typed in the omnibox, and a hidden prerender that joins seats a zombie
  // player. Join only once this copy of the page is the one the user is
  // looking at.
  useEffect(() => {
    const initial = joinCodeFromUrl();
    if (!initial) return;
    const current = listCharacters().find((c) => c.id === currentCharacterId());
    if (!current) return;
    const autoJoin = () => {
      setChosen(current);
      void startJoin(initial, current);
    };
    const doc = document as Document & { prerendering?: boolean };
    if (doc.prerendering) {
      doc.addEventListener("prerenderingchange", autoJoin, { once: true });
      return () => doc.removeEventListener("prerenderingchange", autoJoin);
    }
    autoJoin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: mono,
        color: "#c9bfa8",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 18,
          padding: "32px 40px",
          border: "1px solid #3a3442",
          borderRadius: 6,
          background: "rgba(12,11,15,.85)",
          minWidth: 300,
          maxWidth: 380,
        }}
      >
        <div
          style={{
            fontFamily: display,
            fontSize: 28,
            letterSpacing: 3,
            color: "#c9bfa8",
            textShadow: "0 1px 4px #000",
          }}
        >
          The Barrow
        </div>

        {!chosen ? (
          <>
            {chars.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
                <div style={{ color: "#8f8778", fontSize: 11, letterSpacing: 1 }}>
                  your characters
                </div>
                {chars.map((c) => (
                  <div key={c.id} style={{ display: "flex", gap: 6 }}>
                    <button
                      style={{ ...buttonStyle, flex: 1, textAlign: "left", padding: "8px 12px" }}
                      onClick={() => setChosen(c)}
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
                      onClick={() => {
                        if (!window.confirm(`Bury ${c.name} forever?`)) return;
                        deleteCharacter(c.id);
                        setChars(listCharacters());
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
              <div style={{ color: "#8f8778", fontSize: 11, letterSpacing: 1 }}>new character</div>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  style={{
                    ...inputStyle,
                    flex: 1,
                    boxSizing: "border-box",
                    textTransform: "none",
                  }}
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
                <button
                  style={{ ...buttonStyle, padding: "8px 12px" }}
                  title="roll a new name"
                  onClick={() => setNewName(generateName())}
                >
                  ↻
                </button>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {(["warrior", "witch"] as Klass[]).map((k) => (
                  <button
                    key={k}
                    style={{
                      ...buttonStyle,
                      flex: 1,
                      borderColor: newKlass === k ? "#8f7a4c" : "#3a3442",
                      color: newKlass === k ? "#e8dcc0" : "#8f8778",
                    }}
                    onClick={() => setNewKlass(k)}
                  >
                    {k}
                  </button>
                ))}
              </div>
              <div style={{ color: "#6b6455", fontSize: 11 }}>{KLASS_BLURB[newKlass]}</div>
              <button
                style={{ ...buttonStyle, opacity: newName.trim() ? 1 : 0.5 }}
                disabled={!newName.trim()}
                onClick={forge}
              >
                forge
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 12, color: "#8f8778", letterSpacing: 1 }}>
              {chosen.name} · {chosen.klass} · lvl {chosen.level}{" "}
              <button
                style={{
                  border: "none",
                  background: "none",
                  color: "#7fb8c9",
                  fontFamily: mono,
                  fontSize: 11,
                  cursor: "pointer",
                }}
                disabled={busy !== null}
                onClick={() => setChosen(null)}
              >
                (change)
              </button>
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
                style={inputStyle}
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
              maxWidth: 260,
            }}
          >
            <div>{error}</div>
            <button
              style={{ ...buttonStyle, fontSize: 11, padding: "6px 12px" }}
              onClick={() => setError(null)}
            >
              dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
