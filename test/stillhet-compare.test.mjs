// test/stillhet-compare.test.mjs — the pure parts of tools/stillhet-compare.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countDiffPixels, PARTS, ROUTES, STATES, PULSE_STATES, PAGES, report, deepRoutes, deepPart, settledShot, launchOptions } from '../tools/stillhet-compare.mjs';

test('countDiffPixels: 0 for equal buffers, 1 for one changed channel, w*h for a size mismatch', () => {
  const a = new Uint8ClampedArray(2 * 2 * 4).fill(7), b = new Uint8ClampedArray(a);
  assert.equal(countDiffPixels(a, b, 2, 2), 0);
  b[5] = 8;
  assert.equal(countDiffPixels(a, b, 2, 2), 1);
  assert.equal(countDiffPixels(a, new Uint8ClampedArray(8), 2, 2), 4);
});

test('PARTS lists the invitation, the design switch, one whole-page cell per shell route and one per non-default state', () => {
  assert.deepEqual(PARTS.map((p) => p.id), ['invitation', 'design-switch', ...ROUTES.map((r) => `route-${r}`), ...STATES.map(([s]) => `state-${s}`), ...PULSE_STATES.map(([s]) => `state-${s}`)]);
  assert.deepEqual(PAGES, ['components.html', 'run-page.html', 'pulse.html']);
});

test('STATES: every non-default state is a whole-page cell, opened by the same address in both hosts', () => {
  assert.deepEqual(STATES.map(([s]) => s), ['loading', 'empty', 'offline', 'failed', 'refresh-failed', 'connection-lost', 'session-expired', 'first-run']);
  for (const [s] of STATES) {
    const p = PARTS.find((x) => x.id === `state-${s}`);
    assert.equal(p.route, true);
    assert.equal(p.app.route, p.proto.route);
    assert.match(p.app.route, s === 'first-run' ? /^\?first#/ : new RegExp(`^\\?state=${s}#`));
  }
  // the invitation is drawn by the shared shell from its address, so the app cell uses the prototype's address
  const inv = PARTS.find((x) => x.id === 'invitation');
  assert.equal(inv.app.route, inv.proto.route);
});

test('report: exit 1 on a box-size mismatch or any differing pixel, 0 otherwise', () => {
  const cell = (o) => ({ part: 'invitation', theme: 'dark', width: 1280, appBox: { w: 10, h: 5 }, protoBox: { w: 10, h: 5 }, diff: 0, ...o });
  assert.equal(report([cell({})]).code, 0);
  assert.equal(report([cell({ diff: 1 })]).code, 1);
  const r = report([cell({ protoBox: { w: 11, h: 5 } })]);
  assert.equal(r.code, 1);
  assert.match(r.lines[0], /app 10x5, prototype 11x5/);
});

test('report: a console or page error in a cell fails it even with 0 differing pixels, and the error is listed', () => {
  const r = report([{ part: 'route-chat', theme: 'light', width: 360, appBox: { w: 1, h: 1 }, protoBox: { w: 1, h: 1 }, diff: 0, errors: ['app pageerror: boom'] }]);
  assert.equal(r.code, 1);
  assert.match(r.lines.join('\n'), /app pageerror: boom/);
});

test('deepRoutes: the shell\'s own route list (RailShell.routes) less the top-level places', () => {
  const was = globalThis.window;
  globalThis.window = { RailShell: { routes: () => ['chat', 'chat/c1', 'pulse', 'run/ready', 'settings', 'settings/runs'] } };
  try {
    assert.deepEqual(deepRoutes(), ['chat/c1', 'run/ready', 'settings/runs']);
  } finally { globalThis.window = was; }
  const p = deepPart('workflows/workflow:default');
  assert.equal(p.id, 'route-workflows-workflow-default');
  assert.equal(p.route, true);
  assert.equal(p.app.route, '#workflows/workflow:default');
  assert.equal(p.app.route, p.proto.route);
  assert.equal(deepPart('projects/ws:web-shop').id, 'route-projects-ws-web-shop');
  // one of each kind keeps its pairs beside the other cells for the PR; the rest go to the git-ignored deep/ folder
  assert.equal(p.dir, '');
  assert.equal(deepPart('run/working').dir, 'deep');
});

test('settledShot: shoots until two frames in a row are the same, and gives up after its rounds with the last frame', async () => {
  const fake = (frames) => { let i = 0, evals = 0; return { page: { waitForTimeout: async () => {}, evaluate: async () => { evals++; }, screenshot: async () => Buffer.from(frames[Math.min(i++, frames.length - 1)]) }, shots: () => i, evals: () => evals }; };
  const a = fake(['fading', 'almost', 'still', 'still']);
  assert.equal(String(await settledShot(a.page)), 'still');
  assert.equal(a.shots(), 4);
  assert.equal(a.evals(), 4);   // the script animations are finished before every frame
  const b = fake(['1', '2', '3', '4', '5']);
  assert.equal(String(await settledShot(b.page, { rounds: 3 })), '3');
});

test('launchOptions: the browser rasters on the CPU, whole tiles, so a loaded machine draws the same edges', () => {
  for (const a of ['--disable-gpu', '--disable-partial-raster']) assert.ok(launchOptions().args.includes(a), a);
});

test('the Pulse state parts open the popover on the loading and failed looks, by the same address in both hosts', () => {
  assert.deepEqual(PULSE_STATES.map(([id]) => `state-${id}`), ['state-loading-pulse', 'state-failed-pulse']);
  for (const [id, s] of PULSE_STATES) {
    const p = PARTS.find((x) => x.id === `state-${id}`);
    assert.equal(p.app.route, `?state=${s}#activity`);
    assert.equal(p.app.route, p.proto.route);
  }
});

test('the compare and the gates start the app on demo data (WORCA_STILLHET_DEMO=1)', async () => {
  const { readFileSync } = await import('node:fs');
  for (const f of ['stillhet-compare.mjs', 'stillhet-gates.mjs']) assert.match(readFileSync(new URL(`../tools/${f}`, import.meta.url), 'utf8'), /WORCA_STILLHET_DEMO: '1'/, f);
});

test('the comparison stores rail as a person does; the gates lock it with WORCA_FLAGS', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../tools/stillhet-compare.mjs', import.meta.url), 'utf8');
  assert.match(src, /lockRail \? \{\} : \{ flags: \{ rail: true \} \}/);
  assert.match(src, /WORCA_FLAGS: lockRail \? 'rail' : ''/);
  assert.match(readFileSync(new URL('../tools/stillhet-gates.mjs', import.meta.url), 'utf8'), /\{ lockRail: true \}/);
});
