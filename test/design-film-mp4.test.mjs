// test/design-film-mp4.test.mjs — Design: a video exports as an MP4 (src/core/design/film-mp4.mjs). The capture page
// (the standalone film held still, under its own CSP, with the exporter's handle), the sound as one ffmpeg mix by the
// player's own rule, the render as a child process that reports its frames, and the per-design export jobs: one render
// at a time, the finished file kept for its round, a stop that leaves nothing behind.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { JSDOM, VirtualConsole } from 'jsdom';
import { useDesignEnv, waitUntil } from './helpers/design-fixture.mjs';
import { ExportRefusal } from '../src/core/design/export.mjs';
import {
  FILM_MP4, createFilmExports, filmCaptureDoc, filmMixArgs, filmWorkers, prepareFilmJob, renderFilmMp4,
} from '../src/core/design/film-mp4.mjs';
import { stageDesignKit } from '../src/core/design/kit.mjs';
import { designDir, designWorkDir } from '../src/core/design/paths.mjs';
import { captureCsp } from '../src/core/design/render.mjs';
import { clipKey, musicKey } from '../src/core/design/sound.mjs';
import { createDesign, updateDesign } from '../src/core/design/store.mjs';
import { silentWav } from '../src/core/sound.mjs';

useDesignEnv(after);
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const SHELL = '<!doctype html><html><head><meta charset="utf-8"><!--worca:head--></head><body><!--worca:sections--><!--worca:foot--></body></html>';
const SAY_A = 'Every pot starts as a lump of clay.';
const SAY_B = 'Come and make one.';
const scene = (id, duration, say) => ({ id, job: id, brief: 'b', parts: ['html', 'css', 'js'], duration, ...(say ? { say } : {}) });
const PLAN = { v: 1, kind: 'video', title: 'F', canvas: { w: 1920, h: 1080, fps: 60 }, notes: '', sections: [scene('a', 2, SAY_A), scene('b', 3, SAY_B)] };
const VOICE = { id: 'voice-test', name: 'Test', model: 'eleven_multilingual_v2' };
const clip = (id, text, seconds) => ({ id, file: `voice-${id}.wav`, key: clipKey({ voiceId: VOICE.id, model: VOICE.model, text }), at: 0.35, seconds, text, cues: [{ t: 0.35, text }] });
const MUSIC = { file: 'music.wav', key: musicKey({ prompt: 'warm piano', model: 'music_v2_5' }), seconds: 4, gain: 0.16, prompt: 'warm piano' };
const FILES = {
  'plan.json': JSON.stringify(PLAN), 'shell.html': SHELL,
  'sections/a/index.html': '<div data-section="a" data-scene><b>A</b></div>', 'sections/a/script.js': 'window.__a=S.dur;',
  'sections/b/index.html': '<div data-section="b" data-scene><b>B</b></div>',
};
const SOUND = {
  'assets/sound/sound.json': JSON.stringify({ v: 1, voice: VOICE, clips: [clip('a', SAY_A, 1.2), clip('b', SAY_B, 2)], music: MUSIC }),
  'assets/sound/voice-a.wav': silentWav(1.2), 'assets/sound/voice-b.wav': silentWav(2), 'assets/sound/music.wav': silentWav(4),
};
function put(work, files) {
  for (const [rel, body] of Object.entries(files)) { mkdirSync(dirname(join(work, rel)), { recursive: true }); writeFileSync(join(work, rel), body); }
}
/** A video's work folder outside any design: the kit staged, `files` written. */
async function world(files = FILES) {
  const d = mkdtempSync(join(tmpdir(), 'dfilm-mp4-')); dirs.push(d);
  const work = join(d, 'work'); mkdirSync(work);
  put(work, files);
  await stageDesignKit({ kind: 'video', workDir: work });
  return work;
}
/** A finished video design in the temp home, with (or without) its sound. */
async function seedFilm({ sound = true, title = 'Clay Day' } = {}) {
  const d = createDesign({ kind: 'video', title }, { by: 'local' });
  const work = designWorkDir(d.id);
  put(work, { ...FILES, ...(sound ? SOUND : {}) });
  await stageDesignKit({ kind: 'video', workDir: work });
  return updateDesign(d.id, { status: 'done' });
}

