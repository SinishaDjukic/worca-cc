// test/promo-render.test.mjs
// The `promoRender` card (promo video workflow, lane B3): the reviewed film becomes
// video/promo-1080p60.mp4 + captions + YouTube metadata. Narrated films are mixed first and the
// mix's voice check gates the export; a missing Chrome or ffmpeg is a blocking finding with the
// install hint for the host OS. Offline: every kit tool is injected.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import promoRender, { youtubeChapters, youtubeMarkdown, firstParagraph } from '../scripts/promo-render.mjs';
import { loadScriptRegistry, DEFAULT_SCRIPTS_DIR } from '../src/core/script-registry.mjs';
import { runPluginScriptCases } from '../src/core/plugin-script-cases.mjs';
import { apiFor } from './helpers/promo-fixtures.mjs';

const scratch = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true, maxRetries: 3 }); });

const SILENT = {
  version: 1, duration: 44.5, fps: 60, narrated: false, music: false, sfx: false,
  vo: {
    v01: { text: 'Here is a task.', scene: 'hook', start: 0.5, dur: 1.6, speechStart: 0.05, speechEnd: 1.45, words: [] },
    v02: { text: 'Meet Acme.', scene: 'title', start: 12.2, dur: 1.2, speechStart: 0.05, speechEnd: 1.05, words: [] },
  },
  scenes: [
    { id: 'hook', start: 0, end: 11 },
    { id: 'title', start: 11, end: 22, chapter: { num: '01', title: 'Meet Acme' } },
    { id: 'board', start: 22, end: 32, chapter: { num: '02', title: 'The board' } },
    { id: 'outro', start: 32, end: 44.5, chapter: { num: '03', title: 'Try it' } },
  ],
};
const NARRATED = { ...SILENT, narrated: true, music: true, sfx: true, voiceId: 'VoiceFemaleNarr01' };
const PRODUCT = '# Acme\n\n> internal note\n\nAcme is a kanban board for small teams.\nIt keeps work moving.\n\n## Features\n\n- boards\n';

/** A pipeline dir holding a finished film, the script and the product facts. */
function fixture(timeline = SILENT, { film = true } = {}) {
  const p = tmp('worca-promo-render-');
  const promo = join(p, 'promo');
  mkdirSync(join(promo, 'film'), { recursive: true });
  if (film) writeFileSync(join(promo, 'film', 'index.html'), '<!doctype html><title>film</title>');
  writeFileSync(join(promo, 'script.json'), JSON.stringify({ version: 1, title: 'Meet Acme', lines: [], scenes: [] }));
  writeFileSync(join(promo, 'product.md'), PRODUCT);
  writeFileSync(join(promo, 'timeline.json'), JSON.stringify(timeline));
  const tl = join(p, 'promo-timeline.json');
  writeFileSync(tl, JSON.stringify(timeline));
  const filmMd = join(p, 'promo-scenes-cycle1.md');
  writeFileSync(filmMd, '# Film\n');
  const report = join(p, 'promo-render-cycle1.md');
  return {
    p,
    inputs: { film: { type: 'md', path: filmMd }, timeline: { type: 'json', path: tl } },
    outputs: { video: { type: 'md', path: report }, findings: { type: 'md', path: report } },
  };
}

/** Every kit tool the card calls, recorded. `over` replaces any of them. */
function stubTools(over = {}) {
  const calls = [];
  const rec = (name, fn) => (...a) => { calls.push({ name, args: a }); return fn(...a); };
  const tools = {
    findChrome: rec('findChrome', () => '/fake/chrome'),
    findFfmpeg: rec('findFfmpeg', () => '/fake/ffmpeg'),
    toolHints: (platform) => ({
      chrome: `install Chrome for ${platform}, or set WORCA_CHROME`,
      ffmpeg: platform === 'win32' ? 'winget install Gyan.FFmpeg, or set WORCA_FFMPEG' : 'brew install ffmpeg, or set WORCA_FFMPEG',
    }),
    buildData: rec('buildData', () => ({ scenes: 4, plates: 2, voLines: 2 })),
    dumpCues: rec('dumpCues', async () => ({ dur: 44.5, cues: [{ t: 1, name: 'pop', gain: 1 }, { t: 1.01, name: 'pop', gain: 1 }], violations: ['unknown sfx boop'] })),
    thinCues: rec('thinCues', (cues) => cues.slice(0, 1)),
    mixAudio: rec('mixAudio', async ({ promoDir }) => ({
      lufs: -14.1, tp: -1.2, duration: 44.5, _wrote: writeMix(promoDir),
      voiceCheck: { ok: true, lines: [{ id: 'v01', median: 21, lowShare: 0, ok: true }, { id: 'v02', median: 19, lowShare: 0.01, ok: true }] },
      files: { wav: join(promoDir, 'audio', 'mix.wav'), mp3: join(promoDir, 'audio', 'mix.mp3'), m4a: join(promoDir, 'audio', 'mix.m4a') },
    })),
    exportFilm: rec('exportFilm', async ({ out }) => { mkdirSync(join(out, '..'), { recursive: true }); writeFileSync(out, Buffer.alloc(2048)); return { frames: Math.round(44.5 * 60), duration: 44.5, bytes: 2048 }; }),
    buildSrt: rec('buildSrt', () => '1\n00:00:00,500 --> 00:00:02,000\nHere is a task.\n'),
    ...over,
  };
  return { tools, calls, names: () => calls.map((c) => c.name) };
}

