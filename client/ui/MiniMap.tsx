import { localPlayer } from "../local";
import { useEffect, useRef } from "react";
import { isWalkable } from "../../sim/map";
import { allPlayers, zoneOf, type GameState } from "../../sim/state";
import { playerCss } from "../render/tints";
import { RARITY_CSS } from "./InventoryPanel";

const SCALE = 4;

export function MiniMap({ game }: { game: GameState }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wallsRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const map = zoneOf(game, localPlayer(game)).map;
    // Render the static walls once
    const walls = document.createElement("canvas");
    walls.width = map.width * SCALE;
    walls.height = map.height * SCALE;
    const wctx = walls.getContext("2d")!;
    wctx.fillStyle = "rgba(10,9,12,.9)";
    wctx.fillRect(0, 0, walls.width, walls.height);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (!isWalkable(map, x, y)) {
          wctx.fillStyle = "#3a3442";
          wctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
        }
      }
    }
    wallsRef.current = walls;

    const draw = () => {
      const canvas = canvasRef.current;
      const base = wallsRef.current;
      if (!canvas || !base) return;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(base, 0, 0);
      for (const marker of zoneOf(game, localPlayer(game)).map.markers) {
        if (marker.ch === ">") {
          ctx.fillStyle = "#7fb8c9";
          ctx.fillRect(marker.x * SCALE - 2, marker.y * SCALE - 2, 4, 4);
        }
      }
      for (const gi of zoneOf(game, localPlayer(game)).groundItems.values()) {
        ctx.fillStyle = RARITY_CSS[gi.item.rarity] ?? "#d6d6d6";
        ctx.fillRect(gi.pos.x * SCALE - 1, gi.pos.y * SCALE - 1, 2, 2);
      }
      for (const m of zoneOf(game, localPlayer(game)).monsters.values()) {
        const boss = m.typeId === "barrow_lord";
        ctx.fillStyle = boss ? "#c9a84c" : "#a03030";
        const r = boss ? 3 : 2;
        ctx.fillRect(m.pos.x * SCALE - r / 2, m.pos.y * SCALE - r / 2, r, r);
      }
      // Party members sharing this zone, each in their seat colour…
      const me = localPlayer(game);
      for (const p of allPlayers(game)) {
        if (p.id === me.id || p.zoneId !== me.zoneId) continue;
        ctx.fillStyle = playerCss(p.id);
        ctx.beginPath();
        ctx.arc(p.pos.x * SCALE, p.pos.y * SCALE, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      // …and us, always the bright one.
      ctx.fillStyle = "#f0e9dc";
      ctx.beginPath();
      ctx.arc(me.pos.x * SCALE, me.pos.y * SCALE, 2.2, 0, Math.PI * 2);
      ctx.fill();
    };
    draw();
    const timer = setInterval(draw, 150);
    return () => clearInterval(timer);
  }, [game, localPlayer(game).zoneId]);

  return (
    <canvas
      ref={canvasRef}
      width={zoneOf(game, localPlayer(game)).map.width * SCALE}
      height={zoneOf(game, localPlayer(game)).map.height * SCALE}
      style={{
        position: "absolute",
        top: 12,
        left: 12,
        border: "1px solid #2c2833",
        borderRadius: 3,
        zIndex: 3,
        pointerEvents: "none",
        opacity: 0.88,
      }}
    />
  );
}
