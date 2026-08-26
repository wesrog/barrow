import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { Equipment } from "../../sim/character";
import { makeHeroModelRig, type HeroModelRig } from "../render/modelRigs";
import type { GameAssets } from "../render/models";

/**
 * Inventory paperdoll: the hero model with current gear, idling on a slow
 * turntable in its own tiny Three.js scene. Purely cosmetic — reads
 * equipment, never touches sim state.
 */
export function CharacterView({
  assets,
  equipment,
  width,
  height = 190,
}: {
  assets: GameAssets;
  equipment: Equipment;
  width: number;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const heroRef = useRef<HeroModelRig | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xa8a29a, 1.4));
    const key = new THREE.DirectionalLight(0xfff2dc, 2.2);
    key.position.set(2, 3, 3);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x8a9ab8, 1.0);
    rim.position.set(-2, 2, -2);
    scene.add(rim);

    const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 20);
    camera.position.set(0, 1.15, 2.9);
    camera.lookAt(0, 0.72, 0);

    const hero = makeHeroModelRig(assets);
    hero.setEquipment(equipment);
    scene.add(hero.group);
    heroRef.current = hero;

    let raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      hero.animate(now, 0, 0);
      hero.group.rotation.y = now / 4000;
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      heroRef.current = null;
      renderer.dispose();
    };
  }, [assets, width, height]);

  // Re-dress the standing hero when gear changes; the mount effect handles
  // the first outfit.
  const gearKey = (["weapon", "helm", "chest", "boots"] as const)
    .map((slot) => {
      const item = equipment[slot];
      return item ? `${item.baseId}|${item.name}|${item.rarity}` : "";
    })
    .join("//");
  useEffect(() => {
    heroRef.current?.setEquipment(equipment);
  }, [gearKey]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width,
        height,
        display: "block",
        marginBottom: 10,
        background: "radial-gradient(ellipse at 50% 80%, #241f2c 0%, #16141a 75%)",
        border: "1px solid #2c2833",
        borderRadius: 3,
      }}
    />
  );
}
