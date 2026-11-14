// test/design-film-mp4-real.test.mjs — Design: a video's MP4 export, for real (src/core/design/film-capture.mjs and
// film-mp4-cli.mjs). A small film goes through the real child process, real Chromes and ffmpeg and comes out as an
// H.264 MP4 with every frame and its sound; a stop ends the child; and the Chrome that runs the film's own scripts is
// held to its one page: no file, no host, no other page. Skipped with a reason on a host with no Chrome or no ffmpeg.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { useDesignEnv } from './helpers/design-fixture.mjs';
import { readMP4 } from '../assets/promo-kit/tools/analyze.mjs';
import { launch } from '../assets/promo-kit/tools/cdp.mjs';
import { findFfmpeg } from '../assets/promo-kit/tools/find-tools.mjs';
import { CAPTURE_CHROME, guardCapture } from '../src/core/design/film-capture.mjs';
import { prepareFilmJob, renderFilmMp4 } from '../src/core/design/film-mp4.mjs';
import { stageDesignKit } from '../src/core/design/kit.mjs';
import { designWorkDir } from '../src/core/design/paths.mjs';
import { captureDoc, designChrome } from '../src/core/design/render.mjs';
import { clipKey, musicKey } from '../src/core/design/sound.mjs';
import { createDesign, updateDesign } from '../src/core/design/store.mjs';
import { silentWav } from '../src/core/sound.mjs';

useDesignEnv(after);
const CHROME = designChrome();
const FFMPEG = findFfmpeg();
const skip = (!CHROME && 'no Chrome-family browser on this host (set WORCA_CHROME)') || (!FFMPEG && 'no ffmpeg on this host (set WORCA_FFMPEG)') || false;
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 3 }); });
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d; };

/* ---------- the Chrome that runs a film's own scripts is held to its one page ---------- */

/** A page that tries every way out and writes down what came of each (`window.R`), under `captureDoc` or bare. */
function escapePage({ secretUrl, otherUrl, port }) {
  return `<!doctype html><html><head></head><body><script>
window.R = {};
const t = (name, p) => p.then((v) => { R[name] = 'GOT ' + String(v).slice(0, 40); }, () => { R[name] = 'blocked'; });
t('fetchFile', fetch(${JSON.stringify(secretUrl)}).then((r) => r.text()));
t('fetchLoopback', fetch('http://127.0.0.1:${port}/fetch').then((r) => r.text()));
t('imgLoopback', new Promise((ok, no) => { const i = new Image(); i.onload = () => ok('loaded'); i.onerror = no; i.src = 'http://127.0.0.1:${port}/img'; }));
const f = document.createElement('iframe'); f.src = ${JSON.stringify(otherUrl)}; document.body.appendChild(f);
</script></body></html>`;
}

