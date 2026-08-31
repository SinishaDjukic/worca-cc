// test/ui-agent-port-editor.test.mjs — the v2 port editor: render, read-back,
// add/remove/reorder, hints, and the store's rules mirrored verbatim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const MOCK_ROLES = ['clarify', 'planner-plan', 'reviewer', 'generic-producer', 'generic-verifier'];
const META = {
  metaVersion: 2, key: 'docsWriter', displayName: 'Docs Writer', description: 'writes docs',
  color: 'green', runnerType: 'verifier', order: 8, domain: 'coding', scope: 'workspace-only',
  icon: '<path d="M0 0"/>', verdict: { filename: 'docs-review-cycle{cycle}.json' },
  fanOut: true, asksQuestions: false, questionsLocked: false, questionsDefault: false,
  wantsRequest: true, workspaceFanOut: true, workspaceStrategy: 'review',
  workspaceVariantOf: 'reviewer', requiresSkills: ['mock-skill'], promptHints: 'be terse',
  mockRole: 'generic-verifier', sideEffect: 'code', placeable: false,
  // One AGENT-level field this worca does not surface (a newer worca's, or a
  // hand-authored extension): it must ride through the host dataset.extra, not
  // vanish on the next save. Without it the host-level ride-through is UNTESTED
  // — every other key of META is in AGENT_OWN_KEYS, so dataset.extra is {}.
  futureField: { keep: 'me' },
  inputs: [
    { id: 'plan', type: 'md', required: true, as: 'file', label: 'The plan' },
    { id: 'fix', type: 'md', loop: true, required: false, as: 'fix-review', directive: '## Fix it\n\n{path}' },
  ],
  outputs: [
    { id: 'review', type: 'md', when: 'blocking', filename: '{base}-docs-review.md', store: 'project', artifactKind: 'docs' },
    { id: 'pass', type: 'void', when: 'clean' },
  ],
};

async function boot() {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  window.fetch = () => Promise.resolve({ ok: true, status: 200, json: async () => ({ agents: [], mockWriterRoles: MOCK_ROLES }) });
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const host = window.document.createElement('div');
  host.className = 'agent-form';
  window.document.body.appendChild(host);
  return { window, host, api: window.__agents };
}
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));
const change = (window, node) => node.dispatchEvent(new window.Event('change', { bubbles: true }));
// `input` is the ONLY path that reaches the hint refresh while typing — a text
// field's `change` fires on blur. Driving the id edits with `change` would leave
// the `.pf-id` half of the input listener untested.
const input = (window, node) => node.dispatchEvent(new window.Event('input', { bubbles: true }));

test('render → read round-trips a v2 sidecar byte-for-byte (extras included)', async () => {
  const { window, host, api } = await boot();
  api.agentFormRender(host, META, { markdown: '# body\n', mockWriterRoles: MOCK_ROLES, registryKeys: ['reviewer', 'planner'] });
  const { meta, markdown } = api.agentFormRead(host);
  assert.equal(markdown, '# body\n');
  assert.deepEqual(meta, META, 'every surfaced field AND every unsurfaced key survives the round trip');
  void window;
});

test('render → read: the fields the REGISTRY computes never leave the form', async () => {
  const { host, api } = await boot();
  // What GET /api/agents/:key really returns: the v2 sidecar PLUS the registry's
  // COMPUTED fields. None of them may be authored back into a sidecar. (The v1
  // wiring fields normalizeMeta used to derive are gone with the v1 engine, so
  // there is nothing left for the form's DROP list to drop.)
  const REGISTRY_META = { ...META,
    origin: 'user', agentPath: '/tmp/x/docsWriter.md', agentFile: 'docsWriter.md',
    portSummary: 'Reads plan, fix; produces review.' };
  api.agentFormRender(host, REGISTRY_META, { markdown: '# body\n', mockWriterRoles: MOCK_ROLES });
  const { meta } = api.agentFormRead(host);
  assert.deepEqual(meta, META, 'exactly the v2 sidecar comes back — no more, no less');
  for (const k of ['origin', 'agentPath', 'agentFile', 'portSummary']) {
    assert.equal(k in meta, false, `${k} must never be authored back into a sidecar`);
  }
  assert.equal(meta.outputs[0].artifactKind, 'docs', 'an unsurfaced PORT key still rides through');
  assert.equal(meta.inputs[0].label, 'The plan');
});