const read = (p) => readFileSync(p, 'utf8');
/** What the kit mix leaves on disk. */
function writeMix(promoDir) {
  mkdirSync(join(promoDir, 'audio'), { recursive: true });
  for (const ext of ['wav', 'mp3', 'm4a']) writeFileSync(join(promoDir, 'audio', `mix.${ext}`), 'audio');
  return true;
}

test('silent film: exported with no audio, captions and youtube.md written, a clean verdict', async () => {
  const fx = fixture(SILENT);
  const { tools, calls, names } = stubTools();
  const logs = [];
  const r = await promoRender(apiFor(fx.p, { ...fx, logs }), { tools, cpus: 12 });
  assert.deepEqual(r.verdict.issues, []);
  assert.ok(!names().includes('dumpCues') && !names().includes('mixAudio'), 'a silent film is not mixed');
  const ex = calls.find((c) => c.name === 'exportFilm').args[0];
  assert.equal(ex.audio, null);
  assert.equal(ex.scale, 2);
  assert.equal(ex.workers, 8, 'max(1, cpus - 2), at most 8');
  assert.equal(ex.html, join(fx.p, 'promo', 'film', 'index.html'));
  assert.equal(ex.out, join(fx.p, 'video', 'promo-1080p60.mp4'));
  assert.equal(ex.chrome, '/fake/chrome');
  assert.equal(ex.ffmpeg, '/fake/ffmpeg');
  assert.ok(names().indexOf('buildData') < names().indexOf('exportFilm'), 'data.js is rebuilt before the export');
  assert.equal(read(join(fx.p, 'video', 'promo.en.srt')), '1\n00:00:00,500 --> 00:00:02,000\nHere is a task.\n');
  const yt = read(join(fx.p, 'video', 'youtube.md'));
  assert.match(yt, /^# YouTube/);
  assert.match(yt, /## Title\n\nMeet Acme\n/);
  assert.match(yt, /Acme is a kanban board for small teams\. It keeps work moving\./);
  assert.match(yt, /0:00 Intro\n0:11 Meet Acme\n0:22 The board\n0:32 Try it\n/);
  const md = read(fx.outputs.video.path);
  assert.match(md, /^# Promo video/);
  assert.match(md, /promo-1080p60\.mp4/);
  assert.equal(read(join(fx.p, 'promo', 'video.md')), md, 'the agreed copy at promo/video.md');
  assert.match(r.summary, /promo-1080p60\.mp4/);
});

test('narrated film: cues dumped, thinned, mixed, and the m4a muxed into the export', async () => {
  const fx = fixture(NARRATED);
  const { tools, calls, names } = stubTools();
  const r = await promoRender(apiFor(fx.p, fx), { tools, cpus: 4 });
  assert.deepEqual(r.verdict.issues.filter((i) => ['critical', 'major'].includes(i.severity)), []);
  const order = names().filter((n) => ['dumpCues', 'thinCues', 'mixAudio', 'exportFilm'].includes(n));
  assert.deepEqual(order, ['dumpCues', 'thinCues', 'mixAudio', 'exportFilm']);
  const mix = calls.find((c) => c.name === 'mixAudio').args[0];
  assert.equal(mix.promoDir, join(fx.p, 'promo'));
  assert.equal(mix.ffmpeg, '/fake/ffmpeg');
  assert.deepEqual(mix.cues, [{ t: 1, name: 'pop', gain: 1 }], 'the thinned cues');
  const ex = calls.find((c) => c.name === 'exportFilm').args[0];
  assert.equal(ex.audio, join(fx.p, 'promo', 'audio', 'mix.m4a'));
  assert.equal(ex.workers, 2);
  const md = read(fx.outputs.video.path);
  assert.match(md, /-14\.1 LUFS/);
  assert.match(md, /unknown sfx boop/, 'kit violations are listed');
  assert.ok(r.verdict.issues.some((i) => i.severity === 'minor' && /unknown sfx boop/.test(i.detail)), 'a violation is a minor note, never blocking');
});

test('a narrated film without SFX files mixes the voice and music only (no cues)', async () => {
  const fx = fixture({ ...NARRATED, sfx: false });
  const { tools, calls } = stubTools();
  await promoRender(apiFor(fx.p, fx), { tools });
  assert.deepEqual(calls.find((c) => c.name === 'mixAudio').args[0].cues, []);
});

test('the mix voice check fails: blocking, naming the lines, and nothing is exported', async () => {
  const fx = fixture(NARRATED);
  let mixes = 0;
  const { tools, names } = stubTools({
    mixAudio: async ({ promoDir }) => (mixes += 1, {
      lufs: -14, tp: -1.1, duration: 44.5,
      voiceCheck: { ok: false, lines: [{ id: 'v01', median: 20, lowShare: 0, ok: true }, { id: 'v02', median: 8.4, lowShare: 0.21, ok: false }] },
      files: { wav: join(promoDir, 'audio', 'mix.wav'), mp3: '', m4a: join(promoDir, 'audio', 'mix.m4a') },
    }),
  });
  const r = await promoRender(apiFor(fx.p, fx), { tools });
  const blocking = r.verdict.issues.filter((i) => i.severity === 'major');
  assert.equal(blocking.length, 1);
  assert.match(blocking[0].title, /voice/i);
  assert.match(blocking[0].detail, /v02/);
  assert.doesNotMatch(blocking[0].detail, /v01/);
  assert.ok(!names().includes('exportFilm'));
  assert.equal(existsSync(join(fx.p, 'video', 'promo-1080p60.mp4')), false);
  assert.match(read(fx.outputs.findings.path), /v02/);
  assert.equal(mixes, 2, 'one automatic retry with harder ducking before blocking');
  assert.match(read(fx.outputs.findings.path), /voice check FAILED on 1 of 2 line/);
});

test('a marginal voice check fail is fixed by ONE automatic remix with the effects ducked harder under speech', async () => {
  const fx = fixture(NARRATED);
  const calls = [];
  const { tools, names } = stubTools({
    mixAudio: async ({ promoDir, levels }) => {
      calls.push(levels || {});
      const ok = Number(levels?.sfx_under_vo) <= -18;
      writeMix(promoDir);
      return { lufs: -14, tp: -1.1, duration: 44.5,
        voiceCheck: { ok, lines: [{ id: 'v01', median: 20, lowShare: 0, ok: true }, { id: 'v02', median: ok ? 17 : 15, lowShare: ok ? 0.02 : 0.07, ok }] },
        files: { wav: join(promoDir, 'audio', 'mix.wav'), mp3: '', m4a: join(promoDir, 'audio', 'mix.m4a') } };
    },
  });
  const r = await promoRender(apiFor(fx.p, fx), { tools });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].sfx_under_vo, undefined, 'the first mix uses the kit defaults');
  assert.equal(calls[1].sfx_under_vo, -18);
  assert.equal(r.verdict.issues.filter((i) => i.severity === 'major' || i.severity === 'critical').length, 0, JSON.stringify(r.verdict.issues));
  assert.ok(names().includes('exportFilm'));
  assert.match(read(fx.outputs.video.path), /ducked the effects harder/i);
});

test('missing ffmpeg (and Chrome): blocking findings with the host OS install hint', async () => {
  const fx = fixture(SILENT);
  const { tools, names } = stubTools({ findFfmpeg: () => null });
  const r = await promoRender(apiFor(fx.p, { ...fx, platform: 'win32' }), { tools, platform: 'win32' });
  const crit = r.verdict.issues.filter((i) => i.severity === 'critical');
  assert.equal(crit.length, 1);
  assert.match(crit[0].title, /ffmpeg/);
  assert.ok(crit[0].detail.includes(tools.toolHints('win32').ffmpeg));
  assert.ok(!names().includes('exportFilm'));
  assert.match(read(fx.outputs.findings.path), /winget install Gyan\.FFmpeg/);

  const both = stubTools({ findFfmpeg: () => null, findChrome: () => null });
  const r2 = await promoRender(apiFor(fx.p, fx), { tools: both.tools, platform: 'darwin' });
  assert.deepEqual(r2.verdict.issues.filter((i) => i.severity === 'critical').map((i) => /Chrome/.test(i.title) ? 'chrome' : 'ffmpeg').sort(), ['chrome', 'ffmpeg']);
  assert.ok(r2.verdict.issues.some((i) => i.detail.includes('brew install ffmpeg')));
});

test('no film to render, or no timeline: a critical finding before any tool is looked up', async () => {
  const fx = fixture(SILENT, { film: false });
  const { tools, names } = stubTools();
  const r = await promoRender(apiFor(fx.p, fx), { tools });
  assert.equal(r.verdict.issues[0].severity, 'critical');
  assert.match(r.verdict.issues[0].title, /film/i);
  assert.deepEqual(names(), []);

  const fx2 = fixture(SILENT);
  rmSync(join(fx2.p, 'promo', 'timeline.json'));
  const r2 = await promoRender(apiFor(fx2.p, { ...fx2, inputs: { film: fx2.inputs.film } }), { tools });
  assert.match(r2.verdict.issues[0].title, /timeline/i);
});

test('an export that fails, or that is the wrong length, is a blocking finding — and stale video files go first', async () => {
  const fx = fixture(SILENT);
  mkdirSync(join(fx.p, 'video'), { recursive: true });
  writeFileSync(join(fx.p, 'video', 'promo-1080p60.mp4'), 'stale');
  const boom = stubTools({ exportFilm: async () => { throw new Error('Chrome crashed at frame 812'); } });
  const r = await promoRender(apiFor(fx.p, fx), { tools: boom.tools });
  const major = r.verdict.issues.find((i) => i.severity === 'major');
  assert.match(major.detail, /frame 812/);
  assert.equal(existsSync(join(fx.p, 'video', 'promo-1080p60.mp4')), false, 'the previous cycle\'s mp4 is not left behind');

  const short = stubTools({ exportFilm: async ({ out }) => { writeFileSync(out, Buffer.alloc(10)); return { frames: 1500, duration: 25, bytes: 10 }; } });
  const r2 = await promoRender(apiFor(fx.p, fx), { tools: short.tools });
  const m2 = r2.verdict.issues.find((i) => i.severity === 'major');
  assert.match(m2.detail, /1500 frames/);
  assert.match(m2.detail, /2670/);
});

test('a kit tool that is missing is a blocking finding, never a crash', async () => {
  const fx = fixture(SILENT);
  const { tools } = stubTools({ exportFilm: undefined });
  const r = await promoRender(apiFor(fx.p, fx), { tools, loadTool: async (name) => { throw new Error(`Cannot find module ${name}.mjs`); } });
  assert.ok(r.verdict.issues.some((i) => i.severity === 'critical' && /export/.test(i.detail)));
});

test('youtube helpers: chapters need three, ten seconds apart, the first at 0:00; the description is the first prose paragraph', () => {
  assert.deepEqual(youtubeChapters(SILENT), [
    { t: 0, title: 'Intro' }, { t: 11, title: 'Meet Acme' }, { t: 22, title: 'The board' }, { t: 32, title: 'Try it' },
  ]);
  const two = { ...SILENT, scenes: SILENT.scenes.slice(0, 3) };
  assert.equal(youtubeChapters({ ...two, scenes: [two.scenes[0], two.scenes[1]] }).length, 0, 'fewer than three is none');
  const close = { scenes: [
    { id: 'a', start: 0, end: 4, chapter: { num: '01', title: 'A' } }, { id: 'b', start: 4, end: 20, chapter: { num: '02', title: 'B' } },
    { id: 'c', start: 20, end: 40, chapter: { num: '03', title: 'C' } }, { id: 'd', start: 40, end: 60, chapter: { num: '04', title: 'D' } },
  ] };
  assert.deepEqual(youtubeChapters(close).map((c) => c.title), ['A', 'C', 'D'], 'a chapter under 10 s is folded into the next');
  assert.equal(firstParagraph(PRODUCT), 'Acme is a kanban board for small teams. It keeps work moving.');
  assert.equal(firstParagraph(''), '');
  const md = youtubeMarkdown({ title: 'T', description: 'D', chapters: [], files: [] });
  assert.match(md, /## Title\n\nT\n/);
  assert.doesNotMatch(md, /0:00/);
  assert.match(youtubeMarkdown({ title: 'T', description: '', chapters: [{ t: 3725, title: 'Late' }], files: [] }), /1:02:05 Late/);
});

test('youtubeDescription: the explorer\'s one-liner + the opening narration; a plain first paragraph as the fallback', async () => {
  const { youtubeDescription } = await import('../scripts/promo-render.mjs');
  const product = '# Acme Pulse\nOne-liner: "Product analytics your whole team will actually read" — the page h1 (index.html:6)\nAudience: teams\n\n## Features\n| a | b |\n|---|---|\n';
  const script = { lines: [{ id: 'v01', text: 'So many dashboards.' }, { id: 'v02', text: 'So few readers.' }, { id: 'v03', text: 'Meet Acme Pulse.' }, { id: 'v04', text: 'Not this one.' }] };
  const d = youtubeDescription({ product, script });
  assert.match(d, /^Product analytics your whole team will actually read\./);
  assert.match(d, /So many dashboards\. So few readers\. Meet Acme Pulse\./);
  assert.doesNotMatch(d, /index\.html|Not this one/);
  assert.equal(youtubeDescription({ product: 'A plain first paragraph about it.\n\n## More', script: null }), 'A plain first paragraph about it.');
  assert.equal(youtubeDescription({ product: '', script: null }), '');
});

test('the sidecars: ports, timeouts, mocks and extraFiles exactly as the plan pins', () => {
  const REG = loadScriptRegistry({ scriptsDir: DEFAULT_SCRIPTS_DIR, userScriptsDir: null, includePlugins: false, agentKeys: [] });
  const ports = (m) => ({
    in: m.inputs.map((p) => [p.id, p.type, p.required]),
    out: m.outputs.map((p) => [p.id, p.type, p.when, p.filename ?? null]),
  });
  assert.deepEqual(ports(REG.promoVoices), { in: [['answers', 'json', true]], out: [['voices', 'json', 'always', 'promo-voice-list.json']] });
  assert.deepEqual(ports(REG.promoNarrate), {
    in: [['script', 'json', true], ['answers', 'json', false]],
    out: [['timeline', 'json', 'always', 'promo-timeline.json'], ['report', 'md', 'always', 'promo-narrate-cycle{cycle}.md']],
  });
  assert.deepEqual(ports(REG.promoRender), {
    in: [['film', 'md', true], ['timeline', 'json', false]],
    out: [['video', 'md', 'always', 'promo-render-cycle{cycle}.md'], ['findings', 'md', 'blocking', 'promo-render-cycle{cycle}.md'], ['pass', 'void', 'clean', null]],
  });
  assert.deepEqual(REG.promoRender.outputs[0].extraFiles, [
    { kind: 'video', glob: 'video/*.mp4' }, { kind: 'video', glob: 'video/*.srt' }, { kind: 'video', glob: 'video/youtube.md' },
  ]);
  assert.deepEqual(REG.promoRender.verdict, { filename: 'promo-render-cycle{cycle}.json' });
  assert.deepEqual([REG.promoVoices.timeoutMs, REG.promoNarrate.timeoutMs, REG.promoRender.timeoutMs], [600000, 1800000, 7200000]);
  for (const k of ['promoVoices', 'promoNarrate', 'promoRender']) {
    const m = REG[k];
    assert.equal(m.domain, 'video');
    assert.equal(m.runtime, 'node');
    assert.ok(m.mock && Object.keys(m.mock.outputs).length, `${k} has a mock`);
  }
  assert.deepEqual(Object.keys(REG.promoRender.mock.outputs), ['video']);
});

test('the shipped cases pass through the real bench (silent paths only, a scratch cwd)', async (t) => {
  const home = tmp('worca-promo-cases-home-');
  const root = join(DEFAULT_SCRIPTS_DIR, '..');
  const r = await runPluginScriptCases(root, { home });
  assert.deepEqual(r.problems, []);
  const mine = r.scripts.filter((s) => s.key.startsWith('promo'));
  assert.deepEqual(mine.map((s) => s.key).sort(), ['promoNarrate', 'promoRender', 'promoVoices']);
  for (const s of mine) for (const c of s.cases) assert.ok(c.pass && c.checked, `${s.key}/${c.caseId}: ${c.diffs.join('; ')}`);
  t.diagnostic(mine.map((s) => `${s.key}: ${s.cases.map((c) => c.caseId).join(', ')}`).join(' · '));
});
