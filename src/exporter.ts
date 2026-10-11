import type { Stage } from './scene';

const raf = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function beginOffscreen(stage: Stage) {
  stage.exporting = true;
  const r = stage.renderer;
  const prevRatio = r.getPixelRatio();
  r.setPixelRatio(1);
  r.setSize(stage.outW, stage.outH, false);
  stage.directorCam.aspect = stage.outW / stage.outH;
  stage.directorCam.updateProjectionMatrix();
  return () => {
    r.setPixelRatio(prevRatio);
    stage.exporting = false;
    stage.resize();
  };
}

export async function exportPNG(stage: Stage, t: number): Promise<Blob> {
  const end = beginOffscreen(stage);
  try {
    stage.evaluate(t);
    stage.updateHelpers();
    stage.render(true);
    const blob = await new Promise<Blob | null>((res) => stage.renderer.domElement.toBlob(res, 'image/png'));
    if (!blob) throw new Error('PNG 导出失败');
    return blob;
  } finally {
    end();
  }
}

export function pickMime(): string {
  const cands = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  for (const c of cands) if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
  return '';
}

/** Deterministic frame-by-frame recording of the director camera. */
export async function exportWebM(
  stage: Stage,
  duration: number,
  fps: number,
  onProgress: (p: number) => void,
): Promise<Blob> {
  if (typeof MediaRecorder === 'undefined') throw new Error('当前浏览器不支持 MediaRecorder，请用 Chrome / Edge');
  const mime = pickMime();
  const end = beginOffscreen(stage);
  const canvas = stage.renderer.domElement;
  try {
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
    const rec = new MediaRecorder(stream, {
      mimeType: mime || undefined,
      videoBitsPerSecond: Math.round(stage.outW * stage.outH * fps * 0.25),
    });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
    const total = Math.max(1, Math.round(duration * fps));
    // render the first frame before starting so the stream has content
    stage.evaluate(0);
    stage.updateHelpers();
    stage.render(true);
    rec.start();
    const frameMs = 1000 / fps;
    const t0 = performance.now();
    for (let i = 0; i <= total; i++) {
      stage.evaluate(Math.min(i / fps, duration));
      stage.updateHelpers();
      stage.render(true);
      track.requestFrame?.();
      onProgress(i / total);
      // keep real-time pacing so the recorded duration matches the timeline
      const target = t0 + (i + 1) * frameMs;
      await raf();
      const wait = target - performance.now();
      if (wait > 0) await sleep(wait);
    }
    rec.stop();
    await stopped;
    track.stop();
    return new Blob(chunks, { type: mime || 'video/webm' });
  } finally {
    end();
  }
}
