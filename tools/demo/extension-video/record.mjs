#!/usr/bin/env node
// tools/demo/extension-video/record.mjs — record the Worca browser extension demo video (README.md here).
//   npm run demo:extension-video                    # → tools/demo/extension-video/out/worca-extension-demo-<stamp>.mp4
//   npm run demo:extension-video -- --size 1600x900 --keep --headed --webm --out <dir>
import { chromium } from '@playwright/test';
import { mkdtempSync, mkdirSync, renameSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildOne } from '../../build-extension.mjs';
import { parseArgs, outputName } from './lib/args.mjs';
import { freePort } from './lib/ports.mjs';
import { startHost } from './lib/start-host.mjs';
import { pairExtension } from './lib/pairing.mjs';
import { installStage, mountSidebar, slideSidebarIn } from './lib/stage.mjs';
import { createHuman } from './lib/human.mjs';
import { fitWindow, hasFfmpeg, startScreencast, encodeMp4, probe, tailSeconds } from './lib/capture.mjs';
import { createCamera } from './lib/camera.mjs';
import * as script from './lib/script.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
/** MP4: the page renders at 2× device pixels, so the camera's zoomed crops downscale to the output instead of upscaling. */
const CAPTURE_SCALE = 2;

export async function main(argv = process.argv.slice(2)) {
  const o = parseArgs(argv);
  const log = (m) => console.log(`[demo] ${m}`);
  const work = mkdtempSync(join(tmpdir(), 'worca-demo-video-'));
  const outDir = o.outDir || join(HERE, 'out');
  mkdirSync(outDir, { recursive: true });
  const mp4 = !o.webm && hasFfmpeg();
  if (!o.webm && !mp4) log('ffmpeg not found: recording WebM with Playwright instead (install ffmpeg for the MP4)');
  const scale = mp4 ? CAPTURE_SCALE : 1;
  let host = null; let ctx = null; let rec = null;
  try {
    const port = await freePort();
    log(`demo Worca on 127.0.0.1:${port} (home ${join(work, 'home')})`);
    mkdirSync(join(work, 'home'), { recursive: true });
    // WORCA_EXT_BASE_URL '' on purpose: a tester's own value must not override the demo port.
    const { out: extDir } = await buildOne('chrome', { demo: true, dist: join(work, 'ext'), env: { ...process.env, WORCA_EXT_PORT: String(port), WORCA_EXT_BASE_URL: '' } });
    host = await startHost({ home: join(work, 'home'), port, scenario: join(HERE, 'scenario.json'), log });
    log(`sample app on ${host.appUrl}`);
    if (!host.actionStarted) log('WARN the Dev server Action did not start: the scope will be pinned by hand');
    ctx = await chromium.launchPersistentContext(join(work, 'profile'), {
      // viewport null + fitWindow: an emulated viewport is NOT what the window shows (see fitWindow). The device scale
      // factor changes only device pixels: innerWidth/innerHeight and every input coordinate stay in CSS px.
      channel: 'chromium', headless: !o.headed, viewport: null, colorScheme: 'light',
      args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--hide-scrollbars', `--window-size=${o.size.width},${o.size.height}`,
        `--force-device-scale-factor=${scale}`],
      ...(mp4 ? {} : { recordVideo: { dir: join(work, 'webm'), size: o.size } }),
    });
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
    const extensionId = new URL(sw.url()).host;
    const build = await sw.evaluate(() => globalThis.__worcaTest?.build);
    if (build !== 'worca-demo-build') throw new Error(`the loaded extension is not the demo build (${build ?? 'no test hooks'})`);
    const token = await pairExtension(host.url, extensionId);
    await sw.evaluate(async (t) => { await chrome.storage.local.clear(); await chrome.storage.local.set({ 'worca.token': t }); }, token);
    const page = ctx.pages()[0] || await ctx.newPage();
    await fitWindow(page, o.size);
    await page.goto(host.appUrl);
    await page.evaluate(() => document.fonts.ready);
    const stage = await installStage(page);
    await stage.card(script.INTRO);                                   // title card first: the video opens on it
    rec = mp4 ? await startScreencast(page, join(work, 'frames'), o.size, scale) : null;
    const tab = await sw.evaluate(async (url) => (await chrome.tabs.query({ url })).map((t) => ({ id: t.id, windowId: t.windowId }))[0], page.url());
    if (!tab) throw new Error(`the extension cannot see the app tab (${page.url()}): is http://localhost/* in the demo manifest?`);
    const side = await mountSidebar(page, { extensionId, tabId: tab.id, windowId: tab.windowId });
    const command = (name) => sw.evaluate(([n, id]) => chrome.tabs.get(id).then((t) => globalThis.__worcaTest.command(n, t)), [name, tab.id]);
    const setCapture = async () => {
      await stage.hidden(true);
      const png = (await page.screenshot()).toString('base64');
      await stage.hidden(false);
      await sw.evaluate((b) => globalThis.__worcaTest.setCaptureSource(async () => `data:image/png;base64,${b}`), png);
    };
    const human = createHuman(page, stage);
    // The WebM fallback has no post step, so it records without the camera (the whole stage throughout).
    const camera = createCamera(stage, { frame: o.size, enabled: mp4 });
    const env = { page, side, stage: { ...stage, slideSidebarIn: () => slideSidebarIn(page) }, human, command, setCapture, host, camera };
    await script.run(env);
    const outFile = join(outDir, outputName(new Date(), mp4 ? 'mp4' : 'webm'));
    if (mp4) {
      const frames = await rec.stop();
      log(`encoding ${frames.length} frames (${camera.keys.length} camera moves)`);
      encodeMp4(frames, { dir: join(work, 'frames'), out: outFile, width: o.size.width, height: o.size.height, camera: { keys: camera.keys, scale },
        tailS: tailSeconds(frames, rec.endT) });
    } else {
      const v = page.video();
      await ctx.close(); ctx = null;
      renameSync(await v.path(), outFile);
    }
    const p = probe(outFile);
    console.log(`\nDemo video: ${outFile}${p ? `\n  ${p.width}×${p.height}, ${p.durationS.toFixed(1)} s` : ''}`);
    return outFile;
  } finally {
    if (rec) await rec.stop().catch(() => {});   // an aborted run must not leave the screencast writing frames
    if (ctx) await ctx.close().catch(() => {});
    if (host) await host.stop().catch(() => {});
    if (!o.keep) rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); else log(`kept ${work}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((err) => { console.error(`demo:extension-video: ${err.stack || err.message}`); process.exit(1); });
}
