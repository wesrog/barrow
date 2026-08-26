import * as THREE from "three";

/**
 * Small effects engine: time-based tweens, particle bursts, camera shake.
 * All effects are renderer-side sugar — the sim never knows.
 */
export class Effects {
  private tweens: {
    born: number;
    dur: number;
    fn: (t: number) => void;
    done?: () => void;
  }[] = [];
  private particles: {
    mesh: THREE.Mesh;
    vel: THREE.Vector3;
    born: number;
    dur: number;
  }[] = [];
  private shakeAmp = 0;
  private particleGeo = new THREE.TetrahedronGeometry(0.055);

  constructor(private scene: THREE.Scene) {}

  /** Run fn(t) with t 0->1 over dur ms; call done at the end. */
  tween(dur: number, fn: (t: number) => void, done?: () => void): void {
    this.tweens.push({ born: performance.now(), dur, fn, done });
    fn(0);
  }

  /** Scatter a handful of glowing shards from a point. */
  burst(x: number, y: number, z: number, color: number, count = 8, speed = 2.4): void {
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(
        this.particleGeo,
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }),
      );
      mesh.position.set(x, y, z);
      const a = Math.random() * Math.PI * 2;
      const up = 1.4 + Math.random() * 2.2;
      const out = speed * (0.4 + Math.random() * 0.6);
      this.scene.add(mesh);
      this.particles.push({
        mesh,
        vel: new THREE.Vector3(Math.cos(a) * out, up, Math.sin(a) * out),
        born: performance.now(),
        dur: 350 + Math.random() * 250,
      });
    }
  }

  shake(amp: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
  }

  /** Advance everything; returns the current camera shake offset. */
  update(): { x: number; z: number } {
    const now = performance.now();

    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i]!;
      const t = Math.min(1, (now - tw.born) / tw.dur);
      tw.fn(t);
      if (t >= 1) {
        tw.done?.();
        this.tweens.splice(i, 1);
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i]!;
      const age = (now - pt.born) / pt.dur;
      if (age >= 1) {
        this.scene.remove(pt.mesh);
        (pt.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
        continue;
      }
      const dt = 1 / 60;
      pt.vel.y -= 9.5 * dt;
      pt.mesh.position.addScaledVector(pt.vel, dt);
      if (pt.mesh.position.y < 0.03) {
        pt.mesh.position.y = 0.03;
        pt.vel.y *= -0.3;
        pt.vel.x *= 0.7;
        pt.vel.z *= 0.7;
      }
      (pt.mesh.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - age);
    }

    this.shakeAmp *= 0.86;
    if (this.shakeAmp < 0.005) this.shakeAmp = 0;
    return {
      x: (Math.random() - 0.5) * 2 * this.shakeAmp,
      z: (Math.random() - 0.5) * 2 * this.shakeAmp,
    };
  }

  /** Briefly repaint every material in a group (hit flash), then restore. */
  flash(group: THREE.Object3D, color: number, ms = 90): void {
    const originals: { mat: THREE.MeshStandardMaterial; emissive: number; intensity: number }[] = [];
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
        originals.push({
          mat: obj.material,
          emissive: obj.material.emissive.getHex(),
          intensity: obj.material.emissiveIntensity,
        });
        obj.material.emissive.setHex(color);
        obj.material.emissiveIntensity = 0.9;
      }
    });
    this.tween(ms, () => {}, () => {
      for (const o of originals) {
        o.mat.emissive.setHex(o.emissive);
        o.mat.emissiveIntensity = o.intensity;
      }
    });
  }
}
