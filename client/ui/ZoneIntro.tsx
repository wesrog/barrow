import { useEffect, useState } from "react";
import { display } from "./fonts";

export interface ZoneIntroMsg {
  /** Bumped every crossing so the same title can replay its animation. */
  seq: number;
  title: string;
  sub?: string;
}

/** The big "entering a new land" card: fades in over the world when the local
 * hero crosses into a zone, holds a beat, and drifts away. */
export function ZoneIntro({ intro }: { intro: ZoneIntroMsg | null }) {
  const [shown, setShown] = useState<ZoneIntroMsg | null>(null);
  useEffect(() => {
    if (!intro) return;
    setShown(intro);
    const timer = setTimeout(() => {
      setShown((cur) => (cur?.seq === intro.seq ? null : cur));
    }, 3200);
    return () => clearTimeout(timer);
  }, [intro]);
  if (!shown) return null;
  return (
    <div
      key={shown.seq}
      style={{
        position: "absolute",
        top: "22%",
        left: 0,
        right: 0,
        textAlign: "center",
        pointerEvents: "none",
        zIndex: 7,
        animation: "zone-intro 3.2s ease-out both",
      }}
    >
      <style>{`
        @keyframes zone-intro {
          0% { opacity: 0; transform: translateY(10px); }
          12% { opacity: 1; transform: translateY(0); }
          72% { opacity: 1; }
          100% { opacity: 0; transform: translateY(-8px); }
        }
      `}</style>
      <div
        style={{
          fontFamily: display,
          fontSize: 34,
          letterSpacing: 6,
          color: "#e8dfc8",
          textShadow: "0 2px 10px #000, 0 0 30px rgba(0,0,0,.8)",
        }}
      >
        {shown.title}
      </div>
      {shown.sub && (
        <div
          style={{
            marginTop: 6,
            fontFamily: "ui-monospace, monospace",
            fontSize: 12,
            letterSpacing: 3,
            color: "#9a917c",
            textShadow: "0 1px 4px #000",
          }}
        >
          {shown.sub}
        </div>
      )}
    </div>
  );
}
