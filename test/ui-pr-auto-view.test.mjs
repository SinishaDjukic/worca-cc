// test/ui-pr-auto-view.test.mjs — ui/public/pr-auto-view.mjs: the New run form's PR fields (only a changed value is sent),
// the read-only fact on a run's page, the Workspace page's setting and the Schedules row text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { prFormState, prBodyOf, renderRunPrFact, mountWorkspacePrSetting, createRunPrFields, paintRunPrAuto, prRowText } from '../ui/public/pr-auto-view.mjs';

const PROJECT = { pr: { scope: 'project', open: { value: 'draft', source: 'project' }, slices: { value: 'each', source: 'default' } } };
const WORKSPACE = { pr: { scope: 'workspace', open: { value: 'none', source: 'team' }, slices: null } };
const tick = () => new Promise((r) => setTimeout(r, 0));
const dom = (html = '') => new JSDOM(`<!doctype html><body>${html}</body>`).window;

test('prFormState: a preset value has source run; slices is null for a workspace', () => {
  assert.deepEqual(prFormState(PROJECT), { open: { value: 'draft', source: 'project' }, slices: { value: 'each', source: 'default' } });
  assert.deepEqual(prFormState(PROJECT, { open: 'ready', slices: 'one' }), { open: { value: 'ready', source: 'run' }, slices: { value: 'one', source: 'run' } });
  assert.deepEqual(prFormState(WORKSPACE, { open: 'ready', slices: 'one' }), { open: { value: 'ready', source: 'run' }, slices: null });
  assert.deepEqual(prFormState(null), { open: { value: 'none', source: 'default' }, slices: null });
});

test('prBodyOf sends only changed keys', () => {
  assert.equal(prBodyOf({ open: 'draft', slices: 'each' }, PROJECT, { slicesShown: true }), undefined);
  assert.deepEqual(prBodyOf({ open: 'ready', slices: 'each' }, PROJECT, { slicesShown: true }), { open: 'ready' });
  assert.deepEqual(prBodyOf({ open: 'draft', slices: 'one' }, PROJECT, { slicesShown: true }), { slices: 'one' });
  assert.equal(prBodyOf({ open: 'draft', slices: 'one' }, PROJECT, { slicesShown: false }), undefined, 'slices is never sent for a workspace or no project');
  assert.equal(prBodyOf({ open: 'ready' }, null), undefined, 'no defaults read: nothing is sent');
});

const flat = (n) => (n.nodeType === 3 ? n.data : [...n.childNodes].map(flat).join(n.tagName === 'A' || n.tagName === 'SPAN' ? '' : ' '));
const text = (el) => flat(el).replace(/\s+/g, ' ').trim();

test('renderRunPrFact: normal / slice (from the feature, read-only) / exempt / outcomes', () => {
  const w = dom();
  const fact = (pa) => renderRunPrFact(w.document, pa);
  const normal = fact({ open: 'draft', slices: 'each', source: { open: 'project' }, scope: 'project' });
  assert.equal(normal.className, 'hd-pr-auto');
  assert.equal(text(normal), 'Create a draft PR · Project setting', 'a normal run has no slices part');
  assert.equal(normal.querySelector('input,select,button'), null, 'read-only: no control');
  const slice = fact({ open: 'draft', slices: 'one', source: { open: 'feature' }, feature: { id: 'f1', source: { open: 'team' } }, outcome: { status: 'waiting' } });
  assert.equal(text(slice), 'Create a draft PR · One PR for the whole feature · From the feature (Team default) Waiting for the feature');
  const done = fact({ open: 'draft', slices: 'one', source: { open: 'feature' }, feature: { id: 'f1', source: { open: 'team' }, outcome: { status: 'opened', urls: ['https://github.com/o/r/pull/9'] } }, outcome: { status: 'waiting' } });
  assert.match(text(done), /Opened: https:\/\/github\.com\/o\/r\/pull\/9$/);
  assert.equal(done.querySelector('a').getAttribute('href'), 'https://github.com/o/r/pull/9');
  assert.equal(done.querySelector('a').rel, 'noopener noreferrer');
  assert.equal(text(fact({ open: 'none', exempt: 'automation', source: { open: 'default' } })), "The Git automation opens this run's PR");
  const skipped = fact({ open: 'ready', slices: null, source: { open: 'run' }, outcome: { status: 'skipped', reason: 'the run ended with status error' } });
  assert.equal(text(skipped), 'Create a PR ready for review · This run Not opened: the run ended with status error');
  assert.equal(text(fact({ open: 'none', slices: null, source: { open: 'default' }, outcome: { status: 'skipped', reason: 'x' } })), "Don't create a PR · Worca default", 'a none setting has no outcome line');
  assert.equal(text(fact(null)), '');
});

