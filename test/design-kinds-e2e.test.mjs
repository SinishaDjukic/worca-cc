// test/design-kinds-e2e.test.mjs — decks and video end to end on the mock engine: the real server, the real chat
// route and the mock engine build a pitch, a presentation and a video, and a change round on a deck. Each row checks
// the plan frames, the served build and run docs (the board while building, the real deck or film at the end, `.kit/`
// a 404), `dist` and the HTML export.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bootDesignChat } from './helpers/design-chat-boot.mjs';
import { distDir } from '../src/core/design/paths.mjs';
import { updateDesign } from '../src/core/design/store.mjs';
import { BRIDGE_MARKER } from '../src/core/design/assemble.mjs';

const { base: origin, call, openWs, waitFrame, settled } = await bootDesignChat(after);
const fetchRaw = (path) => fetch(origin + path);   // the mint answers a path (`preview-gate.mjs:167`); no auth headers, as a frame's own requests
const stageOf = (html) => new JSDOM(html).window.document.querySelector('body deck-stage');   // no scripts run; the kit's text quotes `no-rail` itself
const MODEL = { model: 'claude-opus-5-5', effort: 'high' };

async function buildKind(kind) {
  const frames = []; const ws = await openWs((f) => frames.push(f));
  const d = (await call('POST', '/api/design', { kind, title: kind })).body;
  // A video's first start asks about sound first (Design sound C1); the API cannot set it, so the store answers it.
  if (kind === 'video') updateDesign(d.design.id, { sound: { on: false } });
  await call('POST', `/api/ask/threads/${d.threadId}/messages`, { text: `A ${kind}. MOCK_SECTIONS=3`, ...MODEL, design: { designId: d.design.id, pins: [] } });
  await waitFrame(frames, (f) => f.type === 'design-build' && f.designId === d.design.id && f.status === 'done', 60000);
  ws.close();
  const { base } = (await call('POST', `/api/design/${d.design.id}/preview-token`, {})).body;
  return { d, frames, base };
}

test('a pitch: tiles while building, the real deck at the end, .kit unreachable', async () => {
  const { d, frames, base } = await buildKind('pitch');
  const plan = frames.filter((f) => f.type === 'design-plan').at(-1);
  assert.deepEqual([plan.canvas.w, plan.canvas.h, plan.sections.length, 'estHeight' in plan.sections[0]], [1920, 1080, 3, false]);
  const build = await (await fetchRaw(`${base}/build/`)).text();
  assert.ok(build.includes('data-worca-board'));
  assert.equal(stageOf(build).hasAttribute('data-worca-board'), true, 'the deck itself is the board, not only its style');
  assert.equal(build.includes("customElements.define('deck-stage'"), false);
  const run = await (await fetchRaw(`${base}/run/`)).text();
  assert.equal(stageOf(run).hasAttribute('no-rail'), true); assert.ok(run.includes("customElements.define('deck-stage'")); assert.ok(run.includes(BRIDGE_MARKER));
  assert.equal(run.indexOf(BRIDGE_MARKER) < run.indexOf("customElements.define('deck-stage'"), true, 'the bridge is first');
  assert.equal((await fetchRaw(`${base}/run/.kit/deck-stage.js`)).status, 404);
  const dist = readFileSync(join(distDir(d.design.id), 'index.html'), 'utf8');
  assert.equal(dist.includes(BRIDGE_MARKER), false); assert.equal(stageOf(dist).hasAttribute('no-rail'), false);
  const out = await call('POST', `/api/design/${d.design.id}/export`, { format: 'html' });
  assert.ok(String(out.body).includes('__DECK_EXPORTED'));
  assert.equal(String(out.body).includes(BRIDGE_MARKER), false);
});

test('a presentation takes the same path', async () => {
  const { base } = await buildKind('presentation');
  assert.ok((await (await fetchRaw(`${base}/run/`)).text()).includes('<deck-stage width="1920" height="1080" no-rail>'));
});

