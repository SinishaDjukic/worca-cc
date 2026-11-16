// test/stillhet-new-task-presets-host.test.mjs — COV-2 D7 (docs/rail/forms.md form.run-options): New task picks, applies and
// checks a saved preset; its broken items block Start until reset; Update and Duplicate are its menu's; Start sends its
// id and what it carries. Live app host (jsdom), the real shell, a stubbed fetch.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, go, settle, closeHosts, posts, LISTS } from './helpers/stillhet-chat-live-host.mjs';

afterEach(closeHosts);
const DEFAULTS = '/api/run-defaults?projectDir=%2Fsrc%2Fweb';
const P = {
  fix: { id: 'rp_fix', name: 'Bug fix', scope: { kind: 'global', ref: null }, setup: { workflowId: 'wf_lean', engine: 'codex', syncBeforeStart: false, pr: { open: 'none' }, tags: ['bugfix'], guardrailsId: 'strict', overlay: { nodes: { plan: { model: 'opus' } } }, humanInLoop: true } },
  web: { id: 'rp_web', name: 'Web only', scope: { kind: 'project', ref: 'web-1' }, setup: { workflowId: 'wf_shape' } },
  api: { id: 'rp_api', name: 'Api only', scope: { kind: 'project', ref: 'api-2' }, setup: {} },
  gone: { id: 'rp_gone', name: 'Gone bits', scope: { kind: 'global', ref: null }, setup: { workflowId: 'wf_old', guardrailsId: 'old' } },
};
const BROKEN = [{ item: 'workflow', ref: 'wf_old', message: 'Workflow wf_old no longer exists', reset: true }, { item: 'guardrails', ref: 'old', message: 'Guardrail set old no longer exists', reset: true }];
async function open({ presets = Object.values(P), check = () => [200, { broken: [] }], write = () => [200, { runId: 'r-new' }] } = {}) {
  const list = { presets };
  const h = await liveHost({ lists: LISTS, read: (u) => (u === '/api/presets' ? [200, list] : u === DEFAULTS ? [200, { engine: { value: 'claude' }, tags: [], projectKey: 'web-1' }] : null),
    write: (u, b, m) => (/\/check$/.test(u) ? check(u, b) : write(u, b, m, list)) });
  await go(h.w, '#runs', 120);
  h.w.RailCenters.maker('tasks').newPick('form'); await settle(80);
  return { ...h, list };
}
const q = (d, sel) => d.querySelector(`#center-dlg ${sel}`);
const shown = (d, id) => q(d, `[data-menu="f-${id}"]`).textContent.trim();
const menuOf = async (d) => { q(d, '[data-menu="f-preset"]').click(); await settle(10); const got = [...d.querySelectorAll('#center-dlg [data-menu-pick^="f-preset|"]')].map((x) => x.textContent.trim()); q(d, '[data-menu="f-preset"]').click(); await settle(10); return got; };
const pick = async (d, id, v) => { q(d, `[data-menu="f-${id}"]`).click(); await settle(10); q(d, `[data-menu-pick="f-${id}|${v}"]`).click(); await settle(50); };
const type = (w, d, sel, v) => { const t = q(d, sel); t.value = v; t.dispatchEvent(new w.Event('input', { bubbles: true })); };
const start = async (d) => { q(d, '[data-dialog="yes"]').click(); await settle(80); };
const runs = (calls) => posts(calls).filter(([, u]) => u === '/api/run').map(([, , b]) => b);
const note = (d) => q(d, '.choice-note');

test('COV-2 presets: the menu lists only the presets for any project or this one, then No preset', async () => {
  const { d } = await open();
  assert.equal(shown(d, 'preset'), 'no preset');
  assert.deepEqual(await menuOf(d), ['Bug fix', 'Web only', 'Gone bits', 'No preset']);
});

test('COV-2 presets: no preset for this project, no clause in the frame', async () => {
  const { d } = await open({ presets: [P.api] });
  assert.equal(q(d, '[data-menu="f-preset"]'), null);
});

test('COV-2 presets: picking one fills the pickers and checks it for this project', async () => {
  const { d, calls } = await open();
  await pick(d, 'preset', 'p:rp_fix');
  assert.equal(shown(d, 'preset'), 'Bug fix');
  assert.equal(shown(d, 'workflow'), 'Lean');
  assert.equal(shown(d, 'agent'), 'OpenAI Codex');
  assert.equal(shown(d, 'source'), 'my local copy');
  assert.equal(shown(d, 'then'), 'leave it on the branch');
  q(d, '[data-c-more]').click(); await settle(20);
  assert.equal(q(d, '#cc-tags').value, 'bugfix');
  assert.deepEqual(posts(calls).filter(([, u]) => /check$/.test(u)), [['POST', '/api/presets/rp_fix/check', { projectDir: '/src/web' }]]);
});

