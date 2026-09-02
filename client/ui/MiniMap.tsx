import { localPlayer } from "../local";
import { useEffect, useRef } from "react";
import { isWalkable } from "../../sim/map";
import { allPlayers, zoneOf, type GameState } from "../../sim/state";
import { areaAt } from "../../sim/surface";
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
  const WINDOW_W = 280;
  const WINDOW_H = 160;
  const windowed = canvasW > WINDOW_W || canvasH > WINDOW_H;

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
      const me = localPlayer(game);
      const vx = windowed ? projX(me.pos.x, me.pos.y) - WINDOW_W / 2 : 0;
      const vy = windowed ? projY(me.pos.x, me.pos.y) - WINDOW_H / 2 : 0;
      const sx = (x: number, y: number) => projX(x, y) - vx;
      const sy = (x: number, y: number) => projY(x, y) - vy;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(base, -vx, -vy);
      for (const marker of zoneOf(game, localPlayer(game)).map.markers) {
        const px = sx(marker.x, marker.y);
        const py = sy(marker.x, marker.y);
        if (px < -4 || px > WINDOW_W + 4 || py < -4 || py > WINDOW_H + 4) continue;
        if (marker.ch === ">") {
          ctx.fillStyle = "#7fb8c9";
          ctx.fillRect(px - 2, py - 2, 4, 4);
        } else if (marker.ch === "<") {
          ctx.fillStyle = "#f5c877";
          ctx.fillRect(px - 2, py - 2, 4, 4);
        } else if (marker.ch === "W") {
          // Undiscovered pads stay off the map — finding them is the point.
          const me2 = localPlayer(game);
          if (
            me2.zoneId === "surface" &&
            !me2.waypoints.includes(areaAt({ x: marker.x, y: marker.y }))
          ) {
            continue;
          }
          ctx.fillStyle = "#c9a84c";
          ctx.fillRect(px - 2, py - 2, 4, 4);
        }
      }
      for (const npc of zoneOf(game, localPlayer(game)).npcs.values()) {
        const px = sx(npc.pos.x, npc.pos.y);
        const py = sy(npc.pos.x, npc.pos.y);
        if (px < -4 || px > WINDOW_W + 4 || py < -4 || py > WINDOW_H + 4) continue;
        ctx.fillStyle = "#f0c96a";
        ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
      }
      for (const gi of zoneOf(game, localPlayer(game)).groundItems.values()) {
        const px = sx(gi.pos.x, gi.pos.y);
        const py = sy(gi.pos.x, gi.pos.y);
        if (px < -4 || px > WINDOW_W + 4 || py < -4 || py > WINDOW_H + 4) continue;
        ctx.fillStyle = RARITY_CSS[gi.item.rarity] ?? "#d6d6d6";
        ctx.fillRect(px - 1, py - 1, 2, 2);
      }
      for (const m of zoneOf(game, localPlayer(game)).monsters.values()) {
        const px = sx(m.pos.x, m.pos.y);
        const py = sy(m.pos.x, m.pos.y);
        if (px < -4 || px > WINDOW_W + 4 || py < -4 || py > WINDOW_H + 4) continue;
        const boss = m.typeId === "barrow_lord";
        ctx.fillStyle = boss ? "#c9a84c" : "#a03030";
        const r = boss ? 3 : 2;
        ctx.fillRect(px - r / 2, py - r / 2, r, r);
      }
      // Party members sharing this zone, each in their seat colour…
      for (const p of allPlayers(game)) {
        if (p.id === me.id || p.zoneId !== me.zoneId) continue;
        const px = sx(p.pos.x, p.pos.y);
        const py = sy(p.pos.x, p.pos.y);
        if (px < -4 || px > WINDOW_W + 4 || py < -4 || py > WINDOW_H + 4) continue;
        ctx.fillStyle = playerCss(p.id);
        ctx.beginPath();
        ctx.arc(px, py, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      // …and us, always the bright one.
      const px = sx(me.pos.x, me.pos.y);
      const py = sy(me.pos.x, me.pos.y);
      ctx.fillStyle = "#f0e9dc";
      ctx.beginPath();
      ctx.arc(px, py, 2.2, 0, Math.PI * 2);
      ctx.fill();
    };
    draw();
    const timer = setInterval(draw, 150);
    return () => clearInterval(timer);
  }, [game, localPlayer(game).zoneId]);

  return (
    <canvas
      ref={canvasRef}
      width={windowed ? WINDOW_W : canvasW}
      height={windowed ? WINDOW_H : canvasH}
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
