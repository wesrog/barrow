import type { CSSProperties } from "react";
import { PanelChrome } from "./PanelChrome";

const panelStyle: CSSProperties = {
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: 400,
  background: "rgba(12, 11, 15, 0.95)",
  border: "1px solid #3a3442",
  borderRadius: 4,
  padding: 12,
  fontFamily: "ui-monospace, monospace",
  fontSize: 12,
  color: "#c9c2b8",
  zIndex: 6,
  pointerEvents: "auto",
  boxShadow: "0 8px 30px rgba(0,0,0,.7)",
};

export interface LoreText {
  title: string;
  lines: string[];
}

/** A landmark's found lore, read off its weathered stone. */
export function LorePanel({ lore, site, onClose }: { lore: LoreText; site: string; onClose: () => void }) {
  return (
    <div style={panelStyle}>
      <PanelChrome title={site} color="#7fd4c4" onClose={onClose} />
      <div style={{ color: "#8f8778", marginBottom: 6, fontStyle: "italic" }}>{lore.title}</div>
      {lore.lines.map((line, i) => (
        <div key={i} style={{ marginBottom: 5 }}>
          {line}
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
        <span
          style={{
            padding: "6px 12px",
            border: "1px solid #6b6455",
            borderRadius: 3,
            color: "#6b6455",
            cursor: "pointer",
            background: "rgba(38,34,46,.5)",
          }}
          onClick={onClose}
        >
          Leave
        </span>
      </div>
    </div>
  );
}
