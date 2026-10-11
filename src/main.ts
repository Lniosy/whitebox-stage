import './style.css';
import * as THREE from 'three';
import { Stage, CAMERA_ID, PRIM_LABELS, type PrimType, type RenderMode, type TransformMode } from './scene';
import { applyPose, poseOf, type Ease, type Keyframe } from './timeline';
import { download, exportPNG, exportWebM, stamp } from './exporter';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

const RESOLUTIONS: Record<string, [number, number]> = {
  '1280x720': [1280, 720],
  '1920x1080': [1920, 1080],
  '720x1280': [720, 1280],
  '1024x1024': [1024, 1024],
};

document.querySelector('#app')!.innerHTML = `
<div class="h-full flex flex-col">
  <header class="h-11 shrink-0 flex items-center gap-2 px-3 border-b border-neutral-800 bg-neutral-900">
    <div class="flex items-center gap-2 mr-2">
      <div class="w-5 h-5 bg-neutral-100 rounded-sm relative"><span class="absolute -right-1 -top-1 w-2.5 h-2.5 rounded-full bg-orange-500"></span></div>
      <span class="font-semibold text-sm text-white">白模导演台</span>
      <span class="text-xs text-neutral-500 hidden md:inline">Whitebox Stage</span>
    </div>
    <div class="flex gap-1" id="viewModes">
      <button class="btn" data-view="editor" title="自由环绕的编辑视角">编辑视角</button>
      <button class="btn" data-view="director" title="通过导演机位看（即导出画面）">导演机位</button>
    </div>
    <select id="renderMode" class="field !w-auto" title="渲染模式">
      <option value="clay">白模</option><option value="wire">线框</option><option value="normal">法线</option><option value="depth">深度</option>
    </select>
    <div class="flex-1"></div>
    <select id="res" class="field !w-auto" title="导出分辨率">
      <option value="1280x720">1280×720 16:9</option><option value="1920x1080">1920×1080 16:9</option>
      <option value="720x1280">720×1280 9:16</option><option value="1024x1024">1024×1024 1:1</option>
    </select>
    <label class="text-xs text-neutral-400 hidden lg:flex items-center gap-1"><input type="checkbox" id="hideHelpers" checked> 导出时隐藏网格</label>
    <button class="btn" id="exportPng">导出当前帧 PNG</button>
    <button class="btn btn-primary" id="exportWebm">导出视频 WebM</button>
    <a class="btn hidden sm:inline-block" href="https://github.com/Lniosy/whitebox-stage" target="_blank" rel="noopener">GitHub</a>
  </header>
  <div class="flex-1 flex min-h-0 flex-col md:flex-row">
    <aside class="md:w-60 shrink-0 border-b md:border-b-0 md:border-r border-neutral-800 bg-neutral-900 p-3 overflow-y-auto max-h-56 md:max-h-none">
      <div class="panel-title">添加白模</div>
      <div class="grid grid-cols-4 md:grid-cols-2 gap-1" id="prims"></div>
      <label class="btn block text-center mt-1 cursor-pointer">导入 GLB / GLTF<input type="file" id="importFile" accept=".glb,.gltf" class="hidden"></label>
      <div class="panel-title">变换 (W / E / R)</div>
      <div class="grid grid-cols-3 gap-1" id="tmodes">
        <button class="btn" data-mode="translate">平移</button><button class="btn" data-mode="rotate">旋转</button><button class="btn" data-mode="scale">缩放</button>
      </div>
      <div class="grid grid-cols-2 gap-1 mt-1">
        <button class="btn" id="dup">复制</button><button class="btn" id="del">删除</button>
      </div>
      <div class="panel-title">场景物体</div>
      <div id="list" class="space-y-0.5"></div>
      <div class="panel-title">导演机位</div>
      <button class="btn w-full" id="snapCam">将导演机位对齐当前视角</button>
      <label class="text-xs text-neutral-400 flex items-center gap-2 mt-1.5">FOV <input type="range" id="fov" min="10" max="100" value="40" class="flex-1 accent-orange-500"><span id="fovVal" class="w-6 text-right">40</span></label>
      <div class="panel-title">预设运镜（自动打相机关键帧）</div>
      <div class="grid grid-cols-3 gap-1" id="presets">
        <button class="btn" data-preset="dollyIn">推镜</button><button class="btn" data-preset="dollyOut">拉镜</button><button class="btn" data-preset="orbit">环绕</button>
        <button class="btn" data-preset="truck">横移</button><button class="btn" data-preset="crane">升降</button>
      </div>
      <div class="panel-title">深度范围</div>
      <div class="flex gap-1 items-center text-xs text-neutral-400">近<input type="number" id="dNear" value="1" class="field"> 远<input type="number" id="dFar" value="60" class="field"></div>
      <div class="panel-title">场景文件</div>
      <div class="grid grid-cols-2 gap-1">
        <button class="btn" id="saveJson">导出 JSON</button>
        <label class="btn text-center cursor-pointer">导入 JSON<input type="file" id="loadJson" accept=".json" class="hidden"></label>
        <button class="btn" id="demo">示例场景</button><button class="btn" id="clear">清空</button>
      </div>
      <p class="text-[11px] text-neutral-500 mt-3 leading-relaxed">点选物体 → 拖到某一时刻 → 摆好 → 「打关键帧」。选中「导演机位」给镜头打关键帧；切到导演机位视角时，直接拖拽画面就是在移动镜头。</p>
    </aside>
    <main class="flex-1 relative min-h-0 min-w-0">
      <div id="viewport" class="absolute inset-0"></div>
      <div id="hud" class="absolute left-2 top-2 text-[11px] text-neutral-700 bg-white/70 rounded px-2 py-1 pointer-events-none"></div>
      <div id="overlay" class="hidden absolute inset-0 bg-black/60 flex items-center justify-center text-sm text-white">
        <div class="bg-neutral-900 border border-neutral-700 rounded-lg px-5 py-4 w-72">
          <div id="overlayText">正在导出…</div>
          <div class="h-1.5 bg-neutral-700 rounded mt-3 overflow-hidden"><div id="overlayBar" class="h-full bg-orange-500 w-0"></div></div>
        </div>
      </div>
    </main>
  </div>
  <footer class="shrink-0 border-t border-neutral-800 bg-neutral-900 px-3 py-2">
    <div class="flex flex-wrap items-center gap-1.5 text-xs">
      <button class="btn" id="toStart" title="回到开头">⏮</button>
      <button class="btn w-16" id="play" title="空格">▶ 播放</button>
      <label class="flex items-center gap-1 text-neutral-400"><input type="checkbox" id="loop" checked>循环</label>
      <span class="font-mono text-neutral-300 w-28 text-center" id="timeLabel">0.00 / 5.00s</span>
      <button class="btn btn-primary" id="key" title="K">◆ 打关键帧</button>
      <button class="btn" id="unkey">删除此处关键帧</button>
      <span class="text-neutral-500 ml-1" id="keyTarget"></span>
      <div class="flex-1"></div>
      <label class="text-neutral-400">时长<input type="number" id="duration" value="5" min="0.5" max="120" step="0.5" class="field !w-14 ml-1">s</label>
      <label class="text-neutral-400">帧率<input type="number" id="fps" value="30" min="1" max="60" class="field !w-12 ml-1"></label>
      <select id="ease" class="field !w-auto"><option value="ease">缓动</option><option value="linear">线性</option></select>
    </div>
    <div class="relative mt-2 h-8">
      <div id="markers" class="absolute inset-x-0 top-0 h-3"></div>
      <input type="range" id="scrub" class="scrub absolute inset-x-0 bottom-0" min="0" max="5" step="0.001" value="0">
    </div>
  </footer>
</div>`;

