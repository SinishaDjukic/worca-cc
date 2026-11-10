// The Design stage controller (ui/public/design/stage.mjs): createStage over the model, the frame host, the reveal, the
// overlay, the HUD and the Agents popover, driven through test/helpers/design-stage-rig.mjs with frames shaped as P2
// sends them (test/helpers/design-stage-frames.mjs) and C-6 messages as P3 sends them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detailToFrames } from '../ui/public/design/stage.mjs';
import { rig } from './helpers/design-stage-rig.mjs';
import { DID, BID, A1, A2, LEAD as LEAD_ID, build, plan, agent, section, delta, file } from './helpers/design-stage-frames.mjs';
const ROW = { id: BID, designId: DID, round: 1, kind: 'first', status: 'building', brief: 'b', fast: false, reason: null, agentsTotal: 1, layers: 0, costUsd: 0, costKnown: true, startedAt: '2026-11-05T10:00:00Z', endedAt: null, createdBy: null };
const LIVE = { design: { id: DID, kind: 'web', title: 'T', version: 0, threadId: null }, plan: null, build: ROW, sections: [], versions: [] };
const DONE = { ...LIVE, design: { ...LIVE.design, version: 1 }, build: { ...ROW, status: 'done', agentsTotal: 29, costUsd: 4.2, endedAt: '2026-11-05T10:06:14Z' } };