test('paintRunPrAuto fills the fact row, hides it for a run from before v86, and drops an answer for another run', async () => {
  const w = dom('<div class="rd-kv-row" hidden><dt>Pull request</dt><dd class="rd-kv-v"></dd></div>');
  const row = w.document.querySelector('.rd-kv-row');
  let calls = 0;
  const fetchFn = async () => { calls++; return { ok: true, json: async () => ({ prAuto: { open: 'draft', slices: null, source: { open: 'project' }, outcome: { status: 'opened', urls: ['u'] } } }) }; };
  await paintRunPrAuto(row, 'abcd0001', 'done', () => true, { fetchFn });
  assert.equal(row.hidden, false);
  assert.match(text(row.querySelector('.hd-pr-auto')), /^Create a draft PR · Project setting Opened: u$/);
  await paintRunPrAuto(row, 'abcd0001', 'done', () => true, { fetchFn });
  assert.equal(calls, 1, 'a terminal answer is kept');
  const stale = dom('<div class="rd-kv-row" hidden><dd class="rd-kv-v"></dd></div>').document.querySelector('.rd-kv-row');
  await paintRunPrAuto(stale, 'abcd0002', 'done', () => false, { fetchFn });
  assert.equal(stale.hidden, true, 'isCurrent() was false after the await');
  const old = dom('<div class="rd-kv-row"><dd class="rd-kv-v">x</dd></div>').document.querySelector('.rd-kv-row');
  await paintRunPrAuto(old, 'abcd0003', 'done', () => true, { fetchFn: async () => ({ ok: true, json: async () => ({ prAuto: null }) }) });
  assert.equal(old.hidden, true);
});

test('paintRunPrAuto: a waiting slice answer is asked again after RECHECK_MS and shows the feature\'s PR once it is set', async () => {
  const w = dom('<div class="rd-kv-row" hidden><dd class="rd-kv-v"></dd></div>');
  const row = w.document.querySelector('.rd-kv-row');
  const waiting = { open: 'draft', slices: 'one', source: { open: 'feature' }, feature: { id: 'f1', source: { open: 'team' } }, outcome: { status: 'waiting', final: true } };
  const opened = { ...waiting, feature: { ...waiting.feature, outcome: { status: 'opened', urls: ['https://github.com/o/r/pull/9'] } } };
  let answer = waiting; let calls = 0; let clock = 1000;
  const opts = { fetchFn: async () => { calls++; return { ok: true, json: async () => ({ prAuto: answer }) }; }, now: () => clock };
  await paintRunPrAuto(row, 'abcd0010', 'done', () => true, opts);
  assert.match(text(row), /Waiting for the feature$/);
  clock += 1000;
  await paintRunPrAuto(row, 'abcd0010', 'done', () => true, opts);
  assert.equal(calls, 1, 'inside RECHECK_MS the answer is reused');
  answer = opened; clock += 5000;
  await paintRunPrAuto(row, 'abcd0010', 'done', () => true, opts);
  assert.equal(calls, 2);
  assert.match(text(row), /Opened: https:\/\/github\.com\/o\/r\/pull\/9$/);
  clock += 60000;
  await paintRunPrAuto(row, 'abcd0010', 'done', () => true, opts);
  assert.equal(calls, 2, 'the feature\'s opened outcome is terminal');
  const held = { ...waiting, feature: { ...waiting.feature, outcome: { status: 'held' } } };
  answer = held;
  await paintRunPrAuto(row, 'abcd0011', 'done', () => true, opts);
  clock += 5000; answer = opened;
  await paintRunPrAuto(row, 'abcd0011', 'done', () => true, opts);
  assert.match(text(row), /Opened: /, 'held is asked again');
});

test('paintRunPrAuto: another run\'s line is cleared while a failed fetch is pending', async () => {
  const w = dom('<div class="rd-kv-row"><dd class="rd-kv-v"></dd></div>');
  const row = w.document.querySelector('.rd-kv-row');
  const pa = { open: 'draft', slices: null, source: { open: 'project' }, outcome: { status: 'opened', urls: ['u'], final: true } };
  await paintRunPrAuto(row, 'abcd0020', 'done', () => true, { fetchFn: async () => ({ ok: true, json: async () => ({ prAuto: pa }) }) });
  assert.equal(row.hidden, false);
  await paintRunPrAuto(row, 'abcd0021', 'done', () => true, { fetchFn: async () => ({ ok: false }) });
  assert.equal(row.hidden, true);
  assert.equal(row.querySelector('.rd-kv-v').childNodes.length, 0);
});

