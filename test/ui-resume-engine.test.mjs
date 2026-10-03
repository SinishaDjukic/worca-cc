// test/ui-resume-engine.test.mjs — resuming a paused run on the other engine from the UI: the
// Resume menus of the run page and the saved run ("Resume on <saved>" / "Resume on <other>"
// with the switch's note), the confirmation, a 409 engine-refused with New pipeline's
// "Allow unguarded" consent and its re-send, the team-cap re-send keeping the engine, and the
// run page's usage-limit banner button. Harness: the jsdom boot of test/ui-resume-at.test.mjs.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { useDomRelease } from './helpers/jsdom-release.mjs';

const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj-resume-engine';
const KEY = 'proj-resume-engine-abcd1234';
const NOTE = "Starts the paused step fresh; the model falls back to Claude's default.";

const live = [];
afterEach(() => { while (live.length) { try { live.pop().close(); } catch {} } });

const ok = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });

/** `resumeAnswers`: the /api/resume replies in order (the last one repeats); default 200. */
async function boot({ level = 'advanced', resumeAnswers = [], fetchHandler } = {}) {
  let html = readFileSync(htmlPath, 'utf8');
  html = html.replace('<html lang="en" data-theme="system">', `<html lang="en" data-theme="system" data-level="${level}">`);
  const dom = trackDom(new JSDOM(html, { url: 'http://localhost:4317/' }));
  live.push(dom);
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  const sockets = [];
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; sockets.push(this); }
    send() {} close() {}
    addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
    dispatch(type, evt) { for (const fn of this._listeners[type] || []) fn(evt); }
  };
  const resumes = [];
  window.fetch = (url, opts) => {
    const u = String(url);
    if (fetchHandler) { const r = fetchHandler(u, opts || {}); if (r) return r; }
    if (u.includes('/api/resume')) {
      resumes.push(JSON.parse(opts.body));
      const a = resumeAnswers[Math.min(resumes.length - 1, resumeAnswers.length - 1)];
      return a ? ok(a.body, a.status) : ok({ ok: true, runId: `r-new-${resumes.length}`, pipelineId: 'pl_1' });
    }
    if (u.includes('/api/projects')) return ok({ projects: [{ name: 'proj', path: PROJECT, exists: true }] });
    if (u.includes('/api/schedules')) return ok({ schedules: [], tickets: [], counts: {}, defaults: { ifMissed: 'run', graceMin: 360, maxFailures: 3 } });
    return ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const recv = (msg) => { for (const s of sockets) s.dispatch('message', { data: JSON.stringify(msg) }); };
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
  const go = (hash) => { window.location.hash = hash; window.dispatchEvent(new window.Event('hashchange')); };
  return { window, doc: window.document, recv, settle, go, resumes };
}

/** A paused run on `engine`, open on its run page. */
async function pausedRun(ctx, { engine = 'codex', done = {} } = {}) {
  const { doc, recv, settle, go } = ctx;
  go('running');
  recv({ type: 'hello', runs: [{ runId: 'r1', title: 'Feat', projectDir: PROJECT, status: 'running', startedAt: '00:00:00', pipelineId: 'pl_1', runEngine: engine }] });
  await settle();
  go('running/r1');
  await settle(8);
  recv({ type: 'done', runId: 'r1', status: 'paused', ...done });
  await settle(8);
  return doc.querySelector('#run-detail');
}

const modal = (doc) => ({
  open: !doc.getElementById('confirm-modal').classList.contains('hidden'),
  title: doc.getElementById('confirm-title').textContent,
  message: doc.getElementById('confirm-message').textContent,
  checkbox: !doc.getElementById('confirm-checkbox-wrap').classList.contains('hidden'),
  checkboxLabel: doc.getElementById('confirm-checkbox-label').textContent,
  okLabel: doc.getElementById('confirm-ok').textContent,
});

