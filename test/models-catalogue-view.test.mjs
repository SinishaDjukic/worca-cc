// test/models-catalogue-view.test.mjs — the Catalogue tab drawn (models-menu P4 Task 5): renderCatalogue (toolbar,
// harness groups, sub-headers, the hide switch, 44px rows, nothing matches), buildModelPanel (actions by source,
// facts, secrets, limits, uses, the Test reasons, the state word) and renderModelPanel, plus the CSS that keeps the
// panel beside Ask's column and the wide list scrolling sideways. The fixture is the shared one (Task 4).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { cssRules } from './helpers/css-rules.mjs';
import { readStyleCss } from '../src/core/read-style-css.mjs';
import { buildCatalogue, buildModelPanel, CATALOGUE_VIEW_DEFAULT } from '../ui/public/models/catalogue-model.mjs';
import { renderCatalogue, renderModelPanel } from '../ui/public/models/catalogue-view.mjs';
import { setCredentialData } from '../ui/public/credential-badges.mjs';
import { data } from './helpers/models-catalogue-fixture.mjs';

const doms = [];
afterEach(() => { for (const d of doms.splice(0)) d.window.close(); });
const docOf = () => { const d = new JSDOM('<!doctype html><body></body>'); doms.push(d); return d.window.document; };

const view = (over = {}) => ({ ...CATALOGUE_VIEW_DEFAULT, ...over });
const draw = (doc, d = data(), v = view(), opts = {}) => renderCatalogue(buildCatalogue(d, v), { doc, ...opts });
const grp = (root, engine) => root.querySelector(`section.mdl-grp[data-engine="${engine}"]`);
const subH = (root, engine, key) => grp(root, engine).querySelector(`.mdl-sub-h[data-sub="${key}"]`);
const rowEl = (root, id) => [...root.querySelectorAll('.mdl-row[data-id]')].find((r) => r.dataset.id === id);
const texts = (els) => [...els].map((e) => e.textContent);
/** A chip's word without its count. */
const chipWord = (chip) => [...chip.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join('');
const panelOf = (d, id) => buildModelPanel(d, id);
const fact = (panel, k) => panel.facts.find((f) => f.k === k);
/** The fixture with `more` added to one list. */
const plus = (list, ...more) => data({ [list]: [...data()[list], ...more] });

test('1: the toolbar: search, the filter chips with counts, the Source select', () => {
  const doc = docOf();
  const root = draw(doc);
  assert.ok(root.matches('div.mdl-cat'));
  const bar = root.querySelector(':scope > .mdl-toolbar');
  const search = bar.querySelector('input.input.mv-search');
  assert.equal(search.type, 'search');
  assert.equal(search.getAttribute('placeholder'), 'Search models');
  assert.equal(search.getAttribute('aria-label'), 'Search models');
  assert.equal(search.value, '');
  const chips = [...bar.querySelectorAll('.mv-filters > button.filter-chip[data-filter]')];
  assert.deepEqual(chips.map((c) => [c.dataset.filter, c.getAttribute('aria-pressed')]), [['all', 'true'], ['used', 'false'], ['setup', 'false']]);
  assert.deepEqual(chips.map(chipWord), ['All', 'In use', 'Needs setup']);
  assert.deepEqual(chips.map((c) => c.querySelector('span.n').textContent), ['11', '0', '3']);
  assert.ok(chips.every((c) => c.type === 'button'));
  const select = bar.querySelector('select.select-sm.mdl-source');
  assert.equal(select.getAttribute('aria-label'), 'Source');
  assert.deepEqual([...select.options].map((o) => [o.value, o.textContent]), [
    ['any', 'Any source'], ['yours', 'Yours'], ['plugin', 'Plugin'], ['team', 'Team'], ['project', 'Project'],
  ]);
  assert.equal(select.value, 'any');

  const narrowed = draw(doc, data(), view({ filter: 'used', source: 'team', query: 'glm' }), { query: 'glm', filter: 'used', source: 'team' });
  assert.deepEqual([...narrowed.querySelectorAll('.mv-filters .filter-chip')].map((c) => c.getAttribute('aria-pressed')), ['false', 'true', 'false']);
  assert.equal(narrowed.querySelector('select.mdl-source').value, 'team');
  assert.equal(narrowed.querySelector('input.mv-search').value, 'glm');
});

test('2: "Just imported" only after an import', () => {
  const doc = docOf();
  assert.equal(draw(doc).querySelector('.filter-chip[data-filter="imported"]'), null);
  const root = draw(doc, data({ justImported: [] }), view({ filter: 'imported' }), { filter: 'imported' });
  const chip = root.querySelector('.mv-filters > .filter-chip[data-filter="imported"]');
  assert.equal(chipWord(chip), 'Just imported');
  assert.equal(chip.querySelector('span.n').textContent, '0');
  assert.equal(chip.getAttribute('aria-pressed'), 'true');
});

test('3: a group head, a folded group, a row', () => {
  const doc = docOf();
  const root = draw(doc);
  const head = root.querySelector('.mdl-scroll > .mdl-list > .mdl-cols.mdl-cols-head');
  assert.equal(head.getAttribute('aria-hidden'), 'true');
  assert.deepEqual(texts(head.children), ['Model', 'Used by', 'Status', '']);
  assert.deepEqual([...root.querySelectorAll('.mdl-list > section.mdl-grp')].map((g) => g.dataset.engine), ['claude', 'codex', 'copilot']);

  const claude = grp(root, 'claude');
  const toggle = claude.querySelector(':scope > .mdl-grp-head > button.row-btn.mdl-grp-toggle');
  assert.equal(toggle.type, 'button');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(toggle.querySelector('.mdl-grp-title').textContent, 'Claude Code');
  assert.ok(toggle.querySelector('.mdl-mark.lg img[src$="claudecode-color.svg"]'));
  assert.deepEqual(texts(toggle.querySelectorAll('.badge')), ['2', '+6 custom', 'Default']);
  assert.equal(toggle.querySelector('.badge.slate').textContent, 'Default');
  assert.equal(toggle.querySelector('.mdl-st'), null, 'engines unknown: no state word');
  assert.ok(claude.querySelector(':scope > .mdl-grp-body'));

  const codex = grp(root, 'codex');
  assert.equal(codex.querySelector('.mdl-grp-body'), null);
  assert.equal(codex.querySelector('.mdl-grp-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(codex.querySelector('.mdl-grp-toggle .badge.blue').textContent, 'Beta');

  const more = claude.querySelector(':scope > .mdl-grp-head > .mdl-grp-more');
  assert.equal(more.getAttribute('aria-label'), 'More for Claude Code');
  for (const c of ['btn', 'btn-quiet', 'btn-sm', 'btn-icon']) assert.ok(more.classList.contains(c), c);
  assert.equal(more.type, 'button');
  assert.ok(more.querySelector('svg'));

  const row = rowEl(root, 'claude-opus-5-5');
  assert.equal(row.tagName, 'BUTTON');
  assert.equal(row.type, 'button');
  for (const c of ['row-btn', 'mdl-row', 'mdl-cols']) assert.ok(row.classList.contains(c), c);
  assert.equal(row.querySelector('.mdl-mark img[src$="claude-color.svg"]').getAttribute('alt'), 'Anthropic');
  assert.equal(row.querySelector('.mdl-row-name').textContent, 'Opus 5.5');
  assert.equal(row.children.length, 4);
  assert.deepEqual([...row.children].slice(0, 3).map((c) => c.className), ['mdl-row-model', 'mdl-row-used', 'mdl-row-st']);
  assert.ok(row.children[3].querySelector('svg'));
  assert.ok(!row.classList.contains('mdl-used') && !row.classList.contains('mdl-sel'));

  const plugin = rowEl(root, 'acme-stable');
  assert.equal(plugin.querySelector('.mdl-row-model .badge.slate').textContent, 'Plugin');
  assert.ok(plugin.querySelector('.mdl-mark.own svg'), 'a plugin model wears the bag');
  assert.equal(plugin.querySelector('.mdl-row-st .mdl-st.need').textContent, 'Needs setup');
  assert.equal(rowEl(root, 'claude-opus-5-5').querySelector('.mdl-row-st').children.length, 0);
  assert.equal(rowEl(root, 'claude-opus-5-5').querySelector('.badge'), null, 'no chip, no badge');
});

test('3: a ready harness says so; a used row and the open row wear their classes', () => {
  const doc = docOf();
  const uses = { 'gw-claude': [{ kind: 'role', engine: 'claude', key: 'deep', label: 'Deep' }, { kind: 'step', engine: 'claude', key: 'plan', label: 'Plan' }] };
  const d = data({ uses, engines: [{ name: 'claude', ready: true }, { name: 'codex', ready: false }] });
  const root = draw(doc, d, view({ open: 'GW-Claude' }));
  assert.equal(grp(root, 'claude').querySelector('.mdl-grp-toggle .mdl-st.ok').textContent, 'Ready');
  assert.equal(grp(root, 'codex').querySelector('.mdl-grp-toggle .mdl-st.off').textContent, 'Not ready');
  const row = rowEl(root, 'gw-claude');
  assert.ok(row.classList.contains('mdl-used'));
  assert.ok(row.classList.contains('mdl-sel'));
  assert.equal(row.querySelector('.mdl-row-used').textContent, 'Deep +1');
  assert.ok(!rowEl(root, 'team-glm').classList.contains('mdl-sel'));
});

test('4: a provider sub-header and the hide switch', () => {
  const doc = docOf();
  const root = draw(doc, data({ providers: { openrouter: { keySet: false } } }));
  const or = subH(root, 'claude', 'openrouter');
  assert.ok(or.textContent.startsWith('OpenRouter'));
  assert.equal(or.querySelector('.mdl-st.need').textContent, 'Needs key');
  const fix = or.querySelector('button.btn.btn-sm.mdl-fix');
  assert.equal(fix.textContent, 'Set key');
  assert.equal(fix.dataset.row, 'openrouter');
  assert.equal(fix.type, 'button');
  assert.equal(subH(root, 'claude', 'env').querySelector('.badge').textContent, '3');
  assert.equal(subH(root, 'claude', 'env').querySelector('.mdl-fix'), null);
  const keySet = subH(draw(doc, data({ providers: { openrouter: { keySet: true } } })), 'claude', 'openrouter');
  assert.equal(keySet.querySelector('.mdl-st.ok').textContent, 'Key set');
  assert.equal(keySet.querySelector('.mdl-fix'), null, 'a state with nothing to fix has no button');

  const input = grp(root, 'claude').querySelector('input.mv-hide-builtin');
  assert.equal(input.dataset.engine, 'claude');
  assert.equal(input.checked, false);
  assert.equal(input.getAttribute('role'), 'switch');
  assert.equal(input.getAttribute('aria-label'), 'Hide the models built into Claude Code');
  assert.ok(input.closest('.switch-row').textContent.includes('Hide built-in models'));
  assert.equal(input.closest('.mdl-sub-h').dataset.sub, 'builtin');
  assert.equal(subH(root, 'claude', 'builtin').textContent.startsWith('Built in · Claude sign-in'), true);
  assert.equal(subH(root, 'claude', 'openrouter').querySelector('input'), null, 'only the built-in sub-group has the switch');

  const hidden = draw(doc, data({ hiddenBuiltins: { claude: true, codex: false, copilot: false } }));
  const built = subH(hidden, 'claude', 'builtin');
  assert.equal(built.querySelector('.badge').textContent, '2 hidden');
  assert.equal(built.querySelector('input.mv-hide-builtin').checked, true);
  assert.ok(built.nextElementSibling.matches('div.mdl-note'));
  assert.equal(built.nextElementSibling.textContent, 'Hidden from every model picker.');
  assert.equal(rowEl(hidden, 'claude-opus-5-5'), undefined);
  assert.equal(root.querySelector('.mdl-note'), null);
});

test('5: nothing matches', () => {
  const doc = docOf();
  const root = draw(doc, data(), view({ query: 'zzz' }), { query: 'zzz' });
  const none = root.querySelector(':scope > .mdl-nomatch');
  assert.ok(none.textContent.startsWith('No model matches'));
  const all = none.querySelector('button.btn.btn-sm.mdl-show-all');
  assert.equal(all.textContent, 'Show all');
  assert.equal(all.type, 'button');
  assert.equal(root.querySelector('input.mv-search').value, 'zzz');
  assert.equal(root.querySelector('.mdl-grp'), null);
  assert.equal(draw(doc).querySelector('.mdl-nomatch'), null);
});

test('6: panel actions by source', () => {
  const doc = docOf();
  const acts = (id, d = data()) => {
    const p = renderModelPanel(buildModelPanel(d, id), { doc });
    return [...p.querySelectorAll('.mdl-act')].map((b) => [b.dataset.act, b.textContent]);
  };
  assert.deepEqual(acts('my-copilot-gpt'), [['test', 'Test'], ['edit', 'Edit'], ['duplicate', 'Duplicate']]);
  assert.deepEqual(acts('acme-stable'), [['test', 'Test'], ['copy', 'Edit a copy']]);
  assert.deepEqual(acts('team-glm'), [['test', 'Test']]);
  assert.deepEqual(acts('old-project-model'), [['promote', 'Promote to global']]);
  assert.deepEqual(acts('gpt-6.1-sol'), []);
  assert.equal(renderModelPanel(buildModelPanel(data(), 'gpt-6.1-sol'), { doc }).querySelector('.mdl-acts'), null, 'no action, no empty line');
  assert.deepEqual(acts('claude-opus-5-5'), [['test', 'Test']]);
  for (const id of ['acme-stable', 'team-glm', 'old-project-model', 'gpt-6.1-sol', 'claude-opus-5-5']) {
    assert.equal(renderModelPanel(buildModelPanel(data(), id), { doc }).querySelector('.mdl-act-more'), null, id);
  }

  const p = renderModelPanel(buildModelPanel(data(), 'my-copilot-gpt'), { doc });
  assert.ok(p.matches('aside#model-panel.mdl-side'));
  assert.equal(p.getAttribute('aria-label'), 'My Copilot GPT');
  assert.equal(p.querySelector('h2.mdl-side-title').textContent, 'My Copilot GPT');
  assert.ok(p.querySelector('.mdl-mark.lg'));
  assert.equal(p.querySelector('.mdl-st.need').textContent, 'Needs sign-in');
  const close = p.querySelector('button.btn.btn-quiet.btn-sm.btn-icon.mdl-side-close');
  assert.equal(close.getAttribute('aria-label'), 'Close');
  assert.ok(close.querySelector('svg'));
  const test1 = p.querySelector('.mdl-act[data-act="test"]');
  assert.equal(test1.disabled, true);
  assert.equal(test1.title, 'Needs setup first');
  assert.ok(test1.nextElementSibling.matches('span.mdl-test-result'));
  const more = p.querySelector('button.mdl-act-more');
  assert.equal(more.getAttribute('aria-label'), 'More');
  for (const c of ['btn', 'btn-quiet', 'btn-sm', 'btn-icon']) assert.ok(more.classList.contains(c), c);
  assert.ok(!more.classList.contains('mdl-act'));
  assert.ok(more.querySelector('svg'));
  assert.ok([...p.querySelectorAll('button')].every((b) => b.type === 'button'));

  const team = renderModelPanel(buildModelPanel(data(), 'team-glm'), { doc }).querySelector('.mdl-act[data-act="test"]');
  assert.equal(team.disabled, false, 'a team-policy model is testable');
  assert.equal(team.hasAttribute('title'), false);

  assert.deepEqual(buildModelPanel(data(), 'my-copilot-gpt').actions, {
    test: { shown: true, disabled: true, title: 'Needs setup first' },
    edit: true, duplicate: true, del: true, copy: false, promote: false, delLabel: 'Delete',
  });
  const override = buildModelPanel(plus('models', { id: 'claude-opus-5-5', label: 'My Opus', testable: true }), 'claude-opus-5-5');
  assert.equal(override.source, 'yours');
  assert.equal(override.actions.delLabel, 'Remove override');
  assert.equal(buildModelPanel(data(), 'gpt-6.1-sol').actions.test.shown, false);
  assert.equal(buildModelPanel(data({ legacy: [{ id: 'old-project-model', label: 'Old', testable: true }] }), 'old-project-model').actions.test.shown, false);
});

test('7: panel facts, secrets, uses, Test reasons, the state word', () => {
  const doc = docOf();
  const step = { kind: 'step', engine: 'codex', key: 'coder', label: 'Implement' };
  const mine = panelOf(data({ uses: { 'my-copilot-gpt': [step] } }), 'my-copilot-gpt');
  assert.deepEqual(mine.facts.map((f) => f.k), ['ID', 'Sends as', 'Runs on', 'Provider', 'Efforts', 'Price', 'Source']);
  assert.deepEqual(fact(mine, 'ID'), { k: 'ID', v: 'my-copilot-gpt', mono: true, copy: true });
  assert.deepEqual(fact(mine, 'Sends as'), { k: 'Sends as', v: 'claude-sonnet-5.5', mono: true });
  assert.deepEqual(fact(mine, 'Runs on'), { k: 'Runs on', v: 'Claude Code', mark: { kind: 'harness', key: 'claude' } });
  assert.deepEqual(fact(mine, 'Provider'), { k: 'Provider', v: 'GitHub Copilot', mark: { kind: 'provider', key: 'copilot' } });
  assert.equal(fact(mine, 'Efforts').v, 'low, medium, high');
  assert.equal(fact(mine, 'Price').v, 'priced free');
  assert.equal(fact(mine, 'Source').v, 'Yours');
  assert.deepEqual(mine.uses, [{ label: 'Implement', kindText: 'Step · OpenAI Codex', engine: 'codex', kind: 'step' }]);
  assert.equal(mine.actions.test.title, 'Needs setup first');
  assert.deepEqual(mine.state, { tone: 'need', text: 'Needs sign-in' });
  assert.deepEqual(mine.secrets, []);
  const unknown = panelOf(data({ providers: [] }), 'my-copilot-gpt');
  assert.deepEqual(unknown.state, { tone: 'need', text: 'Needs setup' }, 'an unknown Providers payload: the row\'s own need');
  assert.equal(unknown.actions.test.title, 'Needs setup first', 'needsSignIn alone holds Test back');
  const signedOut = data({ models: data().models.map((m) => (m.id === 'my-copilot-gpt' ? { ...m, needsSignIn: false } : m)) });
  const viaProvider = panelOf(signedOut, 'my-copilot-gpt');
  assert.deepEqual(viaProvider.state, { tone: 'need', text: 'Needs sign-in' }, 'the provider sub-group\'s need');
  assert.equal(viaProvider.actions.test.title, 'Needs setup first', 'a provider need alone holds Test back');
  assert.deepEqual(panelOf({ ...signedOut, providers: { copilot: { connected: true } } }, 'my-copilot-gpt').actions.test, { shown: true, disabled: false, title: '' });

  const acme = panelOf(data(), 'acme-stable');
  assert.deepEqual(acme.secrets, [{ key: 'ACME_TOKEN', set: false }]);
  assert.deepEqual(acme.actions.test, { shown: true, disabled: true, title: 'Set the plugin secret first' });
  assert.equal(fact(acme, 'Source').v, 'Plugin acme-models');
  assert.equal(acme.plugin, 'acme-models');
  assert.deepEqual(acme.mark, { kind: 'plugin', key: 'acme-models' });
  assert.deepEqual(acme.state, { tone: 'need', text: 'Needs setup' });

  const gw = panelOf(data({ engines: [{ name: 'claude', ready: false }] }), 'gw-claude');
  assert.deepEqual(gw.actions.test, { shown: true, disabled: true, title: 'Claude Code is not ready' });
  assert.deepEqual(gw.state, { tone: 'off', text: 'Not ready' });
  assert.deepEqual(fact(gw, 'Endpoint'), { k: 'Endpoint', v: 'Custom endpoint' });
  assert.deepEqual(fact(gw, 'Env vars'), { k: 'Env vars', v: 'ANTHROPIC_BASE_URL', mono: true });
  assert.deepEqual(panelOf(data(), 'gw-claude').actions.test, { shown: true, disabled: false, title: '' });

  const team = panelOf(data(), 'team-glm');
  assert.equal(fact(team, 'Source').v, 'Team policy acme/policy');
  assert.equal(fact(panelOf(data(), 'old-project-model'), 'Source').v, 'Project demo');

  const opus = panelOf(data(), 'claude-opus-5-5');
  assert.deepEqual(opus.facts.map((f) => f.k), ['ID', 'Runs on', 'Sign-in', 'Efforts', 'Source']);
  assert.equal(fact(opus, 'Sign-in').v, 'Claude sign-in');
  assert.equal(fact(opus, 'Source').v, 'Built-in');
  assert.equal(opus.state, null, 'engines unknown: no state');
  assert.deepEqual(panelOf(data({ engines: [{ name: 'claude', ready: true }] }), 'claude-opus-5-5').state, { tone: 'ok', text: 'Ready' });
  const unreliable = data({ predefined: [{ ...data().predefined[0], costUnreliable: true }] });
  assert.equal(fact(panelOf(unreliable, 'claude-opus-5-5'), 'Price').v, 'Not verified');
  assert.equal(fact(panelOf(data(), 'gpt-6.1-sol'), 'Sign-in').v, 'ChatGPT sign-in');

  setCredentialData({ enabled: true, models: { 'gw-claude': { slot: 'gw' } }, slots: [{ id: 'gw', label: 'Gateway key', state: 'set' }] });
  try {
    assert.equal(fact(panelOf(data(), 'gw-claude'), 'Key').v, 'your key');
  } finally {
    setCredentialData(null);
  }
  assert.equal(fact(panelOf(data(), 'gw-claude'), 'Key'), undefined);

  const drawn = renderModelPanel(mine, { doc });
  const dl = drawn.querySelector('dl.mdl-facts');
  assert.deepEqual(texts(dl.querySelectorAll('dt')), ['ID', 'Sends as', 'Runs on', 'Provider', 'Efforts', 'Price', 'Source']);
  const idDd = dl.querySelectorAll('dd')[0];
  assert.ok(idDd.classList.contains('mono'));
  assert.ok(idDd.textContent.includes('my-copilot-gpt'));
  const copy = idDd.querySelector('button.mdl-copy-id');
  assert.equal(drawn.querySelectorAll('.mdl-copy-id').length, 1, 'only the ID copies');
  assert.equal(copy.getAttribute('aria-label'), 'Copy the ID');
  assert.ok(dl.querySelectorAll('dd')[1].classList.contains('mono'));
  assert.ok(!dl.querySelectorAll('dd')[2].classList.contains('mono'));
  assert.ok(dl.querySelectorAll('dd')[2].querySelector('.mdl-mark.sm img[src$="claudecode-color.svg"]'));
  assert.ok(dl.querySelectorAll('dd')[3].querySelector('.mdl-mark.sm img[src$="githubcopilot.svg"]'));
  const sects = [...drawn.querySelectorAll('h3.mdl-sect')];
  assert.deepEqual(texts(sects), ['Used by']);
  const use = drawn.querySelector('button.row-btn.mdl-use[data-engine="codex"]');
  assert.equal(use.dataset.kind, 'step');
  assert.ok(use.textContent.includes('Implement'));
  assert.ok(use.textContent.includes('Step · OpenAI Codex'));

  const acmeDrawn = renderModelPanel(acme, { doc });
  assert.ok(acmeDrawn.textContent.includes('ACME_TOKEN: not set'));
  assert.ok(acmeDrawn.textContent.includes('No job yet'));
  assert.equal(acmeDrawn.querySelector('.mdl-use'), null);
  assert.equal(acmeDrawn.querySelector('.mdl-act[data-act="test"]').title, 'Set the plugin secret first');
  const set = renderModelPanel(panelOf(data({ plugin: [{ ...data().plugin[0], secrets: [{ key: 'ACME_TOKEN', label: 'Acme', set: true }] }] }), 'acme-stable'), { doc });
  assert.ok(set.textContent.includes('ACME_TOKEN: set'));
  assert.equal(renderModelPanel(opus, { doc }).querySelector('.mdl-side-head .mdl-st'), null, 'no state, no word');
});

test('7: kind words for every use', () => {
  const lc = 'gw-claude';
  const uses = [
    { kind: 'role', engine: 'claude', key: 'deep', label: 'Deep' },
    { kind: 'helper', engine: 'codex', key: 'title', label: 'Titles' },
    { kind: 'design', engine: 'claude', key: 'lead', label: 'Design lead' },
    { kind: 'project-step', engine: 'claude', key: 'plan', label: 'Plan', project: 'demo' },
    { kind: 'project-node', engine: 'codex', key: 'n1', label: 'wf › n1', project: 'site' },
    { kind: 'step', engine: 'claude', key: 'plan', label: 'Plan', project: 'stray' },
  ];
  assert.deepEqual(panelOf(data({ uses: { [lc]: uses } }), 'GW-Claude').uses.map((u) => u.kindText), [
    'Role', 'Helper job · OpenAI Codex', 'Design', 'Project step · demo', 'Workflow node · OpenAI Codex · site', 'Step',
  ]);
});

test('8: limits', () => {
  const doc = docOf();
  const ernie = panelOf(data(), 'or-ernie');
  assert.deepEqual(ernie.limits, [{ k: 'Reasoning', v: 'None' }, { k: 'Web search', v: 'Not available' }]);
  const drawn = renderModelPanel(ernie, { doc });
  assert.deepEqual(texts(drawn.querySelectorAll('h3.mdl-sect')), ['Limits', 'Used by']);
  assert.ok(drawn.querySelectorAll('dl')[1].textContent.includes('Web search'));
  const gw = panelOf(data(), 'gw-claude');
  assert.deepEqual(gw.limits, []);
  assert.deepEqual(texts(renderModelPanel(gw, { doc }).querySelectorAll('h3.mdl-sect')), ['Used by']);

  const responses = {
    id: 'gw-resp', label: 'Resp', efforts: ['medium'],
    upstream: { provider: 'openai', api: 'openai-responses', model: 'gpt-x', capabilities: { maxPromptTokens: 272000, maxOutputTokens: 128000 } },
  };
  assert.deepEqual(panelOf(plus('models', responses), 'gw-resp').limits, [
    { k: 'Prompt', v: '~272k tokens' }, { k: 'Output', v: '~128k tokens' }, { k: 'Reasoning', v: 'Summaries only' }, { k: 'Web search', v: 'Not available' },
  ]);
  const chat = { ...responses, id: 'gw-chat', upstream: { provider: 'openai', api: 'openai-chat', model: 'x', capabilities: { reasoning: true } } };
  assert.deepEqual(panelOf(plus('models', chat), 'gw-chat').limits, [{ k: 'Reasoning', v: 'Not carried across turns' }, { k: 'Web search', v: 'Not available' }]);
  assert.deepEqual(panelOf(plus('models', { ...responses, id: 'cx', engine: 'codex' }), 'cx').limits, [], 'a Codex model is not translated');
  assert.deepEqual(panelOf(data(), 'my-copilot-gpt').limits, [], 'the anthropic api passes through');
});

test('9: nulls', () => {
  const doc = docOf();
  assert.equal(renderModelPanel(null, { doc }), null);
  assert.equal(buildModelPanel(data(), 'nope'), null);
  assert.equal(buildModelPanel(data(), null), null);
  assert.equal(buildModelPanel(data(), ''), null);
  assert.equal(buildModelPanel(null, 'gw-claude'), null);
  assert.equal(buildModelPanel(data(), 'GW-CLAUDE').id, 'gw-claude');
  const d = data();
  const before = JSON.stringify(d);
  buildModelPanel(d, 'claude-opus-5-5');
  assert.equal(JSON.stringify(d), before, 'the input is never changed');
});

test('CSS: the list scrolls sideways in its box; the panel sits under the top bar and beside Ask\'s column', () => {
  const rules = cssRules(readStyleCss());
  const flat = (s) => s.replace(/\s+/g, '');
  const find = (sel, media = '') => rules.filter((r) => r.sel === sel && r.media === media).map((r) => flat(r.body)).join(';');
  assert.match(find('.mdl-scroll'), /overflow-x:auto/);
  assert.match(find('.mdl-list'), /min-width:720px/);
  assert.match(find('.mdl-cols'), /grid-template-columns:minmax\(0,1\.25fr\)minmax\(0,1fr\)200px28px/);
  assert.match(find('.mdl-row'), /min-height:44px/);
  const side = find('.mdl-side');
  assert.match(side, /position:absolute/);
  assert.match(side, /inset:000auto/);
  assert.match(side, /width:min\(420px,100%\)/);
  assert.match(side, /overflow-y:auto/);
  assert.match(side, /box-shadow:var\(--shadow-sheet\)/);
  assert.match(find('.mdl-side', '@media (max-width:860px)'), /width:100%/);
  assert.match(find('body.ask-side-open .mdl-side', '@media (min-width:1081px)'), /right:var\(--ask-side-w,440px\)/);
  assert.ok(!rules.some((r) => /\.mdl-(?:scroll|list)\b/.test(r.sel) && r.media), 'no viewport query sizes the list');
});

test('CSS: your own model\'s tile shows worca\'s white W on the blue gradient, not a white disc (CAT-11)', () => {
  // The asset is a white disc holding a black W: brightness(0) invert(1) painted the whole disc white (walk 5, 45% of
  // the tile white). invert(1) turns the W white and the disc black; screen drops the black over the gradient.
  const own = cssRules(readStyleCss()).filter((r) => r.sel === '.mdl-mark.own img' && !r.media).map((r) => r.body.replace(/\s+/g, '')).join(';');
  assert.match(own, /filter:invert\(1\)/);
  assert.match(own, /mix-blend-mode:screen/);
  assert.doesNotMatch(own, /brightness\(0\)/);
});

test('CSS: the row a #models/model/<id> address reveals lights up while found, with motion and without (A-7)', () => {
  const found = cssRules(readStyleCss()).filter((r) => /\.is-found\b/.test(r.sel) && /\.mdl-row\b/.test(r.sel));
  assert.ok(found.some((r) => !r.media && /animation:settingFound/.test(r.body.replace(/\s+/g, ''))), 'a found row runs the found fade');
  assert.ok(found.some((r) => /prefers-reduced-motion/.test(r.media) && /box-shadow/.test(r.body)), 'and keeps its ring when motion is reduced');
});
