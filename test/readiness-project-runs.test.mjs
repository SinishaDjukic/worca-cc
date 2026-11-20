// test/readiness-project-runs.test.mjs — the readiness runs on the project page: Evaluate in depth and Set up with AI in
// the header popover's foot and on the Settings card, the run lines (live run to its page, finished run to History),
// and the offers coming back when a run ends. Boots the real app per test (test/helpers/readiness-project-boot.mjs).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import {
  makeBoot, WSStub, NOT_READY, READY, KEY, settle, click, goHash, headChip, openPops,
} from './helpers/readiness-project-boot.mjs';

const trackDom = useDomRelease(afterEach);
const boot = makeBoot(trackDom);

test('clicking Set up with AI posts and opens the run', async () => {
  const state = { report: NOT_READY, setup: { available: true, lastRun: null } };
  const { window } = await boot(state);
  const doc = window.document;
  await goHash(window, 'projects');
  await goHash(window, `projects/${KEY}`);
  click(window, headChip(doc));
  await settle();
  const btn = [...openPops(doc)[0].querySelectorAll('.rp-foot button')].find((b) => b.textContent === 'Set up with AI');
  assert.ok(btn, 'the foot offers Set up with AI');
  click(window, btn);
  await settle();
  assert.deepEqual(state.posts, ['POST']);
  assert.equal(window.location.hash, '#running/run-setup-1', 'the new run is open');
});

test('no Set up with AI button without the plugin', async () => {
  const { window } = await boot({ report: NOT_READY, setup: { available: false, lastRun: null } });
  const doc = window.document;
  await goHash(window, 'projects');
  await goHash(window, `projects/${KEY}`);
  click(window, headChip(doc));
  await settle();
  assert.equal([...openPops(doc)[0].querySelectorAll('.rp-foot button')].some((b) => b.textContent === 'Set up with AI'), false);
});

test('the Setup run line links a live run to its run page and a finished one to History, in words', async () => {
  const state = { report: NOT_READY, setup: { available: true, lastRun: { runId: 'live-9', pipelineId: 'p9', status: 'running', title: 'AI readiness setup' } } };
  const { window } = await boot(state);
  const doc = window.document;
  await goHash(window, 'projects');
  await goHash(window, `projects/${KEY}`);
  click(window, headChip(doc));
  await settle();
  let link = openPops(doc)[0].querySelector('.rp-setup-run');
  assert.equal(link.textContent, 'Setup run: running');
  assert.equal(link.getAttribute('href'), '#running/live-9');
  state.setup = { available: true, lastRun: { runId: null, pipelineId: 'p9', status: 'done', title: 'AI readiness setup' } };
  click(window, [...openPops(doc)[0].querySelectorAll('button')].find((b) => b.textContent === 'Recheck'));
  await settle();
  link = openPops(doc)[0].querySelector('.rp-setup-run');
  assert.equal(link.textContent, 'Setup run: ready to ship');
  assert.equal(link.getAttribute('href'), `#history/${KEY}/p9`);
});

test('the Set up with AI offer comes back once the setup run ends, without a reload', async () => {
  const state = { report: NOT_READY, setup: { available: true, lastRun: null } };
  const { window } = await boot(state);
  const doc = window.document;
  await goHash(window, 'projects');
  await goHash(window, `projects/${KEY}`);
  click(window, headChip(doc));
  await settle();
  click(window, [...openPops(doc)[0].querySelectorAll('.rp-foot button')].find((b) => b.textContent === 'Set up with AI'));
  await settle();
  assert.equal(window.location.hash, '#running/run-setup-1');
  // The run ends: the server's row now reads done, and the live run is gone.
  state.setup = { available: true, lastRun: { runId: null, pipelineId: 'p1', status: 'done', title: 'AI readiness setup' } };
  WSStub.last._frame({ type: 'done', runId: 'run-setup-1', status: 'done', seq: 1 });
  await settle();
  await goHash(window, `projects/${KEY}`);
  click(window, headChip(doc));
  await settle();
  const foot = openPops(doc)[0].querySelector('.rp-foot');
  assert.ok([...foot.querySelectorAll('button')].some((b) => b.textContent === 'Set up with AI'), 'the offer is back');
  assert.equal(foot.querySelector('.rp-setup-run').textContent, 'Setup run: ready to ship');
});

test('the Settings card head is two items: the title, then View report and Set up with AI together on the right', async () => {
  const { window } = await boot({ report: NOT_READY, setup: { available: true, lastRun: null } });
  const doc = window.document;
  await goHash(window, 'projects');
  await goHash(window, `projects/${KEY}/settings`);
  await settle();
  const head = doc.querySelector(`.readiness-settings-card[data-key="${KEY}"] .rs-head`);
  assert.equal(head.children.length, 2, head.innerHTML);
  assert.equal(head.children[0].tagName, 'H3');
  assert.deepEqual([...head.children[1].querySelectorAll('button')].map((b) => b.textContent), ['View report', 'Set up with AI']);
  assert.ok(head.children[1].classList.contains('rs-acts'));
});

