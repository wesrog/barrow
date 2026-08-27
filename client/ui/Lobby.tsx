import { useEffect, useState, type CSSProperties } from "react";
import { hostDriver, joinDriver, localDriver, type NetDriver } from "../net/driver";
import { SIGNAL_URL } from "../net/config";
import { loadRaw } from "../save";

const mono = "ui-monospace, monospace";

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

/** Pre-game overlay: play solo, host a room, or join one by code. Replaces
 * the old auto-start — the game loop only spins up once this hands back a
 * driver. `?join=CODE` in the URL pre-fills the join field and fires the
 * join automatically on mount. */
export function Lobby({
  onReady,
}: {
  onReady: (driver: NetDriver, roomCode: string | null) => void;
}) {
  const [busy, setBusy] = useState<"solo" | "host" | "join" | null>(null);
  const [code, setCode] = useState(() => joinCodeFromUrl() ?? "");
  const [error, setError] = useState<string | null>(null);

  const startSolo = () => {
    setError(null);
    setBusy("solo");
    onReady(localDriver(Date.now() >>> 0, loadRaw() ?? undefined), null);
  };

  const startHost = async () => {
    setError(null);
    setBusy("host");
    try {
      const { driver, code: roomCode } = await hostDriver(
        Date.now() >>> 0,
        SIGNAL_URL,
        loadRaw() ?? undefined,
      );
      onReady(driver, roomCode);
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const startJoin = async (joinCode: string) => {
    const trimmed = joinCode.trim();
    if (!trimmed) return;
    setError(null);
    setBusy("join");
    try {
      const driver = await joinDriver(SIGNAL_URL, trimmed, loadRaw() ?? undefined);
      onReady(driver, null);
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // Auto-join once, on mount, if the URL carries a code.
  useEffect(() => {
    const initial = joinCodeFromUrl();
    if (initial) void startJoin(initial);
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
          minWidth: 280,
        }}
      >
        <div style={{ fontSize: 15, letterSpacing: 3, color: "#8f8778" }}>the barrow</div>

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
