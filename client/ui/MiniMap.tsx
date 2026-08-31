import { localPlayer } from "../local";
import { useEffect, useRef } from "react";
import { isWalkable } from "../../sim/map";
import { allPlayers, zoneOf, type GameState } from "../../sim/state";
import { playerCss } from "../render/tints";
import { RARITY_CSS } from "./InventoryPanel";

export function MiniMap({ game }: { game: GameState }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wallsRef = useRef<HTMLCanvasElement | null>(null);
  // Big open-world maps draw at half scale so the minimap stays a corner widget.
  const SCALE = zoneOf(game, localPlayer(game)).map.width > 40 ? 2 : 4;
  // Match the game camera: the world is viewed from (+x,+z), so sim +x runs
  // down-right on screen and sim +y runs down-left — a 2:1 diamond projection.
  const ISO_X = SCALE;
  const ISO_Y = SCALE / 2;
  const map = zoneOf(game, localPlayer(game)).map;
  const canvasW = (map.width + map.height) * ISO_X;
  const canvasH = (map.width + map.height) * ISO_Y;
  const offX = map.height * ISO_X;
  const projX = (x: number, y: number) => (x - y) * ISO_X + offX;
  const projY = (x: number, y: number) => (x + y) * ISO_Y;

  useEffect(() => {
    const map = zoneOf(game, localPlayer(game)).map;
    // Render the static walls once
    const walls = document.createElement("canvas");
    walls.width = canvasW;
    walls.height = canvasH;
    const wctx = walls.getContext("2d")!;
    // Tile-space transform: unit rects come out as the projected diamonds.
    wctx.setTransform(ISO_X, ISO_Y, -ISO_X, ISO_Y, offX, 0);
    wctx.fillStyle = "rgba(10,9,12,.9)";
    wctx.fillRect(0, 0, map.width, map.height);
    wctx.fillStyle = "#3a3442";
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (!isWalkable(map, x, y)) {
          wctx.fillRect(x, y, 1, 1);
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
          ctx.fillRect(projX(marker.x, marker.y) - 2, projY(marker.x, marker.y) - 2, 4, 4);
        } else if (marker.ch === "W") {
          ctx.fillStyle = "#c9a84c";
          ctx.fillRect(projX(marker.x, marker.y) - 2, projY(marker.x, marker.y) - 2, 4, 4);
        }
      }
      for (const gi of zoneOf(game, localPlayer(game)).groundItems.values()) {
        ctx.fillStyle = RARITY_CSS[gi.item.rarity] ?? "#d6d6d6";
        ctx.fillRect(projX(gi.pos.x, gi.pos.y) - 1, projY(gi.pos.x, gi.pos.y) - 1, 2, 2);
      }
      for (const m of zoneOf(game, localPlayer(game)).monsters.values()) {
        const boss = m.typeId === "barrow_lord";
        ctx.fillStyle = boss ? "#c9a84c" : "#a03030";
        const r = boss ? 3 : 2;
        ctx.fillRect(projX(m.pos.x, m.pos.y) - r / 2, projY(m.pos.x, m.pos.y) - r / 2, r, r);
      }
      // Party members sharing this zone, each in their seat colour…
      const me = localPlayer(game);
      for (const p of allPlayers(game)) {
        if (p.id === me.id || p.zoneId !== me.zoneId) continue;
        ctx.fillStyle = playerCss(p.id);
        ctx.beginPath();
        ctx.arc(projX(p.pos.x, p.pos.y), projY(p.pos.x, p.pos.y), 2, 0, Math.PI * 2);
        ctx.fill();
      }
      // …and us, always the bright one.
      ctx.fillStyle = "#f0e9dc";
      ctx.beginPath();
      ctx.arc(projX(me.pos.x, me.pos.y), projY(me.pos.x, me.pos.y), 2.2, 0, Math.PI * 2);
      ctx.fill();
    };
    draw();
    const timer = setInterval(draw, 150);
    return () => clearInterval(timer);
  }, [game, localPlayer(game).zoneId]);

  return (
    <canvas
      ref={canvasRef}
      width={canvasW}
      height={canvasH}
      style={{
        position: "absolute",
        top: 12,
        left: 12,
        zIndex: 3,
        pointerEvents: "none",
        opacity: 0.88,
      }}
    />
  );
}