test('run page: the Resume menu names both engines; the other one says what switching does', async () => {
  const ctx = await boot();
  const page = await pausedRun(ctx);
  page.querySelector('.rd-resume-more').click();
  await ctx.settle();
  const saved = page.querySelector('.rd-resume-menu .resume-on-saved');
  const other = page.querySelector('.rd-resume-menu .resume-on-other');
  assert.equal(saved.querySelector('b').textContent, 'Resume on Codex');
  assert.equal(other.hidden, false);
  assert.equal(other.querySelector('b').textContent, 'Resume on Claude');
  assert.equal(other.querySelector('small').textContent, NOTE);
  assert.equal(ctx.doc.activeElement, saved, 'the menu opens on its first item');
});

test('run page: "Resume on Codex" is today\'s resume — no question, no engine sent', async () => {
  const ctx = await boot();
  const page = await pausedRun(ctx);
  page.querySelector('.rd-resume-more').click();
  await ctx.settle();
  page.querySelector('.resume-on-saved').click();
  await ctx.settle(8);
  assert.equal(modal(ctx.doc).open, false);
  assert.equal(ctx.resumes.length, 1);
  assert.equal('engine' in ctx.resumes[0], false);
});

test('run page: "Resume on Claude" confirms with the note, then sends engine claude', async () => {
  const ctx = await boot();
  const page = await pausedRun(ctx);
  page.querySelector('.rd-resume-more').click();
  await ctx.settle();
  page.querySelector('.resume-on-other').click();
  await ctx.settle();
  const m = modal(ctx.doc);
  assert.equal(m.open, true);
  assert.equal(m.title, 'Resume on Claude?');
  assert.equal(m.message, NOTE);
  assert.equal(m.okLabel, 'Resume on Claude');
  assert.equal(ctx.resumes.length, 0, 'nothing is sent before the confirmation');
  ctx.doc.getElementById('confirm-ok').click();
  await ctx.settle(8);
  assert.equal(ctx.resumes.length, 1);
  assert.equal(ctx.resumes[0].engine, 'claude');
  assert.equal(ctx.resumes[0].pipelineId, 'pl_1');
});

test('a 409 engine-refused shows the reason and New pipeline\'s consent; ticking it re-sends with it', async () => {
  const refusal = { status: 409, body: { code: 'engine-refused', overridable: true, engine: 'codex', error: 'engine codex: guardrail set "normal" has permission rules this engine cannot enforce' } };
  const ctx = await boot({ resumeAnswers: [refusal, { status: 200, body: { ok: true, runId: 'r-new', pipelineId: 'pl_1' } }] });
  const page = await pausedRun(ctx, { engine: 'claude' });
  page.querySelector('.rd-resume-more').click();
  await ctx.settle();
  page.querySelector('.resume-on-other').click();
  await ctx.settle();
  ctx.doc.getElementById('confirm-ok').click();          // "Resume on Codex?"
  await ctx.settle(8);
  const m = modal(ctx.doc);
  assert.equal(m.open, true, 'the refusal is shown');
  assert.equal(m.title, 'Not resumed on Codex');
  assert.match(m.message, /guardrail set "normal" has permission rules/);
  assert.equal(m.checkbox, true);
  const newPipelineLabel = ctx.doc.getElementById('engineAllowRow').textContent.replace(/\s+/g, ' ').trim();
  assert.equal(m.checkboxLabel, newPipelineLabel, 'the same consent New pipeline offers');
  ctx.doc.getElementById('confirm-checkbox').checked = true;
  ctx.doc.getElementById('confirm-ok').click();
  await ctx.settle(8);
  assert.equal(ctx.resumes.length, 2);
  assert.deepEqual([ctx.resumes[1].engine, ctx.resumes[1].allowUnguardedEngine], ['codex', true]);
});

test('a refusal the consent cannot lift shows the reason only; nothing is re-sent', async () => {
  const refusal = { status: 409, body: { code: 'engine-refused', overridable: false, error: 'engine codex: the credential broker is on' } };
  const ctx = await boot({ resumeAnswers: [refusal] });
  const page = await pausedRun(ctx, { engine: 'claude' });
  page.querySelector('.rd-resume-more').click();
  await ctx.settle();
  page.querySelector('.resume-on-other').click();
  await ctx.settle();
  ctx.doc.getElementById('confirm-ok').click();
  await ctx.settle(8);
  const m = modal(ctx.doc);
  assert.equal(m.checkbox, false);
  assert.match(m.message, /credential broker is on/);
  ctx.doc.getElementById('confirm-ok').click();
  await ctx.settle(8);
  assert.equal(ctx.resumes.length, 1);
  assert.equal(page.querySelector('.rd-pause').disabled, false, 'Resume is usable again');
});