test('optional capabilities are ABSENT when off, never false', async () => {
  const { window, host, api } = await boot();
  api.agentFormRender(host, { metaVersion: 2, key: 'plain', displayName: 'Plain', runnerType: 'producer', order: 99,
    inputs: [{ id: 'task', type: 'md', required: true, as: 'file' }],
    outputs: [{ id: 'notes', type: 'md', when: 'always', filename: 'notes.md', store: 'run' }] },
  { mockWriterRoles: MOCK_ROLES });
  const { meta } = api.agentFormRead(host);
  for (const k of ['verdict', 'sideEffect', 'mockRole', 'wantsRequest', 'workspaceFanOut',
    'workspaceStrategy', 'workspaceVariantOf', 'placeable', 'scope', 'domain', 'icon',
    'promptHints', 'requiresSkills']) {
    assert.equal(k in meta, false, `${k} must be absent, not falsy`);
  }
  // …but the five CLEARABLE fields are always written, because agent-store
  // merges {...existing, ...raw} and an omitted key would keep its old value.
  for (const k of ['description', 'fanOut', 'asksQuestions', 'questionsLocked', 'questionsDefault']) {
    assert.equal(k in meta, true, `${k} must be emitted on every save so it can be turned OFF`);
  }
  assert.equal(meta.metaVersion, 2);
  // A blank Order is ABSENT, never 0 — Number('') is 0, and agent-store's
  // Number.isFinite check accepts it, sorting the agent ahead of every builtin.
  host.querySelector('.agent-f-order').value = '';
  change(window, host.querySelector('.agent-f-order'));
  assert.equal('order' in api.agentFormRead(host).meta, false, 'a blank Order is absent, not 0');
  void window;
});

test('add / remove / reorder ports, and the add button dies at 8 per side', async () => {
  const { window, host, api } = await boot();
  api.agentFormRender(host, META, { mockWriterRoles: MOCK_ROLES });
  const rows = () => [...host.querySelectorAll('.agent-ports-in .port-row .pf-id')].map((i) => i.value);
  assert.deepEqual(rows(), ['plan', 'fix']);
  click(window, host.querySelector('.agent-ports-in .pf-add-in'));
  assert.equal(rows().length, 3, 'a blank row is appended');
  assert.equal(host.querySelector('.agent-ports-in .pf-count').textContent, '(3/8)');
  // Move the second row up, then remove the (now second) one.
  click(window, host.querySelectorAll('.agent-ports-in .port-row')[1].querySelector('.pf-up'));
  assert.deepEqual(rows(), ['fix', 'plan', '']);
  click(window, host.querySelectorAll('.agent-ports-in .port-row')[1].querySelector('.pf-remove'));
  assert.deepEqual(rows(), ['fix', '']);
  assert.deepEqual(api.agentFormRead(host).meta.inputs.map((p) => p.id), ['fix', ''],
    'read-back follows the DOM order');
  // ▲ on the first row and ▼ on the last are no-ops, not crashes.
  click(window, host.querySelector('.agent-ports-in .port-row .pf-up'));
  assert.deepEqual(rows(), ['fix', '']);
  for (let i = rows().length; i < 8; i += 1) click(window, host.querySelector('.pf-add-in'));
  assert.equal(rows().length, 8);
  assert.equal(host.querySelector('.pf-add-in').disabled, true, 'MAX_PORTS_PER_SIDE is 8');
  click(window, host.querySelector('.pf-add-in'));
  assert.equal(rows().length, 8, 'a disabled add button adds nothing');
});

