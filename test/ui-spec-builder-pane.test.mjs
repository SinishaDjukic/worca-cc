// test/ui-spec-builder-pane.test.mjs — the Spec Builder pane alone (jsdom, no app shell): api, thread, storage, timers
// and renderMarkdown are stubs, so every view (form, drafting, questions, output, failed) is driven by snapshots and frames.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { marked } from 'marked';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { mockSpecMarkdown } from '../src/core/spec-builder/mock-spec.mjs';
import { createThreadModel } from '../ui/public/ask-model.mjs';
import { parseWorcaFrontMatter, withWaiver } from '../src/shared/spec-builder/front-matter.mjs';
import { checkShape } from '../src/shared/spec-builder/shape.mjs';
import {
  createSpecBuilder, estimateSummary, shapeSummary, isReshape, activityLine, deriveDraftState, readDrafts, writeDraft, carryWaivers,
  DRAFTS_KEY, SUGGEST_DEBOUNCE_MS,
} from '../ui/public/spec-builder.mjs';

const trackDom = useDomRelease(afterEach);
const flush = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

const TID = 'ask_00000001';
const KEY = 'k';
const EST = { recipe: 'r', stages: [{ phase: 'implementer', model: null, low: 1, high: 2, n: 0, basis: 'rough' }, { phase: 'reviewer', model: null, low: 1, high: 2, n: 0, basis: 'rough' }],
  low: 2, high: 4, ms: 60_000, msHigh: 120_000, basis: 'rough', samples: 0 };
const GROUND = [
  { path: 'src/app.mjs', found: true, isNew: false }, { path: 'src/store.mjs', found: true, isNew: false }, { path: 'test/app.test.mjs', found: true, isNew: false },
  { path: 'src/charts.mjs', found: false, isNew: true }, { path: 'test/charts.test.mjs', found: false, isNew: true },
];
const GROUND_LOST = GROUND.map((g) => (g.path === 'src/store.mjs' ? { ...g, found: false } : g));

const userRow = (text = '[worca spec-builder] write it') => ({ id: 'askm_u1', role: 'user', text, blocks: [], status: null });
const asstRow = (over = {}) => ({ id: 'askm_a1', role: 'assistant', text: '', blocks: [], status: 'done', ...over });
const specCard = (md, over = {}) => ({ type: 'spec', markdown: md, path: 'plans/charts-design.md', grounding: GROUND, projectKey: KEY, projectDir: '/repos/k', estimate: EST, ...over });
const cardBlock = (card, id = 'card_1') => ({ kind: 'card', id, card });
const QUESTIONS = [{ id: 'chart-storage', text: 'Where should pinned charts be stored?', why: '`src/store.mjs` keeps per-project state only.', options: ['Per project', 'Per user'] }];
const questionsCard = (over = {}) => ({ type: 'spec-questions', questions: QUESTIONS, projectKey: KEY, projectDir: '/repos/k', ...over });
const snap = (messages, inFlight = null) => ({ thread: { id: TID }, messages, attachments: [], runLinks: [], inFlight });
const outputSnap = (md = mockSpecMarkdown({ failing: 'testable' }), over = {}) => snap([userRow(), asstRow({ blocks: [cardBlock(specCard(md, over))] })]);
const questionsSnap = () => snap([userRow(), asstRow({ blocks: [cardBlock(questionsCard(), 'card_q')] })]);