test('a live design: mints, loads the build doc and subscribes; ready sends hello first', async () => {
  const { stage, posts, ws, frames, readyFrame, sent, tick } = await rig(LIVE);
  assert.ok(posts.some((p) => p.url === `/api/design/${DID}/preview-token`));
  assert.deepEqual(ws, [{ type: 'subscribe', designBuildId: BID }]);
  assert.match(frames()[0].getAttribute('src'), /\/build\/#n=/);
  readyFrame('build'); await tick();
  assert.equal(sent()[0].t, 'hello');
});
test('a finished design opens the run doc, its HUD says what happened, no subscribe', async () => {
  const { ws, frames, q } = await rig(DONE);
  assert.deepEqual(ws, []);
  assert.match(frames()[0].getAttribute('src'), /\/run\/#n=/);
  assert.equal(q('.dz-hud-text').textContent, 'Built by 29 agents in 6m 14s · $4.20');
  assert.equal(q('.dz-state').textContent, 'Built');
});
test('an empty design has no frame, no HUD and one line', async () => {
  const { frames, q } = await rig({ ...LIVE, build: null, design: { ...LIVE.design, version: 0 } });
  assert.deepEqual(frames(), []);
  assert.ok(q('.dz-hud').classList.contains('is-none'));
  assert.equal(q('.dz-empty').textContent, 'Nothing built yet');
});
test('U3 end to end: `.dz-cursor` count equals the HUD count after every frame', async () => {
  const { stage, q, qa, readyFrame, paint } = await rig(LIVE);
  readyFrame('build');
  const script = [build(), plan(['a', 'b', 'c']), agent(A1, 'writing', { sectionId: 'a', job: 'A' }), agent(A2, 'waiting', { sectionId: 'b', job: 'B' }), agent(A1, 'done', { sectionId: 'a', job: 'A' }), agent(A2, 'writing', { sectionId: 'b', job: 'B' }), agent(A2, 'error', { sectionId: 'b', job: 'B' }), build('paused', { reason: 'failed' })];
  for (const f of script) {
    stage.pushFrame(f); paint();
    const n = qa('.dz-cursor:not(.is-leaving)').length;
    const m = /^(\d+) agents?/.exec(q('.dz-hud-text').textContent);
    assert.equal(m ? Number(m[1]) : 0, n, f.type);
  }
});
test('deltas go through the reveal to `section` messages; css goes straight; design-file settles as final', async () => {
  const { stage, readyFrame, sent, clock } = await rig(LIVE);
  readyFrame('build');
  stage.pushFrame(build()); stage.pushFrame(plan(['hero'])); stage.pushFrame(agent(A1, 'writing'));
  stage.pushFrame(delta('sections/hero/index.html', 1, 0, '<section><h1>Ship</h1></section>'));
  stage.pushFrame(delta('sections/hero/style.css', 1, 0, '.a{}', { part: 'css' }));
  clock.tick(3000);
  assert.equal(sent().filter((m) => m.t === 'section').at(-1).html, '<section><h1>Ship</h1></section>');
  assert.deepEqual(sent().filter((m) => m.t === 'css').at(-1).file, 'hero');
  stage.pushFrame(file('sections/hero/index.html', 2, '<section>end</section>'));
  clock.tick(3000);
  assert.deepEqual([sent().filter((m) => m.t === 'section').at(-1).html, sent().filter((m) => m.t === 'section').at(-1).final], ['<section>end</section>', true]);
});
test('a too-big design-file is fetched through the preview route and then applied', async () => {
  const { stage, readyFrame, gets, clock, tick, sent } = await rig(LIVE, { files: { '/design-preview/TOK/build/sections/hero/index.html': '<section>big</section>' } });
  readyFrame('build');
  stage.pushFrame(build()); stage.pushFrame(plan(['hero'])); stage.pushFrame({ ...file('sections/hero/index.html', 1, ''), text: undefined, bytes: 22 }); // bytes = the served text's UTF-8 length
  await tick(); clock.tick(3000);
  assert.ok(gets.includes('/design-preview/TOK/build/sections/hero/index.html'));
  assert.equal(sent().filter((m) => m.t === 'section').at(-1).html, '<section>big</section>');
});
test('C-6 facts reach the overlay: applied moves the cursor and draws the box; rects moves the layer', async () => {
  const { stage, q, fireMsg, readyFrame, paint } = await rig(LIVE);
  readyFrame('build');
  stage.pushFrame(build()); stage.pushFrame(plan(['hero'])); stage.pushFrame(agent(A1, 'writing'));
  fireMsg('rects', { scrollX: 0, scrollY: 40, vw: 1440, vh: 900, docH: 4000, sections: [{ id: 'hero', rect: [100, 200, 500, 300] }] });
  fireMsg('applied', { id: 'hero', rev: 1, added: 1, layers: 7, rect: [100, 200, 500, 300], tail: { rect: [300, 230, 8, 20], tag: 'p', box: [100, 220, 500, 58] }, marks: [], overflow: false });
  paint(); paint();
  assert.equal(q('.dz-cursor').style.getPropertyValue('--x'), '310px');
  assert.equal(q('.dz-box .dz-tag').textContent, 'p 500×58');
  assert.equal(q('.overlay-doc.is-cursors').style.transform, 'translate(0px, -40px)');
  assert.match(q('.dz-hud-text').textContent, /7 layers/);
});
test('M11: a crew change eases the box and scrolls the frame; the box is never shorter than the stage during the ease', async () => {
  const { stage, q, fireMsg, readyFrame, paint, sent, clock } = await rig(LIVE, { size: [1096, 900] });
  readyFrame('build');
  stage.pushFrame(build()); stage.pushFrame(plan(['a', 'b']));
  fireMsg('rects', { scrollX: 0, scrollY: 0, vw: 1, vh: 1, docH: 6000, sections: [{ id: 'a', rect: [0, 2000, 1440, 1000] }, { id: 'b', rect: [0, 3000, 1440, 1000] }] });
  const before = parseFloat(q('.frame-box').style.height);
  stage.pushFrame(agent(A1, 'writing', { sectionId: 'a' })); stage.pushFrame(agent(A2, 'writing', { sectionId: 'b' })); paint();
  const box = q('.frame-box');
  const s = Number(box.style.getPropertyValue('--s'));
  assert.equal(s, 0.45);
  assert.equal(box.style.getPropertyValue('--cam-ms'), '400ms');
  assert.match(box.style.transform, /scale\(0\.45\)/);
  assert.equal(parseFloat(box.style.height), 900 / 0.45);
  const scroll = sent().filter((m) => m.t === 'scroll').at(-1);
  assert.deepEqual([scroll.behavior, scroll.ms], ['smooth', 400]);
  assert.ok(Math.abs(scroll.y - (2000 - 14 / 0.45)) < 0.01);
  assert.ok(before < 900 / 0.45);
  const zoomIn = q('.frame-box');
  stage.pushFrame(agent(A2, 'done', { sectionId: 'b' })); stage.pushFrame(agent(A1, 'done', { sectionId: 'a' }));
  stage.pushFrame(agent('a_00000009', 'writing', { sectionId: 'a' })); paint();
  const during = parseFloat(zoomIn.style.height);
  assert.equal(during, 900 / 0.45, 'zooming in keeps the taller box until the ease ends');
  clock.tick(400);
  assert.ok(parseFloat(zoomIn.style.height) < during);
});
test('M11: reduced motion moves at once; the person takes the camera; Follow gives it back; done returns to the top', async () => {
  const r = await rig(LIVE, { size: [1096, 900], reduced: true });
  r.readyFrame('build');
  r.stage.pushFrame(build()); r.stage.pushFrame(plan(['a']));
  r.fireMsg('rects', { scrollX: 0, scrollY: 0, vw: 1, vh: 1, docH: 6000, sections: [{ id: 'a', rect: [0, 2000, 1440, 1000] }] });
  r.stage.pushFrame(agent(A1, 'writing', { sectionId: 'a' })); r.paint();
  assert.equal(r.q('.frame-box').style.getPropertyValue('--cam-ms'), '0ms');
  assert.equal(r.sent().filter((m) => m.t === 'scroll').at(-1).behavior, 'auto');
  r.clock.tick(1000);
  r.fireMsg('rects', { scrollX: 0, scrollY: 100, vw: 1, vh: 1, docH: 6000, sections: [{ id: 'a', rect: [0, 2000, 1440, 1000] }] }); r.paint();
  assert.ok([...r.qa('.dz-hud-acts button')].some((b) => b.textContent === 'Follow'));
  [...r.qa('.dz-hud-acts button')].find((b) => b.textContent === 'Follow').click(); r.paint();
  assert.equal([...r.qa('.dz-hud-acts button')].some((b) => b.textContent === 'Follow'), false);
  r.stage.pushFrame(build('done')); r.paint();
  assert.equal(r.sent().filter((m) => m.t === 'scroll').at(-1).y, 0);
});
test('a ctrl-wheel from the frame or the well zooms; a plain wheel over the well does not', async () => {
  const { stage, q, fireMsg, readyFrame, paint, win } = await rig(LIVE, { size: [1096, 900] });
  readyFrame('build'); stage.pushFrame(build()); paint();
  fireMsg('zoom', { dy: 50, y: 100 }); paint();
  assert.ok(Number(q('.frame-box').style.getPropertyValue('--s')) < 1096 / 1440);
  assert.ok([...q('.dz-hud-acts').querySelectorAll('button')].some((b) => b.textContent === 'Follow'));
  const before = q('.frame-box').style.getPropertyValue('--s');
  q('.dz-wrap').dispatchEvent(Object.assign(new win.Event('wheel', { bubbles: true, cancelable: true }), { ctrlKey: false, deltaY: 50, clientY: 0 })); paint();
  assert.equal(q('.frame-box').style.getPropertyValue('--s'), before);
  q('.dz-wrap').dispatchEvent(Object.assign(new win.Event('wheel', { bubbles: true, cancelable: true }), { ctrlKey: true, deltaY: 50, clientY: 0 })); paint();
  assert.notEqual(q('.frame-box').style.getPropertyValue('--s'), before);
});
test('Stop, stop one and Resume hit their routes; M13: a total-limit pause resumes with no dialog and no limit field', async () => {
  const { stage, posts, paint, qa, q, tick, prompts } = await rig(LIVE);
  stage.pushFrame(build()); stage.pushFrame(plan(['hero'])); stage.pushFrame(agent(A1, 'writing')); paint();
  [...qa('.dz-hud-acts button')].find((b) => b.textContent === 'Stop').click();
  qa('.dz-hud-acts button')[1].click(); await tick();
  assert.deepEqual(posts.at(-1), { url: `/api/design/${DID}/builds/${BID}/stop`, body: {} });
  q('.dz-dots button').click(); paint();
  q('[aria-label="Stop Hero"]').click(); await tick();
  assert.deepEqual(posts.at(-1), { url: `/api/design/${DID}/builds/${BID}/agents/${A1}/stop`, body: {} });
  stage.pushFrame(build('paused', { reason: 'failed' })); paint();
  q('.dz-hud .btn-primary').click(); await tick();
  assert.deepEqual(posts.at(-1), { url: `/api/design/${DID}/builds/${BID}/continue`, body: {} });
  stage.pushFrame(build('paused', { reason: 'total-limit', stats: { costUsd: 3.1 } })); paint();
  q('.dz-hud .btn-primary').click(); await tick();
  assert.equal(prompts.length, 0, 'the limit lives in Settings, so Resume asks nothing');
  assert.equal(posts.filter((p) => p.url.endsWith('/continue')).length, 2, 'the second Resume posted too');
  await stage.resume({ sections: ['hero'] });
  assert.deepEqual(posts.at(-1).body, { sections: ['hero'] });
});
test('a dot or a cursor opens the popover on its agent and closes the Stop question', async () => {
  const { stage, q, paint } = await rig(LIVE);
  stage.pushFrame(build()); stage.pushFrame(agent(A1, 'writing')); paint();
  [...q('.dz-hud-acts').querySelectorAll('button')].find((b) => b.textContent === 'Stop').click();
  assert.ok(q('.dz-hud').classList.contains('is-confirm')); q('.dz-cursor').click(); paint();
  assert.equal(q('.dz-hud').classList.contains('is-confirm'), false);
  assert.equal(q('.dz-pop').hidden, false);
  assert.equal(q('.dz-arow.is-picked .dz-aname').textContent, 'Hero');
});
test('M11: a change round ends on its section at the same zoom, in the run doc too; a whole-round Stop holds the zoom', async () => {
  const start = async (kind) => {
    const r = await rig(LIVE, { size: [1096, 900] });
    r.readyFrame('build');
    r.stage.pushFrame(build('building', { kind })); r.stage.pushFrame(plan(['a']));
    r.fireMsg('rects', { scrollX: 0, scrollY: 0, vw: 1, vh: 1, docH: 6000, sections: [{ id: 'a', rect: [0, 2000, 1440, 1500] }] });
    r.stage.pushFrame(agent(A1, 'writing', { sectionId: 'a' })); r.paint();
    return { ...r, s: r.q('.frame-box').style.getPropertyValue('--s'), y: r.sent().filter((m) => m.t === 'scroll').at(-1).y };
  };
  const c = await start('change');
  c.stage.pushFrame(build('done', { kind: 'change' })); c.paint();
  assert.equal(c.q('.frame-box').style.getPropertyValue('--s'), c.s);
  await c.tick(); c.readyFrame('run');
  const last = c.sent().filter((m) => m.t === 'scroll').at(-1);
  assert.deepEqual([last.y, last.behavior], [c.y, 'auto']);
  const st = await start('first');
  const n = st.sent().filter((m) => m.t === 'scroll').length;
  st.stage.pushFrame(build('stopped')); st.paint();
  assert.equal(st.q('.frame-box').style.getPropertyValue('--s'), st.s);
  assert.equal(st.sent().filter((m) => m.t === 'scroll').length, n);
});
test('the run doc swap keeps the old frame until ready; a second loadRunDoc while pending is one load', async () => {
  const { stage, frames, readyFrame, paint } = await rig(LIVE);
  readyFrame('build');
  const old = frames()[0];
  stage.pushFrame(build()); stage.pushFrame(build('done')); await paint();
  stage.loadRunDoc(); await paint();
  assert.equal(frames().length, 2);
  assert.equal(frames()[0], old);
  readyFrame('run');
  assert.equal(frames().length, 1);
  assert.notEqual(frames()[0], old);
});
test('setPick waits for the run doc; picked reaches the chat and draws a pin; unpin removes it', async () => {
  const { stage, sent, readyFrame, fireMsg, picks, paint, q } = await rig(DONE);
  stage.setPick(true);
  readyFrame('run');
  assert.deepEqual(sent().filter((m) => m.t === 'pick').map((m) => m.on), [true]);
  stage.setPick(false);
  assert.deepEqual(sent().filter((m) => m.t === 'pick').map((m) => m.on), [true, false]);
  fireMsg('picked', { id: 'hero', path: 'p', tag: 'h1', text: 'Ship', html: '<h1>', rect: [1, 2, 3, 4] }); paint();
  assert.deepEqual(picks[0], { id: 'hero', path: 'p', tag: 'h1', text: 'Ship', html: '<h1>', rect: [1, 2, 3, 4] });
  assert.ok(q('.dz-box.is-pin'));
  stage.unpin('hero', 'p'); paint();
  assert.equal(q('.dz-box.is-pin'), null);
});
test('R16: a lost frame offers Reload in place, and Reload re-mints', async () => {
  const { stage, q, clock, tick, mints, frames, readyFrame } = await rig(LIVE);
  readyFrame('build');
  frames()[0].dispatchEvent(new (frames()[0].ownerDocument.defaultView.Event)('load'));
  frames()[0].dispatchEvent(new (frames()[0].ownerDocument.defaultView.Event)('load'));
  clock.tick(1500); await tick(); clock.tick(6000); await tick();
  assert.equal(q('.dz-lost').hidden, false);
  assert.match(q('.dz-lost').textContent, /The page left its preview/);
  const n = mints();
  q('.dz-lost button').click(); await tick();
  assert.equal(mints(), n + 1);
  readyFrame('build');
  assert.equal(q('.dz-lost').hidden, true);
});
test('reconnect: hello re-subscribes a live build; a reboot also re-mints', async () => {
  const { stage, ws, mints, tick } = await rig(LIVE);
  const n = ws.length; const m = mints();
  stage.onHello({ rebooted: false });
  assert.deepEqual(ws.slice(n), [{ type: 'subscribe', designBuildId: BID }]);
  stage.onHello({ rebooted: true }); await tick();
  assert.equal(mints(), m + 1);
});
test('viewport: desktop is the plan\'s canvas width; tablet 820; phone 390; the switch is web only', async () => {
  const { stage, q, qa, paint } = await rig(LIVE, { size: [1096, 900] });
  stage.pushFrame(plan(['hero'], { canvas: { w: 1440 } })); paint();
  assert.equal(q('.frame-box').style.width, '1440px');
  assert.ok(qa('.dz-seg button')[0].classList.contains('on'));
  qa('.dz-seg button')[2].click(); paint();
  assert.deepEqual([q('.frame-box').style.width, q('.frame-box').classList.contains('is-narrow')], ['390px', true]);
  assert.deepEqual([...qa('.dz-seg button')].map((b) => b.getAttribute('aria-label')), ['Desktop', 'Tablet', 'Phone']);
  const deck = await rig({ ...LIVE, design: { ...LIVE.design, kind: 'pitch' } });
  assert.equal(deck.q('.dz-seg'), null);
});
test('hide cursors hides overlay and marks, the HUD count stays', async () => {
  const { stage, q, qa, paint } = await rig(LIVE);
  stage.pushFrame(build()); stage.pushFrame(agent(A1, 'writing')); paint();
  q('[aria-label="Hide cursors"]').click(); paint();
  assert.equal(qa('.dz-cursor').length, 0);
  assert.match(q('.dz-hud-text').textContent, /^1 agent/);
});
test('a hidden tab: no paint without an animation frame, and everything lands when it comes back', async () => {
  const { stage, q, paint } = await rig(LIVE);
  stage.pushFrame(build()); stage.pushFrame(agent(A1, 'writing'));
  assert.equal(q('.dz-cursor'), null);
  paint();
  assert.ok(q('.dz-cursor'));
});
test('destroy leaves no timer, no listener and no frame', async () => {
  const { stage, clock, frames, ws, paint } = await rig(LIVE);
  stage.destroy();
  assert.deepEqual([clock.pending(), frames().length], [0, 0]);
  const n = ws.length; stage.pushFrame(build('planning', { buildId: 'b_000000000009' })); paint();
  assert.equal(ws.length, n, 'a destroyed stage takes no frames');
});

// Beyond the plan's list: Step 3 rules the cases above do not reach.
test('beyond the plan: detailToFrames maps the store row and merges the plan with its section records', () => {
  const detail = {
    ...LIVE,
    plan: { canvas: { w: 1200 }, sections: [{ id: 'hero', job: 'Hero', band: 'Top', estHeight: 600, duration: 4 }, { id: 'faq', job: 'FAQ', estHeight: 300 }] },
    build: { ...ROW, agentsTotal: 3, layers: 9, costUsd: 1.5, costKnown: false },
    sections: [{ id: 'hero', status: 'done', agentId: A1, summary: 'Hero done' }, { id: 'old', status: 'failed', agentId: null, summary: '' }],
  };
  assert.deepEqual(detailToFrames(detail, Date.parse('2026-11-05T10:01:00Z')), [
    {
      type: 'design-build', designId: DID, buildId: BID, seq: 0, status: 'building', round: 1, kind: 'first', reason: null, waiting: 0,
      stats: { agentsNow: 0, agentsTotal: 3, sectionsDone: 1, sectionsPlanned: 2, failed: 1, layers: 9, costUsd: 1.5, estimatedUsd: 0, costKnown: false, elapsedMs: 60000 },
    },
    {
      type: 'design-plan', designId: DID, buildId: BID, seq: 0, planRev: 1, canvas: { w: 1200 },
      sections: [
        { id: 'hero', job: 'Hero', band: 'Top', estHeight: 600, duration: 4, status: 'done', agentId: A1, summary: 'Hero done' },
        { id: 'faq', job: 'FAQ', estHeight: 300, status: 'planned', agentId: null, summary: '' },
      ],
    },
  ]);
  assert.equal(detailToFrames(DONE)[0].stats.elapsedMs, 374000, 'a finished round runs to endedAt');
  assert.deepEqual(detailToFrames({ ...LIVE, build: null }), []);
});
test('beyond the plan: a design with versions and no build row opens its run doc; a restore reloads it and the details', async () => {
  const r = await rig({ ...LIVE, build: null, design: { ...LIVE.design, version: 2 } });
  assert.match(r.frames()[0].getAttribute('src'), /\/run\/#n=/);
  assert.equal(r.q('.dz-empty').hidden, true);
  assert.equal(r.q('.dz-state').hidden, true, 'no round, no state word');
  const d = await rig(DONE);
  d.readyFrame('run');
  d.stage.pushFrame({ type: 'design-restored', designId: DID }); await d.tick();
  assert.ok(d.gets.includes(`/api/design/${DID}`));
  assert.equal(d.frames().length, 2, 'the restored run doc loads beside the old one');
});
test('beyond the plan: every frame carries `.dz-frame` and stays under the overlay', async () => {
  const { stage, frames, readyFrame, q, win, tick } = await rig(LIVE);
  readyFrame('build');
  stage.pushFrame(build()); stage.pushFrame(plan(['hero'])); await tick();
  assert.equal(frames().length, 2);
  for (const f of frames()) {
    assert.ok(f.classList.contains('dz-frame'));
    for (const layer of [q('.overlay-clip'), q('.overlay-doc.is-cursors')]) {
      assert.ok(f.compareDocumentPosition(layer) & win.Node.DOCUMENT_POSITION_FOLLOWING, 'the overlay paints over the frame');
    }
  }
});
test('beyond the plan: a Continue after `done`, before the run doc is ready, goes back to the build doc', async () => {
  const { stage, frames, readyFrame, tick } = await rig(LIVE);
  readyFrame('build');
  stage.pushFrame(build()); stage.pushFrame(build('done')); await tick();
  assert.match(frames().at(-1).getAttribute('src'), /\/run\//);
  stage.pushFrame(build('building')); await tick();
  assert.equal(frames().length, 2);
  assert.match(frames().at(-1).getAttribute('src'), /\/build\//);
});
test('beyond the plan: a refused Stop takes back the quick exits and says why; a refused Resume rejects with the error', async () => {
  const { stage, q, qa, paint, tick } = await rig(LIVE, {
    answers: {
      [`/api/design/${DID}/builds/${BID}/stop`]: [409, { error: 'The build is not running' }],
      [`/api/design/${DID}/builds/${BID}/continue`]: [403, { error: 'worca has reached its total limit', code: 'total-limit' }],
    },
  });
  stage.pushFrame(build()); stage.pushFrame(agent(A1, 'writing')); paint();
  [...qa('.dz-hud-acts button')].find((b) => b.textContent === 'Stop').click();
  qa('.dz-hud-acts button')[1].click();
  assert.equal(stage.model().stopping, true);
  await tick(); paint();
  assert.equal(stage.model().stopping, false);
  assert.equal(q('.dz-hud-text').textContent, 'Could not stop');
  assert.equal(q('.dz-hud-text').title, 'The build is not running');
  await assert.rejects(stage.resume({ sections: ['hero'] }), { message: 'worca has reached its total limit', code: 'total-limit', status: 403 });
});
test('beyond the plan: a fetched draft counts UTF-8 bytes; one of another size asks for a snapshot', async () => {
  const path = '/design-preview/TOK/build/sections/hero/index.html';
  const { stage, readyFrame, sent, ws, clock, tick } = await rig(LIVE, { files: { [path]: '<p>é</p>' } });
  readyFrame('build');
  stage.pushFrame(build()); stage.pushFrame(plan(['hero']));
  stage.pushFrame({ ...file('sections/hero/index.html', 1, ''), text: undefined, bytes: 9 });
  await tick(); clock.tick(3000);
  assert.equal(sent().filter((m) => m.t === 'section').at(-1).html, '<p>é</p>');
  const n = ws.length;
  stage.pushFrame({ ...file('sections/hero/index.html', 2, ''), text: undefined, bytes: 99 });
  await tick();
  assert.deepEqual(ws.slice(n), [{ type: 'subscribe', designBuildId: BID }]);
});
test('beyond the plan: the preview token ages on the wall clock, as its epoch `expiresAt` does', async () => {
  const { stage, readyFrame, mints, clock, tick } = await rig(LIVE, { epoch: Date.parse('2026-11-05T10:00:00Z') });
  readyFrame('build');
  stage.pushFrame(build()); stage.pushFrame(plan(['hero'])); await tick();
  assert.equal(mints(), 1, 'a fresh token is used again');
  readyFrame('build');
  clock.tick(43200000 - 30000);
  stage.pushFrame({ ...file('sections/hero/index.html', 1, ''), text: undefined, bytes: 22 }); await tick();
  assert.equal(mints(), 2, 'a draft fetch within a minute of the token\'s end mints again');
  stage.pushFrame(plan(['hero', 'faq'])); await tick();
  assert.equal(mints(), 3, 'so does the frame host');
});
test('beyond the plan: a move while the box eases restarts its settle', async () => {
  const { stage, q, fireMsg, readyFrame, paint, clock } = await rig(LIVE, { size: [1096, 900] });
  readyFrame('build');
  stage.pushFrame(build()); stage.pushFrame(plan(['a', 'b']));
  fireMsg('rects', { scrollX: 0, scrollY: 0, vw: 1, vh: 1, docH: 6000, sections: [{ id: 'a', rect: [0, 2000, 1440, 1000] }, { id: 'b', rect: [0, 3000, 1440, 1000] }] });
  stage.pushFrame(agent(A1, 'writing', { sectionId: 'a' })); stage.pushFrame(agent(A2, 'writing', { sectionId: 'b' })); paint();
  clock.tick(300);
  stage.pushFrame(agent(A2, 'done', { sectionId: 'b' })); paint();
  clock.tick(200);
  assert.equal(parseFloat(q('.frame-box').style.height), 900 / 0.45, 'the first move\'s settle no longer lands');
  clock.tick(200);
  assert.ok(parseFloat(q('.frame-box').style.height) < 900 / 0.45);
});
test('beyond the plan: a frame zoom keeps the page point under the pointer; a meta wheel over the well zooms too', async () => {
  const { stage, q, fireMsg, readyFrame, paint, sent, win } = await rig(LIVE, { size: [1096, 900] });
  readyFrame('build'); stage.pushFrame(build());
  fireMsg('rects', { scrollX: 0, scrollY: 1000, vw: 1, vh: 1, docH: 6000, sections: [] }); paint();
  const s0 = Number(q('.frame-box').style.getPropertyValue('--s'));
  fireMsg('zoom', { dy: 50, y: 100 }); paint();
  const s1 = Number(q('.frame-box').style.getPropertyValue('--s'));
  const { y } = sent().filter((m) => m.t === 'scroll').at(-1);
  assert.ok(Math.abs(y + (100 * s0) / s1 - 1100) < 1e-6, 'page y 1100 stays under the pointer');
  q('.dz-wrap').dispatchEvent(Object.assign(new win.Event('wheel', { bubbles: true, cancelable: true }), { metaKey: true, deltaY: 50, clientY: 0 })); paint();
  assert.notEqual(q('.frame-box').style.getPropertyValue('--s'), String(s1));
});
test('beyond the plan: the dot tip names its agent while hovered; an open popover and the Plan list follow every paint', async () => {
  const { stage, q, paint, plans, win } = await rig(LIVE);
  stage.pushFrame(build()); stage.pushFrame(plan(['hero', 'faq']));
  stage.pushFrame(agent(A1, 'writing', { tool: { name: 'Write', path: 'sections/hero/index.html' } })); paint();
  assert.deepEqual(plans.at(-1).rows.map((r) => [r.name, r.state]), [['Hero', 'active'], ['Faq', 'planned']]);
  const dot = q('.dz-dots button');
  dot.dispatchEvent(new win.Event('mouseenter'));
  assert.deepEqual([q('.dz-tip').hidden, q('.dz-tip b').textContent, q('.dz-tip span').textContent], [false, 'Hero', 'Writing index.html']);
  dot.dispatchEvent(new win.Event('mouseleave'));
  assert.equal(q('.dz-tip').hidden, true);
  stage.showAgent(A1);
  stage.pushFrame(agent(A1, 'done')); paint();
  assert.equal(q('.dz-arow .dz-astat').textContent, 'Done');
});
test('beyond the plan: destroy also drops a paint and an ease still due', async () => {
  const { stage, clock, fireMsg, readyFrame } = await rig(LIVE, { size: [1096, 900] });
  readyFrame('build');
  stage.pushFrame(build()); stage.pushFrame(plan(['a']));
  fireMsg('rects', { scrollX: 0, scrollY: 0, vw: 1, vh: 1, docH: 6000, sections: [{ id: 'a', rect: [0, 2000, 1440, 1000] }] });
  stage.pushFrame(agent(A1, 'writing', { sectionId: 'a' }));
  assert.equal(clock.pending(), 2, 'a paint and the ease\'s settle');
  stage.destroy();
  assert.equal(clock.pending(), 0);
});
test('beyond the plan: an agent that leaves settles its text at once; a removed section drops what is still pacing', async () => {
  const { stage, readyFrame, sent, clock } = await rig(LIVE);
  readyFrame('build');
  stage.pushFrame(build()); stage.pushFrame(plan(['hero', 'faq'])); stage.pushFrame(agent(A1, 'writing'));
  stage.pushFrame(delta('sections/hero/index.html', 1, 0, '<section><h1>Ship</h1></section>'));
  stage.pushFrame(agent(A1, 'done'));
  const last = sent().filter((m) => m.t === 'section' && m.id === 'hero').at(-1);
  assert.deepEqual([last.html, last.final], ['<section><h1>Ship</h1></section>', true]);
  stage.pushFrame(delta('sections/faq/index.html', 1, 0, '<section><h2>Questions</h2><p>Many</p></section>'));
  const n = sent().length;
  stage.pushFrame(section('faq', 'removed')); clock.tick(3000);
  assert.deepEqual(sent().slice(n).filter((m) => m.t === 'section'), []);
});
test('beyond the plan: a doc on its way is not loaded again; the empty line shows until a round starts', async () => {
  const { stage, frames, readyFrame, tick } = await rig(LIVE);
  readyFrame('build');
  stage.pushFrame(build()); stage.pushFrame(build('done')); await tick();
  const pending = frames()[1];
  stage.loadRunDoc(); await tick();
  assert.equal(frames()[1], pending, 'the run doc on its way is the same frame');
  const e = await rig({ ...LIVE, build: null, design: { ...LIVE.design, version: 0 } });
  assert.equal(e.q('.dz-empty').hidden, false);
  e.stage.pushFrame(build('planning')); e.paint();
  assert.equal(e.q('.dz-empty').hidden, true);
});
test('a focused HUD dot opens the popover, which takes the focus; Esc closes it from the popover or the dot, and the dot gets the focus back (review M7)', async () => {
  const { stage, q, win, doc, paint } = await rig(LIVE);
  stage.pushFrame(build()); stage.pushFrame(plan(['hero'])); stage.pushFrame(agent(A1, 'writing')); paint();
  const dot = q('.dz-dots button');
  dot.focus(); dot.click(); paint();
  assert.equal(q('.dz-pop').hidden, false);
  assert.ok(q('.dz-pop').contains(doc.activeElement), 'the dialog has the focus');
  doc.activeElement.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.deepEqual([q('.dz-pop').hidden, doc.activeElement], [true, dot]);
  dot.click(); paint(); dot.focus();
  const outer = []; doc.addEventListener('keydown', (e) => outer.push(e.key));
  dot.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(q('.dz-pop').hidden, true, 'Esc on the dot closes it too');
  assert.deepEqual(outer, [], 'and goes no further than the well');
  dot.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.deepEqual(outer, ['Escape'], 'with the popover closed, the well lets Esc go');
});
test('the agent finishes while its Stop has focus: the focus stays in the popover and Esc closes it (review cycle 2)', async () => {
  const { stage, q, win, doc, paint } = await rig(LIVE);
  stage.pushFrame(build()); stage.pushFrame(plan(['hero'])); stage.pushFrame(agent(A1, 'writing')); paint();
  const dot = q('.dz-dots button'); dot.focus(); dot.click(); paint();
  assert.equal(doc.activeElement, q('.dz-pop-head button'), 'open focuses ×, not the unconfirmed Stop');
  q('[aria-label="Stop Hero"]').focus();
  stage.pushFrame(agent(A1, 'done')); paint();
  assert.equal(q('[aria-label="Stop Hero"]'), null);
  assert.ok(q('.dz-pop').contains(doc.activeElement), 'not <body>');
  doc.activeElement.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(q('.dz-pop').hidden, true);
});
test('Stop pressed, then `stopped`: the focus stays in the popover and Esc closes it (review cycle 2)', async () => {
  const { stage, q, win, doc, paint, tick, posts } = await rig(LIVE);
  stage.pushFrame(build()); stage.pushFrame(plan(['hero'])); stage.pushFrame(agent(A1, 'writing')); paint();
  const dot = q('.dz-dots button'); dot.focus(); dot.click(); paint();
  const stop = q('[aria-label="Stop Hero"]'); stop.focus(); stop.click(); await tick();
  assert.deepEqual(posts.at(-1).url, `/api/design/${DID}/builds/${BID}/agents/${A1}/stop`);
  stage.pushFrame(agent(A1, 'stopped')); paint();
  assert.ok(q('.dz-pop').contains(doc.activeElement), 'not <body>');
  doc.activeElement.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(q('.dz-pop').hidden, true);
});
const B2 = 'b_000000000002';
test('a new round\'s doc gets the text again even when it equals what the last round showed (review M9, reveal.drop on a new buildId)', async () => {
  const { stage, readyFrame, sent, clock } = await rig(LIVE);
  readyFrame('build');
  stage.pushFrame(build()); stage.pushFrame(plan(['hero'])); stage.pushFrame(agent(A1, 'writing'));
  stage.pushFrame(delta('sections/hero/index.html', 1, 0, '<p>X</p>'));
  stage.pushFrame(file('sections/hero/index.html', 2, '<p>X</p>'));
  clock.tick(3000);
  assert.equal(sent().filter((m) => m.t === 'section').at(-1).html, '<p>X</p>');
  stage.pushFrame(build('building', { buildId: B2 }));
  readyFrame('build');
  const n = sent().length;
  stage.pushFrame(plan(['hero'], { buildId: B2 })); stage.pushFrame(agent(A1, 'writing', { buildId: B2 }));
  stage.pushFrame(delta('sections/hero/index.html', 1, 0, '<p>X</p>', { buildId: B2 }));
  clock.tick(3000);
  assert.equal(sent().slice(n).filter((m) => m.t === 'section').at(-1)?.html, '<p>X</p>', 'the new doc is sent it');
});
test('a fetched draft that lands after a new round began is dropped as the old round\'s (review M9)', async () => {
  const { stage, readyFrame, gets, clock, tick } = await rig(LIVE, { files: { '/design-preview/TOK/build/sections/hero/index.html': '<section>big</section>' } });
  readyFrame('build');
  stage.pushFrame(build()); stage.pushFrame(plan(['hero']));
  stage.pushFrame({ ...file('sections/hero/index.html', 1, ''), text: undefined, bytes: 22 });
  stage.pushFrame(build('building', { buildId: B2 }));   // before the fetch answers
  await tick(); await tick(); clock.tick(3000);
  assert.ok(gets.includes('/design-preview/TOK/build/sections/hero/index.html'));
  assert.equal(stage.model().buildId, B2);
  assert.equal(Object.hasOwn(stage.model().drafts, 'sections/hero/index.html'), false, 'the old round\'s text is not the new round\'s draft');
});
test('a zoom from a run doc is its page\'s own script, and zooms nothing (review N3)', async () => {
  const { q, fireMsg, readyFrame, paint } = await rig(DONE, { size: [1096, 900] });
  readyFrame('run'); paint();
  const before = q('.frame-box').style.getPropertyValue('--s');
  fireMsg('zoom', { dy: 50, y: 100 }); paint();
  assert.equal(q('.frame-box').style.getPropertyValue('--s'), before);
});

// 2026-11-10: a design with nothing built showed its empty (black) page for the whole planning phase. The frame now
// waits out of sight until it has something to show, and the well says what is going on.
test('standby: the frame is out of sight until a plan lands; the well says who is at work; a built design never blanks', async () => {
  const EMPTY = { ...LIVE, build: null, design: { ...LIVE.design, version: 0 } };
  const e = await rig(EMPTY);
  assert.ok(e.q('.dz-wrap').classList.contains('is-blank'));
  assert.equal(e.q('.dz-empty').hidden, false, 'idle: the one line, as before');
  assert.equal(e.q('.dz-standby').hidden, true);
  e.stage.setChatBusy(true); e.paint();
  assert.equal(e.q('.dz-empty').hidden, true);
  assert.equal(e.q('.dz-standby').hidden, false);
  assert.equal(e.q('.dz-standby-title').textContent, 'Reading your request');
  e.stage.setChatBusy(false);
  e.stage.pushFrame(build('planning')); e.paint();
  assert.equal(e.q('.dz-standby-title').textContent, 'Planning the page');
  assert.equal(e.q('.dz-standby-doing').hidden, true);
  e.stage.pushFrame(agent(LEAD_ID, 'reading', { role: 'lead', job: 'Lead', sectionId: null, tool: { name: 'Read', path: 'work/brief.md' } })); e.paint();
  assert.equal(e.q('.dz-standby-doing').textContent, 'Reading brief.md…');
  assert.ok(e.q('.dz-wrap').classList.contains('is-blank'), 'still nothing to look at');
  e.stage.pushFrame(plan(['hero', 'pricing'])); e.paint();
  assert.equal(e.q('.dz-wrap').classList.contains('is-blank'), false, 'the plan\'s slots show: the frame comes in');
  assert.equal(e.q('.dz-standby').hidden, true);
  const d = await rig(DONE);
  assert.equal(d.q('.dz-wrap').classList.contains('is-blank'), false);
  d.stage.pushFrame(build('planning', { buildId: 'b_000000000002', round: 2, kind: 'change' })); d.paint();
  assert.equal(d.q('.dz-wrap').classList.contains('is-blank'), false, 'a change round keeps the page in view');
});
