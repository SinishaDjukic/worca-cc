// test/ui-engine-picker.test.mjs — New pipeline: the Claude/Codex engine choice (harness bridge
// §10.4, plan step 5). On submit, a 409 { error, code: 'engine-refused', overridable } response
// is shown inline with an "Allow unguarded" checkbox when the refusal is liftable; ticking it and
// starting again resends with allowUnguardedEngine: true. Boot copied from test/ui-sync-row.test.mjs.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const PROJECTS = [{ name: 'web', path: '/a/web', exists: true }, { name: 'api', path: '/a/api', exists: true }];
const CACHED = {
  '/a/web': { branches: ['dev', 'release'], current: 'dev' },
  '/a/api': { branches: ['main', 'api-only'], current: 'main' },
};
const NOW = new Date().toISOString();
const block = (base = 'dev', over = {}) => ({
  base, remote: 'origin', remoteLabel: 'github.com/acme/web', state: 'behind', ahead: 0, behind: 3,
  dirty: false, dirtyCount: 0, checkedOutHere: true, shallow: false, fetchedAt: NOW, stale: false,
  local: { sha: 'aaaaaaa1', at: NOW }, remoteTip: { sha: 'bbbbbbb2', at: NOW },
  incoming: [{ sha: 'c0ffee1234', at: NOW, author: 'Ana', subject: 'Fix the thing' }],
  settings: { beforeRun: true, onDiverged: 'ask' }, ...over,
});
// As GET /api/branches?fresh=1 (server.mjs): the list's stale/fetchError are copied into its sync block.
const freshBody = (dir, over = {}) => {
  const b = {
    ...CACHED[dir], remote: { name: 'origin', branches: [...CACHED[dir].branches, 'feat/remote'] },
    sync: block(CACHED[dir].current), fetchedAt: NOW, stale: false, ...over,
  };
  if (b.sync && 'stale' in over) b.sync = { ...b.sync, stale: b.stale, ...(b.fetchError ? { fetchError: b.fetchError } : {}) };
  return b;
};
const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

async function boot({ fresh = null, syncGet = null, syncPost = null, run = null, workspaces = [], runDefaults = null, execEnvs = null, appUrl = null } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };
  const calls = [];
  const posted = [];
  window.fetch = (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    calls.push({ url: u, method, body: opts.body ? JSON.parse(opts.body) : null });
    // The server always answers the run defaults; Claude with nothing set (Plan 2a).
    if (u.includes('/api/run-defaults')) return Promise.resolve(ok({ engine: { value: 'claude', source: 'default' }, steps: { claude: {}, codex: {} }, ...(runDefaults || {}) }));
    if (u.includes('/api/projects')) return Promise.resolve(ok({ projects: PROJECTS }));
    if (u.includes('/api/workspaces')) return Promise.resolve(ok({ workspaces }));
    if (execEnvs && u.includes('/api/exec-envs')) return Promise.resolve(ok({ execEnvs }));
    if (u.includes('/api/branches')) {
      const q = new URL(u, 'http://x').searchParams;
      const dir = q.get('projectDir') || '';
      if (q.get('fresh') === '1') {
        const r = fresh ? fresh(dir, q) : freshBody(dir);
        return Promise.resolve(r).then((b) => (b && b.status ? b : ok(b)));
      }
      return Promise.resolve(ok(CACHED[dir] || { branches: [], current: '' }));
    }
    if (u.includes('/api/sync') && method === 'GET') {
      const q = new URL(u, 'http://x').searchParams;
      const r = syncGet ? syncGet(q) : { sync: block(q.get('base') || 'dev') };
      return Promise.resolve(r).then((b) => (b && b.status ? b : ok(b)));
    }
    if (u.includes('/api/sync') && method === 'POST') {
      const body = JSON.parse(opts.body);
      const r = syncPost ? syncPost(body) : { ok: true, sync: block(body.base, { state: 'up-to-date', behind: 0 }) };
      return Promise.resolve(r).then((b) => (b && b.status ? b : ok(b)));
    }
    if (u.endsWith('/api/run') && method === 'POST') {
      const body = JSON.parse(opts.body);
      posted.push(body);
      const r = run ? run(body, posted.length) : { runId: `run-${posted.length}` };
      return Promise.resolve(r).then((b) => (b && b.status ? b : ok(b)));
    }
    return Promise.resolve(ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }));
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  window.localStorage.clear();
  window.localStorage.setItem('worca-cc.runTarget', 'project');
  window.localStorage.setItem('worca-cc.lastProject', 'web');
  await import((appUrl || pathToFileURL(appPath).href) + `?b=${Date.now()}_${Math.random()}`);
  await tick();
  lastWs._l.open?.forEach((fn) => fn());
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  return { window, doc: window.document, calls, posted, recv };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function waitFor(pred, ms = 2000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('waitFor timed out');
    await tick();
  }
}
const $ = (doc, sel) => doc.querySelector(sel);
async function submit(ctx) {
  $(ctx.doc, '#prompt').value = 'do work';
  const n = ctx.posted.length;
  $(ctx.doc, '#run-form').dispatchEvent(new ctx.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => ctx.posted.length > n);
  await tick(); await tick();
}