test('mountWorkspacePrSetting: shows the source; PATCH and clear', async () => {
  const w = dom('<section id="h"></section>');
  const host = w.document.getElementById('h');
  const calls = [];
  let own = {};
  const view = () => ({ own, effective: { 'pr.open': own['pr.open'] ? { value: own['pr.open'], source: 'workspace' } : { value: 'draft', source: 'team' } }, team: { 'pr.open': 'draft' } });
  const fetchFn = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    if (opts.method === 'PATCH') {
      const b = JSON.parse(opts.body);
      if (b['pr.open'] === 'bogus') return { ok: false, status: 400, json: async () => ({ error: 'pr.open must be one of none | draft | ready' }) };
      if (b['pr.open']) own = { 'pr.open': b['pr.open'] }; else own = {};
    }
    return { ok: true, status: 200, json: async () => view() };
  };
  await mountWorkspacePrSetting(host, { workspaceId: 'wks-a-00000001', fetchFn });
  assert.equal(calls[0].url, '/api/workspaces/wks-a-00000001/settings');
  assert.equal(text(host.querySelector('.hint')), 'Now: Create a draft PR (Team default)');
  const select = host.querySelector('select');
  assert.deepEqual([...select.options].map((o) => [o.value, o.textContent]), [['', 'Use team policy / Worca default'], ['none', "Don't create a PR"], ['draft', 'Create a draft PR'], ['ready', 'Create a PR ready for review']]);
  assert.equal(select.value, '');
  select.value = 'ready';
  host.querySelector('button').click();
  await tick(); await tick();
  assert.deepEqual(calls.at(-1), { url: '/api/workspaces/wks-a-00000001/settings', method: 'PATCH', body: { 'pr.open': 'ready' } });
  assert.equal(text(host.querySelector('.hint')), 'Now: Create a PR ready for review (Workspace setting)');
  assert.equal(host.querySelector('select').value, 'ready');
  host.querySelector('select').value = '';
  host.querySelector('button').click();
  await tick(); await tick();
  assert.deepEqual(calls.at(-1).body, { 'pr.open': null }, 'the empty choice clears it');
  assert.equal(text(host.querySelector('.hint')), 'Now: Create a draft PR (Team default)');
});

test('mountWorkspacePrSetting: a refusal is a card alert and keeps the pick', async () => {
  const w = dom('<section id="h"></section>');
  const host = w.document.getElementById('h');
  const fetchFn = async (url, opts = {}) => (opts.method === 'PATCH'
    ? { ok: false, status: 400, json: async () => ({ error: 'pr.open must be one of none | draft | ready' }) }
    : { ok: true, status: 200, json: async () => ({ own: {}, effective: { 'pr.open': { value: 'none', source: 'default' } }, team: { 'pr.open': null } }) });
  await mountWorkspacePrSetting(host, { workspaceId: 'wks-a-00000001', fetchFn });
  host.querySelector('select').value = 'draft';
  host.querySelector('button').click();
  await tick(); await tick();
  assert.match(text(host.querySelector('.card-alert')), /Not saved.*pr\.open must be one of none \| draft \| ready/);
  assert.equal(host.querySelector('select').value, 'draft');
});

const FORM = `<div id="pr-open-row" hidden><select id="prOpen"></select><small id="prOpenSource"></small></div>
  <div id="pr-slices-row" hidden><select id="prSlices"></select><small id="prSlicesSource"></small></div>`;

test('createRunPrFields: prefilled from the scope with its source; only a change is sent; workspace hides slices', async () => {
  const w = dom(FORM);
  const d = w.document;
  let target = { kind: 'project', projectDir: '/p', workspaceId: '' };
  const urls = [];
  const fetchFn = async (url) => { urls.push(url); return { ok: true, json: async () => (url.includes('workspaceId') ? WORKSPACE : PROJECT) }; };
  let changed = 0;
  const f = createRunPrFields({ doc: d, getTarget: () => target, fetchFn, onChange: () => { changed++; } });
  await f.refresh();
  assert.equal(urls[0], '/api/run-defaults?projectDir=%2Fp');
  assert.deepEqual([d.getElementById('prOpen').value, d.getElementById('prOpenSource').textContent], ['draft', 'Project setting']);
  assert.equal(d.getElementById('pr-open-row').hidden, false);
  assert.equal(d.getElementById('pr-slices-row').hidden, false);
  assert.equal(f.body(), undefined, 'untouched: nothing is sent');
  const open = d.getElementById('prOpen');
  open.value = 'ready';
  open.dispatchEvent(new w.Event('change'));
  assert.equal(changed, 1);
  assert.equal(d.getElementById('prOpenSource').textContent, 'This run only');
  assert.deepEqual(f.body(), { open: 'ready' });
  open.value = 'draft';
  open.dispatchEvent(new w.Event('change'));
  assert.equal(d.getElementById('prOpenSource').textContent, 'Project setting', 'back to the setting: nothing is sent');
  assert.equal(f.body(), undefined);
  d.getElementById('prSlices').value = 'one';
  d.getElementById('prSlices').dispatchEvent(new w.Event('change'));
  assert.deepEqual(f.body(), { slices: 'one' });
  target = { kind: 'workspace', projectDir: '', workspaceId: 'wks-a-00000001' };
  await f.refresh();
  assert.equal(urls[1], '/api/run-defaults?workspaceId=wks-a-00000001');
  assert.equal(d.getElementById('pr-slices-row').hidden, true);
  assert.deepEqual([d.getElementById('prOpen').value, d.getElementById('prOpenSource').textContent], ['none', 'Team default'], 'a new target drops the old picks');
  assert.equal(f.body(), undefined);
  target = { kind: 'none', projectDir: '', workspaceId: '' };
  await f.refresh();
  assert.equal(d.getElementById('pr-open-row').hidden, true);
  assert.equal(f.body(), undefined);
});

