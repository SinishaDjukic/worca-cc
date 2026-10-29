// test/promo-kit-tools.test.mjs
// The promo kit's render + review tools: cue thinning, captions, the audio mix (voice-level gate), the
// MP4 export, cue dumps, fluency checks and Chrome-rendered contact sheets. Cases that need Chrome or ffmpeg
// skip with a reason when the host has neither (they run on a dev Mac and on CI with ffmpeg-static).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { thinCues } from '../assets/promo-kit/tools/thin-cues.mjs';
import { buildSrt } from '../assets/promo-kit/tools/srt.mjs';
import { mixAudio } from '../assets/promo-kit/tools/mix.mjs';
import { exportFilm } from '../assets/promo-kit/tools/export.mjs';
import { dumpCues } from '../assets/promo-kit/tools/snap.mjs';
import { checkFluency } from '../assets/promo-kit/tools/fluency.mjs';
import { contactSheet } from '../assets/promo-kit/tools/sheet.mjs';
import { SFX_NAMES, LOOPED_SFX } from '../assets/promo-kit/tools/sfx.mjs';
import { readMP4, encodePNG } from '../assets/promo-kit/tools/analyze.mjs';
import { findChrome, findFfmpeg } from '../assets/promo-kit/tools/find-tools.mjs';
import { initFilm } from '../assets/promo-kit/tools/init-film.mjs';
import { buildData } from '../assets/promo-kit/tools/build-data.mjs';