test('COV-2 presets: broken items show the note and block Start', async () => {
  const { w, d, calls } = await open({ check: () => [200, { broken: BROKEN }] });
  await pick(d, 'preset', 'p:rp_gone');
  const n = note(d);
  assert.match(n.textContent, /This preset needs attention/);
  assert.match(n.textContent, /Workflow wf_old no longer exists/);
  assert.equal(n.querySelectorAll('[data-c-preset-reset]').length, 2);
  type(w, d, '#cc-text', 'Add a pager'); await start(d);
  assert.equal(runs(calls).length, 0, 'Start waits for the items');
  assert.match(q(d, '.dlg').textContent, /Reset each item the preset needs first/);
});

test('COV-2 presets: Reset to default drops the pick and checks again; once none is left, Start goes', async () => {
  let n = 0;
  const { w, d, calls } = await open({ check: () => [200, { broken: ++n === 1 ? BROKEN : BROKEN }] });
  await pick(d, 'preset', 'p:rp_gone');
  q(d, '[data-c-preset-reset="0"]').click(); await settle(50);
  assert.equal(posts(calls).filter(([, u]) => /check$/.test(u)).length, 2, 'checked again');
  assert.doesNotMatch(note(d).textContent, /wf_old/, 'the reset item stays out though dev still lists it');
  q(d, '[data-c-preset-reset="0"]').click(); await settle(50);
  assert.doesNotMatch(note(d)?.textContent || '', /needs attention/);
  type(w, d, '#cc-text', 'Add a pager'); await start(d);
  const [b] = runs(calls);
  assert.equal(b.presetId, 'rp_gone');
  assert.equal(b.guardrailsId, undefined, 'the reset guardrails are not sent');
});

test('COV-2 presets: a changed pick shows Update preset; it sends PUT with setup and basis', async () => {
  const { d, calls } = await open({ write: (u, b, m) => (m === 'PUT' ? [200, { preset: { ...P.fix, setup: b.setup } }] : [200, { runId: 'r-new' }]) });
  await pick(d, 'preset', 'p:rp_fix');
  assert.deepEqual(await menuOf(d), ['Bug fix', 'Web only', 'Gone bits', 'Duplicate', 'No preset'], 'unchanged: no Update');
  await pick(d, 'agent', 'Claude Code');
  assert.ok((await menuOf(d)).includes('Update preset'));
  await pick(d, 'preset', 'update');
  const put = posts(calls).find(([m]) => m === 'PUT');
  assert.equal(put[1], '/api/presets/rp_fix');
  assert.deepEqual(put[2].basis, { projectDir: '/src/web' });
  assert.equal(put[2].setup.engine, 'claude', 'the preset pins an engine: the new pick stays a pin, though Claude is the project\'s default (COV-2 m-pin)');
  assert.equal(put[2].setup.workflowId, 'wf_lean');
  assert.deepEqual(put[2].setup.overlay, { nodes: { plan: { model: 'opus' } } }, 'the preset\'s agent picks ride along');
  assert.equal(put[2].setup.humanInLoop, true);
  assert.equal(put[2].setup.prompt, undefined, 'never the task');
  assert.ok(!(await menuOf(d)).includes('Update preset'), 'saved: not modified any more');
});

test('COV-2 m-pin: Update preset keeps a preset\'s Claude pin when Claude is also the project\'s default', async () => {
  const pinned = { id: 'rp_pin', name: 'Claude pinned', scope: { kind: 'global', ref: null }, setup: { workflowId: 'wf_lean', engine: 'claude' } };
  const { w, d, calls } = await open({ presets: [pinned], write: (u, b, m) => (m === 'PUT' ? [200, { preset: { ...pinned, setup: b.setup } }] : [200, { runId: 'r-new' }]) });
  await pick(d, 'preset', 'p:rp_pin');
  await pick(d, 'workflow', 'Shaper');
  await pick(d, 'preset', 'update');
  const put = posts(calls).find(([m]) => m === 'PUT');
  assert.equal(put[2].setup.engine, 'claude', 'the pin is kept');
  assert.equal(put[2].setup.workflowId, 'wf_shape');
  type(w, d, '#cc-text', 'Add a pager'); await start(d);
  assert.equal(runs(calls)[0].engine, undefined, 'the start still sends no Claude when it is the project\'s default (classic startRun)');
});