const stage = new Stage($('#viewport'));

// ---------- state ----------
const st = { time: 0, duration: 5, fps: 30, playing: false, loop: true };
let lastFrame = performance.now();

function setTime(t: number) {
  st.time = Math.max(0, Math.min(t, st.duration));
  stage.evaluate(st.time);
  refreshTimeline();
}

function refreshTimeline() {
  $<HTMLInputElement>('#scrub').max = String(st.duration);
  $<HTMLInputElement>('#scrub').value = String(st.time);
  $('#timeLabel').textContent = `${st.time.toFixed(2)} / ${st.duration.toFixed(2)}s`;
  const tr = stage.selectedTrack();
  const m = $('#markers');
  m.innerHTML = '';
  if (tr) {
    for (const k of tr.keys) {
      const b = document.createElement('button');
      b.className = 'absolute -translate-x-1/2 w-2.5 h-2.5 rotate-45 bg-orange-400 hover:bg-white border border-orange-900';
      b.style.left = `calc(${(k.t / st.duration) * 100}% )`;
      b.title = `${k.t.toFixed(2)}s`;
      b.onclick = () => setTime(k.t);
      m.appendChild(b);
    }
  }
}

function refreshPanel() {
  const list = $('#list');
  list.innerHTML = '';
  const add = (id: number, name: string, keys: number) => {
    const d = document.createElement('div');
    d.className = 'list-item' + (stage.selected === id ? ' active' : '');
    d.innerHTML = `<span class="truncate">${name}</span><span class="text-neutral-500">${keys ? '◆' + keys : ''}</span>`;
    d.onclick = () => stage.select(id);
    list.appendChild(d);
  };
  add(CAMERA_ID, '🎥 导演机位', stage.cameraTrack.keys.length);
  for (const en of stage.entities) add(en.id, en.name, en.track.keys.length);
  const sel = stage.selected;
  $('#keyTarget').textContent =
    sel === null ? '（先选中物体或导演机位）' : `目标：${sel === CAMERA_ID ? '导演机位' : stage.getSelectedEntity()?.name}`;
  $<HTMLButtonElement>('#key').disabled = sel === null;
  $<HTMLButtonElement>('#dup').disabled = !stage.getSelectedEntity();
  $<HTMLButtonElement>('#del').disabled = !stage.getSelectedEntity();
  document.querySelectorAll<HTMLButtonElement>('#viewModes button').forEach((b) =>
    b.classList.toggle('btn-on', b.dataset.view === stage.viewMode),
  );
  document.querySelectorAll<HTMLButtonElement>('#tmodes button').forEach((b) =>
    b.classList.toggle('btn-on', b.dataset.mode === stage.transform.mode),
  );
  $<HTMLInputElement>('#fov').value = String(Math.round(stage.directorCam.fov));
  $('#fovVal').textContent = String(Math.round(stage.directorCam.fov));
  $('#hud').textContent =
    stage.viewMode === 'editor'
      ? '编辑视角 · 左键旋转 / 右键平移 / 滚轮缩放 · 点选物体'
      : `导演机位 · ${stage.outW}×${stage.outH} · 拖拽即移动镜头`;
  refreshTimeline();
}
stage.onSelect = refreshPanel;
let changeQueued = false;
stage.onChange = () => {
  if (changeQueued) return;
  changeQueued = true;
  requestAnimationFrame(() => {
    changeQueued = false;
    refreshPanel();
  });
};

