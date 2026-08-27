import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { Effects } from "./fx";

/** Drive Effects with a fake clock so tween expiry is deterministic. */
function withClock(fn: (setNow: (ms: number) => void) => void) {
  const real = performance.now.bind(performance);
  let now = 0;
  performance.now = () => now;
  try {
    fn((ms) => {
      now = ms;
    });
  } finally {
    performance.now = real;
  }
}

describe("Effects.flash", () => {
  test("restores the original emissive after the flash", () => {
    withClock((setNow) => {
      const fx = new Effects(new THREE.Scene());
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(),
        new THREE.MeshStandardMaterial({ emissive: 0x000000, emissiveIntensity: 1 }),
      );
      fx.flash(mesh, 0xc03030, 110);
      expect((mesh.material as THREE.MeshStandardMaterial).emissive.getHex()).toBe(0xc03030);
      setNow(120);
      fx.update();
      expect((mesh.material as THREE.MeshStandardMaterial).emissive.getHex()).toBe(0x000000);
      expect((mesh.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(1);
    });
  });

  test("overlapping flashes still restore the true original, not the flash color", () => {
    withClock((setNow) => {
      const fx = new Effects(new THREE.Scene());
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(),
        new THREE.MeshStandardMaterial({ emissive: 0x000000, emissiveIntensity: 1 }),
      );
      // First hit.
      fx.flash(mesh, 0xc03030, 110);
      // Second hit lands while still red from the first.
      setNow(50);
      fx.update();
      fx.flash(mesh, 0xc03030, 110);
      // First flash expires on this frame, the second on a later one.
      setNow(120);
      fx.update();
      setNow(300);
      fx.update();
      const mat = mesh.material as THREE.MeshStandardMaterial;
      expect(mat.emissive.getHex()).toBe(0x000000);
      expect(mat.emissiveIntensity).toBe(1);
    });
  });
});