function fakeTimers() {
  const pending = [];
  return {
    setTimeout: (fn, ms) => { const t = { fn, ms, live: true }; pending.push(t); return t; },
    clearTimeout: (t) => { if (t) t.live = false; },
    pending: () => pending.filter((t) => t.live),
    async fire() { for (const t of pending.filter((x) => x.live)) { t.live = false; await t.fn(); } },
  };
}
function memoryStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
}
const blockedStorage = () => ({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
const seedDraft = (over = {}) => ({ [DRAFTS_KEY]: JSON.stringify({ [KEY]: { threadId: TID, projectKey: KEY, idea: 'Add charts from a question', origin: 'typed', roles: ['product', 'architect', 'qa'], ...over } }) });
const SUGGESTION = { roles: ['product', 'ux', 'security'], kind: 'feature', size: 'large', reasons: { ux: 'New screen to show', security: 'Takes user input' }, source: 'model' };

function mount(opts = {}) {
  const { window: win } = trackDom(new JSDOM('<!doctype html><body></body>'));
  const doc = win.document;
  win.Element.prototype.scrollIntoView = function () {};
  const timers = opts.timers || fakeTimers();
  const storage = opts.storage || memoryStorage();
  const calls = { send: [], create: [], load: [], subscribe: [], stop: [], prompt: [], suggest: [], save: [], used: [], continued: [] };
  const api = {
    suggest: async (idea) => { calls.suggest.push(idea); return opts.suggest ? opts.suggest(idea) : SUGGESTION; },
    prompt: async (a) => { calls.prompt.push(a); return { text: '[worca spec-builder] write', title: 'Spec: idea', projectKey: 'resolved-key', projectName: 'app' }; },
    save: async (b) => { calls.save.push(b); return opts.save ? opts.save(b) : { ok: true, path: 'plans/x-design.md' }; },
  };
  let loadImpl = opts.load || (async () => outputSnap());
  const thread = {
    create: async (title) => { calls.create.push(title); return opts.createId || TID; },
    send: async (id, text, key) => { calls.send.push({ id, text, key }); if (opts.send) return opts.send(id, text, key); return { userMessageId: `askm_u${calls.send.length + 1}` }; },
    stop: async (id) => { calls.stop.push(id); },
    load: async (id) => { calls.load.push(id); return loadImpl(id); },
    subscribe: (id) => { calls.subscribe.push(id); },
  };
  const renderMarkdown = opts.renderMarkdown || ((text) => { const t = doc.createElement('template'); t.innerHTML = marked.parse(text); return { kind: 'md', frag: t.content }; });
  const sb = createSpecBuilder({
    doc, storage, timers, project: () => (opts.noProject ? null : { key: KEY, name: 'app', dir: '/repos/k' }), api, thread, renderMarkdown,
    markdownReady: opts.markdownReady, taskSources: opts.taskSources, taskBrowser: opts.taskBrowser,
    onUse: (s) => calls.used.push(s), onContinue: (id) => calls.continued.push(id),
  });
  doc.body.appendChild(sb.el);
  const q = (s) => sb.el.querySelector(s);
  const qa = (s) => [...sb.el.querySelectorAll(s)];
  const input = (el, value) => { el.value = value; el.dispatchEvent(new win.Event('input', { bubbles: true })); };
  const typeIdea = (text) => input(q('[data-sb-idea]'), text);
  const stored = () => JSON.parse(storage.getItem(DRAFTS_KEY) || '{}')[KEY];
  return { sb, q, qa, win, doc, timers, storage, calls, api, thread, input, typeIdea, stored, setLoad: (fn) => { loadImpl = fn; } };
}
const frame = (type, extra = {}) => ({ type, threadId: TID, messageId: 'askm_a2', ...extra });
const doneFrame = (seq, blocks, extra = {}) => frame('ask-done', { seq, text: '', blocks, status: 'done', ...extra });

// ── form ──────────────────────────────────────────────────────────────────────────────

test('form: one textarea of 8 rows that grows to at most 16; empty idea names the problem', async () => {
  const { sb, q, typeIdea } = mount();
  sb.attach(KEY);
  assert.equal(sb.el.querySelectorAll('textarea').length, 1);
  assert.equal(q('[data-sb-idea]').rows, 8);
  typeIdea(Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n'));
  assert.equal(q('[data-sb-idea]').rows, 16);
  typeIdea('');
  assert.equal(q('[data-sb-idea]').rows, 8);
  q('[data-sb-draft]').click();
  await flush();
  assert.equal(q('[data-sb-error]').hidden, false);
  assert.equal(q('[data-sb-error]').textContent, 'Describe the idea first');
});

test('form: without a project, Draft spec asks for one', async () => {
  const { sb, q, typeIdea, calls } = mount({ noProject: true });
  sb.attach(KEY);
  typeIdea('Add charts from a question');
  q('[data-sb-draft]').click();
  await flush();
  assert.equal(q('[data-sb-error]').textContent, 'Select a project first.');
  assert.equal(calls.create.length, 0);
});

test('form: an idea typed before a project is selected survives picking a project, and is saved under it', async () => {
  const { sb, q, typeIdea, stored } = mount();
  sb.attach(null);
  typeIdea('# Charts\n- ask in plain words');
  sb.attach(KEY);
  assert.equal(q('[data-sb-idea]').value, '# Charts\n- ask in plain words');
  assert.equal(stored().idea, '# Charts\n- ask in plain words');
  assert.equal(q('[data-sb-draft]').textContent, '✦ Reshape into spec');
});

test('form: a stored idea for the picked project wins over the unsaved one typed with no project', async () => {
  const { sb, q, typeIdea } = mount({ storage: memoryStorage(seedDraft({ threadId: null })) });
  sb.attach(null);
  typeIdea('something typed with no project');
  sb.attach(KEY);
  assert.equal(q('[data-sb-idea]').value, 'Add charts from a question');
});

// ── Draft / Reshape ───────────────────────────────────────────────────────────────────

test('Draft vs Reshape: plain text drafts; a heading, a list or 26 lines reshape, with the note', () => {
  const { sb, q, typeIdea } = mount();
  sb.attach(KEY);
  typeIdea('Add charts from a question');
  assert.equal(q('[data-sb-draft]').textContent, '✦ Draft spec');
  assert.equal(q('[data-sb-reshape-note]').hidden, true);
  for (const text of ['# Charts\n\nsome words', '- one\n- two', '1. one\n2. two', Array.from({ length: 26 }, (_, i) => `l${i}`).join('\n')]) {
    typeIdea(text);
    assert.equal(q('[data-sb-draft]').textContent, '✦ Reshape into spec', text.slice(0, 12));
    assert.equal(q('[data-sb-reshape-note]').hidden, false);
  }
});

test('Load .md reshapes', async () => {
  const { sb, q, win } = mount();
  sb.attach(KEY);
  const file = q('[data-sb-file]');
  Object.defineProperty(file, 'files', { value: [{ name: 'idea.md', text: async () => 'plain words only' }], configurable: true });
  file.dispatchEvent(new win.Event('change'));
  await flush();
  assert.equal(q('[data-sb-idea]').value, 'plain words only');
  assert.equal(q('[data-sb-draft]').textContent, '✦ Reshape into spec');
});

test('a picked task source fills the idea and reshapes; an unresolvable source says so', async () => {
  const mk = (browser) => { const m = mount({ taskSources: () => [{ key: 'jira', label: 'Jira' }], taskBrowser: () => browser(m.doc) }); return m; };
  {
    const m = mk(async (doc) => ({ el: Object.assign(doc.createElement('div'), { textContent: 'list' }), take: async () => '# T\n\nbody' }));
    m.sb.attach(KEY);
    const sel = m.q('[data-sb-source]');
    sel.value = 'jira'; sel.dispatchEvent(new m.win.Event('change'));
    await flush();
    m.q('[data-sb-task-use]').click();
    await flush();
    assert.equal(m.q('[data-sb-idea]').value, '# T\n\nbody');
    assert.equal(m.q('[data-sb-draft]').textContent, '✦ Reshape into spec');
  }
  for (const browser of [async () => null, async () => { throw new Error('nope'); }]) {
    const m = mk(browser);
    m.sb.attach(KEY);
    const sel = m.q('[data-sb-source]');
    sel.value = 'jira'; sel.dispatchEvent(new m.win.Event('change'));
    await flush();
    assert.match(m.q('.sb-task-browser').textContent, /Set up this source in its own pane first\./);
    assert.equal(m.q('[data-sb-task-use]'), null);
  }
});

// ── suggestion ────────────────────────────────────────────────────────────────────────

const chipKeys = (m) => m.qa('[data-sb-role]').filter((c) => c.classList.contains('on')).map((c) => c.getAttribute('data-sb-role'));

test('suggestion: after the debounce the chips show the suggested roles with their reasons', async () => {
  const m = mount();
  m.sb.attach(KEY);
  assert.match(m.q('[data-sb-roles]').textContent, /Roles appear as you type/);
  m.typeIdea('Add charts from a question');
  assert.equal(m.timers.pending().length, 1);
  assert.equal(m.timers.pending()[0].ms, SUGGEST_DEBOUNCE_MS);
  await m.timers.fire();
  assert.deepEqual(chipKeys(m), ['product', 'ux', 'security']);
  assert.ok(m.q('[data-sb-suggested]'));
  assert.equal(m.q('[data-sb-role="ux"]').title, 'New screen to show');
  assert.match(m.q('[data-sb-line]').textContent, /^Feature · large · no flag · /);
});

test('suggestion: toggling a role wins over a later suggestion; a rejected suggest shows the defaults', async () => {
  const m = mount();
  m.sb.attach(KEY);
  m.typeIdea('Add charts from a question');
  await m.timers.fire();
  m.q('[data-sb-role="qa"]').click();
  assert.deepEqual(chipKeys(m), ['product', 'qa', 'ux', 'security']);
  assert.equal(m.q('[data-sb-suggested]'), null);
  m.typeIdea('Add charts from a question, please');
  await m.timers.fire();
  assert.deepEqual(chipKeys(m), ['product', 'qa', 'ux', 'security'], 'the user\'s roles stay');

  const r = mount({ suggest: async () => { throw new Error('down'); } });
  r.sb.attach(KEY);
  r.typeIdea('Add charts from a question');
  await r.timers.fire();
  assert.deepEqual(chipKeys(r), ['product', 'architect', 'qa']);
  assert.equal(r.q('[data-sb-suggested]'), null);
});

test('Change reveals kind, size and the flag; kind labels are capitalised', () => {
  const m = mount();
  m.sb.attach(KEY);
  assert.equal(m.q('[data-sb-kind]'), null);
  m.q('[data-sb-change]').click();
  assert.ok(m.q('[data-sb-kind]') && m.q('[data-sb-size]') && m.q('[data-sb-flag-key]'));
  for (const b of m.qa('.seg.seg-sm button')) assert.match(b.textContent, /^[A-Z]/);
  m.q('[data-sb-kind="fix"]').click();
  m.q('[data-sb-size="small"]').click();
  assert.match(m.q('[data-sb-line]').textContent, /^Fix · small · no flag/);
  m.input(m.q('[data-sb-flag-key]'), 'chartsPane');
  assert.match(m.q('[data-sb-line]').textContent, /flag chartsPane/);
  assert.deepEqual(m.stored().flag, { key: 'chartsPane', stage: 'beta' });
});

// ── starting a draft ──────────────────────────────────────────────────────────────────

test('Draft spec creates one thread, pins the project and sends the prompt; two quick clicks make one thread', async () => {
  const m = mount();
  m.sb.attach(KEY);
  m.typeIdea('Add charts from a question');
  m.q('[data-sb-draft]').click(); m.q('[data-sb-draft]').click();
  await flush();
  assert.equal(m.calls.create.length, 1);
  assert.equal(m.calls.prompt[0].mode, 'draft');
  assert.deepEqual(m.calls.send[0], { id: TID, text: '[worca spec-builder] write', key: 'resolved-key' });
  assert.equal(m.sb.view(), 'drafting');
  assert.equal(m.stored().threadId, TID);
  assert.equal(m.stored().projectKey, 'resolved-key');
});

test('a suggestion resolving after Draft spec is clicked changes neither the prompt roles nor the stored draft', async () => {
  let release;
  const m = mount({ suggest: () => new Promise((res) => { release = res; }) });
  m.sb.attach(KEY);
  m.typeIdea('Add charts from a question');
  const fired = m.timers.fire();
  m.q('[data-sb-draft]').click();
  await flush();
  release(SUGGESTION);
  await fired; await flush();
  assert.deepEqual(m.calls.prompt[0].roles, ['product', 'architect', 'qa']);
  assert.deepEqual(m.stored().roles, ['product', 'architect', 'qa']);
});

// ── states ────────────────────────────────────────────────────────────────────────────

test('questions: chips and Other… feed the counter; Send answers posts the marked message', async () => {
  const m = mount({ storage: memoryStorage(seedDraft()), load: async () => questionsSnap() });
  m.sb.attach(KEY);
  await flush();
  assert.equal(m.sb.view(), 'questions');
  assert.equal(m.q('[data-sb-qcount]').textContent, '0 of 1 answered');
  m.q('[data-sb-send-answers]').click();
  assert.match(m.q('.field-error').textContent, /Answer every question first/);
  m.q('[data-sb-option="Per user"]').click();
  assert.equal(m.q('[data-sb-qcount]').textContent, '1 of 1 answered');
  m.q('[data-sb-option=""]').click();
  m.input(m.q('[data-sb-other]'), 'Per team');
  assert.equal(m.q('[data-sb-qcount]').textContent, '1 of 1 answered');
  m.q('[data-sb-send-answers]').click();
  await flush();
  assert.equal(m.calls.send.length, 1);
  assert.ok(m.calls.send[0].text.startsWith('[worca spec-builder answers]'));
  assert.match(m.calls.send[0].text, /→ Per team/);
  assert.equal(m.sb.view(), 'drafting');
});

test('output: a failing spec shows the shape, section outline, role tags, grounding marks, and Use anyway', async () => {
  const m = mount({ storage: memoryStorage(seedDraft()), load: async () => outputSnap() });
  m.sb.attach(KEY);
  await flush();
  assert.equal(m.sb.view(), 'output');
  assert.equal(m.q('[data-sb-shape]').getAttribute('data-sb-shape'), 'fail');
  assert.equal(m.q('[data-sb-use]').textContent, 'Use anyway');
  assert.ok(m.q('section[data-sb-section="problem"].sb-sec-fail'));
  assert.equal(m.q('section[data-sb-section="decisions"].sb-sec-fail'), null);
  const tags = m.qa('.sb-role-tag').map((t) => t.textContent);
  assert.ok(['Product', 'Architect', 'QA'].every((t) => tags.includes(t)), tags.join());
  const store = m.qa('code').find((c) => c.textContent === 'src/store.mjs');
  assert.equal(store.nextElementSibling.className, 'sb-ground');
  assert.equal(store.nextElementSibling.textContent, '✓ exists');
  assert.equal(m.q('[data-sb-path]').textContent, 'plans/charts-design.md');
  assert.equal(m.q('[data-sb-grounded]').getAttribute('data-sb-grounded'), '3');
  assert.match(m.q('[data-sb-summary]').textContent, /\$2\.00–\$4\.00/);
  assert.match(m.q('[data-sb-summary]').textContent, /skips Clarify, Plan, Refine/);
});

test('output: Fix sends one message naming the item; Fix all names every open item', async () => {
  const md = mockSpecMarkdown({ failing: 'testable' });
  const m = mount({ storage: memoryStorage(seedDraft()), load: async () => outputSnap(md, { grounding: GROUND_LOST }) });
  m.sb.attach(KEY);
  await flush();
  m.q('[data-sb-fix="testable"]').click();
  await flush();
  assert.equal(m.calls.send.length, 1);
  assert.match(m.calls.send[0].text, /^\[worca spec-builder fix\]/);
  assert.match(m.calls.send[0].text, /- testable —/);
  assert.doesNotMatch(m.calls.send[0].text, /- paths —/);

  const n = mount({ storage: memoryStorage(seedDraft()), load: async () => outputSnap(md, { grounding: GROUND_LOST }) });
  n.sb.attach(KEY);
  await flush();
  n.q('[data-sb-fix-all]').click();
  await flush();
  assert.match(n.calls.send[0].text, /- testable —/);
  assert.match(n.calls.send[0].text, /- paths —/);
});

test('output: a well-shaped spec reads ok and offers Use as task; Save handles a name clash', async () => {
  const saves = [{ ok: false, status: 409, error: 'exists', suggestion: 'plans/charts-design-2.md' }, { ok: true, path: 'plans/charts-design-2.md' }];
  const m = mount({ storage: memoryStorage(seedDraft()), load: async () => outputSnap(mockSpecMarkdown()), save: () => saves.shift() });
  m.sb.attach(KEY);
  await flush();
  assert.equal(m.q('[data-sb-shape]').getAttribute('data-sb-shape'), 'ok');
  assert.equal(m.q('[data-sb-use]').textContent, 'Use as task');
  m.q('[data-sb-save]').click(); await flush();
  assert.equal(m.q('[data-sb-save]').textContent, 'Save as plans/charts-design-2.md');
  m.q('[data-sb-save]').click(); await flush();
  assert.equal(m.calls.save[1].path, 'plans/charts-design-2.md');
  assert.equal(m.q('[data-sb-save]').textContent, 'Saved to plans/charts-design-2.md');
  m.q('[data-sb-use]').click();
  assert.equal(m.calls.used[0].projectDir, '/repos/k');
  assert.equal(m.calls.used[0].markdown, mockSpecMarkdown());
  m.q('[data-sb-continue]').click();
  assert.deepEqual(m.calls.continued, [TID]);
});

// ── waiver (V18) ──────────────────────────────────────────────────────────────────────

test('waiver: a reason is required; with one the shape reads ok, Use as task, and onUse carries shapeWaived', async () => {
  const m = mount({ storage: memoryStorage(seedDraft()), load: async () => outputSnap() });
  m.sb.attach(KEY);
  await flush();
  m.q('[data-sb-waive="testable"]').click();
  m.q('[data-sb-waive-ok]').click();
  assert.equal(m.q('[data-sb-waive-reason] + * + .field-error').hidden, false);
  assert.match(m.q('[data-sb-waive-reason] + * + .field-error').textContent, /Give a one-line reason/);
  m.input(m.q('[data-sb-waive-reason]'), 'Criteria are reviewed by hand');
  m.q('[data-sb-waive-ok]').click();
  assert.equal(m.q('[data-sb-shape]').getAttribute('data-sb-shape'), 'ok');
  assert.equal(m.q('[data-sb-use]').textContent, 'Use as task');
  m.q('[data-sb-use]').click();
  const parsed = parseWorcaFrontMatter(m.calls.used[0].markdown);
  assert.deepEqual(parsed.fm.shapeWaived, [{ id: 'testable', reason: 'Criteria are reviewed by hand' }]);
});

test('waiver: checklists cannot be ignored', async () => {
  const md = mockSpecMarkdown().replace('- [ ] R-qa-1 An unknown metric is rejected with a 400.\n- [ ] R-qa-2 A pinned chart is listed after a reload.\n', '');
  const m = mount({ storage: memoryStorage(seedDraft()), load: async () => outputSnap(md) });
  m.sb.attach(KEY);
  await flush();
  assert.ok(m.q('[data-sb-fix="checklists"]'));
  assert.equal(m.q('[data-sb-waive="checklists"]'), null);
});

test('a half-typed waiver reason survives a resync', async () => {
  const m = mount({ storage: memoryStorage(seedDraft()), load: async () => outputSnap() });
  m.sb.attach(KEY);
  await flush();
  m.q('[data-sb-waive="testable"]').click();
  m.input(m.q('[data-sb-waive-reason]'), 'half typed');
  m.sb.resync();
  await flush();
  assert.equal(m.q('[data-sb-waive-reason]').value, 'half typed');
});

// ── V19 ───────────────────────────────────────────────────────────────────────────────

test('attach: a finished thread shows the output, a running one shows drafting', async () => {
  const a = mount({ storage: memoryStorage(seedDraft()), load: async () => outputSnap() });
  a.sb.attach(KEY);
  assert.deepEqual(a.calls.subscribe, []);
  await flush();
  assert.equal(a.sb.view(), 'output');
  assert.deepEqual(a.calls.subscribe, [TID]);

  const b = mount({ storage: memoryStorage(seedDraft()), load: async () => snap([userRow()], { messageId: 'askm_a2' }) });
  b.sb.attach(KEY);
  await flush();
  assert.equal(b.sb.view(), 'drafting');
  assert.match(b.q('[data-sb-collapsed], .sb-collapsed').textContent, /Add charts from a question/);
});

test('attach: a deleted thread returns to the form, keeps the idea and clears the stored thread id', async () => {
  const m = mount({ storage: memoryStorage(seedDraft()), load: async () => null });
  m.sb.attach(KEY);
  await flush();
  assert.equal(m.sb.view(), 'form');
  assert.equal(m.q('[data-sb-idea]').value, 'Add charts from a question');
  assert.match(m.q('.hint.warn').textContent, /deleted/);
  assert.equal(m.stored().threadId, null);
});

test('failed: a reloaded error row shows its notice and Try again re-sends the last user text', async () => {
  const row = asstRow({ status: 'error', blocks: [{ kind: 'notice', text: 'Usage limit reached' }] });
  const m = mount({ storage: memoryStorage(seedDraft()), load: async () => snap([userRow('[worca spec-builder] the prompt'), row]) });
  m.sb.attach(KEY);
  await flush();
  assert.equal(m.sb.view(), 'failed');
  assert.match(m.q('[data-sb-failed]').textContent, /Usage limit reached/);
  m.q('[data-sb-retry]').click();
  await flush();
  assert.equal(m.calls.send[0].text, '[worca spec-builder] the prompt');
  assert.equal(m.sb.view(), 'drafting');
});

test('failed: a live ask-error shows its message', async () => {
  const m = mount({ storage: memoryStorage(seedDraft()), load: async () => snap([userRow()], { messageId: 'askm_a2' }) });
  m.sb.attach(KEY);
  await flush();
  m.sb.pushFrame(frame('ask-start', { seq: 1, userMessageId: 'askm_u1' }));
  m.sb.pushFrame(frame('ask-error', { seq: 2, message: 'boom', blocks: [] }));
  assert.equal(m.sb.view(), 'failed');
  assert.match(m.q('[data-sb-failed]').textContent, /boom/);
});

test('failed: a rejected send shows Try again', async () => {
  const m = mount({ send: async () => { throw Object.assign(new Error('busy'), { status: 409 }); } });
  m.sb.attach(KEY);
  m.typeIdea('Add charts from a question');
  m.q('[data-sb-draft]').click();
  await flush();
  assert.equal(m.sb.view(), 'failed');
  assert.match(m.q('[data-sb-failed]').textContent, /busy/);
  assert.ok(m.q('[data-sb-retry]'));
});

test('R26: a 404 on send means the thread is gone — form, note, no retry, id cleared', async () => {
  const m = mount({ storage: memoryStorage(seedDraft()), load: async () => outputSnap() , send: async () => { throw Object.assign(new Error('thread not found'), { status: 404 }); } });
  m.sb.attach(KEY);
  await flush();
  m.q('[data-sb-fix-all]').click();
  await flush();
  assert.equal(m.sb.view(), 'form');
  assert.equal(m.q('[data-sb-idea]').value, 'Add charts from a question');
  assert.match(m.q('.hint.warn').textContent, /deleted/);
  assert.equal(m.q('[data-sb-retry]'), null);
  assert.equal(m.stored().threadId, null);
});

test('R19: attach twice for one project loads once; another project loads its own draft', async () => {
  const other = { ...JSON.parse(seedDraft()[DRAFTS_KEY]), other: { threadId: null, idea: 'Other idea', roles: ['product'] } };
  const m = mount({ storage: memoryStorage({ [DRAFTS_KEY]: JSON.stringify(other) }), load: async () => outputSnap() });
  m.sb.attach(KEY); m.sb.attach(KEY);
  await flush();
  assert.equal(m.calls.load.length, 1);
  m.sb.attach('other');
  assert.equal(m.sb.view(), 'form');
  assert.equal(m.q('[data-sb-idea]').value, 'Other idea');
});

test('a throwing storage never crashes attach or persist', async () => {
  const m = mount({ storage: blockedStorage() });
  m.sb.attach(KEY);
  m.typeIdea('Add charts from a question');
  await m.timers.fire();
  m.q('[data-sb-role="qa"]').click();
  m.q('[data-sb-draft]').click();
  await flush();
  assert.equal(m.sb.view(), 'drafting');
});

// ── R20 ───────────────────────────────────────────────────────────────────────────────

test('R20: after Edit input a frame for the old thread leaves the form alone', async () => {
  const m = mount({ storage: memoryStorage(seedDraft()), load: async () => outputSnap() });
  m.sb.attach(KEY);
  await flush();
  m.q('[data-sb-edit]').click();
  assert.equal(m.sb.view(), 'form');
  m.typeIdea('A different idea entirely');
  m.sb.pushFrame(frame('ask-worktrees', { worktrees: [] }));
  m.sb.resync();
  await flush();
  assert.equal(m.sb.view(), 'form');
  assert.equal(m.q('[data-sb-idea]').value, 'A different idea entirely');
});

test('R20: a resync of the same questions card keeps the typed Other… text and the counter', async () => {
  const m = mount({ storage: memoryStorage(seedDraft()), load: async () => questionsSnap() });
  m.sb.attach(KEY);
  await flush();
  m.q('[data-sb-option=""]').click();
  m.input(m.q('[data-sb-other]'), 'Per team');
  m.sb.resync();
  await flush();
  assert.equal(m.q('[data-sb-other]').value, 'Per team');
  assert.equal(m.q('[data-sb-qcount]').textContent, '1 of 1 answered');
});

test('R20: a POST that resolves with no frame is healed by a resync', async () => {
  let done = false;
  const m = mount({ storage: memoryStorage(seedDraft()), load: async () => (done ? outputSnap() : questionsSnap()) });
  m.sb.attach(KEY);
  await flush();
  m.q('[data-sb-option="Per user"]').click();
  m.q('[data-sb-send-answers]').click();
  await flush();
  assert.equal(m.sb.view(), 'drafting');
  done = true;
  m.sb.resync();
  await flush();
  assert.equal(m.sb.view(), 'output');
  assert.ok(m.q('[data-sb-use]'));
});

// ── R23 / R24 ─────────────────────────────────────────────────────────────────────────

test('R23: a done snapshot whose inFlight still names the row shows the output, and its ask-done changes nothing', async () => {
  const s = outputSnap();
  s.messages[1].id = 'askm_a2';
  s.inFlight = { messageId: 'askm_a2' };
  const m = mount({ storage: memoryStorage(seedDraft()), load: async () => s });
  m.sb.attach(KEY);
  await flush();
  assert.equal(m.sb.view(), 'output');
  const before = m.q('[data-sb-use]');
  m.sb.pushFrame(doneFrame(1, []));
  assert.equal(m.sb.view(), 'output');
  assert.equal(m.q('[data-sb-use]'), before, 'not rebuilt');
});

test('R23: frames pushed while the snapshot loads change nothing', async () => {
  let release;
  const m = mount({ storage: memoryStorage(seedDraft()), load: () => new Promise((res) => { release = res; }) });
  m.sb.attach(KEY);
  assert.equal(m.sb.view(), 'form');
  m.sb.pushFrame(frame('ask-start', { seq: 1 }));
  m.sb.pushFrame(doneFrame(2, []));
  assert.equal(m.sb.view(), 'form');
  release(outputSnap());
  await flush();
  assert.equal(m.sb.view(), 'output');
});

test('R23: an ask-done with no ask-start re-reads the snapshot and shows its card', async () => {
  let done = false;
  const m = mount({ load: async () => (done ? outputSnap() : snap([])) });
  m.sb.attach(KEY);
  m.typeIdea('Add charts from a question');
  m.q('[data-sb-draft]').click();
  await flush();
  assert.equal(m.sb.view(), 'drafting');
  const loads = m.calls.load.length;
  done = true;
  m.sb.pushFrame(doneFrame(1, [cardBlock(specCard(mockSpecMarkdown({ failing: 'testable' })))]));
  await flush();
  assert.equal(m.calls.load.length, loads + 1);
  assert.equal(m.sb.view(), 'output');
  assert.doesNotMatch(m.el?.textContent || '', /did not finish/);
});

test('R23: ask-history-cleared reloads when it names this thread or none, and is ignored for others', async () => {
  const m = mount({ storage: memoryStorage(seedDraft()), load: async () => outputSnap() });
  m.sb.attach(KEY);
  await flush();
  m.sb.pushFrame({ type: 'ask-history-cleared', threadIds: ['ask_other'] });
  await flush();
  assert.equal(m.calls.load.length, 1);
  m.setLoad(async () => null);
  m.sb.pushFrame({ type: 'ask-history-cleared' });
  await flush();
  assert.equal(m.calls.load.length, 2);
  assert.equal(m.sb.view(), 'form');
  assert.match(m.q('.hint.warn').textContent, /deleted/);

  const n = mount({ storage: memoryStorage(seedDraft()), load: async () => outputSnap() });
  n.sb.attach(KEY);
  await flush();
  n.setLoad(async () => null);
  n.sb.pushFrame({ type: 'ask-history-cleared', threadIds: [TID] });
  await flush();
  assert.equal(n.sb.view(), 'form');
});

test('R24: a stopped turn holding a spec shows the output; a stopped turn without one says Stopped.', async () => {
  const a = mount({ storage: memoryStorage(seedDraft()), load: async () => { const s = outputSnap(); s.messages[1].status = 'stopped'; return s; } });
  a.sb.attach(KEY);
  await flush();
  assert.equal(a.sb.view(), 'output');
  const b = mount({ storage: memoryStorage(seedDraft()), load: async () => snap([userRow(), asstRow({ status: 'stopped' })]) });
  b.sb.attach(KEY);
  await flush();
  assert.equal(b.sb.view(), 'failed');
  assert.match(b.q('[data-sb-failed]').textContent, /Stopped\./);
  assert.ok(b.q('[data-sb-retry]'));
});

// ── R22 ───────────────────────────────────────────────────────────────────────────────

async function waivedThenFix(nextCard) {
  const m = mount({ storage: memoryStorage(seedDraft()), load: async () => outputSnap(mockSpecMarkdown({ failing: 'testable' }), { grounding: GROUND_LOST }) });
  m.sb.attach(KEY);
  await flush();
  m.q('[data-sb-waive="testable"]').click();
  m.input(m.q('[data-sb-waive-reason]'), 'by hand');
  m.q('[data-sb-waive-ok]').click();
  m.q('[data-sb-fix="paths"]').click();
  await flush();
  m.sb.pushFrame(frame('ask-start', { seq: 1 }));
  m.sb.pushFrame(doneFrame(2, [cardBlock(nextCard, 'card_2')]));
  await flush();
  return m;
}

test('R22: a Fix that still fails a waived check keeps the waiver; one that passes it drops the waiver', async () => {
  const keep = await waivedThenFix(specCard(mockSpecMarkdown({ failing: 'testable' })));
  assert.equal(keep.sb.view(), 'output');
  assert.equal(keep.q('[data-sb-waive="testable"]'), null);
  keep.q('[data-sb-use]').click();
  assert.deepEqual(parseWorcaFrontMatter(keep.calls.used[0].markdown).fm.shapeWaived, [{ id: 'testable', reason: 'by hand' }]);

  const drop = await waivedThenFix(specCard(mockSpecMarkdown()));
  drop.q('[data-sb-use]').click();
  assert.equal(parseWorcaFrontMatter(drop.calls.used[0].markdown).fm.shapeWaived, undefined);
});

test('carryWaivers: only waivers whose check still fails survive', () => {
  const prev = withWaiver(mockSpecMarkdown({ failing: 'testable' }), 'testable', 'by hand');
  const still = carryWaivers(prev, mockSpecMarkdown({ failing: 'testable' }), null);
  assert.equal(parseWorcaFrontMatter(still).fm.shapeWaived[0].id, 'testable');
  assert.equal(checkShape(still).ok, true);
  const fixed = carryWaivers(prev, mockSpecMarkdown(), null);
  assert.equal(fixed, mockSpecMarkdown());
  assert.equal(carryWaivers(null, 'x', null), 'x');
});

// ── Markdown (R18) ────────────────────────────────────────────────────────────────────

test('R18: a plain renderer shows pre.sb-md, then the rendered Markdown once the bundle is ready', async () => {
  let ready = false;
  let release;
  const m = mount({ storage: memoryStorage(seedDraft()), load: async () => outputSnap(),
    renderMarkdown: (text) => { if (!ready) return { kind: 'plain' }; const t = m.doc.createElement('template'); t.innerHTML = marked.parse(text); return { kind: 'md', frag: t.content }; },
    markdownReady: () => new Promise((res) => { release = res; }) });
  m.sb.attach(KEY);
  await flush();
  assert.equal(m.sb.view(), 'output');
  assert.ok(m.q('pre.sb-md'));
  assert.equal(m.q('.artifact-markdown'), null);
  ready = true; release(true);
  await flush();
  assert.ok(m.q('.artifact-markdown'));
  assert.equal(m.q('pre.sb-md'), null);
});

// ── pure helpers ──────────────────────────────────────────────────────────────────────

test('estimateSummary: rough vs history', () => {
  assert.match(estimateSummary({ ...EST, basis: 'rough' }), /Rough estimate$/);
  assert.match(estimateSummary({ ...EST, basis: 'history', samples: 4 }), /Based on 4\+ past runs$/);
  assert.match(estimateSummary({ ...EST, basis: 'mixed', samples: 4 }), /Based on 4\+ past runs \(some stages rough\)$/);
  assert.equal(estimateSummary(null), '');
});

test('shapeSummary: passed, failing and waived', () => {
  const items = (n, over = {}) => Array.from({ length: n }, (_, i) => ({ id: `i${i}`, label: `L${i}`, pass: true, ...over }));
  assert.equal(shapeSummary({ items: items(8), passed: 8, total: 8 }), 'Shape ✓ 8 of 8');
  const one = [...items(7), { id: 'testable', label: 'Success criteria must be testable', pass: false }];
  assert.equal(shapeSummary({ items: one, passed: 7, total: 8 }), 'Shape 7 of 8 · to fix: Success criteria must be testable');
  const waived = [...items(7), { id: 'testable', label: 'Success criteria must be testable', pass: false, waived: true }];
  assert.equal(shapeSummary({ items: waived, passed: 7, total: 8 }), 'Shape ✓ 7 of 8 · 1 waived');
});

test('isReshape', () => {
  assert.equal(isReshape('add dark mode'), false);
  assert.equal(isReshape('add dark mode', 'file'), true);
  assert.equal(isReshape('add dark mode', 'task'), true);
  assert.equal(isReshape('# Title\nbody'), true);
  assert.equal(isReshape('- a\n- b'), true);
  assert.equal(isReshape('1) a'), true);
  assert.equal(isReshape(Array.from({ length: 26 }, () => 'x').join('\n')), true);
  assert.equal(isReshape(Array.from({ length: 25 }, () => 'x').join('\n')), false);
});

test('activityLine: tool calls, then the label, null when idle', () => {
  const model = createThreadModel({ threadId: TID });
  model.load({ thread: { id: TID }, messages: [], attachments: [], runLinks: [], inFlight: null });
  assert.equal(activityLine(model), null);
  model.apply({ type: 'ask-start', threadId: TID, messageId: 'm1', seq: 1 });
  assert.equal(activityLine(model), 'Thinking…');
  const tool = (seq, name, input, status = 'running') => model.apply({ type: 'ask-block', threadId: TID, messageId: 'm1', seq, block: { kind: 'tool', id: `t${seq}`, name, input, status } });
  tool(2, 'Read', { file_path: '/repos/k/src/store.mjs' });
  assert.equal(activityLine(model), 'Reading src/store.mjs…');
  tool(3, 'Grep', { pattern: 'listCharts' });
  assert.equal(activityLine(model), 'Searching for listCharts…');
  tool(4, 'Glob', { pattern: 'src/**/*.mjs' });
  assert.equal(activityLine(model), 'Listing src/**/*.mjs…');
  tool(5, 'Glob', { pattern: 'src/**/*.mjs' }, 'done');
  assert.equal(activityLine(model), 'Thinking…');
  model.apply({ type: 'ask-label', threadId: TID, messageId: 'm1', seq: 6, label: 'Writing' });
  assert.equal(activityLine(model), 'Writing…');
});

test('deriveDraftState', () => {
  assert.deepEqual(deriveDraftState([]), { view: 'form' });
  assert.deepEqual(deriveDraftState(undefined), { view: 'form' });
  assert.equal(deriveDraftState([userRow()]).error, 'The draft did not finish.');
  const card = specCard('x');
  const out = deriveDraftState([userRow(), asstRow({ blocks: [cardBlock(card, 'c1')] })]);
  assert.equal(out.view, 'output'); assert.equal(out.cardId, 'c1');
  assert.equal(deriveDraftState([userRow(), asstRow({ blocks: [cardBlock(questionsCard(), 'c2')] })]).view, 'questions');
  assert.equal(deriveDraftState([userRow(), asstRow({ status: 'error', errorMessage: 'boom' })]).error, 'boom');
  assert.equal(deriveDraftState([userRow(), asstRow({ status: 'error', blocks: [{ kind: 'notice', text: 'Usage limit' }] })]).error, 'Usage limit');
  assert.equal(deriveDraftState([userRow(), asstRow({ status: 'stopped' })]).error, 'Stopped.');
  assert.equal(deriveDraftState([userRow(), asstRow({ status: 'stopped', blocks: [cardBlock(card)] })]).view, 'output');
  assert.equal(deriveDraftState([userRow(), asstRow()]).error, 'Ask Worca finished without a spec.');
  assert.equal(deriveDraftState([userRow('retry me'), asstRow()]).retryText, 'retry me');
});

test('readDrafts / writeDraft', () => {
  const s = memoryStorage();
  assert.deepEqual(readDrafts(s), {});
  writeDraft(s, 'a', { idea: 'x' });
  writeDraft(s, 'b', { idea: 'y' });
  writeDraft(s, null, { idea: 'ignored' });
  assert.deepEqual(readDrafts(s), { a: { idea: 'x' }, b: { idea: 'y' } });
  writeDraft(s, 'a', null);
  assert.deepEqual(readDrafts(s), { b: { idea: 'y' } });
  s.setItem(DRAFTS_KEY, '[1]');
  assert.deepEqual(readDrafts(s), {});
  s.setItem(DRAFTS_KEY, 'not json');
  assert.deepEqual(readDrafts(s), {});
  assert.deepEqual(readDrafts(blockedStorage()), {});
  assert.doesNotThrow(() => writeDraft(blockedStorage(), 'a', { idea: 'x' }));
});

// ── §6 across all five views ──────────────────────────────────────────────────────────

async function viewsFixture() {
  const out = {};
  const f = mount(); f.sb.attach(KEY); f.q('[data-sb-change]').click(); f.typeIdea('Add charts from a question'); await f.timers.fire();
  out.form = f;
  const d = mount({ storage: memoryStorage(seedDraft()), load: async () => snap([userRow()], { messageId: 'askm_a2' }) }); d.sb.attach(KEY); await flush();
  out.drafting = d;
  const qn = mount({ storage: memoryStorage(seedDraft()), load: async () => questionsSnap() }); qn.sb.attach(KEY); await flush();
  out.questions = qn;
  const o = mount({ storage: memoryStorage(seedDraft()), load: async () => outputSnap() }); o.sb.attach(KEY); await flush();
  out.output = o;
  const fl = mount({ storage: memoryStorage(seedDraft()), load: async () => snap([userRow(), asstRow({ status: 'error', errorMessage: 'boom' })]) }); fl.sb.attach(KEY); await flush();
  out.failed = fl;
  return out;
}

test('§6: all five views keep the shared look — one primary, no disabled buttons, no wizard parts, labels under .field', async () => {
  const views = await viewsFixture();
  for (const [name, m] of Object.entries(views)) {
    assert.equal(m.sb.view(), name);
    for (const b of m.qa('button')) {
      assert.ok(b.classList.contains('btn') || b.parentElement.classList.contains('seg'), `${name}: button "${b.textContent}"`);
      assert.equal(b.disabled, false, `${name}: disabled "${b.textContent}"`);
      assert.doesNotMatch(b.textContent, /^(Back|Next|Start over)$/, name);
    }
    assert.equal(m.qa('button[disabled]').length, 0, name);   // marked renders task-list boxes as disabled inputs; those are not buttons
    assert.equal(m.qa('.wz-track, .wz-step-pill, [class*="wz-"]').length, 0, name);
    assert.ok(m.qa('.btn-primary').length <= 1, `${name}: ${m.qa('.btn-primary').length} primaries`);
    for (const l of m.qa('label')) {
      assert.ok(l.parentElement.classList.contains('field'), `${name}: label "${l.textContent}"`);
      assert.equal(l.className, '', name);
    }
  }
  const form = views.form;
  assert.equal(form.q('label[for="sb-idea"]').textContent, 'Your idea');
  assert.match(form.q('[data-sb-idea]').placeholder, /turns it into a spec grounded in this repo/);
  assert.equal(form.q('[data-sb-role="product"]').tagName, 'SPAN');
  assert.ok(form.q('[data-sb-role="product"]').classList.contains('sb-locked'));
});
