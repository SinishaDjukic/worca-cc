// test/bundled-product-video-plugin.test.mjs
// The Product Video plugin in the builtin marketplace: it validates strictly, its template wires the
// three script steps where the pipeline needs them (check before Clarify, sheets between Recorder and
// Review, encode after a clean review), its shipped script cases pass, and the pure parts of
// tools/video.mjs (PNG round trip, MP4 probe, zoom timing, the take named by recording notes) hold.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { validatePluginDir } from '../src/core/plugin-manifest.mjs';
import { runPluginScriptCases } from '../src/core/plugin-script-cases.mjs';

useTempHome(after);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = join(ROOT, 'plugins', 'product-video');
const video = await import(join(DIR, 'skills', 'product-video', 'tools', 'video.mjs'));
const scratch = mkdtempSync(join(tmpdir(), 'pv-test-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

test('product-video is listed in the builtin marketplace and validates strictly', () => {
  const market = JSON.parse(readFileSync(join(ROOT, 'worca-cc-marketplace.json'), 'utf8'));
  assert.ok(market.plugins.includes('plugins/product-video'));
  const v = validatePluginDir(DIR, { strict: true });
  assert.equal(v.ok, true, JSON.stringify(v.problems));
});

test('the template checks programs before Clarify, makes sheets before Review, encodes after a pass', () => {
  const wf = JSON.parse(readFileSync(join(DIR, 'workflows', 'product-video.json'), 'utf8'));
  const key = (id) => wf.nodes.find((n) => n.id === id)?.key;
  const wire = (from, fp, to, tp) => wf.wires.some((w) => key(w.from.node) === from && w.from.port === fp && key(w.to.node) === to && w.to.port === tp);
  assert.deepEqual(wf.nodes.filter((n) => n.kind === 'script').map((n) => n.key), ['videoPreflight', 'videoSheets', 'videoFinish']);
  assert.ok(wire('videoPreflight', 'tools', 'clarify', 'await'));
  assert.ok(wire('videoRecorder', 'recording', 'videoSheets', 'recording'));
  assert.ok(wire('videoSheets', 'sheets', 'videoReviewer', 'sheets'));
  assert.ok(wf.wires.some((w) => key(w.from.node) === 'videoReviewer' && w.from.port === 'findings' && key(w.to.node) === 'videoRecorder' && w.config?.maxCycles === 3));
  assert.ok(wire('videoReviewer', 'pass', 'videoFinish', 'await'));
  assert.equal(wf.nodes.some((n) => n.key === 'videoPackager'), false);
});

test('the shipped script cases pass', async () => {
  const r = await runPluginScriptCases(DIR);
  assert.equal(r.failed, 0, JSON.stringify(r.scripts, null, 2));
  assert.equal(r.passed, 3);
});

test('video.mjs: a PNG it writes reads back pixel for pixel', () => {
  const w = 7, h = 5, rgb = Buffer.alloc(w * h * 3);
  for (let i = 0; i < rgb.length; i++) rgb[i] = (i * 37) & 0xff;
  const f = join(scratch, 'rt.png');
  video.writeRgbPng(f, w, h, rgb);
  const img = video.readPng(f);
  assert.deepEqual([img.width, img.height, img.channels], [w, h, 3]);
  assert.ok(img.data.equals(rgb));
});

test('video.mjs: probe reads duration from mvhd and size from tkhd', () => {
  const box = (type, body) => { const h = Buffer.alloc(8); h.writeUInt32BE(8 + body.length, 0); h.write(type, 4, 'latin1'); return Buffer.concat([h, body]); };
  const mvhd = Buffer.alloc(100); mvhd.writeUInt32BE(1000, 12); mvhd.writeUInt32BE(42500, 16);   // version 0: 42.5 s
  const tkhd = Buffer.alloc(84); tkhd.writeUInt32BE(1920 * 65536, 76); tkhd.writeUInt32BE(1080 * 65536, 80);
  const f = join(scratch, 'p.mp4');
  writeFileSync(f, Buffer.concat([box('ftyp', Buffer.from('isom0000')), box('moov', Buffer.concat([box('mvhd', mvhd), box('trak', box('tkhd', tkhd))]))]));
  assert.deepEqual(video.probe(f), { bytes: readFileSync(f).length, seconds: 42.5, width: 1920, height: 1080 });
});

test('video.mjs: a post zoom eases in, holds the target, eases out', () => {
  const z = { kind: 'post', at: 10, ms: 600, hold: 2000, scale: 2, rect: { x: 900, y: 500, w: 120, h: 80 } };
  assert.equal(video.postZoomRect(z, 9.9, 1920, 1080), null);
  assert.equal(video.postZoomRect(z, 13.3, 1920, 1080), null);
  const held = video.postZoomRect(z, 11, 1920, 1080);
  assert.deepEqual(held, { x: 480, y: 270, w: 960, h: 540 });                  // 2×, centred on the target
  const mid = video.postZoomRect(z, 10.3, 1920, 1080);
  assert.ok(mid.w < 1920 && mid.w > 960);
  assert.ok(Math.abs(video.zoomMidpoint(z) - 11.6) < 1e-9);
});

test('video.mjs: the take comes from the recording notes, else the newest in video-takes/', () => {
  const pd = join(scratch, 'pipe');
  mkdirSync(join(pd, 'video-takes'), { recursive: true });
  writeFileSync(join(pd, 'video-takes', 'demo-cycle1.webm'), 'x');
  writeFileSync(join(pd, 'notes.md'), 'Take: `video-takes/demo-cycle1.webm`\n');
  assert.equal(video.takeFromNotes(join(pd, 'notes.md'), pd).rel, 'video-takes/demo-cycle1.webm');
  writeFileSync(join(pd, 'none.md'), 'no take named\n');
  assert.equal(video.takeFromNotes(join(pd, 'none.md'), pd).named, false);
  writeFileSync(join(pd, 'gone.md'), 'Take: video-takes/missing-cycle2.webm\n');
  assert.match(video.takeFromNotes(join(pd, 'gone.md'), pd).error, /does not exist/);
});
