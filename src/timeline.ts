import * as THREE from 'three';

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export type Ease = 'linear' | 'ease';

export interface Keyframe {
  t: number;
  p: Vec3;
  q: Quat;
  s: Vec3;
  fov?: number;
}

const EPS = 1e-3;

export function poseOf(obj: THREE.Object3D, t = 0): Keyframe {
  const k: Keyframe = {
    t,
    p: obj.position.toArray() as Vec3,
    q: obj.quaternion.toArray() as Quat,
    s: obj.scale.toArray() as Vec3,
  };
  if (obj instanceof THREE.PerspectiveCamera) k.fov = obj.fov;
  return k;
}

export function applyPose(obj: THREE.Object3D, k: Keyframe) {
  obj.position.fromArray(k.p);
  obj.quaternion.fromArray(k.q);
  obj.scale.fromArray(k.s);
  if (obj instanceof THREE.PerspectiveCamera && k.fov !== undefined && obj.fov !== k.fov) {
    obj.fov = k.fov;
    obj.updateProjectionMatrix();
  }
}

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

export class Track {
  keys: Keyframe[] = [];

  set(k: Keyframe) {
    this.keys = this.keys.filter((x) => Math.abs(x.t - k.t) > EPS);
    this.keys.push(k);
    this.keys.sort((a, b) => a.t - b.t);
  }

  removeAt(t: number): boolean {
    const n = this.keys.length;
    this.keys = this.keys.filter((x) => Math.abs(x.t - t) > 0.02);
    return this.keys.length !== n;
  }

  clear() {
    this.keys = [];
  }

  sample(t: number, ease: Ease): Keyframe | null {
    const ks = this.keys;
    if (ks.length === 0) return null;
    if (t <= ks[0].t) return ks[0];
    const last = ks[ks.length - 1];
    if (t >= last.t) return last;
    let i = 0;
    while (i < ks.length - 1 && ks[i + 1].t < t) i++;
    const a = ks[i];
    const b = ks[i + 1];
    let u = (t - a.t) / Math.max(b.t - a.t, 1e-6);
    if (ease === 'ease') u = u * u * (3 - 2 * u);
    const lerp = (x: number, y: number) => x + (y - x) * u;
    _qa.fromArray(a.q);
    _qb.fromArray(b.q);
    _qa.slerp(_qb, u);
    const out: Keyframe = {
      t,
      p: [lerp(a.p[0], b.p[0]), lerp(a.p[1], b.p[1]), lerp(a.p[2], b.p[2])],
      q: _qa.toArray() as Quat,
      s: [lerp(a.s[0], b.s[0]), lerp(a.s[1], b.s[1]), lerp(a.s[2], b.s[2])],
    };
    if (a.fov !== undefined && b.fov !== undefined) out.fov = lerp(a.fov, b.fov);
    return out;
  }
}