test('a team-cap question on the way keeps the engine on the re-send', async () => {
  const cap = { status: 403, body: { error: 'team cap', code: 'team_pipeline', needsPolicyOverride: true, policy: {} } };
  const ctx = await boot({ resumeAnswers: [cap, { status: 200, body: { ok: true, runId: 'r-new', pipelineId: 'pl_1' } }] });
  const page = await pausedRun(ctx);
  page.querySelector('.rd-resume-more').click();
  await ctx.settle();
  page.querySelector('.resume-on-other').click();
  await ctx.settle();
  ctx.doc.getElementById('confirm-ok').click();          // "Resume on Claude?"
  await ctx.settle(8);
  assert.equal(modal(ctx.doc).title, 'Continue past the team cap?');
  ctx.doc.getElementById('confirm-ok').click();
  await ctx.settle(8);
  assert.equal(ctx.resumes.length, 2);
  assert.deepEqual([ctx.resumes[1].engine, ctx.resumes[1].pastTeamCap], ['claude', true]);
});

test('run page banner: a usage limit an engine hit offers "Resume on <other>", at every level', async () => {
  const ctx = await boot({ level: 'simple' });
  const page = await pausedRun(ctx, { done: { reason: 'usage_limit', detail: "You've hit your usage limit · try again at 3:47 PM", limitEngine: 'codex' } });
  const btn = page.querySelector('.rd-ov-state .rd-ov-switch');
  assert.ok(btn, 'the banner carries the button');
  assert.equal(btn.textContent, 'Resume on Claude');
  assert.match(page.querySelector('.rd-ov-copy').textContent, /Resume after the reset\./);
  btn.click();
  await ctx.settle();
  assert.equal(modal(ctx.doc).message, NOTE);
  ctx.doc.getElementById('confirm-ok').click();
  await ctx.settle(8);
  assert.equal(ctx.resumes.at(-1).engine, 'claude');
});

test('run page banner: other pauses, and a limit that was not the engine\'s, offer no switch', async () => {
  for (const done of [
    { reason: 'usage_limit', detail: "OpenRouter's free-model requests for today are used up" },
    { reason: 'error', detail: 'disk full', limitEngine: 'codex' },
    {},
  ]) {
    const ctx = await boot();
    const page = await pausedRun(ctx, { done });
    assert.equal(page.querySelector('.rd-ov-switch'), null, JSON.stringify(done));
  }
});

// ── History detail ───────────────────────────────────────────────────────────

const histFetch = (runEngine, { limitEngine = runEngine, pauseReason = 'usage_limit' } = {}) => (url) => {
  if (url.endsWith('/api/history')) {
    return ok({ pipelines: [{ id: 'fcec04e8', projectKey: KEY, projectName: 'proj', projectDir: PROJECT, title: 'Paused feat', status: 'paused', startedAt: '2026-08-17T20:54:42Z', branch: 'worca-cc/feat', pauseReason, retainedWork: null }], live: [], ghAvailable: false });
  }
  if (url.endsWith(`/api/history/${KEY}/fcec04e8`)) {
    return ok({
      state: { id: 'fcec04e8', title: 'Paused feat', status: 'paused', startedAt: '2026-08-17T20:54:42Z', stepper: null, steps: [], subAgents: [], totalCostUsd: 1.5, totalActiveMs: 60000, branch: { source: 'main', feature: 'worca-cc/feat', worktreeDir: '/tmp/wt' }, prompt: 'Do it.', pauseReason, limitEngine, runEngine },
      results: null, overview: null, clarify: { questions: [], answers: [] }, reviews: [], stepQuestions: [], artifacts: [], auditMarkdown: '# saved',
    });
  }
  if (url.endsWith('/api/budget')) return ok({ blocked: false });
  return null;
};

