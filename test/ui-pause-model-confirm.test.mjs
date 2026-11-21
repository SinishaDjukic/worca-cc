// test/ui-pause-model-confirm.test.mjs — the run page's Resume menu for #1450: a model_confirm pause offers "Continue on <model>"
// (POST /api/resume confirmModel) and "Switch model and continue…"; a usage limit scoped to one model family offers
// the other families on the same sign-in and never the spent one.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';

const trackDom = useDomRelease(afterEach);
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj-pause-confirm';
const ok = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const SIGNIN = { kind: 'signin', engine: 'claude' };
const MODELS = [
  { id: 'claude-fable-5-2', label: 'Fable 5.2', engine: 'claude', connection: SIGNIN, harnesses: ['claude'], efforts: ['medium'] },
  { id: 'claude-opus-5-5', label: 'Opus 5.5', engine: 'claude', connection: SIGNIN, harnesses: ['claude'], efforts: ['medium'] },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', engine: 'claude', connection: SIGNIN, harnesses: ['claude'], efforts: ['medium'] },
];
const CONFIG = { config: { steps: {}, customModels: [] }, models: MODELS, premiumModels: ['claude-fable-5-2'], efforts: [] };

async function boot(level = 'advanced') {
  let html = readIndexHtml();
  html = html.replace('<html lang="en" data-theme="system">', `<html lang="en" data-theme="system" data-level="${level}">`);
  const dom = trackDom(new JSDOM(html, { url: 'http://localhost:4317/' }));
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
    if (u.includes('/api/resume')) { resumes.push(JSON.parse(opts.body)); return ok({ ok: true, runId: 'r-new', pipelineId: 'pl_1' }); }
    if (u.includes('/api/projects')) return ok({ projects: [{ name: 'proj', path: PROJECT, exists: true }] });
    if (u.includes('/api/schedules')) return ok({ schedules: [], tickets: [], counts: {}, defaults: { ifMissed: 'run', graceMin: 360, maxFailures: 3 } });
    return ok(CONFIG);
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
async function pausedRun(ctx, done) {
  const { doc, recv, settle, go } = ctx;
  go('running');
  recv({ type: 'hello', runs: [{ runId: 'r1', title: 'Feat', projectDir: PROJECT, status: 'running', startedAt: '00:00:00', pipelineId: 'pl_1', runEngine: 'claude' }] });
  await settle();
  go('running/r1');
  await settle(8);
  recv({ type: 'done', runId: 'r1', status: 'paused', ...done });
  await settle(8);
  return doc.querySelector('#run-detail');
}
const shown = (page, sel) => { const n = page.querySelector(`.rd-resume-menu ${sel}`); return n && !n.hidden ? n : null; };

const CONFIRM = { reason: 'model_confirm', detail: 'Paused before Plan: it would run on claude-fable-5-2, a premium model nobody chose.',
  modelConfirm: { nodeId: 'n_plan', stepKey: 'e1', model: 'claude-fable-5-2', requested: 'claude-fable-5-2', at: 'pre' } };

test('a model_confirm pause: "Continue on Fable 5.2" posts confirmModel; "Switch model and continue…" is offered; the copy says why', async () => {
  const ctx = await boot();
  const page = await pausedRun(ctx, CONFIRM);
  assert.match(page.querySelector('.rd-ov-copy')?.textContent || '', /it would run on Fable 5\.2, a premium model nobody chose\. Continue on it, or switch model\.$/);
  page.querySelector('.rd-resume-more').click();
  await ctx.settle();
  const cont = shown(page, '.resume-confirm-model');
  assert.ok(cont, 'Continue on … is shown');
  assert.equal(cont.querySelector('b').textContent, 'Continue on Fable 5.2');
  assert.equal(shown(page, '.resume-with-model').querySelector('b').textContent, 'Switch model and continue…');
  cont.click();
  await ctx.settle(8);
  assert.equal(ctx.resumes.length, 1);
  assert.equal(ctx.resumes[0].confirmModel, 'claude-fable-5-2');
  assert.equal('model' in ctx.resumes[0], false);
});

test('a model_confirm "Switch model and continue…" offers non-premium models only; a plain pause offers neither item', async () => {
  const ctx = await boot();
  const page = await pausedRun(ctx, CONFIRM);
  page.querySelector('.rd-resume-more').click();
  await ctx.settle();
  shown(page, '.resume-with-model').click();
  await ctx.settle(8);
  const opts = [...ctx.doc.querySelectorAll('#confirm-f-model option')].map((o) => o.value);
  assert.deepEqual(opts.sort(), ['claude-opus-5-5', 'claude-sonnet-5-5']);
  const ctx2 = await boot();
  const plain = await pausedRun(ctx2, { reason: 'error', detail: 'disk full' });
  assert.equal(shown(plain, '.resume-confirm-model'), null);
  assert.equal(shown(plain, '.resume-with-model'), null);
});

test('a model-scoped usage limit ("Fable limit"): the switch leads the menu and offers Opus and Sonnet on the same sign-in, never Fable', async () => {
  const ctx = await boot();
  const page = await pausedRun(ctx, { reason: 'usage_limit', detail: "You've hit your Fable limit · resets 3pm", limitEngine: 'claude', limitScope: 'model', limitModel: 'claude-fable-5-2' });
  const menu = page.querySelector('.rd-resume-menu');
  page.querySelector('.rd-resume-more').click();
  await ctx.settle();
  assert.equal(menu.firstElementChild.classList.contains('resume-with-model'), true, 'the model switch is the first action');
  shown(page, '.resume-with-model').click();
  await ctx.settle(8);
  const opts = [...ctx.doc.querySelectorAll('#confirm-f-model option')].map((o) => o.value);
  assert.deepEqual(opts, ['claude-opus-5-5', 'claude-sonnet-5-5']);
  const input = ctx.doc.getElementById('confirm-f-model');
  input.value = 'claude-sonnet-5-5';
  input.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  ctx.doc.getElementById('confirm-ok').click();
  await ctx.settle(8);
  assert.equal(ctx.resumes.at(-1).model, 'claude-sonnet-5-5');
});

// The caret is Advanced and up (data-min-level); jsdom applies no stylesheet, so "shown in Simple" is the levelKeep
// mark ui-level.mjs#minLevelFor reads.
test('Simple mode: a model_confirm pause and a model-scoped limit keep the Resume caret at every level; a plain pause does not', async () => {
  const ctx = await boot('simple');
  const page = await pausedRun(ctx, CONFIRM);
  const caret = page.querySelector('.rd-resume-more');
  assert.equal(caret.hidden, false);
  assert.equal(caret.dataset.levelKeep, '1', 'Continue on … is reachable in Simple');
  const ctx2 = await boot('simple');
  const limit = await pausedRun(ctx2, { reason: 'usage_limit', detail: "You've hit your Fable limit", limitEngine: 'claude', limitScope: 'model', limitModel: 'claude-fable-5-2' });
  assert.equal(limit.querySelector('.rd-resume-more').dataset.levelKeep, '1');
  const ctx3 = await boot('simple');
  const plain = await pausedRun(ctx3, { reason: 'error', detail: 'disk full' });
  assert.equal(plain.querySelector('.rd-resume-more').dataset.levelKeep, undefined);
});
