// tools/demo/extension-video/lib/capture.mjs — CDP screencast → ffmpeg (MP4, H.264) or, without ffmpeg, Playwright's
// own recordVideo (WebM). Frames carry their own timestamps, so idle stretches keep their real length. With ffmpeg the
// page is screencast at `scale`× device pixels and the virtual camera (lib/camera.mjs) crops it before the downscale.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cameraFilter, sendcmdScript } from './camera.mjs';

export function hasFfmpeg(bin = 'ffmpeg') { return spawnSync(bin, ['-version'], { stdio: 'ignore' }).status === 0; }

/** ffconcat text: each frame shown until the next frame's timestamp; the last one for `tailS` seconds. */
export function concatList(frames, tailS = 0.5) {
  const lines = ['ffconcat version 1.0'];
  frames.forEach((f, i) => {
    const next = frames[i + 1];
    lines.push(`file '${f.file}'`, `duration ${(next ? Math.max(next.t - f.t, 0.001) : tailS).toFixed(4)}`);
  });
  lines.push(`file '${frames.at(-1).file}'`);   // ffconcat needs the last file repeated for its duration to apply
  return `${lines.join('\n')}\n`;
}

/** How long the last frame stays up: until the screencast stopped (`endT`, epoch s), at least 0.5 s. The screencast
 *  sends no frame while nothing changes, so a fixed tail would cut a static outro card short. */
export function tailSeconds(frames, endT) { return Math.max(0.5, endT - frames.at(-1).t); }

/** `cameraCmds`: a sendcmd file from lib/camera.mjs; the virtual camera then crops each frame before the downscale. */
export function encodeArgs({ list, out, fps = 30, width, height, cameraCmds = null }) {
  const view = cameraCmds ? cameraFilter(cameraCmds, { width, height }) : `scale=${width}:${height}:flags=lanczos`;
  return ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
    '-vf', `fps=${fps},${view},format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart', out];
}

/** Size the real browser window so its content area is exactly `width`×`height`. Headless Chromium with an extension
 *  keeps ~139 px of hidden browser UI inside --window-size, and viewport emulation does not fix it: the screencast then
 *  crops the bottom and real input below that line is dropped. So: no emulated viewport, a measured window instead. */
export async function fitWindow(page, { width, height }) {
  const cdp = await page.context().newCDPSession(page);
  try {
    for (let i = 0; i < 3; i++) {
      const [w, h] = await page.evaluate(() => [innerWidth, innerHeight]);
      if (w === width && h === height) return;
      const { windowId, bounds } = await cdp.send('Browser.getWindowForTarget');
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: bounds.width + width - w, height: bounds.height + height - h } });
      await page.waitForTimeout(100);
    }
    const got = await page.evaluate(() => `${innerWidth}×${innerHeight}`);
    if (got !== `${width}×${height}`) throw new Error(`the browser window's content area is ${got}, not ${width}×${height}`);
  } finally { await cdp.detach().catch(() => {}); }
}

/** `scale`: device pixels per CSS pixel (the window runs with --force-device-scale-factor). */
export async function startScreencast(page, dir, { width, height }, scale = 1) {
  mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  let n = 0;
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    const file = join(dir, `f${String(n++).padStart(6, '0')}.jpg`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    frames.push({ file, t: metadata.timestamp });
    await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: width * scale, maxHeight: height * scale, everyNthFrame: 1 });
  let stopped = false;
  // endT: when recording ended (epoch s, like the frame timestamps), for tailSeconds.
  return { frames, endT: null, async stop() {   // idempotent: record.mjs also calls it from `finally`
    if (!stopped) { stopped = true; this.endT = Date.now() / 1000; await cdp.send('Page.stopScreencast').catch(() => {}); await cdp.detach().catch(() => {}); }
    return frames;
  } };
}

/** `camera`: { keys, scale } from the script's createCamera; its moves become one crop command per moving frame. */
export function encodeMp4(frames, { dir, out, width, height, fps = 30, camera = null, tailS = 0.5 }) {
  const list = join(dir, 'frames.ffconcat');
  writeFileSync(list, concatList(frames, tailS));
  let cameraCmds = null;
  if (camera?.keys.length) {
    cameraCmds = join(dir, 'camera.cmd');
    writeFileSync(cameraCmds, sendcmdScript(camera.keys, { t0: frames[0].t, durationS: frames.at(-1).t - frames[0].t + tailS, fps,
      frame: { width, height }, scale: camera.scale }));
  }
  const r = spawnSync('ffmpeg', encodeArgs({ list, out, fps, width, height, cameraCmds }), { stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0) throw new Error(`ffmpeg exited ${r.status}`);
  return out;
}

/** {durationS, width, height} via ffprobe, or null when ffprobe is missing. */
export function probe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const j = JSON.parse(r.stdout);
  return { durationS: Number(j.format?.duration), width: j.streams?.[0]?.width, height: j.streams?.[0]?.height };
}