test('COV-2 presets: Duplicate saves a copy, reads the list again and applies the copy', async () => {
  const copy = { ...P.fix, id: 'rp_fix2', name: 'Bug fix (copy)' };
  const { d, calls } = await open({ write: (u, b, m, list) => { if (/duplicate$/.test(u)) { list.presets.push(copy); return [201, { preset: copy }]; } return [200, {}]; } });
  await pick(d, 'preset', 'p:rp_fix');
  await pick(d, 'preset', 'duplicate');
  assert.deepEqual(posts(calls).find(([, u]) => /duplicate$/.test(u)), ['POST', '/api/presets/rp_fix/duplicate', {}]);
  assert.equal(calls.filter((c) => c.url === '/api/presets').length, 2, 'the list is read again');
  assert.equal(shown(d, 'preset'), 'Bug fix (copy)');
});

test('COV-2 presets: a refused Duplicate changes nothing and names dev\'s reason', async () => {
  const { d } = await open({ write: (u) => (/duplicate$/.test(u) ? [404, { error: 'preset not found' }] : [200, {}]) });
  await pick(d, 'preset', 'p:rp_fix');
  await pick(d, 'preset', 'duplicate');
  assert.equal(shown(d, 'preset'), 'Bug fix');
  assert.match(q(d, '.dlg').textContent, /Could not duplicate the preset: preset not found/);
});

test('COV-2 presets: Start sends presetId and the fields the form has no control for', async () => {
  const { w, d, calls } = await open();
  await pick(d, 'preset', 'p:rp_fix');
  type(w, d, '#cc-text', 'Add a pager'); await start(d);
  const [b] = runs(calls);
  assert.equal(b.presetId, 'rp_fix');
  assert.equal(b.guardrailsId, 'strict');
  assert.deepEqual(b.overlay, { nodes: { plan: { model: 'opus' } } });
  assert.equal(b.humanInLoop, true);
  assert.equal(b.workflowId, 'wf_lean'); assert.equal(b.engine, 'codex'); assert.equal(b.syncBeforeStart, false); assert.deepEqual(b.pr, { open: 'none' }); assert.deepEqual(b.tags, ['bugfix']);
});

test('COV-2 presets: a 409 preset-broken at Start repaints the same note, never the form\'s error line', async () => {
  const { w, d } = await open({ write: (u) => (u === '/api/run' ? [409, { error: 'Preset "Bug fix" cannot start: Workflow wf_lean no longer exists', code: 'preset-broken', broken: [{ item: 'workflow', ref: 'wf_lean', message: 'Workflow wf_lean no longer exists', reset: true }] }] : [200, {}]) });
  await pick(d, 'preset', 'p:rp_fix');
  type(w, d, '#cc-text', 'Add a pager'); await start(d);
  assert.match(note(d).textContent, /This preset needs attention/);
  assert.match(note(d).textContent, /Workflow wf_lean no longer exists/);
  assert.equal(q(d, '[id$="-note"]'), null);
});

test('COV-2 presets: No preset clears it; the start body has no preset id', async () => {
  const { w, d, calls } = await open();
  await pick(d, 'preset', 'p:rp_fix');
  await pick(d, 'preset', 'none');
  assert.equal(shown(d, 'preset'), 'no preset');
  type(w, d, '#cc-text', 'Add a pager'); await start(d);
  const [b] = runs(calls);
  assert.equal(b.presetId, undefined); assert.equal(b.guardrailsId, undefined);
});

test('F-G-G3-02: a refused Save as default leaves its error under Cost tags until a preset replaces the tags', async () => {
  const { w, d } = await open({ write: (u) => (u.endsWith('/tags/defaults') ? [400, { error: 'tag "x y" has a space' }] : [200, { runId: 'r-new' }]) });
  q(d, '[data-c-more]').click(); await settle(20);
  type(w, d, '#cc-tags', 'x y');
  q(d, '[data-c-tagsave]').click(); await settle(40);
  assert.equal(q(d, '#cc-tags-note').textContent, 'tag "x y" has a space');
  await pick(d, 'preset', 'p:rp_fix');
  assert.equal(q(d, '#cc-tags').value, 'bugfix');
  assert.equal(q(d, '#cc-tags-note'), null, 'the tags changed: the old refusal goes');
});
