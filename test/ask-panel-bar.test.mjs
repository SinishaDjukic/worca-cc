import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePanel } from './helpers/ask-panel-harness.mjs';

test('the composer row is the compact bar; Attach, Send and Stop carry a styled tip and no native title', () => {
  const ctx = makePanel();
  ctx.panel.open();
  const row = ctx.doc.querySelector('.ask-composer-row');
  assert.equal(row.dataset.bar, 'compact');
  for (const [sel, tip] of [['[data-ask-attach-btn]', 'Attach files'], ['[data-ask-send]', 'Send'], ['[data-ask-stop]', 'Stop']]) {
    const b = row.querySelector(sel);
    assert.deepEqual([b.dataset.tip, b.getAttribute('aria-label'), b.hasAttribute('title')], [tip, tip, false], sel);
  }
  ctx.panel.destroy();
});

test('Project: a dashed folder alone while none is picked; no arrow; the name stays in the accessible name and the tip', () => {
  const ctx = makePanel();
  ctx.panel.open();
  const btn = ctx.doc.querySelector('[data-ask-scope-btn]');
  assert.deepEqual([btn.classList.contains('is-bare'), btn.querySelectorAll('svg').length], [true, 1]);
  assert.equal(btn.querySelector('svg path').getAttribute('stroke-dasharray'), '2.6 3.2');
  assert.equal(btn.querySelector('svg').getAttribute('width'), '16');
  assert.deepEqual([btn.getAttribute('aria-label'), btn.dataset.tip, btn.hasAttribute('title')], ['Chat scope: No project', 'Chat scope: No project', false]);
  assert.equal(btn.querySelector('.ask-scope-label').textContent, 'No project');   // kept in the DOM, hidden by CSS
  assert.ok(btn.querySelector('.ask-scope-dot'));
  ctx.panel.setScope({ pinned: true, projectKey: 'demo', label: 'Demo' });
  assert.deepEqual([btn.classList.contains('is-bare'), btn.classList.contains('is-pinned'), btn.dataset.tip], [false, true, 'Chat scope: Demo']);
  assert.equal(btn.querySelector('svg path').hasAttribute('stroke-dasharray'), false);
  ctx.panel.destroy();
});

test('Requirements: an icon, and the count once features are attached', () => {
  const ctx = makePanel();
  ctx.panel.open();
  const btn = ctx.doc.querySelector('[data-ask-pull-btn]');
  assert.deepEqual([btn.textContent, btn.getAttribute('aria-label'), btn.dataset.tip, btn.classList.contains('is-bare'), btn.getAttribute('aria-haspopup')],
    ['', 'Pull from Requirements', 'Pull from Requirements', true, 'dialog']);
  assert.equal(btn.querySelector('.ask-bar-n').hidden, true);
  ctx.panel.destroy();
});

test('Sets: the layers icon and a bare number', () => {
  const ctx = makePanel();
  ctx.panel.open();
  const btn = ctx.doc.querySelector('[data-ask-mcp-btn]');
  assert.deepEqual([btn.querySelectorAll('svg').length, btn.querySelector('.ask-bar-n').textContent, btn.dataset.tip, btn.getAttribute('aria-label'), btn.dataset.minLevel],
    [1, '0', 'Sets for this chat', 'Sets for this chat', 'advanced']);
  ctx.panel.destroy();
});

test('Project: back to no project is the dashed folder at 16px again; a design that fixes the scope adds it to the tip, never a native title', () => {
  let setComposer = null;
  const designChat = { enabled: () => true, mountStart(slot, api) { setComposer = api.setComposer; }, mount() {}, unmount() {} };
  const ctx = makePanel({ deps: { designChat } });
  ctx.panel.open();
  const btn = ctx.doc.querySelector('[data-ask-scope-btn]');
  ctx.panel.setScope({ pinned: true, projectKey: 'demo', label: 'Demo' });
  assert.equal(btn.querySelector('svg').getAttribute('width'), '16');
  ctx.panel.setScope({ pinned: false });
  assert.deepEqual([btn.classList.contains('is-bare'), btn.querySelector('svg path').getAttribute('stroke-dasharray'), btn.querySelector('svg').getAttribute('width')], [true, '2.6 3.2', '16']);
  assert.equal(ctx.panel.startDesign(), true);
  setComposer({ payload: () => ({}), scope: 'fixed' });
  assert.deepEqual([btn.dataset.tip, btn.getAttribute('aria-label'), btn.hasAttribute('title')], ['Chat scope: No project · set when the design started', 'Chat scope: No project', false]);
  ctx.panel.destroy();
});

