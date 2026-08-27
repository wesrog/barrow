import { useEffect, useState } from "react";

const mono = "ui-monospace, monospace";

export interface ToastMsg {
  id: number;
  text: string;
}

function Toast({ toast, onDone }: { toast: ToastMsg; onDone: (id: number) => void }) {
  const [fading, setFading] = useState(false);
  useEffect(() => {
    const fadeTimer = setTimeout(() => setFading(true), 3400);
    const removeTimer = setTimeout(() => onDone(toast.id), 4000);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
    };
    // toast.id is the identity of this row; onDone is stable enough in practice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.id]);

  return (
    <div
      style={{
        padding: "6px 11px",
        background: "rgba(12,11,15,.9)",
        border: "1px solid #3a3442",
        borderRadius: 4,
        color: "#e8dcc0",
        fontFamily: mono,
        fontSize: 12,
        letterSpacing: 0.3,
        boxShadow: "0 4px 16px rgba(0,0,0,.5)",
        opacity: fading ? 0 : 1,
        transition: "opacity .6s ease-out",
      }}
    >
      {toast.text}
    </div>
  );
}

/** Bottom-right toast stack (event pings, 4s fade) plus a persistent desync
 * banner that never fades — a desync is fatal, not a passing notice. */
export function Toasts({
  toasts,
  onExpire,
  desync,
}: {
  toasts: ToastMsg[];
  onExpire: (id: number) => void;
  desync: boolean;
}) {
  if (toasts.length === 0 && !desync) return null;
  return (
    <div
      style={{
        position: "absolute",
        bottom: 170,
        right: 16,
        display: "flex",
        flexDirection: "column-reverse",
        alignItems: "flex-end",
        gap: 6,
        zIndex: 6,
        pointerEvents: "none",
      }}
    >
      {desync && (
        <div
          style={{
            padding: "8px 13px",
            background: "rgba(90,20,20,.94)",
            border: "1px solid #a32222",
            borderRadius: 4,
            color: "#f6e2e2",
            fontFamily: mono,
            fontSize: 13,
            fontWeight: 600,
            boxShadow: "0 4px 16px rgba(0,0,0,.6)",
          }}
        >
          desync detected — restart the game
        </div>
      )}
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onDone={onExpire} />
      ))}
    </div>
  );
}
