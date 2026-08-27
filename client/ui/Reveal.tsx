import { useEffect, useState } from "react";
import type { ReactNode } from "react";

const DURATION_MS = 150;
const HIDDEN = "translateY(8px) scale(0.985)";

// The entry animation is a keyframe so it plays on mount with no follow-up
// state flip; the exit is a transition from the committed visible style.
const KEYFRAMES = `@keyframes barrow-panel-in { from { opacity: 0; transform: ${HIDDEN}; } }`;
if (!document.getElementById("barrow-panel-kf")) {
  const el = document.createElement("style");
  el.id = "barrow-panel-kf";
  el.textContent = KEYFRAMES;
  document.head.appendChild(el);
}

// Fades/slides a HUD panel in and out. Children stay mounted while the exit
// animation plays. The wrapper covers the screen but is pointer-transparent —
// panel roots opt back in with pointerEvents: "auto".
export function Reveal({ open, children }: { open: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const t = setTimeout(() => setMounted(false), DURATION_MS);
    return () => clearTimeout(t);
  }, [open]);

  if (!mounted && !open) return null;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        opacity: open ? 1 : 0,
        transform: open ? "none" : HIDDEN,
        animation: open ? `barrow-panel-in ${DURATION_MS}ms ease` : undefined,
        transition: open ? undefined : `opacity ${DURATION_MS}ms ease, transform ${DURATION_MS}ms ease`,
      }}
    >
      {children}
    </div>
  );
}