test('History detail: the saved run\'s engine names the menu; the other one confirms and sends it', async () => {
  const ctx = await boot({ fetchHandler: histFetch('codex') });
  ctx.go(`history/${KEY}/fcec04e8`);
  await ctx.settle(8);
  const menu = ctx.doc.querySelector('.hd-resume-menu');
  assert.equal(menu.querySelector('.resume-on-saved b').textContent, 'Resume on Codex');
  assert.equal(menu.querySelector('.resume-on-other b').textContent, 'Resume on Claude');
  assert.equal(menu.querySelector('.resume-on-other small').textContent, NOTE);
  ctx.doc.querySelector('.hd-resume-more').click();
  await ctx.settle();
  menu.querySelector('.resume-on-other').click();
  await ctx.settle();
  assert.equal(modal(ctx.doc).title, 'Resume on Claude?');
  ctx.doc.getElementById('confirm-ok').click();
  await ctx.settle(8);
  assert.equal(ctx.resumes.length, 1);
  assert.deepEqual([ctx.resumes[0].pipelineId, ctx.resumes[0].engine], ['fcec04e8', 'claude']);
});

test('History detail: a refused switch offers the consent and re-sends with it', async () => {
  const refusal = { status: 409, body: { code: 'engine-refused', overridable: true, error: 'engine codex: the project\'s .claude/settings.json denies Bash(rm:*)' } };
  const ctx = await boot({ fetchHandler: histFetch('claude'), resumeAnswers: [refusal, { status: 200, body: { ok: true, runId: 'r-new', pipelineId: 'fcec04e8' } }] });
  ctx.go(`history/${KEY}/fcec04e8`);
  await ctx.settle(8);
  ctx.doc.querySelector('.hd-resume-more').click();
  await ctx.settle();
  ctx.doc.querySelector('.hd-resume-menu .resume-on-other').click();
  await ctx.settle();
  ctx.doc.getElementById('confirm-ok').click();          // "Resume on Codex?"
  await ctx.settle(8);
  assert.equal(modal(ctx.doc).checkbox, true);
  ctx.doc.getElementById('confirm-checkbox').checked = true;
  ctx.doc.getElementById('confirm-ok').click();
  await ctx.settle(8);
  assert.equal(ctx.resumes.length, 2);
  assert.deepEqual([ctx.resumes[1].engine, ctx.resumes[1].allowUnguardedEngine], ['codex', true]);
});

test('History detail at simple level: a usage limit the engine hit puts "Resume on <other>" in the bar', async () => {
  const ctx = await boot({ level: 'simple', fetchHandler: histFetch('codex') });
  ctx.go(`history/${KEY}/fcec04e8`);
  await ctx.settle(8);
  const btn = ctx.doc.querySelector('#hist-detail .hd-bar .hd-resume-switch');
  assert.ok(btn, 'the bar carries the button');
  assert.equal(btn.hidden, false);
  assert.equal(btn.hasAttribute('data-min-level'), false, 'not gated by the interface level');
  assert.equal(btn.textContent.trim(), 'Resume on Claude');
  assert.equal(btn.title, NOTE);
  btn.click();
  await ctx.settle();
  assert.equal(modal(ctx.doc).title, 'Resume on Claude?');
  ctx.doc.getElementById('confirm-ok').click();
  await ctx.settle(8);
  assert.equal(ctx.resumes.length, 1);
  assert.deepEqual([ctx.resumes[0].pipelineId, ctx.resumes[0].engine], ['fcec04e8', 'claude']);
});

test('History detail: other pauses, and a limit that was not the engine\'s, put no switch in the bar', async () => {
  for (const opts of [{ limitEngine: null }, { pauseReason: 'error' }, { pauseReason: null }]) {
    const ctx = await boot({ level: 'simple', fetchHandler: histFetch('codex', opts) });
    ctx.go(`history/${KEY}/fcec04e8`);
    await ctx.settle(8);
    assert.equal(ctx.doc.querySelector('#hist-detail .hd-resume-switch').hidden, true, JSON.stringify(opts));
  }
});
