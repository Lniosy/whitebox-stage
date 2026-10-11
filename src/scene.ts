import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Track, applyPose, poseOf, type Ease, type Keyframe } from './timeline';

export type PrimType = 'box' | 'plane' | 'sphere' | 'cylinder' | 'cone' | 'capsule' | 'torus' | 'airplane';
export type EntityType = PrimType | 'glb';
export type RenderMode = 'clay' | 'wire' | 'normal' | 'depth';
export type ViewMode = 'editor' | 'director';
export type TransformMode = 'translate' | 'rotate' | 'scale';

export const PRIM_LABELS: Record<PrimType, string> = {
  box: '方块',
  plane: '平面',
  sphere: '球',
  cylinder: '圆柱',
  cone: '圆锥',
  capsule: '胶囊(人物)',
  torus: '圆环',
  airplane: '飞机',
};

export interface Entity {
  id: number;
  name: string;
  type: EntityType;
  obj: THREE.Object3D;
  track: Track;
  glb?: { data: string; ext: string }; // base64
}

export const CAMERA_ID = -1;

// ---------- materials ----------
const clayMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.9, metalness: 0 });
const groundMat = new THREE.MeshStandardMaterial({ color: 0xd9d9d9, roughness: 1, metalness: 0 });
const wireMat = new THREE.MeshBasicMaterial({ color: 0x222222, wireframe: true });
const normalMat = new THREE.MeshNormalMaterial();
const depthMat = new THREE.ShaderMaterial({
  uniforms: { uNear: { value: 1 }, uFar: { value: 60 } },
  vertexShader: `
    #include <common>
    #include <skinning_pars_vertex>
    varying float vDepth;
    void main() {
      #include <skinbase_vertex>
      #include <begin_vertex>
      #include <skinning_vertex>
      vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
      vDepth = -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform float uNear; uniform float uFar; varying float vDepth;
    void main() {
      float d = 1.0 - clamp((vDepth - uNear) / (uFar - uNear), 0.0, 1.0);
      gl_FragColor = vec4(vec3(d), 1.0);
    }`,
});

function modeMaterial(mode: RenderMode, ground: boolean): THREE.Material {
  switch (mode) {
    case 'wire':
      return wireMat;
    case 'normal':
      return normalMat;
    case 'depth':
      return depthMat;
    default:
      return ground ? groundMat : clayMat;
  }
}

const BG: Record<RenderMode, number> = { clay: 0xbfc3c7, wire: 0xf4f4f4, normal: 0x8080ff, depth: 0x000000 };

function bytesToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToBytes(b64: string): ArrayBuffer {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
}

function buildPrim(type: PrimType): THREE.Object3D {
  const mesh = (g: THREE.BufferGeometry) => new THREE.Mesh(g, clayMat);
  let o: THREE.Object3D;
  switch (type) {
    case 'box':
      o = mesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
      break;
    case 'plane':
      o = mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2).translate(0, 0.01, 0));
      break;
    case 'sphere':
      o = mesh(new THREE.SphereGeometry(0.5, 32, 16).translate(0, 0.5, 0));
      break;
    case 'cylinder':
      o = mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 32).translate(0, 0.5, 0));
      break;
    case 'cone':
      o = mesh(new THREE.ConeGeometry(0.5, 1, 32).translate(0, 0.5, 0));
      break;
    case 'capsule':
      o = mesh(new THREE.CapsuleGeometry(0.28, 1.14, 8, 16).translate(0, 0.85, 0));
      break;
    case 'torus':
      o = mesh(new THREE.TorusGeometry(0.5, 0.18, 16, 48).translate(0, 0.7, 0));
      break;
    case 'airplane': {
      const g = new THREE.Group();
      const body = mesh(new THREE.CylinderGeometry(0.22, 0.16, 3, 20).rotateZ(Math.PI / 2));
      const nose = mesh(new THREE.SphereGeometry(0.22, 20, 12).translate(1.5, 0, 0));
      const wing = mesh(new THREE.BoxGeometry(0.7, 0.05, 3.2).translate(0.1, -0.05, 0));
      const tail = mesh(new THREE.BoxGeometry(0.35, 0.05, 1.1).translate(-1.35, 0.05, 0));
      const fin = mesh(new THREE.BoxGeometry(0.4, 0.6, 0.05).translate(-1.35, 0.32, 0));
      g.add(body, nose, wing, tail, fin);
      o = g;
      break;
    }
  }
  return o;
}