const RUN = (o = {}) => ({ available: { check: true, setup: true }, hasCode: true, lastCheck: null, lastSetup: null, live: null, ...o });

test('clicking Evaluate in depth posts kind=check and opens the run', async () => {
  const state = { report: READY, run: RUN() };
  const { window } = await boot(state);
  const doc = window.document;
  await goHash(window, 'projects');
  await goHash(window, `projects/${KEY}`);
  click(window, headChip(doc));
  await settle();
  const btn = [...openPops(doc)[0].querySelectorAll('.rp-foot button')].find((b) => b.textContent === 'Evaluate in depth');
  assert.ok(btn, 'a ready project offers Evaluate in depth');
  click(window, btn);
  await settle();
  assert.deepEqual(state.bodies, [{ kind: 'check' }]);
  assert.equal(window.location.hash, '#running/run-setup-1', 'the new run is open');
});

test('the check line shows the newest score, and a live run replaces the buttons with its line', async () => {
  const state = { report: NOT_READY, run: RUN({ lastCheck: { runId: null, pipelineId: 'c1', status: 'done', title: 't', workflowId: 'wfp_ai-readiness_check', workspaceId: null, score: 64, at: null } }) };
  const { window } = await boot(state);
  const doc = window.document;
  await goHash(window, 'projects');
  await goHash(window, `projects/${KEY}`);
  click(window, headChip(doc));
  await settle();
  const link = openPops(doc)[0].querySelector('.rp-check-run');
  assert.equal(link.textContent, 'Evaluated: 64/100');
  assert.equal(link.getAttribute('href'), `#history/${KEY}/c1`);
  const live = { runId: 'w-live', pipelineId: 'w1', status: 'running', title: 't', workflowId: 'wfp_ai-readiness_setup', workspaceId: 'ws1', score: null, at: null };
  state.run = RUN({ live, lastSetup: live });
  click(window, [...openPops(doc)[0].querySelectorAll('button')].find((b) => b.textContent === 'Recheck'));
  await settle();
  const foot = openPops(doc)[0].querySelector('.rp-foot');
  const names = [...foot.querySelectorAll('button')].map((b) => b.textContent);
  assert.equal(names.includes('Evaluate in depth'), false);
  assert.equal(names.includes('Set up with AI'), false);
  assert.match(foot.querySelector('.rp-live-run').textContent, /^Setup run \(workspace .+\): running$/);
  assert.equal(foot.querySelector('.rp-live-run').getAttribute('href'), '#running/w-live');
});

test('no Evaluate in depth for a project without code', async () => {
  const { window } = await boot({ report: READY, run: RUN({ hasCode: false }) });
  const doc = window.document;
  await goHash(window, 'projects');
  await goHash(window, `projects/${KEY}`);
  click(window, headChip(doc));
  await settle();
  assert.equal([...openPops(doc)[0].querySelectorAll('.rp-foot button')].some((b) => b.textContent === 'Evaluate in depth'), false);
});

test('the Settings card head holds View report, Evaluate in depth and Set up with AI together', async () => {
  const { window } = await boot({ report: NOT_READY, run: RUN() });
  const doc = window.document;
  await goHash(window, 'projects');
  await goHash(window, `projects/${KEY}/settings`);
  await settle();
  const head = doc.querySelector(`.readiness-settings-card[data-key="${KEY}"] .rs-head`);
  assert.equal(head.children.length, 2, head.innerHTML);
  assert.deepEqual([...head.children[1].querySelectorAll('button')].map((b) => b.textContent), ['View report', 'Evaluate in depth', 'Set up with AI']);
});

test('the foot keeps Evaluate in depth, Set up with AI and Recheck together in one .rp-acts group', async () => {
  const { window } = await boot({ report: NOT_READY, run: RUN() });
  const doc = window.document;
  await goHash(window, 'projects');
  await goHash(window, `projects/${KEY}`);
  click(window, headChip(doc));
  await settle();
  const foot = openPops(doc)[0].querySelector('.rp-foot');
  const groups = foot.querySelectorAll('.rp-acts');
  assert.equal(groups.length, 1);
  assert.deepEqual([...groups[0].querySelectorAll('button')].map((b) => b.textContent), ['Evaluate in depth', 'Set up with AI', 'Recheck']);
  assert.equal(foot.querySelectorAll('button').length, 3, 'no readiness button sits outside the group');
});