const CHROME = findChrome();
const FFMPEG = findFfmpeg();
const noChrome = CHROME ? false : 'no Chrome-family browser on this host (set WORCA_CHROME)';
const noFfmpeg = FFMPEG ? false : 'no ffmpeg on this host (ffmpeg-static not installed; set WORCA_FFMPEG)';
const noBoth = noChrome || noFfmpeg;
const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const ff = (args) => { const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' }); if (r.status) throw new Error(r.stderr); };

/* ---------- pure ---------- */

test('every kit Chrome launch keeps off the macOS keychain: mock keychain flags + the real HOME for Chrome', async () => {
  const { chromeArgs, chromeEnv, CHROME_SAFE_ARGS } = await import('../assets/promo-kit/tools/cdp.mjs');
  const { userInfo } = await import('node:os');
  assert.deepEqual(CHROME_SAFE_ARGS, ['--use-mock-keychain', '--password-store=basic']);
  for (const platform of ['darwin', 'linux', 'win32']) {
    const args = chromeArgs({ dir: '/tmp/x', platform });
    for (const a of CHROME_SAFE_ARGS) assert.ok(args.includes(a), `${platform}: ${a}`);
  }
  const fake = { HOME: join(tmpdir(), 'promo-temp-home'), PATH: '/usr/bin' };
  const env = chromeEnv(fake);
  if (process.platform !== 'win32') assert.equal(env.HOME, userInfo().homedir, 'Chrome gets the real home, not the sandboxed one');
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(fake.HOME, join(tmpdir(), 'promo-temp-home'), 'the caller env is not mutated');
  // source guard: Chrome is only ever started by cdp.mjs launch() or capture/lib.mjs open(), both with the fix
  const kit = fileURLToPath(new URL('../assets/promo-kit/', import.meta.url));
  const files = ['capture/lib.mjs', ...readdirSync(join(kit, 'tools')).filter((f) => f.endsWith('.mjs')).map((f) => `tools/${f}`)];
  for (const f of files) {
    const src = readFileSync(join(kit, f), 'utf8');
    if (/chromium\.launch\(/.test(src)) {
      assert.match(src, /chromium\.launch\(launchOptions\(exe\)\)/, f);
      assert.match(src, /export function launchOptions\([^)]*\)\s*\{[\s\S]*?env: chromeEnv\(env\)[\s\S]*?CHROME_SAFE_ARGS/, f);
    }
    if (f !== 'tools/cdp.mjs' && f !== 'tools/find-tools.mjs' && f !== 'capture/lib.mjs') assert.doesNotMatch(src, /\bspawn\([^)]*(chrome|exe)\b/i, `${f} starts Chrome itself`);
  }
  assert.match(readFileSync(join(kit, 'tools', 'cdp.mjs'), 'utf8'), /spawn\(exe, \[[^\]]*\][^)]*env: chromeEnv\(\)/);
});

test('browser proxy: flag on -> proxy.server is the local proxy URL; flag off -> no proxy option', async (t) => {
  const { chromeProxy, chromeArgs } = await import('../assets/promo-kit/tools/cdp.mjs');
  const { launchOptions } = await import('../assets/promo-kit/capture/lib.mjs');
  const { startEgressPolicy } = await import('../src/core/egress-policy.mjs');
  const { startFakeUpstream } = await import('./helpers/fake-upstream-proxy.mjs');
  const fake = await startFakeUpstream({ scheme: 'none', originPort: 9 });
  t.after(() => fake.close());

  const on = { HTTPS_PROXY: fake.url(), NO_PROXY: 'intranet.acme.example' };
  const r = await startEgressPolicy({ env: on, proxyOn: () => true, settings: () => ({}), login: () => null });
  t.after(() => r.close());
  assert.equal(launchOptions('/x/chrome', on).proxy.server, r.url);
  assert.equal(chromeProxy(on).server, r.url);
  assert.equal(chromeProxy(on).bypass, 'intranet.acme.example');
  const argv = chromeArgs({ dir: '/tmp/x', platform: 'linux', env: on });
  assert.ok(argv.includes(`--proxy-server=${r.url}`));
  assert.ok(argv.includes('--proxy-bypass-list=intranet.acme.example'));

  // Flag off, even with the user's own loopback proxy in HTTPS_PROXY: launches stay exactly as today.
  const off = { HTTPS_PROXY: 'http://127.0.0.1:3128' };
  await startEgressPolicy({ env: off, proxyOn: () => false });
  assert.equal('proxy' in launchOptions('/x/chrome', off), false);
  assert.equal(chromeProxy(off), null);
  assert.ok(!chromeArgs({ dir: '/tmp/x', platform: 'linux', env: off }).some((a) => a.startsWith('--proxy-')));
  assert.equal(chromeProxy({ WORCA_CORPORATE_PROXY_URL: 'http://u:p@127.0.0.1:1' }), null, 'never a URL with credentials');
  assert.equal(chromeProxy({ WORCA_CORPORATE_PROXY_URL: 'http://corp.example:8080' }), null, 'only a loopback URL');
  assert.equal(chromeProxy({ WORCA_CORPORATE_PROXY_URL: 'http://127.0.0.1:5', NO_PROXY: '*' }), null, 'NO_PROXY=* means everything goes direct');
});

test('kit.js F.SFX and tools/sfx.mjs list the same sound names', () => {
  const kit = readFileSync(fileURLToPath(new URL('../assets/promo-kit/film/kit.js', import.meta.url)), 'utf8');
  const m = /F\.SFX = \[([\s\S]*?)\];/.exec(kit);
  const names = [...m[1].matchAll(/'([a-z-]+)'/g)].map((x) => x[1]);
  assert.deepEqual(names, SFX_NAMES);
  for (const l of LOOPED_SFX) assert.ok(SFX_NAMES.includes(l), l);
});

test('thinCues merges 5 step cues inside 120 ms into one quiet cue, keeps others, adds accents', () => {
  const steps = [0, 0.02, 0.04, 0.06, 0.08].map((d) => ({ t: 1 + d, name: 'step', gain: 1, pan: 0, dur: null, rate: 1 }));
  const out = thinCues([...steps, { t: 1.03, name: 'ding', gain: 1, pan: 0, dur: null, rate: 1 }], { accents: [{ t: 2, name: 'chime', gain: 0.7 }] });
  const st = out.filter((c) => c.name === 'step');
  assert.equal(st.length, 1);
  assert.ok(st[0].gain <= 0.32, `gain ${st[0].gain}`);
  assert.equal(out.filter((c) => c.name === 'ding').length, 1);
  assert.deepEqual(out.find((c) => c.name === 'chime'), { t: 2, name: 'chime', gain: 0.7, pan: 0, dur: null, rate: 1 });
  assert.deepEqual(out.map((c) => c.t), [...out.map((c) => c.t)].sort((a, b) => a - b));
  assert.ok(out.every((c) => !('n' in c) && !('ducked' in c)));
  // a later step outside the window is a new cue; input untouched
  assert.equal(thinCues([...steps, { t: 1.2, name: 'step', gain: 1 }]).filter((c) => c.name === 'step').length, 2);
  assert.equal(steps[0].gain, 1);
});

const words = (text, start = 0, per = 0.32) => text.split(' ').map((w, i) => ({ w, key: w.toLowerCase().replace(/[^a-z0-9-]/g, ''), t0: start + i * per, t1: start + i * per + per * 0.8 }));
const TL2 = {
  version: 1, duration: 20, fps: 60, narrated: true,
  vo: {
    v01: { text: '', scene: 'a', start: 0.5, dur: 6, speechStart: 0, speechEnd: 5.9,
      words: words('Here is a fairly long opening sentence that keeps going, so the captions must split it into readable pieces. Then a second one.') },
    v02: { text: '', scene: 'b', start: 9, dur: 3, speechStart: 0, speechEnd: 2.9, words: words('Short and sweet.') },
  },
  scenes: [{ id: 'a', start: 0, end: 8.5 }, { id: 'b', start: 8.5, end: 20 }],
};

test('buildSrt: numbered cues, ≤ 42 chars a line, ≤ 2 lines, increasing non-overlapping times', () => {
  const srt = buildSrt(TL2);
  const blocks = srt.trim().split(/\n\n+/);
  assert.ok(blocks.length >= 2, srt);
  const toS = (ts) => { const [h, m, rest] = ts.split(':'); const [s, ms] = rest.split(','); return +h * 3600 + +m * 60 + +s + +ms / 1000; };
  let prevEnd = -1;
  blocks.forEach((b, i) => {
    const [num, time, ...text] = b.split('\n');
    assert.equal(+num, i + 1);
    const [a, z] = time.split(' --> ').map(toS);
    assert.ok(a < z, time);
    assert.ok(a >= prevEnd, `cue ${i + 1} starts before the previous one ends`);
    prevEnd = z;
    assert.ok(text.length >= 1 && text.length <= 2, b);
    for (const line of text) assert.ok(line.length <= 42, `"${line}" is ${line.length} chars`);
  });
  assert.match(srt, /Short and sweet\./);
  assert.equal(buildSrt({ ...TL2, vo: {} }), '');
});

test('mixAudio on a silent timeline passes the voice check and writes nothing', async () => {
  const promo = tmp('promo-mix-silent-');
  try {
    writeFileSync(join(promo, 'timeline.json'), JSON.stringify({ ...TL2, narrated: false }));
    const r = await mixAudio({ promoDir: promo, cues: [{ t: 1, name: 'pop', gain: 1 }], ffmpeg: FFMPEG || '/nonexistent/ffmpeg' });
    assert.deepEqual(r.voiceCheck, { ok: true, lines: [] });
    assert.equal(r.files, null);
    assert.equal(r.duration, 20);
    assert.equal(existsSync(join(promo, 'audio')), false);
  } finally { rmSync(promo, { recursive: true, force: true }); }
});

/* ---------- ffmpeg ---------- */

test('mixAudio levels the voice and gates on it: a loud SFX over the line fails, a quiet one passes', { skip: noFfmpeg }, async () => {
  const promo = tmp('promo-mix-');
  try {
    mkdirSync(join(promo, 'audio', 'vo'), { recursive: true });
    mkdirSync(join(promo, 'audio', 'sfx'), { recursive: true });
    ff(['-f', 'lavfi', '-i', 'sine=frequency=330:duration=2:sample_rate=44100', '-af', 'volume=-20dB', '-c:a', 'libmp3lame', '-b:a', '128k', join(promo, 'audio', 'vo', 'v01.mp3')]);
    ff(['-f', 'lavfi', '-i', 'anoisesrc=color=white:amplitude=1:duration=2:sample_rate=44100', '-c:a', 'libmp3lame', '-b:a', '128k', join(promo, 'audio', 'sfx', 'pop.mp3')]);
    writeFileSync(join(promo, 'timeline.json'), JSON.stringify({ version: 1, duration: 4, fps: 60, narrated: true, music: false,
      vo: { v01: { text: 'tone', scene: 'a', start: 0.5, dur: 2, speechStart: 0, speechEnd: 2, words: [{ w: 'tone', key: 'tone', t0: 0, t1: 2 }] } },
      scenes: [{ id: 'a', start: 0, end: 4 }] }));
    const loud = await mixAudio({ promoDir: promo, cues: [{ t: 0.5, name: 'pop', gain: 8 }], ffmpeg: FFMPEG });
    assert.equal(loud.voiceCheck.ok, false, JSON.stringify(loud.voiceCheck));
    assert.equal(loud.voiceCheck.lines[0].id, 'v01');
    assert.equal(loud.voiceCheck.lines[0].ok, false);

    const quiet = await mixAudio({ promoDir: promo, cues: [{ t: 0.5, name: 'pop', gain: 0.05 }], ffmpeg: FFMPEG });
    assert.equal(quiet.voiceCheck.ok, true, JSON.stringify(quiet.voiceCheck));
    assert.ok(quiet.voiceCheck.lines[0].median >= 12);
    assert.ok(quiet.voiceCheck.lines[0].lowShare <= 0.05);
    for (const k of ['wav', 'mp3', 'm4a']) assert.ok(existsSync(quiet.files[k]), k);
    assert.equal(quiet.files.wav, join(promo, 'audio', 'mix.wav'));
    assert.ok(Math.abs(quiet.duration - 4) < 1e-6);
    assert.ok(Math.abs(quiet.lufs - -14) <= 0.6, `integrated ${quiet.lufs} LUFS`);
    assert.ok(quiet.tp <= -0.9, `true peak ${quiet.tp}`);
    // a narrated timeline whose line audio is missing is an error, not a silent mix
    rmSync(join(promo, 'audio', 'vo', 'v01.mp3'));
    writeFileSync(join(promo, 'timeline.json'), JSON.stringify({ version: 1, duration: 4, fps: 60, narrated: true,
      vo: { v01: { text: 'a', start: 0.5, dur: 1, words: [] }, v02: { text: 'b', start: 2, dur: 1, words: [] } }, scenes: [{ id: 'a', start: 0, end: 4 }] }));
    writeFileSync(join(promo, 'audio', 'vo', 'v02.mp3'), readFileSync(join(promo, 'audio', 'sfx', 'pop.mp3')));
    await assert.rejects(mixAudio({ promoDir: promo, cues: [], ffmpeg: FFMPEG }), /v01/);
  } finally { rmSync(promo, { recursive: true, force: true }); }
});

test('mixAudio skips an undecodable SFX file (warns, counts it missing) instead of failing the whole mix', { skip: noFfmpeg }, async () => {
  const promo = tmp('promo-mix-bad-');
  try {
    mkdirSync(join(promo, 'audio', 'vo'), { recursive: true });
    mkdirSync(join(promo, 'audio', 'sfx'), { recursive: true });
    ff(['-f', 'lavfi', '-i', 'sine=frequency=330:duration=2:sample_rate=44100', '-af', 'volume=-20dB', '-c:a', 'libmp3lame', '-b:a', '128k', join(promo, 'audio', 'vo', 'v01.mp3')]);
    // the real failure: an ID3 header and one frame header, nothing decodable (a clip trimmed to nothing)
    writeFileSync(join(promo, 'audio', 'sfx', 'pop-high.mp3'), Buffer.concat([Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x22', 'latin1'), Buffer.alloc(30), Buffer.from([0xff, 0xfb, 0x90, 0xc0]), Buffer.alloc(420)]));
    ff(['-f', 'lavfi', '-i', 'sine=frequency=900:duration=0.2:sample_rate=44100', '-c:a', 'libmp3lame', '-b:a', '128k', join(promo, 'audio', 'sfx', 'pop.mp3')]);
    writeFileSync(join(promo, 'timeline.json'), JSON.stringify({ version: 1, duration: 4, fps: 60, narrated: true, music: false,
      vo: { v01: { text: 'tone', scene: 'a', start: 0.5, dur: 2, speechStart: 0, speechEnd: 2, words: [{ w: 'tone', key: 'tone', t0: 0, t1: 2 }] } },
      scenes: [{ id: 'a', start: 0, end: 4 }] }));
    const r = await mixAudio({ promoDir: promo, cues: [{ t: 3, name: 'pop-high', gain: 0.3 }, { t: 3.2, name: 'pop', gain: 0.3 }], ffmpeg: FFMPEG });
    assert.ok(r.files && existsSync(r.files.m4a), 'the mix is written');
    assert.ok(r.missingSfx.includes('pop-high'), JSON.stringify(r.missingSfx));
    assert.equal(r.placed, 1);
  } finally { rmSync(promo, { recursive: true, force: true }); }
});

/* ---------- Chrome (+ ffmpeg) ---------- */

/** A tiny real film: kit + one scene (a box that slides, a pop cue), `dur` seconds. */
function fixtureFilm(dur, sceneJs) {
  const promo = tmp('promo-film-');
  initFilm({ filmDir: join(promo, 'film') });
  writeFileSync(join(promo, 'timeline.json'), JSON.stringify({ version: 1, duration: dur, fps: 60, narrated: false, music: false,
    vo: {}, scenes: [{ id: 'hook', start: 0, end: dur }] }));
  writeFileSync(join(promo, 'film', 'scenes', 'hook.js'), sceneJs);
  writeFileSync(join(promo, 'film', 'scenes', 'hook.css'), '[data-scene="hook"] .box { width: 200px; height: 200px; background: #5B56C9; border-radius: 24px; }\n');
  buildData({ promoDir: promo });
  return promo;
}
const SLIDE = `F.scene({ id: 'hook', build(S) {
  const b = S.el('div', { cls: 'box' });
  S.tl.set(b, { x: 200, y: 440 }, 0).to(b, { x: 1500, duration: 0.9, ease: 'none' }, 0.05);
  S.sfx(0.05, 'whoosh'); S.sfx(0.5, 'pop', { gain: 0.6 });
}});`;

test('dumpCues loads the scene files listed in data.js and returns its cues, no violations', { skip: noChrome }, async () => {
  const promo = fixtureFilm(1, SLIDE);
  try {
    const r = await dumpCues({ html: join(promo, 'film', 'index.html'), chrome: CHROME });
    assert.equal(r.dur, 1);
    assert.deepEqual(r.violations, []);
    assert.deepEqual(r.cues.map((c) => [c.t, c.name]), [[0.05, 'whoosh'], [0.5, 'pop']]);
    assert.equal(r.cues[1].gain, 0.6);
  } finally { rmSync(promo, { recursive: true, force: true }); }
});

test('exportFilm renders every frame to an H.264 MP4 at 60 fps and muxes the audio', { skip: noBoth }, async () => {
  const promo = fixtureFilm(1, SLIDE);
  try {
    const audio = join(promo, 'tone.m4a');
    ff(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1:sample_rate=48000', '-c:a', 'aac', '-b:a', '128k', audio]);
    const out = join(promo, 'video', 'promo-1080p60.mp4');
    const progress = [];
    const r = await exportFilm({ html: join(promo, 'film', 'index.html'), out, audio, scale: 1, workers: 2, crf: 30, preset: 'ultrafast',
      chrome: CHROME, ffmpeg: FFMPEG, onProgress: (p) => progress.push(p) });
    assert.equal(r.frames, 60);
    assert.ok(Math.abs(r.duration - 1) < 0.02, `duration ${r.duration}`);
    assert.ok(r.bytes > 1000);
    const m = readMP4(out);
    assert.equal(m.samples, 60);
    assert.equal(m.width, 1920); assert.equal(m.height, 1080);
    assert.equal(Math.round(m.fps), 60);
    const probe = spawnSync(FFMPEG, ['-hide_banner', '-i', out], { encoding: 'utf8' }).stderr;
    assert.match(probe, /Audio: aac/);
    assert.ok(progress.length >= 1 && progress.at(-1).done === 60);
  } finally { rmSync(promo, { recursive: true, force: true }); }
});

test('checkFluency flags a one-frame pop, paper-only frames and a frozen hold', { skip: noChrome }, async () => {
  const POP = `F.scene({ id: 'hook', build(S) {
    const b = S.el('div', { cls: 'box', style: { width: '640px', height: '400px' } });   // big enough to read as a pop
    S.tl.set(b, { x: 640, y: 340, autoAlpha: 0 }, 0).set(b, { autoAlpha: 1 }, 1.0);
  }});`;
  const promo = fixtureFilm(3, POP);
  try {
    const r = await checkFluency({ html: join(promo, 'film', 'index.html'), chrome: CHROME, workers: 2 });
    assert.equal(r.frames, 180);
    assert.ok(r.pops.some((p) => Math.abs(p.t - 1.0) < 0.05), JSON.stringify(r.pops));
    assert.ok(r.blanks.some((b) => b.t < 0.05 && b.frames >= 50), JSON.stringify(r.blanks));
    assert.ok(r.holds.some((h) => h.t > 0.95 && h.t < 1.1 && h.dur > 1.2), JSON.stringify(r.holds));
    assert.equal(r.pops[0].scene, 'hook');
  } finally { rmSync(promo, { recursive: true, force: true }); }
});

test('contactSheet renders labelled thumbnails into one JPEG with headless Chrome', { skip: noChrome }, async () => {
  const dir = tmp('promo-sheet-');
  try {
    const images = [];
    for (let i = 0; i < 5; i++) {
      const rgb = new Uint8Array(64 * 36 * 3).fill(40 * i);
      const f = join(dir, `f${String(i).padStart(3, '0')}_${(i * 0.5).toFixed(2).padStart(7, '0')}.png`);
      writeFileSync(f, encodePNG(64, 36, rgb)); images.push(f);
    }
    const out = join(dir, 'sheet.jpg');
    assert.equal(await contactSheet({ images, out, cols: 3, thumb: 160, chrome: CHROME }), out);
    const buf = readFileSync(out);
    assert.equal(buf[0], 0xff); assert.equal(buf[1], 0xd8);
    // SOFn → height, width
    let o = 2, size = null;
    while (o < buf.length) {
      if (buf[o] !== 0xff) { o++; continue; }
      const mk = buf[o + 1];
      if (mk >= 0xc0 && mk <= 0xc3) { size = { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) }; break; }
      o += 2 + buf.readUInt16BE(o + 2);
    }
    assert.deepEqual(size, { w: 480, h: 180 });
    assert.ok(!readdirSync(dir).some((f) => f.endsWith('.html')), 'no temp page left next to the sheet');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