test('fit: tiers rise only while the row overflows, stop at 6, clear when it fits; tips are off while measuring; painters refit', () => {
  const ctx = makePanel({ resizeObserver: true });
  ctx.panel.open();
  const row = ctx.doc.querySelector('.ask-composer-row');
  const ro = ctx.resizeObservers.find((o) => o.targets.includes(row));
  let over = { undefined: 470, 1: 442, 2: 400 };      // keyed by the tier: fits after two tiers
  const measuring = [];
  Object.defineProperty(row, 'clientWidth', { configurable: true, get: () => 400 });
  Object.defineProperty(row, 'scrollWidth', { configurable: true, get: () => { measuring.push(row.hasAttribute('data-measure')); return over[row.dataset.fit] ?? 380; } });
  ro.cb([]);
  assert.equal(row.dataset.fit, '2');
  assert.ok(measuring.length && measuring.every(Boolean), 'measured with the tips hidden');
  assert.equal(row.hasAttribute('data-measure'), false);
  over = { undefined: 470, 1: 400 };                  // one tier is enough: the first tier is '1'
  ro.cb([]);
  assert.equal(row.dataset.fit, '1');
  // A 1px overflow is an overflow (Task 7 browser proof: at 400px Send stood 0.98px past the row, which failed
  // row.scrollWidth <= row.clientWidth there and in verify:theme's rowScroll).
  over = { undefined: 470, 1: 401, 2: 400 };
  ro.cb([]);
  assert.equal(row.dataset.fit, '2');
  // The Sets count is the last part to go (tier 6, composer-bar.css): a row that fits once the model name may shrink
  // (tier 5) keeps it; only a row that still overflows there lets Sets shrink.
  over = { undefined: 470, 1: 460, 2: 450, 3: 440, 4: 430, 5: 400 };
  ro.cb([]);
  assert.equal(row.dataset.fit, '5');
  over = { undefined: 470, 1: 460, 2: 450, 3: 440, 4: 430, 5: 420, 6: 400 };
  ro.cb([]);
  assert.equal(row.dataset.fit, '6');
  over = new Proxy({}, { get: () => 900 });           // never fits
  ro.cb([]);
  assert.equal(row.dataset.fit, '6');
  over = new Proxy({}, { get: () => 300 });
  ro.cb([]);
  assert.equal(row.dataset.fit, undefined);
  over = new Proxy({}, { get: () => 900 });
  ctx.panel.setScope({ pinned: true, projectKey: 'demo', label: 'Demo' });   // no observer call: the painter refits
  assert.equal(row.dataset.fit, '6');
  ctx.panel.destroy();
});

