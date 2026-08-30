// test/ui-running-pause-fixes.test.mjs — regressions in the Running tab around a
// PAUSED run: (a) Resume button placement (CSS), (c) paused frontier node kind,
// (d) branch name on the run card. Harness mirrors ui-pause-resume.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(here, '../ui/public/index.html');
const appPath = join(here, '../ui/public/app.js');
const cssPath = join(here, '../ui/public/style.css');

async function bootLive() {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; }
    send() {} close() {}
    addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  };
  window.fetch = (url) => {
    if (String(url).includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return { window };
}

// (a) Resume button placement — it must right-align like Pause/Stop, not drift left.
test('(a) the header action cluster right-aligns via margin-left:auto', () => {
  const css = readFileSync(cssPath, 'utf8');
  const m = css.match(/\.rc-acts\s*\{([^}]*)\}/);
  assert.ok(m, '.rc-acts rule missing — the header action cluster has no layout');
  assert.match(m[1], /margin-left:\s*auto/, '.rc-acts must right-align Pause/Stop/chevron in the header');
  assert.match(css, /\.rc-acts \.btn-pause,[^{]*\.rc-open\{[^}]*width:\s*30px/, '30px icon buttons');
});

// (c) A paused run's frontier node must read as paused, not "running…".

// (d) Branch name shows on the run card and survives a later state event.
test('(d) run-card meta renders branch feature and refreshes when branch arrives via onState', async () => {
  const { window } = await bootLive();
  const { upsertRun, buildRunCard, onState } = window.__np;
  const r = upsertRun({ runId: 'rb1', title: 't', projectDir: '/tmp/proj', status: 'running' });
  r.el = buildRunCard(r);
  const chip = () => r.el.querySelector('.rc-branch');
  assert.equal(chip().hidden, true, 'no branch chip before it is known');
  // Branch arrives on a later state snapshot — the chip must refresh.
  onState(r, { branch: { feature: 'feat/x' } });
  assert.equal(chip().hidden, false, 'branch feature must appear in the chip after onState');
  assert.equal(r.el.querySelector('.rc-branch-name').textContent, 'feat/x');
});

// (e) Resume must be a real pill, not a bare native button.
test('(e) Pause/Resume render as amber-outline icon buttons in the cluster', () => {
  const css = readFileSync(cssPath, 'utf8');
  const m = css.match(/\.rc-acts \.btn-pause,\.rc-acts \.btn-resume\{([^}]*)\}/);
  assert.ok(m, '.rc-acts .btn-pause,.rc-acts .btn-resume rule missing');
  assert.match(m[1], /border:\s*1px solid var\(--amber\)/);
  assert.match(m[1], /color:\s*var\(--amber-ink\)/);
});

// (f) The author display rules defeat the UA [hidden] rule — must be patched per
// class, same as .questions-toggle[hidden] / .hist-pr[hidden] / .subs-bar[hidden].
test('(f) [hidden] hides Pause/Resume despite their author display rules', () => {
  const css = readFileSync(cssPath, 'utf8');
  assert.match(
    css,
    /\.btn-pause\[hidden\]\s*,\s*\.btn-resume\[hidden\]\s*\{[^}]*display:\s*none/,
    'need .btn-pause[hidden],.btn-resume[hidden]{display:none;} — otherwise the paused card shows BOTH buttons and two margin-left:auto split the row'
  );
  assert.match(css, /\.rc-acts \.btn-pause\[hidden\],\.rc-acts \.btn-resume\[hidden\]\{[^}]*display:\s*none/,
    'the cluster must re-state [hidden] at its own specificity, or .rc-acts .btn-pause wins on source order');
});

// (g) Dead rule: pause sits between resume and stop in the DOM, so this `+`
// selector can never match; its presence signals the broken margin scheme.
test('(g) dead adjacency rule .btn-resume.sm + .btn-stop.sm is gone', () => {
  const css = readFileSync(cssPath, 'utf8');
  assert.doesNotMatch(css, /\.btn-resume\.sm\s*\+\s*\.btn-stop\.sm/);
});