test('createRunPrFields: a preset lays its values over the scope (source run) and they are sent; leaving it restores the scope', async () => {
  const w = dom(FORM);
  const d = w.document;
  const f = createRunPrFields({ doc: d, getTarget: () => ({ kind: 'project', projectDir: '/p', workspaceId: '' }), fetchFn: async () => ({ ok: true, json: async () => PROJECT }) });
  f.apply({ open: 'ready', slices: 'one' });
  await f.refresh();
  assert.deepEqual([d.getElementById('prOpen').value, d.getElementById('prOpenSource').textContent], ['ready', 'This run']);
  assert.deepEqual(f.body(), { open: 'ready', slices: 'one' });
  f.apply(null);
  assert.deepEqual([d.getElementById('prOpen').value, f.body()], ['draft', undefined]);
});

test('createRunPrFields: a stale answer is dropped; a failed read hides the fields and sends nothing', async () => {
  const w = dom(FORM);
  const d = w.document;
  let release;
  const slow = new Promise((r) => { release = r; });
  let n = 0;
  const fetchFn = async () => { n++; if (n === 1) await slow; return n === 1 ? { ok: true, json: async () => PROJECT } : { ok: false, json: async () => null }; };
  const f = createRunPrFields({ doc: d, getTarget: () => ({ kind: 'project', projectDir: '/p', workspaceId: '' }), fetchFn });
  const first = f.refresh();
  await f.refresh();
  release();
  await first;
  assert.equal(d.getElementById('pr-open-row').hidden, true, 'the later (failed) read wins');
  assert.equal(f.body(), undefined);
});

test('createRunPrFields: a workspace target with no id yet reads nothing, and the restored id refreshes the row', async () => {
  const w = dom(FORM);
  const d = w.document;
  let target = { kind: 'workspace', projectDir: '', workspaceId: '' };
  const urls = [];
  const f = createRunPrFields({ doc: d, getTarget: () => target, fetchFn: async (url) => { urls.push(url); return { ok: true, json: async () => ({ pr: { scope: 'workspace', open: { value: 'draft', source: 'workspace' }, slices: null } }) }; } });
  await f.refresh();
  assert.deepEqual(urls, [], 'no request without a workspace id');
  assert.equal(d.getElementById('pr-open-row').hidden, true);
  assert.equal(f.body(), undefined);
  target = { kind: 'workspace', projectDir: '', workspaceId: 'wks-a-00000001' };
  await f.refresh();
  assert.deepEqual(urls, ['/api/run-defaults?workspaceId=wks-a-00000001']);
  assert.equal(d.getElementById('pr-open-row').hidden, false);
  assert.equal(d.getElementById('prOpen').value, 'draft');
});

test('createRunPrFields: a preset\'s values are still sent when the scope read failed', async () => {
  const w = dom(FORM);
  const f = createRunPrFields({ doc: w.document, getTarget: () => ({ kind: 'project', projectDir: '/p', workspaceId: '' }), fetchFn: async () => ({ ok: false }) });
  f.apply({ open: 'ready', slices: 'one', junk: 1 });
  await f.refresh();
  assert.deepEqual(f.body(), { open: 'ready', slices: 'one' });
});

test('prRowText for the Schedules details', () => {
  assert.equal(prRowText({ open: 'draft', slices: 'one' }), 'Create a draft PR · One PR for the whole feature');
  assert.equal(prRowText({ open: null, slices: 'each' }), 'A PR per slice, stacked');
  assert.equal(prRowText(undefined), '');
});