test('loop forces required off, expands is json-only, and void hides filename/store', async () => {
  const { window, host, api } = await boot();
  api.agentFormRender(host, META, { mockWriterRoles: MOCK_ROLES });
  const plan = host.querySelectorAll('.agent-ports-in .port-row')[0];
  assert.equal(plan.querySelector('.pf-required').disabled, false);
  plan.querySelector('.pf-loop').checked = true;
  change(window, plan.querySelector('.pf-loop'));
  assert.equal(plan.querySelector('.pf-required').checked, false);
  assert.equal(plan.querySelector('.pf-required').disabled, true);
  assert.equal(api.agentFormRead(host).meta.inputs[0].required, false);

  const review = host.querySelectorAll('.agent-ports-out .port-row')[0];
  assert.equal(review.querySelector('.pf-f-filename').hidden, false);
  review.querySelector('.pf-type').value = 'void';
  change(window, review.querySelector('.pf-type'));
  assert.equal(review.querySelector('.pf-f-filename').hidden, true, 'a void port carries no filename');
  assert.equal(review.querySelector('.pf-f-store').hidden, true);
  const out0 = api.agentFormRead(host).meta.outputs[0];
  assert.equal(out0.filename, undefined, 'and never emits one');
  assert.equal(out0.store, undefined);
});

test('a void INPUT is authorable: the blank `as` option means "the store default"', async () => {
  const { window, host, api } = await boot();
  api.agentFormRender(host, META, { mockWriterRoles: MOCK_ROLES });
  const hints = () => [...host.querySelectorAll('.pf-hint')].map((h) => h.textContent).join('\n');
  const plan = host.querySelectorAll('.agent-ports-in .port-row')[0];
  // Assert the OPTION LIST, not just the value: `select.value = ''` with no
  // matching option yields selectedIndex -1 and STILL reads back '', so dropping
  // the blank option would be invisible to a value-only assertion.
  assert.deepEqual([...plan.querySelectorAll('.pf-as option')].map((o) => o.value),
    ['', 'file', 'answers', 'fix-review', 'worktree']);
  plan.querySelector('.pf-type').value = 'void';
  change(window, plan.querySelector('.pf-type'));
  // The form never silently rewrites an authored value: as:'file' on a void
  // input is still emitted, and the hint says exactly what the store will say.
  assert.equal(api.agentFormRead(host).meta.inputs[0].as, 'file');
  assert.match(hints(), /inputs\.plan: as "file" requires a non-void port \(got void\)/);
  // Clearing it to the blank option is how a void input IS authored — without
  // that option the form could only ever emit a value the store 400s on.
  plan.querySelector('.pf-as').value = '';
  change(window, plan.querySelector('.pf-as'));
  assert.equal('as' in api.agentFormRead(host).meta.inputs[0], false);
  assert.doesNotMatch(hints(), /requires a non-void port/);
  plan.querySelector('.pf-as').value = 'worktree';
  change(window, plan.querySelector('.pf-as'));
  assert.equal(api.agentFormRead(host).meta.inputs[0].as, 'worktree');
  assert.doesNotMatch(hints(), /requires a/);
});