test('a video: durations on the plan, the film in the run doc, an export that plays alone', async () => {
  const { d, frames, base } = await buildKind('video');
  assert.deepEqual(frames.filter((f) => f.type === 'design-plan').at(-1).sections.map((s) => s.duration), [4, 4, 4]);
  assert.ok(frames.some((f) => f.type === 'design-delta' && f.part === 'js'));
  const build = await (await fetchRaw(`${base}/build/`)).text();
  assert.ok(build.includes('<div data-film data-worca-board>')); assert.equal(build.includes('F.start'), false);
  const run = await (await fetchRaw(`${base}/run/`)).text();
  assert.ok(run.includes('"embedded":true')); assert.ok(run.includes('F.start();'));
  const out = String((await call('POST', `/api/design/${d.design.id}/export`, { format: 'html' })).body);
  assert.ok(out.includes('"embedded":false')); assert.doesNotMatch(out, /<script[^>]+\ssrc=/); assert.equal(out.includes(BRIDGE_MARKER), false);
});

test('a change round on a deck goes back to the board, and the run doc after', async () => {
  const { d, base } = await buildKind('pitch');
  await settled(d.threadId);   // else the route answers 409 `turn in flight` (`askTurnRefusal`, `ui/routes/chat/thread-turns.mjs:160`)
  const frames = []; const ws = await openWs((f) => frames.push(f));
  const mine = (f) => f.type === 'design-build' && f.designId === d.design.id;
  assert.equal((await call('POST', `/api/ask/threads/${d.threadId}/messages`, { text: 'Make it bolder', ...MODEL, design: { designId: d.design.id, pins: [] } })).status, 202);
  await waitFrame(frames, (f) => mine(f) && f.status === 'done', 60000);
  ws.close();
  const statuses = frames.filter(mine).map((f) => f.status);
  const live = statuses.findIndex((s) => ['planning', 'building'].includes(s));
  assert.ok(live >= 0 && statuses.indexOf('done', live) > live, 'a live round, then done');
  const build = await (await fetchRaw(`${base}/build/`)).text();
  assert.ok(build.includes('data-worca-board')); assert.equal(stageOf(build).hasAttribute('data-worca-board'), true);
  assert.equal(stageOf(await (await fetchRaw(`${base}/run/`)).text()).hasAttribute('no-rail'), true);
});

// Only the real route proves the chat hand-off's staging and the preview gate's serving together: the run doc loads
// worca's fonts from assets/worca/ (same origin), never from `.kit/`.
test('a document: no board, a TOC in the run doc, worca\'s fonts, a PDF-ready export', async () => {
  const { d, frames, base } = await buildKind('document');
  const plan = frames.filter((f) => f.type === 'design-plan').at(-1);
  assert.deepEqual([plan.canvas.w, plan.sections.length, plan.sections[0].estHeight], [794, 3, 600]);
  const build = await (await fetchRaw(`${base}/build/`)).text();
  const buildDoc = new JSDOM(build).window.document;   // the bridge script's own text names the board, so the DOM is read
  assert.equal(buildDoc.querySelector('deck-stage, [data-worca-board], [data-film], style[data-worca-board-css]'), null);
  const run = await (await fetchRaw(`${base}/run/`)).text();
  assert.ok(run.includes('data-worca-toc') && run.includes('@page{size:A4'));
  const font = await fetchRaw(`${base}/run/assets/worca/poppins-latin-400-normal.woff2`);
  assert.deepEqual([font.status, font.headers.get('content-type')], [200, 'font/woff2']);
  assert.deepEqual(Buffer.from(await font.arrayBuffer()), readFileSync(new URL('../ui/public/fonts/poppins-latin-400-normal.woff2', import.meta.url)));
  assert.equal((await fetchRaw(`${base}/run/.kit/CONTRACT.md`)).status, 404);
  assert.ok(readFileSync(join(distDir(d.design.id), 'assets', 'worca', 'poppins-latin-400-normal.woff2')).length > 0);
  const out = String((await call('POST', `/api/design/${d.design.id}/export`, { format: 'html' })).body);
  assert.ok(out.includes('data:font/woff2;base64,') && out.includes('data-worca-toc'));
});