// ---------- playback loop ----------
function loop(now: number) {
  const dt = (now - lastFrame) / 1000;
  lastFrame = now;
  if (st.playing && !stage.exporting) {
    let t = st.time + dt;
    if (t > st.duration) {
      if (st.loop) t = t % st.duration;
      else {
        t = st.duration;
        setPlaying(false);
      }
    }
    setTime(t);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function setPlaying(p: boolean) {
  st.playing = p;
  if (p && st.time >= st.duration) st.time = 0;
  $('#play').textContent = p ? '⏸ 暂停' : '▶ 播放';
}

function keyframe() {
  if (!stage.keyframeSelected(st.time)) {
    flash('先选中一个物体或导演机位');
    return false;
  }
  refreshPanel();
  return true;
}

let flashTimer = 0;
function flash(msg: string) {
  const hud = $('#hud');
  hud.textContent = msg;
  hud.classList.add('!bg-orange-200');
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => {
    hud.classList.remove('!bg-orange-200');
    refreshPanel();
  }, 1600);
}

// ---------- export ----------
function overlay(show: boolean, text = '', p = 0) {
  $('#overlay').classList.toggle('hidden', !show);
  $('#overlayText').textContent = text;
  $('#overlayBar').style.width = `${Math.round(p * 100)}%`;
}

async function doExportPNG() {
  const blob = await exportPNG(stage, st.time);
  download(blob, `whitebox-${stamp()}-${st.time.toFixed(2)}s.png`);
  stage.evaluate(st.time);
  return blob;
}

async function doExportWebM() {
  setPlaying(false);
  const keep = st.time;
  overlay(true, `正在逐帧录制 ${stage.outW}×${stage.outH} @${st.fps}fps…`, 0);
  try {
    const blob = await exportWebM(stage, st.duration, st.fps, (p) => overlay(true, `正在逐帧录制 ${Math.round(p * 100)}%`, p));
    download(blob, `whitebox-${stamp()}.webm`);
    return blob;
  } catch (e) {
    alert('导出失败：' + (e as Error).message);
    throw e;
  } finally {
    overlay(false);
    setTime(keep);
  }
}

// ---------- scene JSON ----------
interface SceneFile {
  app: 'whitebox-stage';
  version: 1;
  settings: { duration: number; fps: number; ease: Ease; res: string; renderMode: RenderMode };
  camera: { pose: Keyframe; keys: Keyframe[] };
  entities: { name: string; type: string; pose: Keyframe; keys: Keyframe[]; glb?: { data: string; ext: string } }[];
}

function serialize(): SceneFile {
  return {
    app: 'whitebox-stage',
    version: 1,
    settings: { duration: st.duration, fps: st.fps, ease: stage.ease, res: `${stage.outW}x${stage.outH}`, renderMode: stage.renderMode },
    camera: { pose: poseOf(stage.directorCam), keys: stage.cameraTrack.keys },
    entities: stage.entities.map((e) => ({ name: e.name, type: e.type, pose: poseOf(e.obj), keys: e.track.keys, glb: e.glb })),
  };
}

async function load(data: SceneFile) {
  if (data.app !== 'whitebox-stage') throw new Error('不是白模导演台的场景文件');
  stage.clearAll();
  const s = data.settings;
  st.duration = s.duration;
  st.fps = s.fps;
  stage.ease = s.ease;
  $<HTMLInputElement>('#duration').value = String(s.duration);
  $<HTMLInputElement>('#fps').value = String(s.fps);
  $<HTMLSelectElement>('#ease').value = s.ease;
  if (RESOLUTIONS[s.res]) {
    $<HTMLSelectElement>('#res').value = s.res;
    stage.setOutput(...RESOLUTIONS[s.res]);
  }
  for (const e of data.entities) {
    const en =
      e.type === 'glb' && e.glb
        ? await stage.addModelFromData(e.glb.data, e.glb.ext, e.name, false)
        : stage.addPrimitive(e.type as PrimType, e.name, false);
    applyPose(en.obj, e.pose);
    en.track.keys = e.keys;
  }
  applyPose(stage.directorCam, data.camera.pose);
  stage.cameraTrack.keys = data.camera.keys;
  stage.setRenderMode(s.renderMode ?? 'clay');
  $<HTMLSelectElement>('#renderMode').value = stage.renderMode;
  stage.select(null);
  setTime(0);
}

// ---------- demo scene ----------
function demoScene() {
  stage.clearAll();
  st.duration = 5;
  $<HTMLInputElement>('#duration').value = '5';
  const rand = (() => {
    let s = 7;
    return () => ((s = (s * 16807) % 2147483647) / 2147483647);
  })();
  const spots: [number, number][] = [[-6, -4], [-3, -6], [0, -5], [3, -7], [6, -4], [-8, 1], [8, 0], [-4, 3], [5, 4]];
  spots.forEach(([x, z], i) => {
    const b = stage.addPrimitive('box', `楼 ${i + 1}`, false);
    const h = 1.5 + rand() * 5;
    b.obj.position.set(x, 0, z);
    b.obj.scale.set(1.4 + rand(), h, 1.4 + rand());
  });
  const person = stage.addPrimitive('capsule', '人物', false);
  person.obj.position.set(0, 0, 4);
  person.track.set(poseOf(person.obj, 0));
  person.obj.position.set(1.5, 0, 2.5);
  person.track.set(poseOf(person.obj, 5));

  const plane = stage.addPrimitive('airplane', '飞机', false);
  plane.obj.scale.setScalar(1.2);
  plane.obj.position.set(-14, 7, -2);
  plane.obj.rotation.set(0, 0, -0.08);
  plane.track.set(poseOf(plane.obj, 0));
  plane.obj.position.set(0, 5, 0);
  plane.obj.rotation.set(0.25, 0, 0);
  plane.track.set(poseOf(plane.obj, 2.5));
  plane.obj.position.set(14, 6.5, 1);
  plane.obj.rotation.set(0.05, 0, 0.12);
  plane.track.set(poseOf(plane.obj, 5));

  const cam = stage.directorCam;
  const tmp = new THREE.Vector3();
  cam.fov = 45;
  cam.updateProjectionMatrix();
  cam.position.set(0, 1.6, 15);
  cam.lookAt(tmp.set(0, 3, 0));
  stage.cameraTrack.set(poseOf(cam, 0));
  cam.position.set(0, 1.4, 9.5);
  cam.lookAt(tmp.set(0, 4.5, 0));
  stage.cameraTrack.set(poseOf(cam, 5));

  stage.ease = 'ease';
  $<HTMLSelectElement>('#ease').value = 'ease';
  stage.select(null);
  setTime(0);
}

// ---------- wiring ----------
const prims = $('#prims');
(Object.keys(PRIM_LABELS) as PrimType[]).forEach((t) => {
  const b = document.createElement('button');
  b.className = 'btn';
  b.textContent = PRIM_LABELS[t];
  b.onclick = () => stage.addPrimitive(t);
  prims.appendChild(b);
});
$<HTMLInputElement>('#importFile').onchange = async (e) => {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  input.value = '';
  if (!f) return;
  try {
    await stage.importModel(f);
  } catch (err) {
    alert('模型导入失败（.gltf 需为内嵌资源的单文件，推荐用 .glb）：' + (err as Error).message);
  }
};
document.querySelectorAll<HTMLButtonElement>('#tmodes button').forEach(
  (b) => (b.onclick = () => (stage.setTransformMode(b.dataset.mode as TransformMode), refreshPanel())),
);
document.querySelectorAll<HTMLButtonElement>('#viewModes button').forEach(
  (b) => (b.onclick = () => (stage.setViewMode(b.dataset.view as 'editor' | 'director'), refreshPanel())),
);
document.querySelectorAll<HTMLButtonElement>('#presets button').forEach(
  (b) =>
    (b.onclick = () => {
      stage.presetCamera(b.dataset.preset as Parameters<Stage['presetCamera']>[0], st.duration);
      stage.select(CAMERA_ID);
      setTime(0);
      flash('已生成相机关键帧，按播放预览');
    }),
);
$('#dup').onclick = () => stage.duplicateSelected();
$('#del').onclick = () => stage.deleteSelected();
$('#snapCam').onclick = () => {
  stage.snapDirectorToEditor();
  flash('导演机位已对齐，记得打关键帧');
};
$<HTMLInputElement>('#fov').oninput = (e) => {
  stage.directorCam.fov = Number((e.target as HTMLInputElement).value);
  stage.directorCam.updateProjectionMatrix();
  $('#fovVal').textContent = String(Math.round(stage.directorCam.fov));
};
$<HTMLSelectElement>('#renderMode').onchange = (e) => stage.setRenderMode((e.target as HTMLSelectElement).value as RenderMode);
const depthRange = () => stage.setDepthRange(Number($<HTMLInputElement>('#dNear').value) || 0, Number($<HTMLInputElement>('#dFar').value) || 60);
$('#dNear').onchange = depthRange;
$('#dFar').onchange = depthRange;
$<HTMLSelectElement>('#res').onchange = (e) => {
  stage.setOutput(...RESOLUTIONS[(e.target as HTMLSelectElement).value]);
  refreshPanel();
};
$<HTMLInputElement>('#hideHelpers').onchange = (e) => (stage.hideHelpersOnExport = (e.target as HTMLInputElement).checked);
$('#exportPng').onclick = () => void doExportPNG();
$('#exportWebm').onclick = () => void doExportWebM().catch(() => {});
$('#saveJson').onclick = () =>
  download(new Blob([JSON.stringify(serialize())], { type: 'application/json' }), `whitebox-scene-${stamp()}.json`);
$<HTMLInputElement>('#loadJson').onchange = async (e) => {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  input.value = '';
  if (!f) return;
  try {
    await load(JSON.parse(await f.text()));
  } catch (err) {
    alert('场景导入失败：' + (err as Error).message);
  }
};
$('#demo').onclick = demoScene;
$('#clear').onclick = () => {
  if (confirm('清空整个场景？')) {
    stage.clearAll();
    setTime(0);
  }
};
$('#toStart').onclick = () => setTime(0);
$('#play').onclick = () => setPlaying(!st.playing);
$<HTMLInputElement>('#loop').onchange = (e) => (st.loop = (e.target as HTMLInputElement).checked);
$('#key').onclick = keyframe;
$('#unkey').onclick = () => {
  if (stage.selectedTrack()?.removeAt(st.time)) refreshPanel();
  else flash('当前时间没有关键帧');
};
$<HTMLInputElement>('#scrub').oninput = (e) => {
  setPlaying(false);
  setTime(Number((e.target as HTMLInputElement).value));
};
$<HTMLInputElement>('#duration').onchange = (e) => {
  st.duration = Math.max(0.5, Number((e.target as HTMLInputElement).value) || 5);
  setTime(Math.min(st.time, st.duration));
};
$<HTMLInputElement>('#fps').onchange = (e) => (st.fps = Math.max(1, Math.min(60, Number((e.target as HTMLInputElement).value) || 30)));
$<HTMLSelectElement>('#ease').onchange = (e) => {
  stage.ease = (e.target as HTMLSelectElement).value as Ease;
  setTime(st.time);
};

window.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  const k = e.key.toLowerCase();
  if (k === 'w') stage.setTransformMode('translate');
  else if (k === 'e') stage.setTransformMode('rotate');
  else if (k === 'r') stage.setTransformMode('scale');
  else if (k === ' ') {
    e.preventDefault();
    setPlaying(!st.playing);
  } else if (k === 'k') keyframe();
  else if (k === 'delete' || k === 'backspace') stage.deleteSelected();
  else if (k === 'escape') stage.select(null);
  else return;
  refreshPanel();
});

// ---------- test hook ----------
declare global {
  interface Window {
    __wbs: unknown;
  }
}
window.__wbs = {
  stage,
  state: st,
  addPrimitive: (t: PrimType) => stage.addPrimitive(t),
  select: (id: number | null) => stage.select(id),
  setTime,
  keyframe,
  play: () => setPlaying(true),
  pause: () => setPlaying(false),
  exportPNG: doExportPNG,
  exportWebM: doExportWebM,
  serialize,
  load,
  demoScene,
};

demoScene();
refreshPanel();