const pick = (ctx, engine) => { const s = ctx.doc.getElementById('engineSelect'); s.value = engine; s.dispatchEvent(new ctx.doc.defaultView.Event('change', { bubbles: true })); };

test('engine: Claude is the default and sends nothing', async () => {
  const ctx = await boot({ run: (_body, n) => ok({ runId: `r${n}` }) });
  const doc = ctx.doc;
  assert.equal(doc.getElementById('engineSelect').value, 'claude');
  assert.equal(doc.getElementById('engine-hint').hidden, true);
  // Advanced and up; on Claude nothing keeps it on screen in Simple.
  assert.equal(doc.getElementById('engine-row').dataset.minLevel, 'advanced');
  assert.equal(doc.getElementById('engine-row').dataset.levelKeep, undefined);
  await submit(ctx);
  const first = ctx.posted.at(-1);
  assert.equal('engine' in first, false);
  assert.equal('allowUnguardedEngine' in first, false);
});

/** A copy of app.js whose engine-switch import is a shim: its engineOptions labels codex `label`, everything else is
 *  the real module. Every other relative import is made absolute, so the copy runs from a temp folder on the real
 *  modules. (The catalog is frozen and engineLabel reads it directly, so a label with markup needs this seam.) */
function appWithEngineLabel(label) {
  const dir = mkdtempSync(join(tmpdir(), 'worca-engine-label-'));
  const real = new URL('../src/shared/engine-switch.mjs', import.meta.url).href;
  const shim = join(dir, 'engine-switch-shim.mjs');
  writeFileSync(shim, `export * from ${JSON.stringify(real)};\nimport { engineOptions as realOptions } from ${JSON.stringify(real)};\n`
    + `export function engineOptions(o) { return realOptions(o).map((x) => (x.value === 'codex' ? { ...x, label: ${JSON.stringify(label)} } : x)); }\n`);
  const appUrl = pathToFileURL(appPath).href;
  let swapped = 0;
  const src = readFileSync(appPath, 'utf8').replace(/(\bfrom\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\2/g, (_m, kw, q, spec) => {
    const abs = new URL(spec, appUrl).href;
    if (abs === real) { swapped += 1; return `${kw}${q}${pathToFileURL(shim).href}${q}`; }
    return `${kw}${q}${abs}${q}`;
  });
  assert.equal(swapped, 1, 'app.js imports engine-switch once');
  writeFileSync(join(dir, 'app.mjs'), src);
  return { url: pathToFileURL(join(dir, 'app.mjs')).href, dir };
}

test('engine: an engine\'s label is text in its <option>, never parsed as markup', async () => {
  const label = '<img src="x" onerror="window.__labelRan = 1">Codex';
  const app = appWithEngineLabel(label);
  try {
    const ctx = await boot({ appUrl: app.url });
    const opt = [...ctx.doc.getElementById('engineSelect').options].find((o) => o.value === 'codex');
    assert.ok(opt.textContent.startsWith(label), opt.textContent);
    assert.equal(opt.children.length, 0, 'no element was parsed out of the label');
    assert.equal(ctx.doc.querySelector('#engineSelect img'), null);
  } finally { rmSync(app.dir, { recursive: true, force: true }); }
});

test('engine: Codex sends engine only, and shows the hint', async () => {
  // Its own boot: a second start after a successful one would depend on what beginRun
  // leaves behind, which is not what this test is about.
  const ctx = await boot({ run: (_body, n) => ok({ runId: `r${n}` }) });
  const doc = ctx.doc;
  pick(ctx, 'codex');
  assert.equal(doc.getElementById('engineSelect').value, 'codex');
  assert.equal(doc.getElementById('engine-row').dataset.levelKeep, '1', 'a non-Claude engine stays visible in Simple');
  assert.equal(doc.getElementById('engine-hint').hidden, false);
  await submit(ctx);
  const second = ctx.posted.at(-1);
  assert.equal(second.engine, 'codex');
  assert.equal('allowUnguardedEngine' in second, false);
});

test('engine: Copilot sends engine copilot, says it runs on its default model, and carries the consent after a refusal', async () => {
  const refusal = { error: 'engine copilot: guardrail set "normal" has permission rules this engine cannot enforce', code: 'engine-refused', overridable: true };
  const ctx = await boot({ run: (_body, n) => (n === 1 ? ok(refusal, 409) : ok({ runId: 'r2' })) });
  const doc = ctx.doc;
  pick(ctx, 'copilot');
  assert.equal(doc.getElementById('engineSelect').value, 'copilot');
  assert.equal(doc.getElementById('engine-hint').hidden, false);
  // The hint is built from the catalog: an engine with helpers of its own but no helper slots runs them on its default model.
  assert.equal(doc.getElementById('engine-hint').textContent, 'Copilot runs this pipeline, including titles and summaries (on its default model). Step models: Models › Copilot.');
  await submit(ctx);
  assert.equal(ctx.posted.at(-1).engine, 'copilot');
  await waitFor(() => !doc.getElementById('engineRefusal').hidden);
  doc.getElementById('engineAllowUnguarded').checked = true;
  await submit(ctx);
  assert.equal(ctx.posted.at(-1).engine, 'copilot');
  assert.equal(ctx.posted.at(-1).allowUnguardedEngine, true);
});

test('engine: a liftable refusal shows inline with the consent; ticking it and starting again sends it', async () => {
  const refusal = { error: 'engine codex: guardrail set "normal" has permission rules this engine cannot enforce', code: 'engine-refused', overridable: true };
  const ctx = await boot({ run: (_body, n) => (n === 1 ? ok(refusal, 409) : ok({ runId: 'r2' })) });
  const doc = ctx.doc;
  pick(ctx, 'codex');
  await submit(ctx);
  // The branch runs after `await fetch` and `await safeJson(res)`: wait for it, not a tick count.
  await waitFor(() => !doc.getElementById('engineRefusal').hidden);
  assert.match(doc.getElementById('engineRefusalText').textContent, /cannot enforce/);
  assert.equal(doc.getElementById('engineAllowRow').hidden, false);
  assert.equal(doc.getElementById('start-btn').disabled, false, 'the user can start again');
  assert.equal(ctx.posted.length, 1, 'no automatic resend');
  doc.getElementById('engineAllowUnguarded').checked = true;
  await submit(ctx);
  const resent = ctx.posted.at(-1);
  assert.equal(resent.engine, 'codex');
  assert.equal(resent.allowUnguardedEngine, true);
  await waitFor(() => doc.getElementById('engineRefusal').hidden); // cleared on success
  assert.equal(doc.getElementById('engineAllowUnguarded').checked, false, 'the consent is per attempt');
});

test('engine: a refusal the consent cannot lift offers no checkbox; switching to Claude clears it', async () => {
  const refusal = { error: 'engine codex: the credential broker is on', code: 'engine-refused', overridable: false };
  const ctx = await boot({ run: () => ok(refusal, 409) });
  const doc = ctx.doc;
  pick(ctx, 'codex');
  await submit(ctx);
  await waitFor(() => !doc.getElementById('engineRefusal').hidden);
  assert.equal(doc.getElementById('engineAllowRow').hidden, true);
  pick(ctx, 'claude');
  assert.equal(doc.getElementById('engineRefusal').hidden, true);
  assert.equal(doc.getElementById('engine-hint').hidden, true);
});

test('engine: changing guardrails, project, or target clears a shown refusal and its consent', async () => {
  const refusal = { error: 'engine codex: guardrail set "normal" has permission rules this engine cannot enforce', code: 'engine-refused', overridable: true };
  const ctx = await boot({ run: () => ok(refusal, 409) });
  const doc = ctx.doc;
  pick(ctx, 'codex');

  async function triggerRefusal() {
    await submit(ctx);
    await waitFor(() => !doc.getElementById('engineRefusal').hidden);
    doc.getElementById('engineAllowUnguarded').checked = true;
  }

  await triggerRefusal();
  doc.getElementById('guardrailsSelect').dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  assert.equal(doc.getElementById('engineRefusal').hidden, true, 'guardrails change clears the refusal');
  assert.equal(doc.getElementById('engineAllowUnguarded').checked, false, 'and the per-attempt consent');

  await triggerRefusal();
  doc.getElementById('projectSelect').dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  assert.equal(doc.getElementById('engineRefusal').hidden, true, 'project change clears the refusal');
  assert.equal(doc.getElementById('engineAllowUnguarded').checked, false);

  await triggerRefusal();
  doc.querySelector('#target-seg button[data-target="workspace"]').click();
  assert.equal(doc.getElementById('engineRefusal').hidden, true, 'target change clears the refusal');
  assert.equal(doc.getElementById('engineAllowUnguarded').checked, false);
});

test('engine: the hint and the checkbox row really hide (explicit [hidden] rules)', () => {
  // jsdom applies no stylesheet, so pin the rules themselves: without them .hint
  // (display:block) and label.check-row (display:inline-flex) stay visible.
  const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');
  assert.match(css, /#engine-hint\[hidden\]/);
  assert.match(css, /#engineAllowRow\[hidden\]/);
  assert.match(css, /#exec-env-hint\[hidden\]/);
});

test('engine: the Codex hint says the whole pipeline runs on Codex and where its models live', async () => {
  const ctx = await boot();
  pick(ctx, 'codex');
  assert.equal(ctx.doc.getElementById('engine-hint').textContent.trim(),
    'Codex runs this pipeline, including titles and summaries. Its models: Models › Codex');
});

test('engine: Cursor is the third choice; it sends engine cursor and says helper jobs run on Claude', async () => {
  const ctx = await boot({ run: (_body, n) => ok({ runId: `r${n}` }) });
  const doc = ctx.doc;
  // The page holds no engine <option>: app.js builds them from the catalog (engineOptions), a beta one saying so.
  assert.deepEqual([...doc.querySelectorAll('#engineSelect option')].map((o) => o.value), ['claude', 'codex', 'copilot', 'cursor', 'gemini', 'goose', 'opencode', 'qwen']);
  assert.deepEqual([...doc.querySelectorAll('#engineSelect option')].map((o) => o.textContent), ['Claude', 'Codex (Beta)', 'Copilot (Beta)', 'Cursor (Beta)', 'Gemini CLI (Beta)', 'Goose (Beta)', 'OpenCode (Beta)', 'Qwen Code (Beta)']);
  assert.doesNotMatch(readFileSync(htmlPath, 'utf8'), /<option value="(claude|codex|copilot|cursor|gemini|goose|opencode|qwen)"/);
  pick(ctx, 'cursor');
  assert.equal(doc.getElementById('engineSelect').value, 'cursor');
  const hint = doc.getElementById('engine-hint');
  assert.equal(hint.hidden, false);
  assert.equal(hint.textContent.trim(), 'Cursor runs this pipeline. Helper jobs (titles, summaries) run on Claude. Step models: Models › Cursor.');
  assert.doesNotMatch(hint.textContent, /including titles and summaries/);
  await submit(ctx);
  assert.equal(ctx.posted.at(-1).engine, 'cursor');
});

test('engine: OpenCode is the fifth choice; it sends engine opencode and says helper jobs run on Claude', async () => {
  const ctx = await boot({ run: (_body, n) => ok({ runId: `r${n}` }) });
  pick(ctx, 'opencode');
  assert.equal(ctx.doc.getElementById('engineSelect').value, 'opencode');
  assert.equal(ctx.doc.querySelector('#engineSelect option[value="opencode"]').textContent, 'OpenCode (Beta)');
  assert.equal(ctx.doc.getElementById('engine-hint').textContent.trim(),
    'OpenCode runs this pipeline. Helper jobs (titles, summaries) run on Claude. Step models: Models › OpenCode.');
  await submit(ctx);
  assert.equal(ctx.posted.at(-1).engine, 'opencode');
});

test('engine: on Cursor the agent rows offer Cursor models only and no sub-agent model', async () => {
  const ctx = await boot();
  const np = ctx.window.__np;
  np._setModels([
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'] },
    { id: 'my-cursor-m', label: 'My Cursor', engine: 'cursor', efforts: [], custom: 'global' },
  ]);
  pick(ctx, 'cursor');
  const def = { model: '', effort: '', fanOut: false, askQuestions: false, subagentModel: '' };
  np.renderAgentRows([{ nodeId: 'n1', key: 'planner', label: 'Plan', color: '', stepIndex: 0, parallel: false,
    model: '', effort: '', fanOut: false, subagentModel: '', askQuestions: null, def, override: {}, modified: false }]);
  const model = ctx.doc.querySelector('#agents-rows .step-model');
  assert.deepEqual([...model.options].map((o) => o.value).filter((v) => v !== '__add__'), ['', 'my-cursor-m']);
  assert.equal(model.options[0].textContent, '(default model)');
  assert.equal(ctx.doc.querySelector('#agents-rows .step-subagent').closest('.select-wrap').hidden, true);
});

for (const [engine, label] of [['gemini', 'Gemini CLI'], ['qwen', 'Qwen Code']]) {
  test(`engine: ${label} is offered (beta); it sends engine ${engine} and says helper jobs run on Claude`, async () => {
    const ctx = await boot({ run: (_body, n) => ok({ runId: `r${n}` }) });
    const doc = ctx.doc;
    const opt = doc.querySelector(`#engineSelect option[value="${engine}"]`);
    assert.equal(opt.textContent, `${label} (Beta)`, 'marked beta');
    pick(ctx, engine);
    const hint = doc.getElementById('engine-hint');
    assert.equal(hint.textContent.trim(), `${label} runs this pipeline. Helper jobs (titles, summaries) run on Claude. Step models: Models › ${label}.`);
    await submit(ctx);
    assert.equal(ctx.posted.at(-1).engine, engine);
  });

  test(`engine: on ${label} the agent rows offer ${label} models only and no sub-agent model`, async () => {
    const ctx = await boot();
    const np = ctx.window.__np;
    np._setModels([
      { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'] },
      { id: `my-${engine}-m`, label: 'Mine', engine, efforts: [], custom: 'global' },
      { id: 'my-cursor-m', label: 'My Cursor', engine: 'cursor', efforts: [], custom: 'global' },
    ]);
    pick(ctx, engine);
    const def = { model: '', effort: '', fanOut: false, askQuestions: false, subagentModel: '' };
    np.renderAgentRows([{ nodeId: 'n1', key: 'planner', label: 'Plan', color: '', stepIndex: 0, parallel: false,
      model: '', effort: '', fanOut: false, subagentModel: '', askQuestions: null, def, override: {}, modified: false }]);
    const model = ctx.doc.querySelector('#agents-rows .step-model');
    assert.deepEqual([...model.options].map((o) => o.value).filter((v) => v !== '__add__'), ['', `my-${engine}-m`]);
    assert.equal(ctx.doc.querySelector('#agents-rows .step-subagent').closest('.select-wrap').hidden, true);
  });
}

const pickExecEnv = (ctx, v) => { const s = ctx.doc.getElementById('execEnvSelect'); s.value = v; s.dispatchEvent(new ctx.doc.defaultView.Event('change', { bubbles: true })); };

test('execution environment: a server without the field, or a local default, sends nothing', async () => {
  for (const runDefaults of [null, { execEnv: { value: 'local', source: 'default' } }]) {
    const ctx = await boot({ run: (_body, n) => ok({ runId: `r${n}` }), runDefaults });
    assert.equal(ctx.doc.getElementById('execEnvSelect').value, 'local');
    assert.equal(ctx.doc.getElementById('exec-env-row').dataset.minLevel, 'advanced');
    await submit(ctx);
    assert.equal('execEnv' in ctx.posted.at(-1), false, JSON.stringify(runDefaults));
  }
});

test('execution environment: an Ask card\'s Runs in pick survives the target change and the defaults that load after it', async () => {
  const ctx = await boot({ run: (_body, n) => ok({ runId: `r${n}` }), runDefaults: { execEnv: { value: 'local', source: 'default' } } });
  ctx.window.__np.openNewPipeline({ target: 'project', projectDir: PROJECTS[1].path, workflowId: 'wf_default', guardrailsId: 'normal',
    prompt: 'x', title: 'X', featureBranch: '', execEnv: 'e2b' });
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  for (let i = 0; i < 12; i++) await tick();
  assert.equal(ctx.doc.getElementById('execEnvSelect').value, 'e2b');
  await submit(ctx);
  assert.equal(ctx.posted.at(-1).execEnv, 'e2b');
});

test('execution environment: picking E2B sends execEnv e2b', async () => {
  const ctx = await boot({ run: (_body, n) => ok({ runId: `r${n}` }) });
  pickExecEnv(ctx, 'e2b');
  await submit(ctx);
  assert.equal(ctx.posted.at(-1).execEnv, 'e2b');
});

test('execution environment: an e2b default preselects E2B; choosing Local sends execEnv local', async () => {
  const ctx = await boot({ run: (_body, n) => ok({ runId: `r${n}` }), runDefaults: { execEnv: { value: 'e2b', source: 'user' } } });
  await waitFor(() => ctx.doc.getElementById('execEnvSelect').value === 'e2b');
  assert.equal(ctx.doc.getElementById('exec-env-row').dataset.levelKeep !== undefined, true, 'Simple still shows a non-local default');
  pickExecEnv(ctx, 'local');
  await submit(ctx);
  assert.equal(ctx.posted.at(-1).execEnv, 'local');
});

test('execution environment: an e2b default applies to every remote engine; a workspace run falls back to Local with a hint', async () => {
  const ctx = await boot({ run: (_body, n) => ok({ runId: `r${n}` }), runDefaults: { execEnv: { value: 'e2b', source: 'user' } } });
  const select = ctx.doc.getElementById('execEnvSelect');
  const hint = ctx.doc.getElementById('exec-env-hint');
  const row = ctx.doc.getElementById('exec-env-row');
  await waitFor(() => select.value === 'e2b');
  assert.equal(hint.hidden, true);
  pick(ctx, 'codex');
  assert.equal(select.value, 'e2b', 'codex takes the saved E2B default');
  assert.equal(hint.hidden, true);
  await submit(ctx);
  assert.equal('execEnv' in ctx.posted.at(-1), false, 'unsent: the run gets the saved default');
  ctx.doc.querySelector('#target-seg button[data-target="workspace"]').click();
  await waitFor(() => select.value === 'local');
  assert.equal(hint.hidden, false, 'a workspace run cannot take the E2B default');
  assert.match(hint.textContent, /saved E2B default does not apply to a workspace run/);
  assert.notEqual(row.dataset.levelKeep, undefined, 'Simple still shows the row with its hint');
});

test('execution environment: codex takes the saved E2B default: an explicit E2B pick equals it, so nothing is sent', async () => {
  const ctx = await boot({ run: (_body, n) => ok({ runId: `r${n}` }), runDefaults: { execEnv: { value: 'e2b', source: 'user' } } });
  await waitFor(() => ctx.doc.getElementById('execEnvSelect').value === 'e2b');
  pick(ctx, 'codex');
  pickExecEnv(ctx, 'e2b');
  assert.equal(ctx.doc.getElementById('exec-env-hint').hidden, true);
  await submit(ctx);
  assert.equal('execEnv' in ctx.posted.at(-1), false);
});

test('execution environment: a saved default of another backend follows the same rule, and the hint names it', async () => {
  const execEnvs = [{ name: 'local', label: 'Local', title: 'Local' }, { name: 'e2b', label: 'E2B sandbox', title: 'E2B' },
    { name: 'loopback', label: 'Loopback sandbox', title: 'Loopback' }];
  const ctx = await boot({ run: (_body, n) => ok({ runId: `r${n}` }), execEnvs, runDefaults: { execEnv: { value: 'loopback', source: 'user' } } });
  const select = ctx.doc.getElementById('execEnvSelect');
  const hint = ctx.doc.getElementById('exec-env-hint');
  await waitFor(() => select.value === 'loopback');
  assert.equal(hint.hidden, true);
  ctx.doc.querySelector('#target-seg button[data-target="workspace"]').click();
  await waitFor(() => select.value === 'local');
  assert.equal(hint.hidden, false);
  assert.match(hint.textContent, /saved Loopback default does not apply to a workspace run/);
  // Back to a project before any submit: no workspace is selected, so the workspace target cannot start.
  ctx.doc.querySelector('#target-seg button[data-target="project"]').click();
  await waitFor(() => select.value === 'loopback');
  await submit(ctx);
  assert.equal('execEnv' in ctx.posted.at(-1), false, 'the run gets the saved default: nothing to send');
});