/* ---------- the capture page ---------- */

test('the capture page is the standalone film held still: its own CSP first, no sound, embedded, the handle last', async () => {
  const work = await world({ ...FILES, ...SOUND });
  const { html, problems } = filmCaptureDoc({ workDir: work, plan: PLAN });
  assert.deepEqual(problems, []);
  assert.equal(captureCsp(), "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'");
  assert.ok(html.startsWith(`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${captureCsp()}">`), html.slice(0, 200));
  assert.match(html, /"embedded":true/);
  assert.doesNotMatch(html, /<audio/, 'the sound is mixed apart: the capture page plays nothing');
  assert.match(html, /F\.scene\("a",function\(root,S\)\{\nwindow\.__a=S\.dur;/, 'the scenes\' own scripts run: they draw the frames');
  assert.ok(html.trimEnd().endsWith('</script>') && html.lastIndexOf('window.__film') > html.lastIndexOf('F.start();'), 'the handle comes after the film has started');
});

test('the capture page hands the exporter a ready film it can seek; a page with no film says so at once', async () => {
  const open = (html) => {
    const win = new JSDOM(html, { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
      beforeParse(w) { w.matchMedia = () => ({ matches: false }); } }).window;
    after(() => win.close());
    return win;
  };
  const win = open(filmCaptureDoc({ workDir: await world(), plan: PLAN }).html);
  await waitUntil(() => win.__film?.ready === true);
  assert.deepEqual([win.__film.dur, win.__film.fps, [...win.__film.violations]], [5, 60, []]);
  assert.equal(win.F.playing, false, 'nothing plays by itself');
  assert.equal(win.document.querySelector('[data-film-bar]'), null, 'no player bar in the frames');
  await win.__film.seek(2.5);
  assert.equal(win.F.t, 2.5);
  assert.equal(win.document.querySelector('[data-section="b"]').style.display, 'block');
  // No scene has a duration: there is no film to capture, and the exporter must not wait a minute to learn it.
  const none = open(filmCaptureDoc({ workDir: await world(), plan: { ...PLAN, sections: [] } }).html);
  assert.equal(JSON.stringify(none.__film), '{"ready":false}');
});

/* ---------- the sound mix ---------- */

test('the mix follows the player\'s rule: each clip at its start, the music looped under it at its gain with its fades', () => {
  const tracks = {
    clips: [{ id: 'open', file: 'voice-open.mp3', start: 0.35, seconds: 4.82 }, { id: 'close', file: 'voice-close.wav', start: 12.05, seconds: 2 }],
    music: { file: 'music.mp3', seconds: 14.7, gain: 0.16 },
  };
  const args = filmMixArgs({ tracks, dur: 20, dir: '/job/sound', out: '/job/mix.wav' });
  assert.deepEqual(args.filter((_, i) => args[i - 1] === '-i'), ['voice-open.mp3', 'voice-close.wav', 'music.mp3'].map((f) => join('/job/sound', f)));
  const graph = args[args.indexOf('-filter_complex') + 1];
  assert.match(graph, /\[0:a\][^;]*atrim=0:4\.82,[^;]*adelay=350:all=1\[c0\]/);
  assert.match(graph, /\[1:a\][^;]*atrim=0:2,[^;]*adelay=12050:all=1\[c1\]/);
  assert.match(graph, /\[2:a\][^;]*atrim=0:14\.7,[^;]*aloop=loop=-1:size=705600,[^;]*atrim=0:20,[^;]*volume=0\.16,afade=t=in:st=0:d=0\.5,afade=t=out:st=18\.5:d=1\.5\[m\]/);
  assert.match(graph, /\[c0\]\[c1\]\[m\]amix=inputs=3:normalize=0:[^;]*atrim=0:20\[out\]$/);
  assert.deepEqual(args.slice(args.indexOf('-map')), ['-map', '[out]', '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', '/job/mix.wav']);
});

test('the mix: nothing to play is no mix; a voice alone, music alone, and a clip past the film\'s end is left out', () => {
  const graphOf = (tracks, dur = 10) => { const a = filmMixArgs({ tracks, dur, dir: '/s', out: '/o.wav' }); return a && a[a.indexOf('-filter_complex') + 1]; };
  assert.equal(filmMixArgs({ tracks: null, dur: 10, dir: '/s', out: '/o.wav' }), null);
  assert.equal(graphOf({ clips: [], music: null }), null);
  assert.equal(graphOf({ clips: [{ id: 'late', file: 'voice-late.mp3', start: 10, seconds: 1 }], music: null }), null);
  const voice = graphOf({ clips: [{ id: 'a', file: 'voice-a.mp3', start: 0, seconds: 1 }, { id: 'late', file: 'voice-late.mp3', start: 11, seconds: 1 }], music: null });
  assert.match(voice, /^\[0:a\][^;]*adelay=0:all=1\[c0\];\[c0\]amix=inputs=1:/);
  assert.doesNotMatch(voice, /\[m\]|\[c1\]/);
  const music = graphOf({ clips: [], music: { file: 'music.wav', seconds: 3, gain: 0.5 } });
  assert.match(music, /^\[0:a\][^;]*volume=0\.5,[^;]*\[m\];\[m\]amix=inputs=1:/);
});

/* ---------- one job's folder ---------- */

test('a job folder holds what the render reads: the capture page, the sound\'s files, the mix and the settings', async () => {
  const d = await seedFilm();
  const dir = mkdtempSync(join(tmpdir(), 'dfilm-job-')); dirs.push(dir);
  const job = await prepareFilmJob({ design: d, dir });
  assert.match(job.key, /^[0-9a-f]{64}$/);
  assert.deepEqual([job.total, job.seconds, job.problems], [300, 5, []]);
  assert.deepEqual(readdirSync(dir).sort(), ['capture.html', 'job.json', 'sound']);
  assert.deepEqual(readdirSync(join(dir, 'sound')).sort(), ['music.wav', 'voice-a.wav', 'voice-b.wav']);
  assert.match(readFileSync(join(dir, 'capture.html'), 'utf8'), /window\.__film/);
  const written = JSON.parse(readFileSync(join(dir, 'job.json'), 'utf8'));
  assert.deepEqual({ ...written, mix: null }, { v: 1, html: join(dir, 'capture.html'), out: join(dir, 'film.mp4'), audio: join(dir, 'mix.wav'), mix: null, workers: filmWorkers(), ...FILM_MP4 });
  assert.equal(written.mix.at(-1), join(dir, 'mix.wav'));
  assert.ok(written.mix.includes(join(dir, 'sound', 'voice-a.wav')));
  // The same round is the same key; a changed scene, or changed sound, is another.
  const again = mkdtempSync(join(tmpdir(), 'dfilm-job-')); dirs.push(again);
  assert.equal((await prepareFilmJob({ design: d, dir: again })).key, job.key);
  writeFileSync(join(designWorkDir(d.id), 'assets/sound/voice-a.wav'), silentWav(1.1));
  rmSync(again, { recursive: true }); mkdirSync(again);
  assert.notEqual((await prepareFilmJob({ design: d, dir: again })).key, job.key);
});

test('a silent film\'s job has no mix and no sound folder', async () => {
  const d = await seedFilm({ sound: false });
  const dir = mkdtempSync(join(tmpdir(), 'dfilm-job-')); dirs.push(dir);
  await prepareFilmJob({ design: d, dir });
  const written = JSON.parse(readFileSync(join(dir, 'job.json'), 'utf8'));
  assert.deepEqual([written.mix, written.audio], [null, null]);
  assert.deepEqual(readdirSync(dir).sort(), ['capture.html', 'job.json']);
});

test('the render uses as many Chromes as the machine can hold: by its cores, by its memory, or as it is told', () => {
  const GiB = 1024 ** 3;
  assert.equal(filmWorkers({ cpus: 10, mem: 16 * GiB, env: {} }), 8, 'never more than 8');
  assert.equal(filmWorkers({ cpus: 8, mem: 8 * GiB, env: {} }), 5, 'one per 1.5 GiB of memory');
  assert.equal(filmWorkers({ cpus: 4, mem: 32 * GiB, env: {} }), 2, 'two cores stay free');
  assert.equal(filmWorkers({ cpus: 1, mem: 1 * GiB, env: {} }), 1, 'at least one');
  assert.equal(filmWorkers({ cpus: 10, mem: 16 * GiB, env: { WORCA_DESIGN_VIDEO_WORKERS: '3' } }), 3);
  assert.equal(filmWorkers({ cpus: 2, mem: 2 * GiB, env: { WORCA_DESIGN_VIDEO_WORKERS: '12' } }), 12, 'the setting is the person\'s call');
  for (const bad of ['0', '-1', '2.5', 'x', '']) assert.equal(filmWorkers({ cpus: 10, mem: 16 * GiB, env: { WORCA_DESIGN_VIDEO_WORKERS: bad } }), 8, JSON.stringify(bad));
});

/* ---------- the render: a child process that reports its frames ---------- */

/** A child as `spawn` hands it back: `out(line)` writes to its stdout, `exit(code)` closes it. */
function fakeChild() {
  const child = new EventEmitter();
  Object.assign(child, { pid: 4242, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null });
  child.stdinEnded = false;
  child.stdin.on('finish', () => { child.stdinEnded = true; });
  child.out = (text) => child.stdout.write(text);
  child.exit = (code) => { child.exitCode = code; child.stdout.end(); child.stderr.end(); setImmediate(() => child.emit('close', code, null)); };
  return child;
}
function fakeSpawn() {
  const spawned = [];
  const spawnImpl = (cmd, args, opts) => { const child = fakeChild(); spawned.push({ cmd, args, opts, child }); return child; };
  return { spawnImpl, spawned };
}

test('the render runs the CLI as a child, reads its frames line by line and answers what it made', async () => {
  const { spawnImpl, spawned } = fakeSpawn();
  const seen = [];
  const env = { PATH: '/usr/bin', HOME: '/home/w', TMPDIR: '/big/tmp', CHROME_NO_SANDBOX: '1', WORCA_HOME: '/data', ELEVENLABS_API_KEY: 'k', ANTHROPIC_API_KEY: 'k' };
  const run = renderFilmMp4({ dir: '/job', chrome: '/bin/chrome', ffmpeg: '/bin/ffmpeg', onProgress: (p) => seen.push(p), spawnImpl, env });
  const { cmd, args, opts, child } = spawned[0];
  assert.deepEqual(opts.env, { PATH: '/usr/bin', HOME: '/home/w', TMPDIR: '/big/tmp', CHROME_NO_SANDBOX: '1' }, 'no key and no worca setting reaches the child');
  assert.equal(cmd, process.execPath);
  assert.match(args[0], /src[\\/]core[\\/]design[\\/]film-mp4-cli\.mjs$/);
  assert.deepEqual(args.slice(1), [join('/job', 'job.json'), '/bin/chrome', '/bin/ffmpeg']);
  assert.deepEqual(opts.stdio, ['pipe', 'pipe', 'pipe']);
  // A line can arrive in pieces, and two in one piece.
  child.out('{"type":"progress","done":10,"to');
  child.out('tal":300}\n{"type":"progress","done":200,"total":300}\n');
  child.out('{"type":"done","frames":300,"seconds":5,"bytes":1234,"violations":["scene a build failed"]}\n');
  child.exit(0);
  assert.deepEqual(await run, { frames: 300, seconds: 5, bytes: 1234, violations: ['scene a build failed'] });
  assert.deepEqual(seen, [{ done: 10, total: 300 }, { done: 200, total: 300 }]);
});

test('the render fails with the child\'s own words, or its last stderr line, and never succeeds without a done line', async () => {
  const fail = async (drive) => {
    const { spawnImpl, spawned } = fakeSpawn();
    const run = renderFilmMp4({ dir: '/job', chrome: 'c', ffmpeg: 'f', spawnImpl });
    drive(spawned[0].child);
    return run.then(() => assert.fail('resolved'), (e) => e);
  };
  assert.equal((await fail((c) => { c.out('{"type":"error","message":"film did not become ready"}\n'); c.exit(1); })).message, 'film did not become ready');
  assert.equal((await fail((c) => { c.stderr.write('first\nlast words\n'); c.exit(1); })).message, 'last words');
  assert.equal((await fail((c) => { c.exit(3); })).message, 'exit 3');
  assert.equal((await fail((c) => { c.out('{"type":"progress","done":300,"total":300}\n'); c.exit(0); })).message, 'the render ended without a video');
  const { spawned, spawnImpl } = fakeSpawn();
  const gone = renderFilmMp4({ dir: '/job', chrome: 'c', ffmpeg: 'f', spawnImpl });
  spawned[0].child.emit('error', new Error('spawn ENOENT'));
  await assert.rejects(gone, /spawn ENOENT/);
});

test('a stop closes the child\'s stdin (its own stop), kills its tree if it lingers, and is an AbortError', async () => {
  const { spawnImpl, spawned } = fakeSpawn();
  const ac = new AbortController();
  const killed = [];
  const run = renderFilmMp4({ dir: '/job', chrome: 'c', ffmpeg: 'f', signal: ac.signal, spawnImpl, graceMs: 150, kill: (child, sig) => { killed.push(sig); child.exit(null); } });
  const { child } = spawned[0];
  ac.abort();
  await waitUntil(() => child.stdinEnded);
  assert.deepEqual(killed, [], 'the child gets its grace to close its browsers');
  await assert.rejects(run, { name: 'AbortError' });
  assert.deepEqual(killed, ['SIGKILL']);
  // A child that ends by itself inside the grace is never killed.
  const second = fakeSpawn(); const ac2 = new AbortController(); const killed2 = [];
  const run2 = renderFilmMp4({ dir: '/job', chrome: 'c', ffmpeg: 'f', signal: ac2.signal, spawnImpl: second.spawnImpl, graceMs: 5000, kill: (c, s) => killed2.push(s) });
  ac2.abort(); second.spawned[0].child.exit(130);
  await assert.rejects(run2, { name: 'AbortError' });
  assert.deepEqual(killed2, []);
});

test('a render that says nothing for too long is killed and fails', async () => {
  const { spawnImpl, spawned } = fakeSpawn();
  const killed = [];
  const run = renderFilmMp4({ dir: '/job', chrome: 'c', ffmpeg: 'f', spawnImpl, stallMs: 30, kill: (child, sig) => { killed.push(sig); child.exit(null); } });
  spawned[0].child.out('{"type":"progress","done":1,"total":300}\n');
  await assert.rejects(run, /stopped making progress/);
  assert.deepEqual(killed, ['SIGKILL']);
});

/* ---------- the export jobs ---------- */

/** A render the test drives: each call waits for `finish()` (which writes the job's film.mp4) or `fail(err)`. */
function fakeRender() {
  const calls = [];
  const render = ({ dir, chrome, ffmpeg, signal, onProgress }) => new Promise((resolve, reject) => {
    const call = {
      dir, chrome, ffmpeg, signal, onProgress,
      finish(bytes = 'MP4 BYTES') { writeFileSync(join(dir, 'film.mp4'), bytes); resolve({ frames: 300, seconds: 5, bytes: Buffer.byteLength(bytes), violations: [] }); },
      fail: reject,
    };
    signal.addEventListener('abort', () => { const e = new Error('stopped'); e.name = 'AbortError'; reject(e); }, { once: true });
    calls.push(call);
  });
  return { render, calls };
}
const films = (over = {}) => {
  const r = fakeRender();
  return { ...r, exports: createFilmExports({ render: r.render, chrome: () => '/bin/chrome', ffmpeg: () => '/bin/ffmpeg', ...over }) };
};
const exportDir = (d) => join(designDir(d.id), 'export');

test('a video renders once: progress while it runs, then the file is kept for its round and handed out by its key', async () => {
  const d = await seedFilm();
  const { exports, calls } = films();
  const started = await exports.start(d);
  assert.deepEqual({ ...started, key: 'k' }, { state: 'rendering', done: 0, total: 300, key: 'k' });
  assert.deepEqual(exports.status(d.id), started);
  assert.deepEqual([calls.length, calls[0].chrome, calls[0].ffmpeg], [1, '/bin/chrome', '/bin/ffmpeg']);
  calls[0].onProgress({ done: 120, total: 300 });
  assert.deepEqual(exports.status(d.id), { ...started, done: 120 });
  assert.deepEqual(await exports.start(d), { ...started, done: 120 }, 'a second click joins the render that runs');
  assert.equal(exports.file(d, started.key), null, 'nothing to hand out yet');
  calls[0].finish();
  await waitUntil(() => exports.status(d.id).state === 'ready');
  assert.deepEqual(exports.status(d.id), { state: 'ready', key: started.key, bytes: 9, frames: 300, seconds: 5, problems: { total: 0, shown: [] } });
  assert.deepEqual(readdirSync(exportDir(d)).sort(), ['film.json', 'film.mp4'], 'the job folder is gone');
  const file = exports.file(d, started.key);
  assert.deepEqual([file.name, file.bytes, readFileSync(file.path, 'utf8')], ['clay-day.mp4', 9, 'MP4 BYTES']);
  assert.equal(exports.file(d, 'f'.repeat(64)), null, 'only by the key of the round it shows');
  assert.equal(exports.file(d, undefined), null);
  // The same round again, even from another server run: ready at once, nothing rendered.
  const later = films();
  assert.deepEqual(await later.exports.start(d), { state: 'ready', key: started.key, bytes: 9, frames: 300, seconds: 5, problems: { total: 0, shown: [] } });
  assert.equal(later.calls.length, 0);
  assert.equal(calls.length, 1);
});

test('a new round renders again, and the old round\'s key no longer opens the file', async () => {
  const d = await seedFilm();
  const { exports, calls } = films();
  const first = await exports.start(d);
  calls[0].finish('OLD');
  await waitUntil(() => exports.status(d.id).state === 'ready');
  writeFileSync(join(designWorkDir(d.id), 'sections/a/index.html'), '<div data-section="a" data-scene><b>A2</b></div>');
  const second = await exports.start(d);
  assert.equal(second.state, 'rendering');
  assert.notEqual(second.key, first.key);
  calls[1].finish('NEW FILM');
  await waitUntil(() => exports.status(d.id).state === 'ready');
  assert.equal(exports.file(d, first.key), null);
  assert.equal(readFileSync(exports.file(d, second.key).path, 'utf8'), 'NEW FILM');
});

test('a round that changes while its video renders starts over for the new round', async () => {
  const d = await seedFilm();
  const { exports, calls } = films();
  const first = await exports.start(d);
  writeFileSync(join(designWorkDir(d.id), 'sections/a/index.html'), '<div data-section="a" data-scene><b>A2</b></div>');
  const second = await exports.start(d);
  assert.notEqual(second.key, first.key);
  assert.equal(calls[0].signal.aborted, true, 'the old round\'s render is stopped');
  await waitUntil(() => calls.length === 2);
  calls[1].finish();
  await waitUntil(() => exports.status(d.id).state === 'ready');
  assert.equal(exports.status(d.id).key, second.key);
});

test('stop: the render is aborted, nothing is kept, and the next start renders from the beginning', async () => {
  const d = await seedFilm();
  const { exports, calls } = films();
  await exports.start(d);
  calls[0].onProgress({ done: 50, total: 300 });
  exports.stop(d.id);
  assert.equal(calls[0].signal.aborted, true);
  assert.deepEqual(exports.status(d.id), { state: 'none' });
  await exports.idle();
  assert.deepEqual(readdirSync(exportDir(d)), [], 'no job folder, no film');
  assert.deepEqual({ ...(await exports.start(d)), key: 'k' }, { state: 'rendering', done: 0, total: 300, key: 'k' });
  assert.equal(calls.length, 2);
});

test('a render that fails says so in words; its details stay in the log, and Try again renders anew', async (t) => {
  const d = await seedFilm();
  const { exports, calls } = films();
  const logged = t.mock.method(console, 'error', () => {});
  await exports.start(d);
  calls[0].fail(new Error('ffmpeg worker 2: /Users/someone/secret/path exploded'));
  await waitUntil(() => exports.status(d.id).state === 'failed');
  assert.deepEqual(exports.status(d.id), { state: 'failed', error: 'Could not make the video.' });
  assert.match(String(logged.mock.calls[0].arguments[0]), /secret\/path exploded/);
  assert.deepEqual(readdirSync(exportDir(d)), []);
  assert.equal((await exports.start(d)).state, 'rendering');
  assert.equal(calls.length, 2);
});

test('one render at a time: the next video waits its turn, and a stop while it waits never renders it', async () => {
  const [one, two, three] = [await seedFilm({ title: 'One' }), await seedFilm({ title: 'Two' }), await seedFilm({ title: 'Three' })];
  const { exports, calls } = films();
  assert.equal((await exports.start(one)).state, 'rendering');
  assert.equal((await exports.start(two)).state, 'queued');
  assert.equal((await exports.start(three)).state, 'queued');
  assert.equal(calls.length, 1);
  exports.stop(two.id);
  calls[0].finish();
  await waitUntil(() => exports.status(three.id).state === 'rendering');
  assert.deepEqual(exports.status(two.id), { state: 'none' });
  assert.equal(calls.length, 2, 'the stopped one never rendered');
  calls[1].finish();
  await waitUntil(() => exports.status(three.id).state === 'ready');
});

test('no Chrome or no ffmpeg is a refusal with words, before anything is written', async () => {
  const d = await seedFilm();
  const noChrome = films({ chrome: () => null });
  await assert.rejects(noChrome.exports.start(d), (e) => e instanceof ExportRefusal && e.status === 422 && e.code === 'no-chrome'
    && e.message === 'Video needs Chrome or Edge on this machine. Install one, or set WORCA_CHROME.');
  const noFfmpeg = films({ ffmpeg: () => null });
  await assert.rejects(noFfmpeg.exports.start(d), (e) => e instanceof ExportRefusal && e.status === 422 && e.code === 'no-ffmpeg'
    && /^Video needs ffmpeg on this machine\. .*WORCA_FFMPEG/.test(e.message));
  assert.equal(existsSync(exportDir(d)), false);
  assert.equal(noChrome.calls.length + noFfmpeg.calls.length, 0);
});

test('forget stops a design\'s render and waits until its folder is free', async () => {
  const d = await seedFilm();
  const { exports, calls } = films();
  await exports.start(d);
  await exports.forget(d.id);
  assert.equal(calls[0].signal.aborted, true);
  assert.deepEqual(exports.status(d.id), { state: 'none' });
  assert.deepEqual(readdirSync(exportDir(d)), []);
});

test('two starts at once for one video are one render, and neither clears the other\'s folder', async () => {
  const d = await seedFilm();
  const { exports, calls } = films();
  const [a, b] = await Promise.all([exports.start(d), exports.start(d)]);
  assert.deepEqual([a.state, b.state, a.key === b.key, calls.length], ['rendering', 'rendering', true, 1]);
  assert.deepEqual(readdirSync(calls[0].dir).sort(), ['capture.html', 'job.json', 'sound'], 'the render\'s folder is whole');
  assert.deepEqual(readdirSync(exportDir(d)).length, 1, 'the start that joined left no folder');
  calls[0].finish();
  await waitUntil(() => exports.status(d.id).state === 'ready');
});

test('a stop that comes while a start is still getting ready wins: nothing renders', async () => {
  const d = await seedFilm();
  const { exports, calls } = films();
  const starting = exports.start(d);
  exports.stop(d.id);
  assert.deepEqual(await starting, { state: 'none' });
  assert.deepEqual([calls.length, exports.status(d.id), readdirSync(exportDir(d))], [0, { state: 'none' }, []]);
  assert.equal((await exports.start(d)).state, 'rendering', 'the next start is its own');
});

test('a job folder a dead server left behind is cleared by the next start', async () => {
  const d = await seedFilm();
  mkdirSync(join(exportDir(d), 'job-deadbeef'), { recursive: true });
  writeFileSync(join(exportDir(d), 'job-deadbeef', 'capture.html'), 'old');
  const { exports, calls } = films();
  await exports.start(d);
  assert.equal(existsSync(join(exportDir(d), 'job-deadbeef')), false);
  calls[0].finish();
  await waitUntil(() => exports.status(d.id).state === 'ready');
});