test('hints mirror the store rules VERBATIM and appear/disappear live, without blocking', async () => {
  const { window, host, api } = await boot();
  api.agentFormRender(host, META, { mockWriterRoles: MOCK_ROLES });
  const hints = () => [...host.querySelectorAll('.pf-hint')].map((h) => h.textContent).join('\n');
  // A reserved id, live.
  const plan = host.querySelectorAll('.agent-ports-in .port-row')[0];
  plan.querySelector('.pf-id').value = 'await';
  input(window, plan.querySelector('.pf-id'));
  assert.match(hints(), /inputs: port id "await" is reserved — the engine synthesizes the await gate port on every agent node/);
  plan.querySelector('.pf-id').value = 'Plan Two';
  input(window, plan.querySelector('.pf-id'));
  assert.match(hints(), /inputs: bad port id "Plan Two"/);
  plan.querySelector('.pf-id').value = 'plan';
  input(window, plan.querySelector('.pf-id'));
  assert.doesNotMatch(hints(), /await|bad port id/);
  // expands on a non-json input.
  plan.querySelector('.pf-expands').checked = true;
  change(window, plan.querySelector('.pf-expands'));
  assert.match(hints(), /inputs\.plan: expands is only legal on json inputs/);
  plan.querySelector('.pf-expands').checked = false;
  change(window, plan.querySelector('.pf-expands'));
  // `as` mirrors AS_REQUIRES_TYPE exactly — "file" has NO required type, so the
  // store's wording for it is "non-void", not "md".
  plan.querySelector('.pf-as').value = 'answers';
  change(window, plan.querySelector('.pf-as'));
  assert.match(hints(), /inputs\.plan: as "answers" requires a json port \(got md\)/);
  plan.querySelector('.pf-as').value = 'file';
  change(window, plan.querySelector('.pf-as'));
  // Verifier without a verdict filename.
  host.querySelector('.agent-f-verdict').value = '';
  change(window, host.querySelector('.agent-f-verdict'));
  assert.match(hints(), /runnerType "verifier" requires verdict: \{ filename \}/);
  assert.match(hints(), /outputs\.review: when "blocking" requires the agent to declare verdict: \{ filename \}/);
  // A path in the VERDICT filename — the agent-level twin of the output rule.
  host.querySelector('.agent-f-verdict').value = 'sub/v.json';
  change(window, host.querySelector('.agent-f-verdict'));
  assert.match(hints(), /verdict filename "sub\/v\.json" must be a plain basename/);
  host.querySelector('.agent-f-verdict').value = 'docs-review-cycle{cycle}.json';
  change(window, host.querySelector('.agent-f-verdict'));
  // A path in a filename template, and an unknown token, both on the output row.
  const rev = host.querySelectorAll('.agent-ports-out .port-row')[0];
  rev.querySelector('.pf-filename').value = 'sub/r.md';
  change(window, rev.querySelector('.pf-filename'));
  assert.match(hints(), /outputs\.review: filename "sub\/r\.md" must be a plain basename/);
  rev.querySelector('.pf-filename').value = 'r-{nope}.md';
  change(window, rev.querySelector('.pf-filename'));
  assert.match(hints(), /outputs\.review: filename "r-\{nope\}\.md" uses unknown token\(s\) \{nope\}/);
  rev.querySelector('.pf-filename').value = '{base}-docs-review.md';
  change(window, rev.querySelector('.pf-filename'));
  // workspaceVariantOf with the scope still on `project` — both controls are on
  // this form, so the store's 400 is one keystroke away.
  host.querySelector('.agent-f-scope').value = 'project';
  change(window, host.querySelector('.agent-f-scope'));
  assert.match(hints(), /workspaceVariantOf requires scope "workspace-only"/);
  host.querySelector('.agent-f-scope').value = 'workspace-only';
  change(window, host.querySelector('.agent-f-scope'));
  // Clarifier obligation.
  host.querySelector('.agent-f-runner').value = 'clarifier';
  change(window, host.querySelector('.agent-f-runner'));
  assert.match(hints(), /runnerType "clarifier" requires at least one json output port/);
  // Hints NEVER block: no control is disabled by one, and read-back still works.
  assert.equal(host.querySelector('.pf-add-in').disabled, false);
  assert.equal(host.querySelector('.pf-add-out').disabled, false);
  assert.equal(api.agentFormRead(host).meta.runnerType, 'clarifier');
});

test('a duplicate id and a missing filename are hinted per side', async () => {
  const { window, host, api } = await boot();
  api.agentFormRender(host, META, { mockWriterRoles: MOCK_ROLES });
  const [, fix] = host.querySelectorAll('.agent-ports-in .port-row');
  fix.querySelector('.pf-id').value = 'plan';
  change(window, fix.querySelector('.pf-id'));
  assert.match([...host.querySelectorAll('.pf-hint')].map((h) => h.textContent).join('\n'),
    /inputs: duplicate port id "plan"/);
  const review = host.querySelectorAll('.agent-ports-out .port-row')[0];
  review.querySelector('.pf-filename').value = '';
  change(window, review.querySelector('.pf-filename'));
  assert.match([...host.querySelectorAll('.pf-hint')].map((h) => h.textContent).join('\n'),
    /outputs\.review: md outputs require a filename template/);
  void api;
});