export class Stage {
  container: HTMLElement;
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  editorCam: THREE.PerspectiveCamera;
  directorCam: THREE.PerspectiveCamera;
  camHelper: THREE.CameraHelper;
  camProxy: THREE.Mesh;
  editorOrbit: OrbitControls;
  directorOrbit: OrbitControls;
  transform: TransformControls;
  transformHelper: THREE.Object3D;
  grid: THREE.GridHelper;
  axes: THREE.AxesHelper;
  ground: THREE.Mesh;
  selBox: THREE.BoxHelper;
  entities: Entity[] = [];
  cameraTrack = new Track();
  selected: number | null = null;
  viewMode: ViewMode = 'editor';
  renderMode: RenderMode = 'clay';
  ease: Ease = 'ease';
  outW = 1280;
  outH = 720;
  exporting = false;
  hideHelpersOnExport = true;
  private nextId = 1;
  private loader = new GLTFLoader();
  onChange: () => void = () => {};
  onSelect: () => void = () => {};

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setScissorTest(true);
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';

    this.scene.background = new THREE.Color(BG.clay);

    this.editorCam = new THREE.PerspectiveCamera(50, 1, 0.05, 1000);
    this.editorCam.position.set(12, 9, 14);
    this.directorCam = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 500);
    this.directorCam.position.set(0, 2, 12);
    this.directorCam.lookAt(0, 1.5, 0);
    this.directorCam.name = '导演机位';
    this.scene.add(this.directorCam);
    this.camHelper = new THREE.CameraHelper(this.directorCam);
    this.scene.add(this.camHelper);
    // a small pickable body for the director camera
    this.camProxy = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.3, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xff5a36 }),
    );
    this.camProxy.userData.isCamProxy = true;
    this.scene.add(this.camProxy);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.4);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 2.2);
    dir.position.set(8, 16, 6);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    const sc = dir.shadow.camera;
    sc.left = -25; sc.right = 25; sc.top = 25; sc.bottom = -25; sc.far = 60;
    dir.shadow.bias = -0.0005;
    this.scene.add(dir);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), groundMat);
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.grid = new THREE.GridHelper(100, 100, 0x888888, 0xaaaaaa);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.6;
    this.grid.position.y = 0.002;
    this.scene.add(this.grid);
    this.axes = new THREE.AxesHelper(3);
    this.axes.position.y = 0.004;
    this.scene.add(this.axes);

    this.selBox = new THREE.BoxHelper(new THREE.Object3D(), 0xffb020);
    this.selBox.visible = false;
    this.scene.add(this.selBox);

    const dom = this.renderer.domElement;
    this.editorOrbit = new OrbitControls(this.editorCam, dom);
    this.editorOrbit.target.set(0, 1, 0);
    this.editorOrbit.enableDamping = true;
    this.editorOrbit.update();
    this.directorOrbit = new OrbitControls(this.directorCam, dom);
    this.directorOrbit.target.set(0, 1.5, 0);
    this.directorOrbit.enabled = false;
    this.directorOrbit.addEventListener('change', () => this.onChange());

    this.transform = new TransformControls(this.editorCam, dom);
    this.transformHelper = this.transform.getHelper();
    this.scene.add(this.transformHelper);
    this.transform.addEventListener('dragging-changed', (e) => {
      const dragging = (e as unknown as { value: boolean }).value;
      this.activeOrbit().enabled = !dragging;
    });
    this.transform.addEventListener('objectChange', () => this.onChange());

    this.setupPicking();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  activeOrbit() {
    return this.viewMode === 'editor' ? this.editorOrbit : this.directorOrbit;
  }

  private setupPicking() {
    const dom = this.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    dom.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    dom.addEventListener('pointerup', (e) => {
      if (!down || this.transform.dragging) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 4) return;
      const r = dom.getBoundingClientRect();
      const vp = this.viewportRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - r.left - vp.x) / vp.w) * 2 - 1,
        -((e.clientY - r.top - (r.height - vp.y - vp.h)) / vp.h) * 2 + 1,
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, this.viewMode === 'editor' ? this.editorCam : this.directorCam);
      const targets: THREE.Object3D[] = this.entities.map((en) => en.obj);
      if (this.viewMode === 'editor') targets.push(this.camProxy);
      const hit = ray.intersectObjects(targets, true)[0];
      if (!hit) {
        this.select(null);
        return;
      }
      if (hit.object === this.camProxy) {
        this.select(CAMERA_ID);
        return;
      }
      const en = this.entities.find((x) => {
        let o: THREE.Object3D | null = hit.object;
        while (o) {
          if (o === x.obj) return true;
          o = o.parent;
        }
        return false;
      });
      this.select(en ? en.id : null);
    });
  }

  /** viewport rect in renderer pixel space (css px, bottom-left origin) */
  viewportRect() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (this.viewMode === 'editor') return { x: 0, y: 0, w, h };
    const aspect = this.outW / this.outH;
    let vw = w;
    let vh = w / aspect;
    if (vh > h) {
      vh = h;
      vw = h * aspect;
    }
    return { x: (w - vw) / 2, y: (h - vh) / 2, w: vw, h: vh };
  }

  resize() {
    if (this.exporting) return;
    const w = Math.max(this.container.clientWidth, 1);
    const h = Math.max(this.container.clientHeight, 1);
    this.renderer.setSize(w, h);
    this.editorCam.aspect = w / h;
    this.editorCam.updateProjectionMatrix();
    this.directorCam.aspect = this.outW / this.outH;
    this.directorCam.updateProjectionMatrix();
  }

  setOutput(w: number, h: number) {
    this.outW = w;
    this.outH = h;
    this.resize();
  }

  private tick() {
    if (this.exporting) return;
    this.activeOrbit().update();
    this.updateHelpers();
    this.render();
  }

  updateHelpers() {
    this.camProxy.position.copy(this.directorCam.position);
    this.camProxy.quaternion.copy(this.directorCam.quaternion);
    this.camHelper.update();
    const editor = this.viewMode === 'editor';
    this.camHelper.visible = editor;
    this.camProxy.visible = editor;
    const sel = this.getSelectedEntity();
    if (sel && !this.exporting) {
      this.selBox.setFromObject(sel.obj);
      this.selBox.visible = true;
    } else this.selBox.visible = false;
  }

  render(forExport = false) {
    const r = this.renderer;
    const helpersVisible = !(forExport && this.hideHelpersOnExport);
    const modeHides = this.renderMode === 'depth' || this.renderMode === 'normal';
    this.grid.visible = helpersVisible && !modeHides;
    this.axes.visible = helpersVisible && !modeHides;
    if (forExport) {
      this.camHelper.visible = false;
      this.camProxy.visible = false;
      this.selBox.visible = false;
      this.transformHelper.visible = false;
      const size = r.getSize(new THREE.Vector2());
      r.setViewport(0, 0, size.x, size.y);
      r.setScissor(0, 0, size.x, size.y);
      r.render(this.scene, this.directorCam);
      this.transformHelper.visible = true;
      return;
    }
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    r.setViewport(0, 0, w, h);
    r.setScissor(0, 0, w, h);
    if (this.viewMode === 'editor') {
      r.render(this.scene, this.editorCam);
    } else {
      const bg = this.scene.background;
      r.setClearColor(0x111214);
      this.scene.background = null;
      r.clear();
      this.scene.background = bg;
      const vp = this.viewportRect();
      r.setViewport(vp.x, vp.y, vp.w, vp.h);
      r.setScissor(vp.x, vp.y, vp.w, vp.h);
      this.transformHelper.visible = false;
      r.render(this.scene, this.directorCam);
      this.transformHelper.visible = true;
    }
  }

  // ---------- entities ----------
  private applyMaterials(root: THREE.Object3D) {
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        const m = o as THREE.Mesh;
        m.material = modeMaterial(this.renderMode, false);
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
  }

  setRenderMode(mode: RenderMode) {
    this.renderMode = mode;
    this.entities.forEach((e) => this.applyMaterials(e.obj));
    this.ground.material = modeMaterial(mode, true);
    (this.scene.background as THREE.Color).set(BG[mode]);
    this.ground.visible = mode !== 'wire';
    this.onChange();
  }

  setDepthRange(near: number, far: number) {
    depthMat.uniforms.uNear.value = near;
    depthMat.uniforms.uFar.value = far;
  }

  private register(type: EntityType, obj: THREE.Object3D, name?: string, glb?: Entity['glb']): Entity {
    this.applyMaterials(obj);
    const id = this.nextId++;
    const count = this.entities.filter((e) => e.type === type).length + 1;
    const label = type === 'glb' ? '模型' : PRIM_LABELS[type];
    const en: Entity = { id, name: name ?? `${label} ${count}`, type, obj, track: new Track(), glb };
    this.scene.add(obj);
    this.entities.push(en);
    return en;
  }

  addPrimitive(type: PrimType, name?: string, select = true): Entity {
    const en = this.register(type, buildPrim(type), name);
    if (select) this.select(en.id);
    this.onChange();
    return en;
  }

  async importModel(file: File): Promise<Entity> {
    const ext = file.name.toLowerCase().endsWith('.gltf') ? 'gltf' : 'glb';
    const buf = await file.arrayBuffer();
    return this.addModelFromData(bytesToB64(buf), ext, file.name.replace(/\.(glb|gltf)$/i, ''));
  }

  async addModelFromData(b64: string, ext: string, name?: string, select = true): Promise<Entity> {
    const buf = b64ToBytes(b64);
    const data: ArrayBuffer | string = ext === 'gltf' ? new TextDecoder().decode(buf) : buf;
    const gltf = await this.loader.parseAsync(data, '');
    const inner = gltf.scene;
    const box = new THREE.Box3().setFromObject(inner);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const s = 2 / maxDim;
    inner.scale.setScalar(s);
    const center = box.getCenter(new THREE.Vector3());
    inner.position.set(-center.x * s, -box.min.y * s, -center.z * s);
    const outer = new THREE.Group();
    outer.add(inner);
    const en = this.register('glb', outer, name, { data: b64, ext });
    if (select) this.select(en.id);
    this.onChange();
    return en;
  }

  duplicateSelected() {
    const en = this.getSelectedEntity();
    if (!en) return;
    let copy: Entity;
    if (en.type === 'glb') {
      const obj = en.obj.clone(true);
      copy = this.register('glb', obj, en.name + ' 副本', en.glb);
    } else {
      copy = this.register(en.type, buildPrim(en.type), en.name + ' 副本');
    }
    applyPose(copy.obj, poseOf(en.obj));
    copy.obj.position.x += 1;
    copy.track.keys = en.track.keys.map((k) => ({ ...k, p: [k.p[0] + 1, k.p[1], k.p[2]] }));
    this.select(copy.id);
    this.onChange();
  }

  deleteSelected() {
    const en = this.getSelectedEntity();
    if (!en) return;
    this.transform.detach();
    this.scene.remove(en.obj);
    this.entities = this.entities.filter((e) => e !== en);
    this.selected = null;
    this.onSelect();
    this.onChange();
  }

  clearAll() {
    this.transform.detach();
    this.entities.forEach((e) => this.scene.remove(e.obj));
    this.entities = [];
    this.cameraTrack.clear();
    this.selected = null;
    this.nextId = 1;
    this.onSelect();
  }

  getSelectedEntity(): Entity | undefined {
    return this.entities.find((e) => e.id === this.selected);
  }

  selectedObject(): THREE.Object3D | null {
    if (this.selected === CAMERA_ID) return this.directorCam;
    return this.getSelectedEntity()?.obj ?? null;
  }

  selectedTrack(): Track | null {
    if (this.selected === CAMERA_ID) return this.cameraTrack;
    return this.getSelectedEntity()?.track ?? null;
  }

  select(id: number | null) {
    this.selected = id;
    const obj = this.selectedObject();
    // in director view the director camera is driven by orbit, not the gizmo
    if (obj && !(this.viewMode === 'director' && id === CAMERA_ID)) this.transform.attach(obj);
    else this.transform.detach();
    this.onSelect();
  }

  setTransformMode(m: TransformMode) {
    this.transform.setMode(m);
  }

  setViewMode(m: ViewMode) {
    this.viewMode = m;
    const editor = m === 'editor';
    this.editorOrbit.enabled = editor;
    this.directorOrbit.enabled = !editor;
    this.transform.camera = editor ? this.editorCam : this.directorCam;
    if (!editor) {
      // put orbit target in front of the director camera
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.directorCam.quaternion);
      const dist = this.directorCam.position.distanceTo(this.directorOrbit.target) || 10;
      this.directorOrbit.target.copy(this.directorCam.position).addScaledVector(fwd, dist);
    }
    this.select(this.selected);
    this.resize();
  }

  snapDirectorToEditor() {
    this.directorCam.position.copy(this.editorCam.position);
    this.directorCam.quaternion.copy(this.editorCam.quaternion);
    this.directorOrbit.target.copy(this.editorOrbit.target);
    this.onChange();
  }

  /** apply all tracks at time t */
  evaluate(t: number) {
    for (const en of this.entities) {
      const k = en.track.sample(t, this.ease);
      if (k) applyPose(en.obj, k);
    }
    const k = this.cameraTrack.sample(t, this.ease);
    if (k) {
      applyPose(this.directorCam, k);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.directorCam.quaternion);
      const dist = this.directorCam.position.distanceTo(this.directorOrbit.target) || 10;
      this.directorOrbit.target.copy(this.directorCam.position).addScaledVector(fwd, dist);
    }
  }

  keyframeSelected(t: number): boolean {
    const obj = this.selectedObject();
    const tr = this.selectedTrack();
    if (!obj || !tr) return false;
    tr.set(poseOf(obj, t));
    this.onChange();
    return true;
  }

  // ---------- camera presets ----------
  presetCamera(kind: 'dollyIn' | 'dollyOut' | 'orbit' | 'truck' | 'crane', duration: number) {
    const cam = this.directorCam;
    const sel = this.getSelectedEntity();
    const target = new THREE.Vector3(0, 1, 0);
    if (sel) new THREE.Box3().setFromObject(sel.obj).getCenter(target);
    const start = cam.position.clone();
    const tmp = new THREE.PerspectiveCamera();
    const keyAt = (t: number, pos: THREE.Vector3, look?: THREE.Vector3, quat?: THREE.Quaternion): Keyframe => {
      tmp.position.copy(pos);
      if (look) tmp.lookAt(look);
      else if (quat) tmp.quaternion.copy(quat);
      return { t, p: pos.toArray() as Keyframe['p'], q: tmp.quaternion.toArray() as Keyframe['q'], s: [1, 1, 1], fov: cam.fov };
    };
    const tr = this.cameraTrack;
    tr.clear();
    const dist = start.distanceTo(target);
    if (kind === 'dollyIn' || kind === 'dollyOut') {
      const near = start.clone().lerp(target, 0.55);
      const [a, b] = kind === 'dollyIn' ? [start, near] : [near, start];
      tr.set(keyAt(0, a, target));
      tr.set(keyAt(duration, b, target));
    } else if (kind === 'orbit') {
      const off = start.clone().sub(target);
      const r = Math.hypot(off.x, off.z) || 8;
      const a0 = Math.atan2(off.z, off.x);
      const n = 12;
      for (let i = 0; i <= n; i++) {
        const a = a0 + (i / n) * Math.PI * 2;
        const p = new THREE.Vector3(target.x + Math.cos(a) * r, start.y, target.z + Math.sin(a) * r);
        tr.set(keyAt((i / n) * duration, p, target));
      }
    } else if (kind === 'truck') {
      tmp.position.copy(start);
      tmp.lookAt(target);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(tmp.quaternion);
      const q = tmp.quaternion.clone();
      const off = right.multiplyScalar(dist * 0.35);
      tr.set(keyAt(0, start.clone().sub(off), undefined, q));
      tr.set(keyAt(duration, start.clone().add(off), undefined, q));
    } else if (kind === 'crane') {
      const low = start.clone();
      low.y = Math.max(0.4, target.y * 0.5);
      const high = start.clone();
      high.y = start.y + dist * 0.6;
      tr.set(keyAt(0, low, target));
      tr.set(keyAt(duration, high, target));
    }
    this.evaluate(0);
    this.onChange();
  }
}
