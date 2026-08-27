import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";

// Title bar shared by the HUD's modal panels: title on the left, an X on the
// right. Negative margins let it bleed to the panel's edges — panels using it
// must keep panelStyle's 12px padding.
const barStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  margin: "-12px -12px 10px",
  padding: "7px 10px 7px 12px",
  borderBottom: "1px solid #2c2833",
  borderRadius: "3px 3px 0 0",
  background: "rgba(34, 30, 42, 0.65)",
  letterSpacing: 1,
};

export function PanelChrome({
  title,
  color = "#8f8778",
  onClose,
}: {
  title: ReactNode;
  color?: string;
  onClose: () => void;
}) {
  const [hot, setHot] = useState(false);
  return (
    <div style={barStyle}>
      <span style={{ color, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {title}
      </span>
      <span
        onClick={onClose}
        onMouseEnter={() => setHot(true)}
        onMouseLeave={() => setHot(false)}
        title="close (esc)"
        style={{
          cursor: "pointer",
          color: hot ? "#e8dcc0" : "#6b6455",
          border: `1px solid ${hot ? "#5a5468" : "#3a3442"}`,
          borderRadius: 3,
          background: hot ? "rgba(48,42,60,.6)" : "transparent",
          width: 18,
          height: 18,
          lineHeight: "16px",
          textAlign: "center",
          flex: "none",
          userSelect: "none",
        }}
      >
        ×
      </span>
    </div>
  );
}
