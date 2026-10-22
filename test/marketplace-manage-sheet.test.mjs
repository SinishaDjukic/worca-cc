// test/marketplace-manage-sheet.test.mjs — the installed plugin sheet (board 3.3, F8) over P3's sheet.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { createManageSheet } from '../ui/public/marketplace/manage-sheet.mjs';
import { sheetHarness, ok, fail, settle, deferred } from './helpers/marketplace-sheet-harness.mjs';
import { ROW, DETAIL, CHECKS, CONFIG } from './helpers/marketplace-manage-fixtures.mjs';

const trackDom = useDomRelease(afterEach);
const base = (over = {}) => ({ 'GET /api/plugins/github-source': ok(DETAIL), 'GET /api/plugins/github-source/config': ok(CONFIG), ...over });
function mount(opts = {}) {
  const h = sheetHarness({ trackDom, plugins: [ROW], ...opts, routes: opts.routes || base() });
  const manage = createManageSheet({ doc: h.doc, win: h.window, page: h.page, deps: h.deps, wait: opts.wait || h.wait, now: h.now });
  return { ...h, manage, $: (s) => h.doc.querySelector(`#mk-sheet ${s}`), $$: (s) => [...h.doc.querySelectorAll(`#mk-sheet ${s}`)],
    errText: (hook) => h.doc.querySelector(`#mk-sheet .${hook}.mk-wash-bad[role="alert"] .mk-wash-text`)?.textContent ?? null };
}
const escape = (m) => m.doc.getElementById('mk-sheet').dispatchEvent(new m.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

test('opens at once from the row, then fills Settings, Adds and Source; Health waits for "Run checks"', async () => {
  const m = mount();
  const opening = m.manage.open('github-source', { opener: m.doc.getElementById('opener') });
  assert.equal(m.manage.isOpen(), true, 'the sheet is up before any answer');
  assert.equal(m.doc.querySelector('#mk-sheet').dataset.mode, 'manage');
  assert.equal(m.$('h2').textContent, 'github-source');
  await opening;
  assert.deepEqual(m.calls.map((c) => `${c[0]} ${c[1]}`), ['GET /api/plugins/github-source', 'GET /api/plugins/github-source/config']);
  assert.deepEqual(m.$$('.mk-sec[data-sec]').map((s) => s.dataset.sec), ['settings', 'health', 'adds', 'source']);
  assert.equal(m.$('[data-sec="settings"] .mk-sec-head .mk-meta').textContent, 'GitHub Issues', 'one group: its name beside Settings');
  assert.equal(m.$('.mk-health-run').textContent.trim(), 'Run checks');
  assert.ok(m.$('button.mk-remove'));
  assert.deepEqual(m.$$('[data-act="cancel"], [data-act="save"]').map((b) => [b.className, b.textContent]),
    [['btn btn-quiet', 'Cancel'], ['btn btn-primary', 'Save']]);
  assert.equal(m.manage.current(), 'github-source');
});

test('"Run checks" runs Doctor; "Run again" re-runs; a failed request is a failed check inside the sheet', async () => {
  let n = 0;
  const m = mount({ routes: base({ 'POST /api/plugins/github-source/doctor': () => (++n === 1 ? ok({ ok: true, checks: CHECKS }) : fail(500, { error: 'doctor exploded' })) }) });
  await m.manage.open('github-source');
  m.$('.mk-health-run').click();
  await settle();
  assert.equal(m.$('[data-sec="health"] .mk-chip').textContent.trim(), '8 of 8 checks passed');
  assert.equal(m.$('.mk-health-run').textContent.trim(), 'Run again');
  m.$('.mk-health-run').click();
  await settle();
  assert.equal(m.$('[data-sec="health"] .mk-chip').textContent.trim(), '0 of 1 checks passed');
  assert.deepEqual(m.$$('li.mk-check').map((li) => [li.dataset.check, li.querySelector('.mk-meta').textContent]), [['request', 'doctor exploded']]);
  assert.deepEqual(m.notified, []);
});

test('opened with { section: "health" } it checks at once; the last result is shown on the next open', async () => {
  const m = mount({ routes: base({ 'POST /api/plugins/github-source/doctor': ok({ ok: true, checks: CHECKS }) }) });
  await m.manage.open('github-source', { section: 'health' });
  await settle();
  assert.equal(m.calls.filter((c) => c[1] === '/api/plugins/github-source/doctor').length, 1);
  m.manage.close();
  await m.manage.open('github-source');
  assert.equal(m.calls.filter((c) => c[1] === '/api/plugins/github-source/doctor').length, 1, 'no second run');
  assert.equal(m.$('[data-sec="health"] .mk-chip').textContent.trim(), '8 of 8 checks passed');
  assert.equal(m.$('.mk-health-run').textContent.trim(), 'Run again');
});

test('the Enabled switch posts at once; a refusal flips it back with the reason inside the sheet', async () => {
  let n = 0;
  const m = mount({ routes: base({ 'POST /api/plugins/github-source/enable': () => (++n === 1 ? fail(409, { error: 'plugin is busy' }) : ok({ ok: true, enabled: false })) }) });
  await m.manage.open('github-source');
  const sw = m.$('input.mk-manage-enable');
  sw.checked = false;
  sw.dispatchEvent(new m.window.Event('change', { bubbles: true }));
  await settle();
  assert.deepEqual(m.calls.at(-1), ['POST', '/api/plugins/github-source/enable', { enabled: false }]);
  assert.equal(sw.checked, true, 'flipped back');
  assert.equal(m.errText('mk-head-err'), 'plugin is busy');
  assert.equal(m.page.loads, 0);
  sw.checked = false;
  sw.dispatchEvent(new m.window.Event('change', { bubbles: true }));
  await settle();
  assert.deepEqual([sw.checked, m.errText('mk-head-err'), m.page.loads], [false, null, 1]);
  assert.ok(m.calls.some((c) => c[0] === 'invalidate'), 'plugin agents join or leave the registry');
  assert.deepEqual(m.notified, []);
});

test('hand-offs: Review update, Remove…, a landing link; a refresh repaints the head only; gone → the sheet closes', async () => {
  const m = mount();
  await m.manage.open('github-source', { opener: m.doc.getElementById('opener') });
  m.$('.mk-review-update').click();
  await settle();
  assert.deepEqual(m.page.acts.at(-1), ['openUpdateReview', ['github-source'], { opener: m.doc.getElementById('opener') }]);
  m.$('.mk-remove').click();
  const [act, name, o] = m.page.acts.at(-1);
  assert.deepEqual([act, name, o.opener === m.$('.mk-remove'), typeof o.onRemoved], ['openRemove', 'github-source', true, 'function']);
  const select = m.$('[data-group="source:github"] [data-key="closeOnDone"]');
  select.value = 'yes';
  select.dispatchEvent(new m.window.Event('change', { bubbles: true }));
  m.page.emit({ plugins: [{ ...ROW, enabled: false, latest: null }] });
  assert.equal(m.$('input.mk-manage-enable').checked, false);
  assert.equal(m.$('.mk-manage-upd'), null);
  assert.equal(m.$('[data-group="source:github"] [data-key="closeOnDone"]').value, 'yes', 'typed values survive a refresh');
  m.page.emit({ plugins: [] });
  assert.equal(m.manage.isOpen(), false, 'removed elsewhere → the sheet closes without asking');
  await m.manage.open('github-source');
  assert.equal(m.manage.isOpen(), false, 'nothing to open for a plugin that is gone');
  m.page.emit({ plugins: [ROW] });
  await m.manage.open('github-source');
  m.$('.mk-remove').click();
  m.page.acts.at(-1)[2].onRemoved();
  assert.equal(m.manage.isOpen(), false, "P5's dialog removed it → the sheet closes");
  const m2 = mount();
  await m2.manage.open('github-source');
  m2.$('.mk-add-row a.mk-link').click();
  await settle();
  assert.deepEqual([m2.manage.isOpen(), m2.navigated], [false, ['#new']]);
});

test('SM55: while the shared panel shows another mode, this sheet\'s controls do nothing; Close is P3\'s', async () => {
  const m = mount({ routes: base({ 'POST /api/plugins/github-source/doctor': ok({ ok: true, checks: CHECKS }) }) });
  await m.manage.open('github-source');
  m.doc.getElementById('mk-sheet').dataset.mode = 'install';
  m.$('.mk-health-run').click();
  m.$('.mk-remove').click();
  await settle();
  assert.deepEqual([m.calls.filter((c) => c[1] === '/api/plugins/github-source/doctor').length, m.page.acts.length], [0, 0]);
  m.doc.getElementById('mk-sheet').dataset.mode = 'manage';
  m.doc.querySelector('#mk-sheet-host .mk-close').click();
  await settle();
  assert.deepEqual([m.manage.isOpen(), m.manage.current()], [false, null]);
});

test('SM70: leaving #marketplace (e.g. a Blocked dialog\'s "Open" link) closes the manage sheet without asking', async () => {
  const m = mount();
  await m.manage.open('github-source');
  const select = m.$('[data-group="source:github"] [data-key="closeOnDone"]');
  select.value = 'yes';
  select.dispatchEvent(new m.window.Event('change', { bubbles: true }));
  m.window.location.hash = '#models';
  m.window.dispatchEvent(new m.window.Event('hashchange'));
  await settle();
  assert.deepEqual([m.manage.isOpen(), m.doc.querySelector('dialog.discard-modal')], [false, null]);
});

test('a failed detail or config read shows its error inside its own section', async () => {
  const m = mount({ routes: { 'GET /api/plugins/github-source': fail(404, { error: 'plugin not found' }),
    'GET /api/plugins/github-source/config': fail(409, { error: 'plugin manifest unreadable — run doctor' }) } });
  await m.manage.open('github-source');
  assert.equal(m.$('[data-sec="settings"] .mk-sec-err .mk-wash-text').textContent, 'plugin manifest unreadable — run doctor');
  assert.equal(m.$('[data-sec="adds"] .mk-sec-err .mk-wash-text').textContent, 'plugin not found');
  assert.equal(m.$('[data-sec="source"]'), null);
  assert.equal(m.$('[data-act="save"]'), null, 'nothing to save');
  assert.deepEqual(m.notified, []);
});

const SLACK_CH = { id: 'slack', displayName: 'Slack', platform: 'slack', values: { botToken: { set: true }, notifyChatIds: null },
  schema: [{ key: 'botToken', type: 'text', label: 'Bot token', secret: true, required: true, default: null, help: null, options: [] },
    { key: 'notifyChatIds', type: 'text', label: 'Notify channel IDs', secret: false, required: false, default: null, help: null, options: [] }] };
const pick = (m, group, key, value) => {
  const el = m.$(`[data-group="${group}"] [data-key="${key}"]`);
  el.value = value;
  el.dispatchEvent(new m.window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  return el;
};
const puts = (m) => m.calls.filter((c) => c[0] === 'PUT').map((c) => c[2]);

test('Save sends one PUT per changed group — never an untouched secret — then closes with "Settings saved."', async () => {
  const m = mount({ routes: base({ 'GET /api/plugins/github-source/config': ok({ ...CONFIG, channels: [SLACK_CH] }),
    'PUT /api/plugins/github-source/config': ok({ ok: true }) }) });
  await m.manage.open('github-source');
  assert.deepEqual(m.$$('[data-sec="settings"] .mk-setup-h').map((h) => h.textContent), ['GitHub Issues', 'Slack'], 'two groups: P4 names them');
  pick(m, 'source:github', 'closeOnDone', 'yes');
  m.$('[data-act="save"]').click();
  await settle();
  assert.deepEqual(puts(m), [{ sourceId: 'github', values: { closeOnDone: 'yes' } }],
    'the stored token is omitted; the Slack group did not change, so no PUT restarts its worker');
  assert.equal(m.manage.isOpen(), false);
  assert.deepEqual(m.notified, [{ tone: 'ok', title: 'Settings saved.' }]);
  assert.equal(m.page.loads, 1);
});

test('Save with nothing changed sends nothing and closes', async () => {
  const m = mount();
  await m.manage.open('github-source');
  m.$('[data-act="save"]').click();
  await settle();
  assert.deepEqual([puts(m).length, m.manage.isOpen(), m.notified], [0, false, []]);
});

test('a changed group with an empty required field is marked "Enter a value." and nothing is sent', async () => {
  const m = mount({ routes: base({ 'GET /api/plugins/github-source/config': ok({ sources: [], channels: [{ ...SLACK_CH, values: { botToken: { set: false }, notifyChatIds: null } }] }) }) });
  await m.manage.open('github-source');
  pick(m, 'channel:slack', 'notifyChatIds', 'C07Q2M4KD1');
  m.$('[data-act="save"]').click();
  await settle();
  assert.equal(m.$('[data-group="channel:slack"] [data-key="botToken"]').closest('.field').querySelector('.fe-text').textContent, 'Enter a value.');
  assert.deepEqual([puts(m).length, m.manage.isOpen()], [0, true]);
});

test('a refused Save keeps the sheet open with the server error inside it and the typed value intact', async () => {
  const m = mount({ routes: base({ 'PUT /api/plugins/github-source/config': fail(400, { error: 'closeOnDone must be yes or no' }) }) });
  await m.manage.open('github-source');
  pick(m, 'source:github', 'closeOnDone', 'yes');
  m.$('[data-act="save"]').click();
  await settle();
  assert.equal(m.errText('mk-save-err'), 'closeOnDone must be yes or no');
  assert.equal(m.manage.isOpen(), true);
  assert.equal(m.$('[data-group="source:github"] [data-key="closeOnDone"]').value, 'yes');
  assert.deepEqual(m.notified, []);
});

test('Escape asks before dropping changed settings ("Keep editing" keeps them); Cancel closes at once', async () => {
  const m = mount();
  await m.manage.open('github-source');
  pick(m, 'source:github', 'closeOnDone', 'yes');
  escape(m);
  await settle();
  const keep = m.doc.querySelector('dialog.discard-modal .discard-keep');
  assert.ok(keep, 'the "Discard changes?" question is up');
  keep.click();
  await settle();
  assert.equal(m.manage.isOpen(), true);
  assert.equal(m.$('[data-group="source:github"] [data-key="closeOnDone"]').value, 'yes');
  m.$('[data-act="cancel"]').click();
  await settle();
  assert.equal(m.manage.isOpen(), false);
  assert.equal(m.doc.querySelector('dialog.discard-modal'), null, 'Cancel never asks');
});

test('openManage with { section: "settings", seeds }: blank non-secret fields take the team policy values; Save sends them', async () => {
  const REPO = { key: 'repo', type: 'text', label: 'Repository', secret: false, required: false, default: null, help: null, options: [] };
  const cfg = { channels: [], sources: [{ ...CONFIG.sources[0], schema: [...CONFIG.sources[0].schema, REPO],
    values: { token: { set: true }, closeOnDone: 'no', repo: null } }] };
  const m = mount({ routes: base({ 'GET /api/plugins/github-source/config': ok(cfg), 'PUT /api/plugins/github-source/config': ok({ ok: true }) }) });
  await m.manage.open('github-source', { section: 'settings', seeds: { repo: 'acme/tools', closeOnDone: 'yes', token: 'nope' } });
  const field = (k) => m.$(`[data-group="source:github"] [data-key="${k}"]`);
  assert.deepEqual([field('repo').value, field('closeOnDone').value], ['acme/tools', 'no'], 'a stored value wins; a secret is never seeded');
  assert.equal(m.$('[data-sec="settings"] .mk-sec-head .mk-chip').textContent.trim(), 'From team policy');
  assert.equal(m.doc.activeElement, field('closeOnDone'), 'Settings: focus on its first field');
  m.$('[data-act="save"]').click();
  await settle();
  assert.deepEqual(puts(m), [{ sourceId: 'github', values: { closeOnDone: 'no', repo: 'acme/tools' } }]);
});

test('model secrets: broker on and nothing saved → a chip and the key page link, no form; broker off → a normal group', async () => {
  const MODELS = { schema: [{ key: 'BMF_KEY', type: 'text', label: 'BMF key', secret: true, required: false, default: null, help: null, options: [] }],
    values: { BMF_KEY: { set: false } } };
  const m = mount({ routes: base({ 'GET /api/plugins/github-source/config': ok({ sources: [], channels: [], models: { ...MODELS, broker: { keyPage: 'https://keys.example.com/k' } } }) }) });
  await m.manage.open('github-source');
  const g = m.$('[data-group="models"]');
  assert.equal(m.$('[data-sec="settings"] .mk-sec-head .mk-meta').textContent, 'Model secrets');
  assert.equal(g.querySelector('.mk-chip').textContent.trim(), 'Credential broker');
  const a = g.querySelector('a.mk-link');
  assert.deepEqual([a.textContent.trim(), a.getAttribute('href'), a.getAttribute('target')], ['Key page', 'https://keys.example.com/k', '_blank']);
  assert.equal(g.querySelector('[data-key], .mk-secret-set'), null, 'no form: each person adds the key on the key page');
  assert.equal(m.$('[data-act="save"]'), null, 'nothing to save: no foot');
  const m2 = mount({ routes: base({ 'GET /api/plugins/github-source/config': ok({ sources: [], channels: [], models: MODELS }),
    'PUT /api/plugins/github-source/config': ok({ ok: true }) }) });
  await m2.manage.open('github-source');
  pick(m2, 'models', 'BMF_KEY', 'k-123');
  m2.$('[data-act="save"]').click();
  await settle();
  assert.deepEqual(puts(m2), [{ target: 'modelSecrets', values: { BMF_KEY: 'k-123' } }]);
});

test('profiles: switching re-reads that profile, a changed form asks first, Add profile prompts, Remove profile… confirms', async () => {
  const JIRA = { ...ROW, name: 'jira-source', latest: null };
  const roster = (extra = []) => [{ id: 'work', label: 'Work' }, { id: 'home', label: '' }, ...extra];
  const src = (profile, baseUrl, extra) => ({ channels: [], sources: [{ id: 'jira', multiProfile: true, profile, profiles: roster(extra),
    schema: [{ key: 'baseUrl', type: 'text', label: 'Base URL', secret: false, required: true, default: null, help: null, options: [] }],
    values: { baseUrl } }] });
  const m = mount({ plugins: [JIRA], confirms: [false, true], prompts: [{ id: 'lab', label: 'Lab' }], routes: {
    'GET /api/plugins/jira-source': ok({ ...DETAIL, plugin: JIRA, inventory: { taskSources: [{ id: 'jira', displayName: 'Jira' }] } }),
    'GET /api/plugins/jira-source/config': ok(src('work', 'https://w.example')),
    'GET /api/plugins/jira-source/config?profile=home': ok(src('home', 'https://h.example')),
    'GET /api/plugins/jira-source/config?profile=lab': ok(src('lab', '', [{ id: 'lab', label: 'Lab' }])),
    'POST /api/plugins/jira-source/profiles': ok({ ok: true, profile: { id: 'lab', label: 'Lab' } }),
    'DELETE /api/plugins/jira-source/profiles/lab?sourceId=jira': ok({ ok: true, unbound: 0 }) } });
  await m.manage.open('jira-source');
  const sel = () => m.$('[data-group="source:jira"] select.mk-profile-sel');
  const change = (v) => { sel().value = v; sel().dispatchEvent(new m.window.Event('change', { bubbles: true })); };
  change('home');
  await settle();
  assert.equal(m.$('[data-group="source:jira"] [data-key="baseUrl"]').value, 'https://h.example');
  pick(m, 'source:jira', 'baseUrl', 'https://typed.example');
  change('work');
  await settle();
  assert.deepEqual(m.calls.filter((c) => c[0] === 'confirm').map((c) => c[1]), ['Discard unsaved changes?']);
  assert.deepEqual([sel().value, m.$('[data-group="source:jira"] [data-key="baseUrl"]').value], ['home', 'https://typed.example'], 'answered no');
  m.$('[data-group="source:jira"] .mk-profile-add').click();
  await settle();
  assert.deepEqual(m.calls.find((c) => c[0] === 'POST'), ['POST', '/api/plugins/jira-source/profiles', { sourceId: 'jira', id: 'lab', label: 'Lab' }]);
  assert.equal(sel().value, 'lab');
  m.$('[data-group="source:jira"] .mk-profile-del').click();
  await settle();
  assert.deepEqual(m.calls.filter((c) => c[0] === 'confirm').map((c) => c[1]), ['Discard unsaved changes?', 'Delete profile']);
  assert.ok(m.calls.some((c) => c[0] === 'DELETE' && c[1] === '/api/plugins/jira-source/profiles/lab?sourceId=jira'));
  assert.equal(sel().value, 'work', 'back on the first profile');
});

test('an empty roster: P4\'s Profile id field, nothing to test; Save creates the profile, then fills it', async () => {
  const JIRA = { ...ROW, name: 'jira-source', latest: null };
  const m = mount({ plugins: [JIRA], routes: {
    'GET /api/plugins/jira-source': ok({ ...DETAIL, plugin: JIRA, inventory: { taskSources: [{ id: 'jira', displayName: 'Jira' }] } }),
    'GET /api/plugins/jira-source/config': ok({ channels: [], sources: [{ id: 'jira', multiProfile: true, profile: null, profiles: [],
      schema: [{ key: 'baseUrl', type: 'text', label: 'Base URL', secret: false, required: true, default: null, help: null, options: [] }], values: {} }] }),
    'POST /api/plugins/jira-source/profiles': ok({ ok: true, profile: { id: 'work', label: '' } }),
    'PUT /api/plugins/jira-source/config': ok({ ok: true }) } });
  await m.manage.open('jira-source');
  const g = m.$('[data-group="source:jira"]');
  assert.ok(g.querySelector('input.mk-profile-id'));
  assert.deepEqual([g.querySelector('.mk-test'), g.querySelector('.mk-profile-del')], [null, null]);
  g.querySelector('input.mk-profile-id').value = 'work';
  pick(m, 'source:jira', 'baseUrl', 'https://w.example');
  m.$('[data-act="save"]').click();
  await settle();
  assert.deepEqual(m.calls.filter((c) => c[0] === 'POST' || c[0] === 'PUT').map((c) => [c[0], c[1], c[2]]), [
    ['POST', '/api/plugins/jira-source/profiles', { sourceId: 'jira', id: 'work', label: '' }],
    ['PUT', '/api/plugins/jira-source/config', { sourceId: 'jira', profile: 'work', values: { baseUrl: 'https://w.example' } }]]);
});

const TOKEN = { key: 'token', type: 'text', label: 'Token', secret: false, required: false, default: null, help: null, options: [] };
const DUAL_ROW = { ...ROW, name: 'dual', latest: null };
const DUAL = { sources: ['alpha', 'beta'].map((id) => ({ id, multiProfile: false, profile: null, profiles: [], schema: [TOKEN], values: { token: id[0] } })), channels: [] };
const dual = (call) => ({ 'GET /api/plugins/dual': ok({ ...DETAIL, plugin: DUAL_ROW, inventory: { taskSources: [{ id: 'alpha', displayName: 'Alpha' }, { id: 'beta', displayName: 'Beta' }] } }),
  'GET /api/plugins/dual/config': ok(DUAL), 'PUT /api/plugins/dual/config': ok({ ok: true }), 'POST /api/sources/call': call });

test('Test connection: one result per source; a changed source saves first; a field error sits on its field', async () => {
  const m = mount({ plugins: [DUAL_ROW], routes: dual((b) => (b.sourceId === 'alpha'
    ? ok({ ok: true, result: { ok: false, errors: [{ field: 'token', message: 'bad token' }] } })
    : ok({ ok: true, result: { ok: true, identity: 'beta-bot' } }))) });
  await m.manage.open('dual');
  pick(m, 'source:alpha', 'token', 'a2');
  m.$('[data-group="source:alpha"] .mk-test').click();
  await settle();
  assert.deepEqual(m.calls.filter((c) => c[0] === 'PUT' || c[1] === '/api/sources/call').map((c) => [c[0], c[2]]), [
    ['PUT', { sourceId: 'alpha', values: { token: 'a2' } }],
    ['POST', { plugin: 'dual', sourceId: 'alpha', op: 'validateConfig' }]]);
  m.$('[data-group="source:beta"] .mk-test').click();
  await settle();
  const outA = m.$('[data-group="source:alpha"] .mk-test-out');
  assert.equal(outA.querySelector('.mk-chip').textContent.trim(), 'Not connected', "alpha's failure stays…");
  const tokA = m.$('[data-group="source:alpha"] [data-key="token"]');
  assert.equal(tokA.getAttribute('aria-invalid'), 'true');
  assert.match(m.$('[data-group="source:alpha"] .field-error').textContent, /bad token/);
  assert.equal(m.$('[data-group="source:beta"] .mk-test-out .mk-chip').textContent.trim(), 'Connected · signed in as beta-bot', '…beside beta\'s success');
});

test('a pending answer polls every 5 s until it settles; past 5 minutes it stops with "Timed out waiting for the sign-in"', async () => {
  let n = 0;
  const m = mount({ plugins: [DUAL_ROW], routes: dual(() => (++n < 3
    ? ok({ ok: true, result: { ok: false, pending: true, message: 'Finish signing in in the browser' } })
    : ok({ ok: true, result: { ok: true, identity: 'dp' } }))) });
  await m.manage.open('dual');
  m.$('[data-group="source:alpha"] .mk-test').click();
  await settle(30);
  assert.deepEqual([n, m.waits], [3, [5000, 5000]]);
  assert.equal(m.$('[data-group="source:alpha"] .mk-test-out .mk-chip').textContent.trim(), 'Connected · signed in as dp');
  let k = 0;
  const m2 = mount({ plugins: [DUAL_ROW], routes: dual(() => { k += 1; return ok({ ok: true, result: { ok: false, pending: true } }); }) });
  await m2.manage.open('dual');
  m2.$('[data-group="source:beta"] .mk-test').click();
  await settle(400);
  assert.equal(k, 62, 'polls at 0, 5 s … 305 s, then stops');
  const out = m2.$('[data-group="source:beta"] .mk-test-out');
  assert.deepEqual([out.querySelector('.mk-chip').textContent.trim(), out.querySelector('.mk-test-err').textContent],
    ['Not connected', 'Timed out waiting for the sign-in']);
});

test('closing the sheet stops a running test', async () => {
  let n = 0;
  const gate = deferred();
  const m = mount({ plugins: [DUAL_ROW], wait: () => gate.p.then(() => new Promise((r) => setTimeout(r, 0))),   // a loop that ignores close yields, so it reds instead of hanging
    routes: dual(() => { n += 1; return ok({ ok: true, result: { ok: false, pending: true } }); }) });
  await m.manage.open('dual');
  m.$('[data-group="source:alpha"] .mk-test').click();
  await settle();
  assert.equal(n, 1);
  m.manage.close();
  gate.resolve();
  await settle();
  assert.equal(n, 1, 'no call after the sheet closed');
});

test('a chat channel shows its live state — no Test connection — and the channel-status patch key is kept', async () => {
  const SLACK_ROW = { ...ROW, name: 'slack-chat', latest: null, contributions: { ...ROW.contributions, taskSources: 0, chatChannels: 1 } };
  const m = mount({ plugins: [SLACK_ROW],
    channelStatus: [{ plugin: 'slack-chat', channelId: 'slack', displayName: 'Slack', platform: 'slack', state: 'unconfigured', detail: 'missing config: botToken' }],
    routes: { 'GET /api/plugins/slack-chat': ok({ ...DETAIL, plugin: SLACK_ROW, inventory: { chatChannels: [{ id: 'slack', displayName: 'Slack' }] } }),
      'GET /api/plugins/slack-chat/config': ok({ sources: [], channels: [SLACK_CH] }) } });
  await m.manage.open('slack-chat');
  const chip = m.$('[data-group="channel:slack"] .pl-channel[data-channel-key="slack-chat/slack"]');
  assert.equal(chip.textContent, 'Slack · unconfigured');
  assert.equal(m.$('.mk-test'), null);
});

test('model secrets: broker on with a value still saved → "Clear saved values" PUTs null for each saved key, then re-reads', async () => {
  const KEYS = ['BMF_KEY', 'ALT_KEY'].map((key) => ({ key, type: 'text', label: key, secret: true, required: false, default: null, help: null, options: [] }));
  const cfg = (set) => ({ sources: [], channels: [], models: { schema: KEYS, values: { BMF_KEY: { set }, ALT_KEY: { set: false } }, broker: { keyPage: null } } });
  let reads = 0;
  const m = mount({ routes: base({ 'GET /api/plugins/github-source/config': () => ok(cfg(++reads === 1)), 'PUT /api/plugins/github-source/config': ok({ ok: true }) }) });
  await m.manage.open('github-source');
  const chipsOf = () => m.$$('[data-group="models"] .mk-chip').map((c) => c.textContent.trim());
  assert.deepEqual(chipsOf(), ['Credential broker', 'Clear these values']);
  assert.equal(m.$('[data-group="models"] [data-key]'), null, 'no form: the server refuses a typed key while the broker is on');
  const clear = m.$('[data-group="models"] button.mk-clear-secrets');
  assert.deepEqual([clear.type, clear.textContent], ['button', 'Clear saved values']);
  clear.click();
  await settle();
  assert.deepEqual(puts(m), [{ target: 'modelSecrets', values: { BMF_KEY: null } }], 'only the saved key, as null');
  assert.equal(reads, 2, 'the group is re-read');
  assert.deepEqual([chipsOf(), m.$('.mk-clear-secrets')], [['Credential broker'], null]);
  assert.deepEqual([m.manage.isOpen(), m.notified], [true, []]);
  const m2 = mount({ routes: base({ 'GET /api/plugins/github-source/config': ok(cfg(true)),
    'PUT /api/plugins/github-source/config': fail(409, { error: 'the credential broker is on' }) }) });
  await m2.manage.open('github-source');
  m2.$('[data-group="models"] .mk-clear-secrets').click();
  await settle();
  assert.equal(m2.errText('mk-group-err'), 'the credential broker is on');
  assert.ok(m2.$('[data-group="models"] .mk-clear-secrets'), 'still offered after a refusal');
  assert.deepEqual(m2.notified, []);
});

test('Save checks Required only in changed groups: an untouched, unconfigured channel never blocks the source', async () => {
  const m = mount({ routes: base({ 'GET /api/plugins/github-source/config': ok({ ...CONFIG, channels: [{ ...SLACK_CH, values: { botToken: { set: false }, notifyChatIds: null } }] }),
    'PUT /api/plugins/github-source/config': ok({ ok: true }) }) });
  await m.manage.open('github-source');
  pick(m, 'source:github', 'closeOnDone', 'yes');
  m.$('[data-act="save"]').click();
  await settle();
  assert.deepEqual([puts(m), m.manage.isOpen(), m.$$('.field-error').length], [[{ sourceId: 'github', values: { closeOnDone: 'yes' } }], false, 0]);
});

test('Escape closes a clean sheet at once, even after the Enabled switch applied', async () => {
  const m = mount({ routes: base({ 'POST /api/plugins/github-source/enable': ok({ ok: true, enabled: false }) }) });
  await m.manage.open('github-source');
  const sw = m.$('input.mk-manage-enable');
  sw.checked = false;
  sw.dispatchEvent(new m.window.Event('change', { bubbles: true }));
  await settle();
  escape(m);
  await settle();
  assert.deepEqual([m.manage.isOpen(), m.doc.querySelector('dialog.discard-modal')], [false, null]);
});

test('Review update and a landing link ask before dropping changed settings', async () => {
  const m = mount();
  await m.manage.open('github-source', { opener: m.doc.getElementById('opener') });
  pick(m, 'source:github', 'closeOnDone', 'yes');
  m.$('.mk-review-update').click();
  await settle();
  assert.deepEqual([m.page.acts.length, !!m.doc.querySelector('dialog.discard-modal')], [0, true], 'asked first');
  m.doc.querySelector('dialog.discard-modal .discard-go').click();
  await settle();
  assert.deepEqual(m.page.acts.at(-1)?.[0], 'openUpdateReview');
  const m2 = mount();
  await m2.manage.open('github-source');
  pick(m2, 'source:github', 'closeOnDone', 'yes');
  m2.$('.mk-add-row a.mk-link').click();
  await settle();
  assert.deepEqual([m2.navigated, m2.manage.isOpen(), !!m2.doc.querySelector('dialog.discard-modal')], [[], true, true]);
});

test('while Save is out, Escape and Cancel wait; a seeded secret stays blank', async () => {
  const gate = deferred();
  const m = mount({ routes: base({ 'PUT /api/plugins/github-source/config': () => gate.p }) });
  await m.manage.open('github-source');
  pick(m, 'source:github', 'closeOnDone', 'yes');
  m.$('[data-act="save"]').click();
  await settle();
  escape(m);
  m.$('[data-act="cancel"]').click();
  await settle();
  assert.deepEqual([m.manage.isOpen(), m.doc.querySelector('dialog.discard-modal')], [true, null]);
  gate.resolve(ok({ ok: true }));
  await settle();
  assert.equal(m.manage.isOpen(), false);
  const KEY = { key: 'apiKey', type: 'text', label: 'API key', secret: true, required: false, default: null, help: null, options: [] };
  const cfg = { channels: [], sources: [{ ...CONFIG.sources[0], schema: [...CONFIG.sources[0].schema, KEY], values: { ...CONFIG.sources[0].values, apiKey: { set: false } } }] };
  const m2 = mount({ routes: base({ 'GET /api/plugins/github-source/config': ok(cfg) }) });
  await m2.manage.open('github-source', { seeds: { apiKey: 'nope' } });
  assert.equal(m2.$('[data-group="source:github"] [data-key="apiKey"]').value, '', 'a secret is never seeded');
});

test('Test connection: a field error is shown on its field only; a test that saved leaves Save nothing to send', async () => {
  const m = mount({ plugins: [DUAL_ROW], routes: dual(() => ok({ ok: true, result: { ok: false, errors: [{ field: 'token', message: 'bad token' }] } })) });
  await m.manage.open('dual');
  pick(m, 'source:alpha', 'token', 'a2');
  m.$('[data-group="source:alpha"] .mk-test').click();
  await settle();
  assert.equal(m.$('[data-group="source:alpha"] .mk-test-out .mk-test-err'), null);
  m.$('[data-act="save"]').click();
  await settle();
  assert.deepEqual([puts(m).length, m.manage.isOpen(), m.notified], [1, false, []]);
});

test('a value typed while a PUT is out stays a change: Save sends it after Test connection, and the retry after a refusal', async () => {
  const gate = deferred();
  let n = 0;
  const m = mount({ plugins: [DUAL_ROW], routes: { ...dual(ok({ ok: true, result: { ok: true } })), 'PUT /api/plugins/dual/config': () => (++n === 1 ? gate.p : ok({ ok: true })) } });
  await m.manage.open('dual');
  pick(m, 'source:alpha', 'token', 'a2');
  m.$('[data-group="source:alpha"] .mk-test').click();
  await settle();
  pick(m, 'source:alpha', 'token', 'a3');
  gate.resolve(ok({ ok: true }));
  await settle();
  m.$('[data-act="save"]').click();
  await settle();
  assert.deepEqual(puts(m), [{ sourceId: 'alpha', values: { token: 'a2' } }, { sourceId: 'alpha', values: { token: 'a3' } }]);
  const gate2 = deferred();
  let k = 0;
  const m2 = mount({ plugins: [DUAL_ROW], routes: { ...dual(ok({ ok: true, result: { ok: true } })),
    'PUT /api/plugins/dual/config': (b) => { k += 1; if (k === 1) return gate2.p; return b.sourceId === 'beta' && k === 2 ? fail(400, { error: 'bad beta' }) : ok({ ok: true }); } } });
  await m2.manage.open('dual');
  pick(m2, 'source:alpha', 'token', 'a2');
  pick(m2, 'source:beta', 'token', 'b2');
  m2.$('[data-act="save"]').click();
  await settle();
  pick(m2, 'source:alpha', 'token', 'a3');
  gate2.resolve(ok({ ok: true }));
  await settle();
  assert.equal(m2.errText('mk-save-err'), 'bad beta');
  m2.$('[data-act="save"]').click();
  await settle();
  assert.deepEqual(puts(m2).map((p) => `${p.sourceId}=${p.values.token}`), ['alpha=a2', 'beta=b2', 'alpha=a3', 'beta=b2']);
});

test('while Save is out: no Test connection (no second PUT), no Review update, landing link or Remove…', async () => {
  const gate = deferred();
  const m = mount({ routes: base({ 'PUT /api/plugins/github-source/config': () => gate.p }) });
  await m.manage.open('github-source');
  pick(m, 'source:github', 'closeOnDone', 'yes');
  m.$('[data-act="save"]').click();
  await settle();
  m.$('[data-group="source:github"] .mk-test').click();
  m.$('.mk-review-update').click();
  m.$('.mk-add-row a.mk-link').click();
  m.$('.mk-remove').click();
  await settle();
  assert.deepEqual([puts(m).length, m.calls.filter((c) => c[1] === '/api/sources/call').length, m.doc.querySelector('dialog.discard-modal'),
    m.page.acts.length, m.navigated.length], [1, 0, null, 0, 0]);
  gate.resolve(ok({ ok: true }));
  await settle();
  assert.equal(m.manage.isOpen(), false);
  await m.manage.open('github-source');
  m.$('.mk-review-update').click();
  await settle();
  assert.equal(m.page.acts.at(-1)?.[0], 'openUpdateReview', 'Save is over: the hand-offs work again');
});

test('a seed a select cannot take fills nothing and earns no "From team policy" chip', async () => {
  const SEL = { key: 'mode', type: 'select', label: 'Mode', secret: false, required: false, default: null, help: null,
    options: [{ value: '', label: '—' }, { value: 'a', label: 'a' }] };
  const m = mount({ routes: base({ 'GET /api/plugins/github-source/config': ok({ channels: [],
    sources: [{ id: 'github', multiProfile: false, profile: null, profiles: [], schema: [SEL], values: { mode: '' } }] }) }) });
  await m.manage.open('github-source', { seeds: { mode: 'zzz' } });
  assert.deepEqual([m.$('[data-key="mode"]').value, m.$('[data-sec="settings"] .mk-sec-head .mk-chip')], ['', null]);
});

test('a plugin the page state does not list yet (P4\'s "already installed") opens after one reload', async () => {
  const m = mount({ plugins: [] });
  m.page.load = function () { this.loads += 1; this.state = { ...this.state, plugins: [ROW] }; return Promise.resolve(); };
  await m.manage.open('github-source');
  assert.deepEqual([m.manage.isOpen(), m.page.loads, m.manage.current()], [true, 1, 'github-source']);
  const gone = mount({ plugins: [] });
  await gone.manage.open('github-source');
  assert.deepEqual([gone.manage.isOpen(), gone.page.loads], [false, 1], 'still missing after the reload: nothing opens');
  const d = deferred();
  const late = mount();
  late.page.load = function () { this.loads += 1; return d.p.then(() => { this.state = { ...this.state, plugins: [ROW, { ...ROW, name: 'new-one' }] }; }); };
  const first = late.manage.open('new-one');
  await late.manage.open('github-source');
  d.resolve();
  await first;
  assert.equal(late.manage.current(), 'github-source', 'an open made during that reload wins');
});

test('a re-run keeps "Run again" on the held button; the Enabled switch is held while its request is out, then keeps focus', async () => {
  const d = deferred();
  const e = deferred();
  let n = 0;
  const m = mount({ routes: base({ 'POST /api/plugins/github-source/doctor': () => (++n === 1 ? ok({ ok: true, checks: CHECKS }) : d.p),
    'POST /api/plugins/github-source/enable': () => e.p }) });
  await m.manage.open('github-source');
  m.$('.mk-health-run').click(); await settle();
  m.$('.mk-health-run').click(); await settle();
  assert.deepEqual([m.$('.mk-health-run').textContent.trim(), m.$('.mk-health-run').disabled, m.$('[data-sec="health"] .mk-chip').textContent.trim()],
    ['Run again', true, 'Running checks…']);
  d.resolve(ok({ ok: true, checks: CHECKS })); await settle();
  const P = m.window.HTMLInputElement.prototype;      // a browser drops focus from a control that turns disabled
  const d0 = Object.getOwnPropertyDescriptor(P, 'disabled');
  Object.defineProperty(P, 'disabled', { configurable: true, get() { return d0.get.call(this); },
    set(v) { if (v && this.ownerDocument.activeElement === this) this.blur(); d0.set.call(this, v); } });
  const sw = m.$('input.mk-manage-enable');
  sw.focus(); sw.checked = false; sw.dispatchEvent(new m.window.Event('change', { bubbles: true }));
  await settle(2);
  assert.equal(sw.disabled, true, 'one request at a time');
  e.resolve(ok({ ok: true, enabled: false })); await settle();
  assert.deepEqual([sw.disabled, m.doc.activeElement === sw], [false, true]);
});

test('closing with the opener gone parks focus on the Installed tab, never <body>', async () => {
  const m = mount();
  const tab = Object.assign(m.doc.createElement('a'), { href: '#marketplace/installed', className: 'tab mk-tab' });
  tab.dataset.tab = 'installed';
  m.doc.body.prepend(tab);
  const opener = m.doc.getElementById('opener');
  await m.manage.open('github-source', { opener });
  opener.remove();
  m.doc.querySelector('#mk-sheet-host .mk-close').click();
  await settle();
  assert.deepEqual([m.manage.isOpen(), m.doc.activeElement === tab], [false, true]);
});

test('a value typed while a successful Save is out keeps the sheet open with it; the next Save sends it', async () => {
  const gate = deferred();
  let n = 0;
  const m = mount({ plugins: [DUAL_ROW], routes: { ...dual(ok({ ok: true, result: { ok: true } })),
    'PUT /api/plugins/dual/config': () => (++n === 1 ? gate.p : ok({ ok: true })) } });
  await m.manage.open('dual');
  pick(m, 'source:alpha', 'token', 'a2');
  m.$('[data-act="save"]').click();
  await settle();
  pick(m, 'source:beta', 'token', 'b2');   // typed while alpha's PUT is out
  gate.resolve(ok({ ok: true }));
  await settle();
  assert.deepEqual([m.manage.isOpen(), m.$('[data-group="source:beta"] [data-key="token"]').value, m.notified.length], [true, 'b2', 1],
    'alpha is saved; beta\'s new value is still on screen, not dropped by a close');
  m.$('[data-act="save"]').click();
  await settle();
  assert.deepEqual([puts(m).map((p) => `${p.sourceId}=${p.values.token}`), m.manage.isOpen()], [['alpha=a2', 'beta=b2'], false]);
});

test('a Save still out from a sheet SM70 closed holds nothing in the next opening, and never releases a newer Save\'s hold', async () => {
  const g1 = deferred();
  const g2 = deferred();
  let n = 0;
  const m = mount({ routes: base({ 'PUT /api/plugins/github-source/config': () => (++n === 1 ? g1.p : g2.p),
    'POST /api/sources/call': ok({ ok: true, result: { ok: true } }) }) });
  const hash = (h) => { m.window.location.hash = h; m.window.dispatchEvent(new m.window.Event('hashchange')); };
  await m.manage.open('github-source');
  pick(m, 'source:github', 'closeOnDone', 'yes');
  m.$('[data-act="save"]').click();
  await settle();
  hash('#models');
  await settle();
  assert.equal(m.manage.isOpen(), false, 'SM70 closed it with the PUT still out');
  hash('#marketplace/installed');
  await m.manage.open('github-source');
  m.$('.mk-review-update').click();
  m.$('.mk-remove').click();
  m.$('[data-group="source:github"] .mk-test').click();
  await settle();
  m.$('.mk-add-row a.mk-link').click();
  await settle();
  assert.deepEqual([m.page.acts.map((a) => a[0]), m.calls.filter((c) => c[1] === '/api/sources/call').length, m.navigated],
    [['openUpdateReview', 'openRemove'], 1, ['#new']], 'the new opening\'s hand-offs, Test connection and landing link work');
  await m.manage.open('github-source');
  pick(m, 'source:github', 'closeOnDone', 'yes');
  m.$('[data-act="save"]').click();   // this opening's own Save (its PUT is the third)
  await settle();
  g1.resolve(ok({ ok: true }));   // the first opening's Save answers
  await settle();
  m.$('.mk-remove').click();
  assert.deepEqual(m.page.acts.map((a) => a[0]), ['openUpdateReview', 'openRemove'], 'this opening\'s Save is still out: Remove… waits');
  g2.resolve(ok({ ok: true }));
  await settle();
});

test('a refresh landing while the Enabled switch\'s request is out leaves the switch as the person set it', async () => {
  const gate = deferred();
  const m = mount({ routes: base({ 'POST /api/plugins/github-source/enable': () => gate.p }) });
  await m.manage.open('github-source');
  const sw = m.$('input.mk-manage-enable');
  sw.checked = false;
  sw.dispatchEvent(new m.window.Event('change', { bubbles: true }));
  await settle();
  m.page.emit({ plugins: [ROW] });   // read before the POST landed (e.g. a marketplace refresh): still enabled
  assert.deepEqual([sw.disabled, sw.checked], [true, false]);
  gate.resolve(ok({ ok: true, enabled: false }));
  await settle();
  m.page.emit({ plugins: [{ ...ROW, enabled: false }] });
  assert.deepEqual([sw.disabled, sw.checked], [false, false]);
});

test('reopening while Doctor still runs shows that run and starts no second one', async () => {
  const d = deferred();
  const m = mount({ routes: base({ 'POST /api/plugins/github-source/doctor': () => d.p }) });
  await m.manage.open('github-source', { section: 'health' });
  await settle();
  m.manage.close();
  await m.manage.open('github-source');
  await settle();
  const chip = () => m.$('[data-sec="health"] .mk-chip')?.textContent.trim();
  const during = [chip(), m.$('.mk-health-run').disabled];
  d.resolve(ok({ ok: true, checks: CHECKS }));
  await settle();
  assert.deepEqual([m.calls.filter((c) => c[1] === '/api/plugins/github-source/doctor').length, during, chip()],
    [1, ['Running checks…', true], '8 of 8 checks passed']);
});

// A browser drops focus from a control that turns disabled (jsdom keeps it): blur first, as Chrome does.
function blurOnDisable(win, Ctor) {
  const P = win[Ctor].prototype;
  const d0 = Object.getOwnPropertyDescriptor(P, 'disabled');
  Object.defineProperty(P, 'disabled', { configurable: true, get() { return d0.get.call(this); },
    set(v) { if (v && this.ownerDocument.activeElement === this) this.blur(); d0.set.call(this, v); } });
}

test('while Save is out the panel holds focus (a held "Saving…" drops it to <body>); a refusal gives it back to Save', async () => {
  const gate = deferred();
  const m = mount({ routes: base({ 'PUT /api/plugins/github-source/config': () => gate.p }) });
  await m.manage.open('github-source');
  blurOnDisable(m.window, 'HTMLButtonElement');
  pick(m, 'source:github', 'closeOnDone', 'yes');
  const save = m.$('[data-act="save"]');
  save.focus();
  save.click();
  await settle(2);
  assert.equal(m.doc.activeElement, m.doc.getElementById('mk-sheet'), 'inside the sheet, never <body>');
  gate.resolve(fail(400, { error: 'closeOnDone must be yes or no' }));
  await settle();
  assert.deepEqual([m.manage.isOpen(), m.doc.activeElement === save], [true, true]);
});

test('while Doctor runs the panel holds focus, never <body>; the report gives it to "Run again"', async () => {
  const d = deferred();
  const m = mount({ routes: base({ 'POST /api/plugins/github-source/doctor': () => d.p }) });
  await m.manage.open('github-source');
  const run = m.$('.mk-health-run');
  run.focus();
  run.click();
  await settle(2);
  assert.equal(m.doc.activeElement, m.doc.getElementById('mk-sheet'));
  d.resolve(ok({ ok: true, checks: CHECKS }));
  await settle();
  assert.equal(m.doc.activeElement, m.$('.mk-health-run'));
});

test('the Enabled switch takes focus back after its request only when nothing else has it', async () => {
  const e = deferred();
  const m = mount({ routes: base({ 'POST /api/plugins/github-source/enable': () => e.p }) });
  await m.manage.open('github-source');
  blurOnDisable(m.window, 'HTMLInputElement');
  const sw = m.$('input.mk-manage-enable');
  sw.focus(); sw.checked = false; sw.dispatchEvent(new m.window.Event('change', { bubbles: true }));
  await settle(2);
  const next = m.$('.mk-review-update');
  next.focus();                                        // Tab onward while the request is out
  e.resolve(ok({ ok: true, enabled: false }));
  await settle();
  assert.equal(m.doc.activeElement, next);
});

test('SM70: a plugin the page had not re-read yet (LC-P6-30) opens no sheet when the person left #marketplace during the reload', async () => {
  const m = mount({ plugins: [] });
  const gate = deferred();
  m.page.load = function () { this.loads += 1; return gate.p.then(() => { this.state = { ...this.state, plugins: [ROW] }; }); };
  const opening = m.manage.open('github-source');
  await settle();
  m.window.location.hash = '#runs';
  await settle();
  gate.resolve();
  await opening;
  assert.deepEqual([m.manage.isOpen(), m.doc.getElementById('mk-sheet-host')?.classList.contains('hidden') ?? true, m.calls], [false, true, []]);
});

test('a refresh that rebuilds the head\'s update row gives its focus to the fresh "Review update"; an update gone elsewhere, to the switch', async () => {
  const m = mount();
  await m.manage.open('github-source');
  m.$('.mk-review-update').focus();
  m.page.emit({ plugins: [ROW] });   // e.g. the entry's marketplace refresh landing (seconds after the page opened)
  assert.equal(m.doc.activeElement, m.$('.mk-review-update'), 'the rebuilt button, never <body>');
  m.page.emit({ plugins: [{ ...ROW, latest: null }] });   // the update landed from another tab
  assert.equal(m.doc.activeElement, m.$('input.mk-manage-enable'));
});

test('"Set up" on a source with no profile yet focuses its Profile id, the first control', async () => {
  const JIRA = { ...ROW, name: 'jira-source', latest: null };
  const m = mount({ plugins: [JIRA], routes: {
    'GET /api/plugins/jira-source': ok({ ...DETAIL, plugin: JIRA, inventory: { taskSources: [{ id: 'jira', displayName: 'Jira' }] } }),
    'GET /api/plugins/jira-source/config': ok({ channels: [], sources: [{ id: 'jira', multiProfile: true, profile: null, profiles: [],
      schema: [{ key: 'baseUrl', type: 'text', label: 'Base URL', secret: false, required: true, default: null, help: null, options: [] }], values: {} }] }) } });
  await m.manage.open('jira-source', { section: 'settings' });
  assert.equal(m.doc.activeElement, m.$('input.mk-profile-id'));
});

test('while the Enabled switch\'s request is out the panel holds focus (a held switch drops it to <body>)', async () => {
  const e = deferred();
  const m = mount({ routes: base({ 'POST /api/plugins/github-source/enable': () => e.p }) });
  await m.manage.open('github-source');
  blurOnDisable(m.window, 'HTMLInputElement');
  const sw = m.$('input.mk-manage-enable');
  sw.focus(); sw.checked = false; sw.dispatchEvent(new m.window.Event('change', { bubbles: true }));
  await settle(2);
  assert.equal(m.doc.activeElement, m.doc.getElementById('mk-sheet'), 'inside the sheet, never <body>');
  e.resolve(ok({ ok: true, enabled: false }));
  await settle();
  assert.equal(m.doc.activeElement, sw);
});

test('Clear saved values holds focus inside the sheet (the button turns busy, then leaves); a refusal gives it back', async () => {
  const KEY = { key: 'BMF_KEY', type: 'text', label: 'BMF key', secret: true, required: false, default: null, help: null, options: [] };
  const cfg = (set) => ({ sources: [], channels: [], models: { schema: [KEY], values: { BMF_KEY: { set } }, broker: { keyPage: null } } });
  let reads = 0;
  const m = mount({ routes: base({ 'GET /api/plugins/github-source/config': () => ok(cfg(++reads === 1)), 'PUT /api/plugins/github-source/config': ok({ ok: true }) }) });
  await m.manage.open('github-source');
  blurOnDisable(m.window, 'HTMLButtonElement');
  m.$('.mk-clear-secrets').focus();
  m.$('.mk-clear-secrets').click();
  await settle();
  assert.deepEqual([m.$('.mk-clear-secrets'), m.doc.activeElement === m.doc.getElementById('mk-sheet')], [null, true], 'cleared; the panel, never <body>');
  const m2 = mount({ routes: base({ 'GET /api/plugins/github-source/config': ok(cfg(true)),
    'PUT /api/plugins/github-source/config': fail(409, { error: 'the credential broker is on' }) }) });
  await m2.manage.open('github-source');
  blurOnDisable(m2.window, 'HTMLButtonElement');
  const clear = m2.$('.mk-clear-secrets');
  clear.focus();
  clear.click();
  await settle();
  assert.equal(m2.doc.activeElement, clear, 'refused: back on the button');
});

test('a profile re-read that fails after "Discard and switch" gives focus back to the select (#confirm-modal restores none)', async () => {
  const JIRA = { ...ROW, name: 'jira-source', latest: null };
  const src = (profile) => ({ channels: [], sources: [{ id: 'jira', multiProfile: true, profile, profiles: [{ id: 'work', label: '' }, { id: 'home', label: '' }],
    schema: [{ key: 'baseUrl', type: 'text', label: 'Base URL', secret: false, required: true, default: null, help: null, options: [] }], values: { baseUrl: 'https://w' } }] });
  const m = mount({ plugins: [JIRA], routes: {
    'GET /api/plugins/jira-source': ok({ ...DETAIL, plugin: JIRA, inventory: { taskSources: [{ id: 'jira', displayName: 'Jira' }] } }),
    'GET /api/plugins/jira-source/config': ok(src('work')),
    'GET /api/plugins/jira-source/config?profile=home': fail(500, { error: 'config load failed: EACCES' }) } });
  m.deps.confirmModal = async () => { m.doc.activeElement?.blur(); return true; };   // the app's confirm leaves focus on <body>
  await m.manage.open('jira-source');
  pick(m, 'source:jira', 'baseUrl', 'https://typed');
  const sel = m.$('select.mk-profile-sel');
  sel.focus(); sel.value = 'home'; sel.dispatchEvent(new m.window.Event('change', { bubbles: true }));
  await settle();
  assert.deepEqual([sel.value, m.errText('mk-group-err'), m.doc.activeElement === sel], ['work', 'config load failed: EACCES', true]);
});

test('a Save SM70 cut off leaves the next opening un-busy: its Close and Escape work at once (LC-P6-22)', async () => {
  const gate = deferred();
  const m = mount({ routes: base({ 'PUT /api/plugins/github-source/config': () => gate.p }) });
  const hash = (h) => { m.window.location.hash = h; m.window.dispatchEvent(new m.window.Event('hashchange')); };
  await m.manage.open('github-source');
  pick(m, 'source:github', 'closeOnDone', 'yes');
  m.$('[data-act="save"]').click();
  await settle();
  hash('#models');
  await settle();
  hash('#marketplace/installed');
  await m.manage.open('github-source');
  assert.deepEqual([m.doc.querySelector('#mk-sheet-host .mk-close').disabled, m.doc.getElementById('mk-sheet').hasAttribute('aria-busy')], [false, false]);
  escape(m);
  await settle();
  assert.equal(m.manage.isOpen(), false, 'the old PUT is still out');
  gate.resolve(ok({ ok: true }));
  await settle();
});