test('the capture Chrome reads no file, reaches no host and never leaves its page', { skip: CHROME ? false : skip }, async () => {
  const dir = tmp('dfilm-guard-');
  writeFileSync(join(dir, 'secret.txt'), 'TOP-SECRET-FILE');
  writeFileSync(join(dir, 'other.html'), '<body>OTHER-PAGE</body>');
  const hits = [];
  const server = createServer((req, res) => { hits.push(req.url); res.end('LOOPBACK-SECRET'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  after(() => server.close());
  const urls = { secretUrl: pathToFileURL(join(dir, 'secret.txt')).href, otherUrl: pathToFileURL(join(dir, 'other.html')).href, port: server.address().port };
  // Bare first: the Chrome alone must hold a page that carries no CSP at all. Then as the capture page is.
  const pages = [['bare', escapePage(urls)], ['capture', captureDoc(escapePage(urls), { script: 'window.__film={ready:false};' })]];
  // The last way out is to leave: for another file, for a host, or by loading itself again.
  for (const [name, html] of pages) {
    const file = join(dir, `${name}.html`);
    writeFileSync(file, html);
    for (const to of [urls.otherUrl, `http://127.0.0.1:${urls.port}/nav`, `${pathToFileURL(file).href}?again=1`]) {
      const b = await launch({ ...CAPTURE_CHROME, chrome: CHROME });
      try {
        const guard = await guardCapture(b, file);
        await b.goto(`${pathToFileURL(file).href}?export=1`);
        await b.evaluate('new Promise((r) => setTimeout(r, 900))');
        assert.deepEqual(await b.evaluate('window.R'), { fetchFile: 'blocked', fetchLoopback: 'blocked', imgLoopback: 'blocked' }, name);
        // A frame fires `load` whether or not its page came, so the frames are asked what they hold: never the file.
        const { frameTree } = await b.page('Page.getFrameTree');
        const frames = [frameTree.frame, ...(frameTree.childFrames ?? []).map((c) => c.frame)].map((fr) => fr.url);
        assert.equal(frames.includes(urls.otherUrl), false, `${name}: ${frames}`);
        assert.equal(guard.left, false, `${name}: a refused fetch or frame is not leaving`);
        // Leaving: refused, and that is the end of this browser. What it would have shown is never read.
        await b.evaluate(`void (location.href = ${JSON.stringify(to)})`).catch(() => {});
        await assert.rejects((async () => { for (let i = 0; i < 100; i++) { await b.evaluate('1'); await new Promise((r) => setTimeout(r, 50)); } })(), /closed/, `${name} -> ${to}`);
        assert.equal(guard.left, true, `${name} -> ${to}`);
      } finally { await b.close(); }
    }
  }
  assert.deepEqual(hits, [], 'nothing reached the loopback server');
});

/* ---------- a real render ---------- */

const SHELL = '<!doctype html><html><head><meta charset="utf-8"><!--worca:head--></head><body><!--worca:sections--><!--worca:foot--></body></html>';
const SAY = 'Every pot starts as a lump of clay.';
const scene = (id, duration, say) => ({ id, job: id, brief: 'b', parts: ['html', 'css', 'js'], duration, ...(say ? { say } : {}) });
const PLAN = { v: 1, kind: 'video', title: 'F', canvas: { w: 1920, h: 1080, fps: 60 }, notes: '', sections: [scene('a', 0.5, SAY), scene('b', 0.5)] };
const VOICE = { id: 'voice-test', name: 'Test', model: 'eleven_multilingual_v2' };

/** A finished one-second video with a voice clip and music; `scripts` are its scenes' own script.js. */
async function seedFilm(scripts = {}) {
  const d = createDesign({ kind: 'video', title: 'Clay Day' }, { by: 'local' });
  const work = designWorkDir(d.id);
  const files = {
    'plan.json': JSON.stringify(PLAN), 'shell.html': SHELL,
    'sections/a/index.html': '<div data-section="a" data-scene style="background:#fff"><b style="position:absolute;left:0;top:400px;width:200px;height:200px;background:#5B56C9"></b></div>',
    'sections/a/script.js': scripts.a ?? "S.tl.fromTo(root.querySelector('b'), { x: 0 }, { x: 1500, duration: 0.45, ease: 'none' }, 0);",
    'sections/b/index.html': '<div data-section="b" data-scene style="background:#0b0d12"><b style="color:#fff;font:120px sans-serif">B</b></div>',
    ...(scripts.b ? { 'sections/b/script.js': scripts.b } : {}),
    'assets/sound/sound.json': JSON.stringify({
      v: 1, voice: VOICE,
      clips: [{ id: 'a', file: 'voice-a.wav', key: clipKey({ voiceId: VOICE.id, model: VOICE.model, text: SAY }), at: 0.05, seconds: 0.3, text: SAY, cues: [{ t: 0.05, text: SAY }] }],
      music: { file: 'music.wav', key: musicKey({ prompt: 'warm piano', model: 'music_v2_5' }), seconds: 0.4, gain: 0.16, prompt: 'warm piano' },
    }),
    'assets/sound/voice-a.wav': silentWav(0.3), 'assets/sound/music.wav': silentWav(0.4),
  };
  for (const [rel, body] of Object.entries(files)) { mkdirSync(dirname(join(work, rel)), { recursive: true }); writeFileSync(join(work, rel), body); }
  await stageDesignKit({ kind: 'video', workDir: work });
  return updateDesign(d.id, { status: 'done' });
}

test('a video renders to an H.264 MP4 with every frame and its sound, through the real child process', { skip }, async () => {
  const d = await seedFilm();
  const dir = tmp('dfilm-real-');
  const job = await prepareFilmJob({ design: d, dir });
  assert.equal(job.total, 60);
  const seen = [];
  const made = await renderFilmMp4({ dir, chrome: CHROME, ffmpeg: FFMPEG, onProgress: (p) => seen.push(p) });
  assert.deepEqual([made.frames, made.violations], [60, []]);
  assert.ok(Math.abs(made.seconds - 1) < 0.02, `seconds ${made.seconds}`);
  const m = readMP4(join(dir, 'film.mp4'));
  assert.deepEqual([m.samples, m.width, m.height, Math.round(m.fps)], [60, 1920, 1080, 60]);
  const probe = spawnSync(FFMPEG, ['-hide_banner', '-i', join(dir, 'film.mp4')], { encoding: 'utf8' }).stderr;
  assert.match(probe, /Video: h264/);
  assert.match(probe, /Audio: aac/);
  assert.ok(seen.length >= 1 && seen.at(-1).done === 60 && seen.at(-1).total === 60, JSON.stringify(seen.at(-1)));
  assert.equal(existsSync(join(dir, 'mix.wav')), true, 'the sound was mixed from the round\'s files');
});

test('a film whose own script tries to leave its page fails with that reason, at once', { skip }, async () => {
  const other = join(tmp('dfilm-other-'), 'other.html');
  writeFileSync(other, '<body>OTHER-PAGE</body>');
  // As the film starts (the page still loading), and from a frame in the middle of the film.
  const leave = `location.href = ${JSON.stringify(pathToFileURL(other).href)};`;
  for (const script of [leave, `S.tl.call(function () { ${leave} }, null, 0.2);`]) {
    const d = await seedFilm({ b: script });
    const dir = tmp('dfilm-leave-');
    await prepareFilmJob({ design: d, dir });
    const t0 = Date.now();
    await assert.rejects(renderFilmMp4({ dir, chrome: CHROME, ffmpeg: FFMPEG }), /the film tried to open another page/, script);
    assert.ok(Date.now() - t0 < 30000, `failed fast: ${Date.now() - t0} ms`);
    assert.equal(existsSync(join(dir, 'film.mp4')), false);
  }
});

test('a stop ends the real child and leaves no video', { skip }, async () => {
  const d = await seedFilm();
  const dir = tmp('dfilm-stop-');
  await prepareFilmJob({ design: d, dir });
  const ac = new AbortController();
  const run = renderFilmMp4({ dir, chrome: CHROME, ffmpeg: FFMPEG, signal: ac.signal, onProgress: () => ac.abort() });
  await assert.rejects(run, { name: 'AbortError' });
  assert.equal(existsSync(join(dir, 'film.mp4')), false);
});

test('a film that cannot start fails with the reason, not a hang', { skip }, async () => {
  const d = await seedFilm();
  rmSync(join(designWorkDir(d.id), '.kit', 'film.js'));
  writeFileSync(join(designWorkDir(d.id), '.kit', 'film.js'), '/* no film */');
  const dir = tmp('dfilm-broken-');
  await prepareFilmJob({ design: d, dir });
  await assert.rejects(renderFilmMp4({ dir, chrome: CHROME, ffmpeg: FFMPEG }), /film did not become ready/);
});
