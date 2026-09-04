import { useState } from "react";

/** Small "sort" control that sits over an item grid and tidies it on click. */
export function SortButton({ onSort, hint }: { onSort: () => void; hint: string }) {
  const [hot, setHot] = useState(false);
  return (
    <span
      onClick={onSort}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      title={hint}
      style={{
        cursor: "pointer",
        color: hot ? "#e8dcc0" : "#8f8778",
        border: `1px solid ${hot ? "#5a5468" : "#3a3442"}`,
        borderRadius: 3,
        background: hot ? "rgba(48,42,60,.6)" : "transparent",
        padding: "1px 7px",
        lineHeight: "14px",
        fontSize: 11,
        letterSpacing: 1,
        userSelect: "none",
        flex: "none",
      }}
    >
      sort
    </span>
  );
}
