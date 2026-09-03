import type { CSSProperties } from "react";
import { useState } from "react";
import { isAmbienceMuted, isMuted, setAmbienceMuted, setMuted } from "../audio";
import { MUSIC_VARIANTS, getMusicVariant, setMusicVariant } from "../music";
import { PanelChrome } from "./PanelChrome";

const panelStyle: CSSProperties = {
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: 240,
  background: "rgba(12, 11, 15, 0.95)",
  border: "1px solid #3a3442",
  borderRadius: 4,
  padding: 12,
  fontFamily: "ui-monospace, monospace",
  fontSize: 12,
  color: "#c9c2b8",
  zIndex: 8,
  pointerEvents: "auto",
  boxShadow: "0 8px 30px rgba(0,0,0,.7)",
};

function MenuRow({ label, color = "#e8dcc0", onClick }: { label: string; color?: string; onClick: () => void }) {
  const [hot, setHot] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      style={{
        padding: "8px 10px",
        marginBottom: 6,
        border: `1px solid ${hot ? "#5a5468" : "#3a3442"}`,
        borderRadius: 3,
        background: hot ? "rgba(48,42,60,.6)" : "rgba(20,18,24,.6)",
        color: hot ? color : "#c9c2b8",
        textAlign: "center",
        letterSpacing: 1,
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      {label}
    </div>
  );
}

/** The escape menu: resume, mute, or head back to the lobby. */
export function SystemMenu({ onResume, onLeave }: { onResume: () => void; onLeave: () => void }) {
  const [muted, setMutedState] = useState(isMuted);
  const [musicMuted, setMusicMutedState] = useState(isAmbienceMuted);
  const [musicVariant, setMusicVariantState] = useState(getMusicVariant);
  return (
    <div style={panelStyle}>
      <PanelChrome title="system" onClose={onResume} />
      <MenuRow label="resume" onClick={onResume} />
      <MenuRow
        label={muted ? "sound: off" : "sound: on"}
        onClick={() => {
          setMuted(!muted);
          setMutedState(!muted);
        }}
      />
      <MenuRow
        label={musicMuted ? "music: off" : "music: on"}
        onClick={() => {
          setAmbienceMuted(!musicMuted);
          setMusicMutedState(!musicMuted);
        }}
      />
      {!musicMuted && (
        <MenuRow
          label={`style: ${MUSIC_VARIANTS.find((v) => v.id === musicVariant)?.label}`}
          onClick={() => {
            const i = MUSIC_VARIANTS.findIndex((v) => v.id === musicVariant);
            const next = MUSIC_VARIANTS[(i + 1) % MUSIC_VARIANTS.length]!.id;
            setMusicVariant(next);
            setMusicVariantState(next);
          }}
        />
      )}
      <MenuRow label="leave game" color="#e07070" onClick={onLeave} />
    </div>
  );
}