test('fit: each painter that changes the row refits after its change (the last measure sees the new row); a keystroke measures nothing', async () => {
  const { applyFlags } = await import('../ui/public/flags.mjs');
  const TID = 'ask_00000001';
  const MID = 'askm_00000001';
  const release = {};
  const gate = (k) => new Promise((r) => { release[k] = r; });
  const held = { models: gate('models'), preview: gate('preview') };
  const json = (status, body) => ({ ok: true, status, json: async () => body });
  const handler = (url, opts) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (url === '/api/ask/models') return held.models.then(() => json(200, { models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['high'], custom: false }], efforts: ['high'], default: { model: 'claude-opus-5-5', effort: 'high' }, askEngine: 'claude' }));
    if (url === '/api/ask/mcp-preview') return held.preview.then(() => json(200, { sets: [{ id: 'general', name: 'General', members: 1, skills: 0 }], copies: [], skipped: [], started: 1 }));
    if (url === '/api/ask/threads' && method === 'POST') return json(201, { thread: { id: TID, title: null, createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} } });
    if (url === `/api/ask/threads/${TID}/messages` && method === 'POST') return json(202, { userMessageId: 'askm_u0000001', assistantMessageId: MID });
    if (url.startsWith('/api/requirements/search')) return json(200, { features: [{ seq: 5, id: 'FEAT-5', title: 'Login flow', criteriaCount: 3, startable: true }] });
    if (url === '/api/requirements/attach/resolve') return json(200, { items: JSON.parse(opts.body).seqs.map((seq) => ({ seq, status: 'ok' })) });
    return json(200, {});
  };
  let lend = null;
  const designChat = { enabled: () => true, mountStart(slot, api) { lend = api.setComposer; }, mount() {}, unmount() {} };
  const ctx = makePanel({ resizeObserver: true, fetchHandler: handler, deps: { designChat } });
  const { doc, window } = ctx;
  const settle = async () => { for (let i = 0; i < 6; i += 1) await ctx.tick(); ctx.flush(); };
  ctx.panel.open();
  const row = doc.querySelector('.ask-composer-row');
  const q = (sel) => row.querySelector(sel);
  const seen = [];
  Object.defineProperty(row, 'clientWidth', { configurable: true, get: () => 400 });
  Object.defineProperty(row, 'scrollWidth', { configurable: true, get: () => {
    seen.push({ model: q('.ask-model-btn-label').textContent, sets: q('[data-ask-mcp-btn]').hidden, pull: q('[data-ask-pull-btn]').hidden,
      n: q('[data-ask-pull-btn] .ask-bar-n').textContent, ext: q('[data-ask-composer-ext]').hidden, stop: q('[data-ask-stop]').hidden });
    return 900;                                       // never fits: every refit ends at tier 6
  } });
  const refit = async (change) => { seen.length = 0; delete row.dataset.fit; await change(); return { fit: row.dataset.fit, last: seen.at(-1) || {} }; };
  let r = await refit(async () => { release.models(); await settle(); });
  assert.deepEqual([r.fit, r.last.model], ['6', 'Opus 5.5'], 'updatePickerButton');
  r = await refit(async () => { release.preview(); await settle(); });
  assert.deepEqual([r.fit, r.last.sets], ['6', false], 'refreshMcp');
  r = await refit(() => doc.dispatchEvent(new window.Event('worca:level')));
  assert.equal(r.fit, '6', 'the level change');
  r = await refit(() => applyFlags({ requirements: true }, doc));
  assert.deepEqual([r.fit, r.last.pull], ['6', false], 'the Requirements flag, measured after the button shows');
  ctx.panel.setScope({ pinned: true, projectKey: 'p1', label: 'P1' });
  const input = doc.querySelector('textarea.ask-input');
  input.value = '#';
  input.setSelectionRange(1, 1);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await settle();
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await settle();
  assert.equal(q('[data-ask-pull-btn] .ask-bar-n').textContent, '1', 'one feature attached');
  // A removal pins no scope (an attach does, and updateScopeButton refits after it), so only paintPull refits here.
  r = await refit(() => doc.querySelector('[data-ask-attach-cards] [aria-label="Remove FEAT-5"]').click());
  assert.deepEqual([r.fit, r.last.n], ['6', ''], 'paintPull');
  seen.length = 0;
  input.value = 'first';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(seen.length, 0, 'a keystroke that shows or hides nothing measures nothing');
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await settle();
  r = await refit(() => { ctx.panel.pushServerFrame({ type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't', threadId: TID, messageId: MID, seq: 1 }); ctx.flush(); });
  assert.deepEqual([r.fit, r.last.stop], ['6', false], 'updateSendStop, once Stop shows');
  ctx.panel.close();
  r = await refit(() => ctx.panel.open());
  assert.equal(r.fit, '6', 'openPage');
  assert.equal(ctx.panel.startDesign(), true);
  r = await refit(() => lend({ send: async () => ({ ok: true }), nodes: [doc.createElement('button')] }));
  assert.deepEqual([r.fit, r.last.ext], ['6', false], 'setComposerExt lends');
  r = await refit(() => lend(null));
  assert.deepEqual([r.fit, r.last.ext], ['6', true], 'setComposerExt gives back (its early return)');
  ctx.panel.destroy();
});
