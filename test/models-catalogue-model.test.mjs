// test/models-catalogue-model.test.mjs — the Catalogue tab's view model (models-menu P4 Task 4):
// buildCatalogue / displayName / CATALOGUE_VIEW_DEFAULT (ui/public/models/catalogue-model.mjs). Pure: no DOM. The
// numbers in the test names are the plan's rules (1 rows … 12 selected); the fixture is the shared one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogue, displayName, CATALOGUE_VIEW_DEFAULT } from '../ui/public/models/catalogue-model.mjs';
import { data } from './helpers/models-catalogue-fixture.mjs';

const D = CATALOGUE_VIEW_DEFAULT;
const BASE = 11;
const view = (over = {}) => ({ ...D, ...over });
const build = (d = data(), v = D) => buildCatalogue(d, v);
const group = (cat, engine) => cat.groups.find((g) => g.engine === engine);
const sub = (g, key) => g.subs.find((s) => s.key === key);
const rowsOf = (cat) => cat.groups.flatMap((g) => g.subs.flatMap((s) => s.rows));
const ids = (rows) => rows.map((r) => r.id);
const distinct = (rows) => [...new Set(ids(rows))].sort();
const rowIn = (cat, id) => rowsOf(cat).filter((r) => r.id === id);
/** The fixture with `more` added to one list. */
const plus = (list, ...more) => data({ [list]: [...data()[list], ...more] });

test('the default view is frozen and folds every harness but Claude Code', () => {
  assert.deepEqual(D, { query: '', filter: 'all', source: 'any', fold: { claude: false }, open: null });
  assert.ok(Object.isFrozen(D));
  assert.ok(Object.isFrozen(D.fold));
  const loose = build(data(), { query: undefined, filter: undefined, source: undefined, fold: undefined, open: undefined });
  assert.deepEqual(loose, build());
  assert.deepEqual(build(data(), {}), build());
  assert.deepEqual(build(data(), view({ fold: { codex: undefined } })).groups.map((g) => g.open), [true, false, false]);
});

test('1–3: groups, sub-groups, order and names', () => {
  const cat = build();
  assert.deepEqual(cat.groups.map((g) => g.engine), ['claude', 'codex', 'copilot']);
  const claude = group(cat, 'claude');
  assert.deepEqual(claude.subs.map((s) => [s.name, s.builtIn]), [
    ['Claude sign-in', false], ['Custom endpoint', false], ['GitHub Copilot', false], ['OpenRouter', false],
    ['Built in · Claude sign-in', true],
  ]);
  assert.deepEqual(claude.subs.map((s) => s.key), ['signin', 'env', 'copilot', 'openrouter', 'builtin']);
  assert.deepEqual(claude.subs.map((s) => ids(s.rows)), [
    ['old-project-model'], ['gw-claude', 'acme-stable', 'team-glm'], ['my-copilot-gpt'], ['or-ernie'],
    ['claude-opus-5-5', 'claude-haiku-5-5'],
  ]);
  assert.equal(sub(claude, 'builtin').rows.length, 2);
  assert.deepEqual(claude.subs.map((s) => s.count), [1, 3, 1, 1, 2]);
  assert.deepEqual(group(cat, 'codex').subs.map((s) => s.name), ['Built in · ChatGPT sign-in']);
  assert.deepEqual(ids(group(cat, 'codex').subs[0].rows), ['gpt-6.1-sol', 'gpt-6-luna']);
  assert.deepEqual(group(cat, 'copilot').subs.map((s) => s.name), ['Built in · Copilot sign-in']);
  assert.deepEqual(group(cat, 'copilot').subs[0].rows.map((r) => r.source), ['builtin']);
  assert.deepEqual(cat.groups.map((g) => [g.name, g.beta]), [['Claude Code', false], ['OpenAI Codex', true], ['GitHub Copilot', true]]);
  // Only the built-in sub-group has a switch; the others carry no note.
  assert.deepEqual(claude.subs.map((s) => s.hide), [null, null, null, null, { on: false, ariaLabel: 'Hide the models built into Claude Code' }]);
  assert.deepEqual(claude.subs.map((s) => s.note), ['', '', '', '', '']);
  assert.equal(sub(group(cat, 'codex'), 'builtin').hide.ariaLabel, 'Hide the models built into OpenAI Codex');
});

test('2 + 7: a harness with no built-ins gets a group once it has a model, and no built-in sub-group', () => {
  const cat = build(plus('models', { id: 'cursor-fast', label: 'Cursor Fast', engine: 'cursor' }));
  assert.deepEqual(cat.groups.map((g) => g.engine), ['claude', 'codex', 'copilot', 'cursor']);
  const cursor = group(cat, 'cursor');
  assert.deepEqual(cursor.subs.map((s) => [s.key, s.name]), [['signin', 'Cursor sign-in']]);
  assert.deepEqual([cursor.name, cursor.beta, cursor.hiddenText, cursor.customText], ['Cursor', true, '', '1 custom']);
});

test('1: an override hides its built-in and wears the chip', () => {
  const cat = build(plus('models', { id: 'claude-opus-5-5', label: 'My Opus', efforts: ['high'] }));
  const rows = rowIn(cat, 'claude-opus-5-5');
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].name, rows[0].chip, rows[0].source], ['My Opus', 'Overrides built-in', 'yours']);
  assert.deepEqual(ids(sub(group(cat, 'claude'), 'builtin').rows), ['claude-haiku-5-5']);
  assert.equal(cat.count, BASE);
  const luna = rowIn(build(plus('models', { id: 'gpt-6-luna', label: 'My Luna', engine: 'codex' })), 'gpt-6-luna');
  assert.deepEqual(luna.map((r) => [r.source, r.chip]), [['yours', 'Overrides built-in']]);
  const cp = rowIn(build(plus('models', { id: 'copilot/claude-opus-5.5', label: 'My CP', engine: 'copilot' })), 'copilot/claude-opus-5.5');
  assert.deepEqual(cp.map((r) => [r.source, r.chip]), [['yours', 'Overrides built-in']]);
});

test('1: one row per id', () => {
  const cat = build(plus('models', { id: 'acme-stable', label: 'My Acme' }));
  const rows = rowIn(cat, 'acme-stable');
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].source, rows[0].chip, rows[0].plugin], ['yours', null, null]);
  assert.equal(cat.count, BASE);
});

test('2 + 8: a model on two harnesses is in both groups, counted once and marked in both', () => {
  const gw = { id: 'gw-gpt', label: 'GW GPT', upstream: { provider: 'openai', api: 'openai-responses', model: 'gpt-6', baseUrl: 'https://gw.example/v1' } };
  const cat = build(plus('models', gw), view({ fold: { claude: false, codex: false } }));
  assert.equal(cat.count, BASE + 1);
  assert.equal(cat.chips.all, BASE + 1);
  const holding = cat.groups.filter((g) => g.subs.some((s) => s.rows.some((r) => r.id === 'gw-gpt')));
  assert.deepEqual(holding.map((g) => g.engine), ['claude', 'codex']);
  for (const g of holding) {
    const s = g.subs.find((x) => x.rows.some((r) => r.id === 'gw-gpt'));
    assert.deepEqual([s.key, s.name, g.open], ['openai', 'OpenAI-compatible', true]);
  }
  assert.deepEqual(group(cat, 'codex').customText, '+1 custom');
  const opened = build(plus('models', gw), view({ open: 'GW-GPT' }));
  assert.deepEqual(rowIn(opened, 'gw-gpt').map((r) => r.selected), [true, true]);
});

test('4 + 5: a provider says its state once', () => {
  const cat = build(data({ providers: { openrouter: { keySet: false } } }));
  const claude = group(cat, 'claude');
  const or = sub(claude, 'openrouter');
  assert.deepEqual([or.state.tone, or.state.text, or.state.fix, or.fixRow], ['need', 'Needs key', 'Set key', 'openrouter']);
  assert.deepEqual(or.rows.map((r) => r.state), [null]);
  assert.deepEqual(rowIn(cat, 'acme-stable')[0].state, { tone: 'need', text: 'Needs setup' });
  assert.deepEqual(rowIn(cat, 'gw-claude')[0].state, null);
  // Only provider sub-groups carry a state.
  for (const key of ['signin', 'env', 'builtin']) assert.deepEqual([sub(claude, key).state, sub(claude, key).fixRow], [null, null]);
  // A row that needs a sign-in its connected provider does not explain says so itself (L25).
  const linked = build(data({ providers: { copilot: { connected: true } } }));
  const cp = sub(group(linked, 'claude'), 'copilot');
  assert.deepEqual([cp.state.tone, cp.state.text, cp.fixRow], ['ok', 'Connected', null]);
  assert.deepEqual(cp.rows[0].state, { tone: 'need', text: 'Needs setup' });
});

test('4: an unknown Providers payload claims nothing', () => {
  for (const providers of [null, ['copilot']]) {
    const cat = build(data({ providers }));
    const claude = group(cat, 'claude');
    for (const key of ['copilot', 'openrouter']) assert.deepEqual([sub(claude, key).state, sub(claude, key).fixRow], [null, null], `${JSON.stringify(providers)} ${key}`);
    assert.deepEqual(rowIn(cat, 'or-ernie')[0].state, { tone: 'need', text: 'Needs setup' });
    assert.deepEqual(rowIn(cat, 'my-copilot-gpt')[0].state, { tone: 'need', text: 'Needs setup' });
  }
});

test('6: search and filters', () => {
  const gpt = build(data(), view({ query: 'GPT-6' }));
  assert.ok(gpt.groups.length >= 1);
  assert.ok(gpt.groups.every((g) => g.open));
  assert.equal(group(gpt, 'claude'), undefined);
  assert.deepEqual(distinct(rowsOf(gpt)), ['gpt-6-luna', 'gpt-6.1-sol']);
  const none = build(data(), view({ query: 'zzz' }));
  assert.equal(none.noMatch, true);
  assert.deepEqual(none.groups, []);
  assert.equal(build().noMatch, false);
  const empty = data({ models: [], plugin: [], policy: [], predefined: [], codex: [], copilot: [], legacy: [] });
  assert.deepEqual(build(empty).groups, []);
  assert.equal(build(empty).noMatch, false, 'nothing searched (a failed read lists nothing): no "No model matches"');
  assert.equal(build(empty, view({ query: 'x' })).noMatch, true);
  const team = rowsOf(build(data(), view({ source: 'team' })));
  assert.ok(team.length >= 1);
  assert.ok(team.every((r) => r.source === 'team'));
  for (const [source, want] of [['yours', ['gw-claude', 'my-copilot-gpt', 'or-ernie']], ['plugin', ['acme-stable']], ['project', ['old-project-model']]]) {
    const rows = rowsOf(build(data(), view({ source })));
    assert.deepEqual(distinct(rows), want, source);
    assert.ok(rows.every((r) => r.source === source), source);
  }
  assert.deepEqual(distinct(rowsOf(build(data(), view({ filter: 'setup' })))), ['acme-stable', 'my-copilot-gpt', 'or-ernie']);
  const imported = build(data({ justImported: ['MY-COPILOT-GPT'] }), view({ filter: 'imported' }));
  assert.deepEqual(distinct(rowsOf(imported)), ['my-copilot-gpt']);
  assert.equal(imported.chips.imported, 1);
  // A source with nothing in a harness leaves that group out, and its sub-groups with no match too.
  const plugin = build(data(), view({ source: 'plugin' }));
  assert.deepEqual(plugin.groups.map((g) => g.engine), ['claude']);
  assert.deepEqual(group(plugin, 'claude').subs.map((s) => s.key), ['env']);
});

test('7 + 8: hidden built-ins', () => {
  const uses = { 'claude-opus-5-5': [{ kind: 'role', engine: 'claude', key: 'deep', label: 'Deep thinking' }] };
  const hidden = { claude: true, codex: false, copilot: false };
  const cat = build(data({ hiddenBuiltins: hidden, uses }));
  const claude = group(cat, 'claude');
  const b = sub(claude, 'builtin');
  assert.deepEqual([b.rows.length, b.count, b.hide.on], [0, '2 hidden', true]);
  assert.equal(b.note, 'Hidden from every model picker. 1 of them is still used by jobs and keeps working.');
  assert.equal(claude.hiddenText, '2 built-in hidden');
  assert.equal(claude.nBuilt, 0);
  assert.equal(cat.count, BASE - 2);
  assert.equal(cat.chips.all, BASE - 2);
  assert.equal(cat.chips.used, 0);
  assert.equal(cat.chips.setup, 3);
  assert.equal(rowIn(cat, 'claude-opus-5-5').length, 0);
  // Not hidden: no note; hidden but unused: the first sentence alone.
  assert.equal(sub(group(build(data({ uses })), 'claude'), 'builtin').note, '');
  assert.equal(sub(group(build(data({ hiddenBuiltins: hidden })), 'claude'), 'builtin').note, 'Hidden from every model picker.');
  // While finding, a hidden match keeps the group and says how many are hidden.
  const opus = build(data({ hiddenBuiltins: hidden, uses }), view({ query: 'opus' }));
  const found = group(opus, 'claude');
  assert.ok(found);
  assert.equal(found.open, true);
  assert.equal(sub(found, 'builtin').note, '1 matching built-in model is hidden.');
  // How many are hidden does not follow the search.
  assert.deepEqual([found.hiddenText, sub(found, 'builtin').count], ['2 built-in hidden', '2 hidden']);
  const both = build(data({ hiddenBuiltins: hidden }), view({ query: 'claude-' }));
  assert.equal(sub(group(both, 'claude'), 'builtin').note, '2 matching built-in models are hidden.');
  // While finding with no hidden match, the built-in sub-group is left out.
  const gw = build(data({ hiddenBuiltins: hidden }), view({ query: 'gw-' }));
  assert.equal(sub(group(gw, 'claude'), 'builtin'), undefined);
  // A harness whose only rows are hidden built-ins keeps its group, so its switch stays reachable.
  const codexHidden = build(data({ hiddenBuiltins: { claude: true, codex: true, copilot: false } }));
  const codex = group(codexHidden, 'codex');
  assert.ok(codex);
  assert.deepEqual(codex.subs.map((s) => [s.key, s.hide.on, s.rows.length, s.count]), [['builtin', true, 0, '2 hidden']]);
  assert.equal(codexHidden.count, BASE - 4);
});

test('8: counts ignore narrowing', () => {
  const plain = build();
  assert.equal(plain.count, BASE);
  assert.deepEqual(plain.chips, { all: BASE, used: 0, setup: 3, imported: null });
  for (const v of [view({ query: 'zzz' }), view({ filter: 'used' }), view({ source: 'team' })]) {
    const cat = build(data(), v);
    assert.deepEqual([cat.count, cat.chips.all, cat.chips.setup], [plain.count, plain.chips.all, plain.chips.setup]);
  }
});

test('8: the custom pill', () => {
  const plain = group(build(), 'claude');
  assert.match(plain.customText, /^\+\d+ custom$/);
  assert.deepEqual([plain.nBuilt, plain.customText, plain.hiddenText], [2, '+6 custom', '']);
  assert.equal(group(build(), 'codex').customText, '');
  const hidden = group(build(data({ hiddenBuiltins: { claude: true, codex: false, copilot: false } })), 'claude');
  assert.match(hidden.customText, /^\d+ custom$/);
  assert.equal(hidden.customText, '6 custom');
  // nBuilt and the custom count follow the narrowing.
  const narrowed = group(build(data(), view({ query: 'haiku' })), 'claude');
  assert.deepEqual([narrowed.nBuilt, narrowed.customText], [1, '']);
  // Folded groups still carry their sub-groups.
  const codex = group(build(), 'codex');
  assert.deepEqual([codex.open, codex.subs.length], [false, 1]);
});

test('9: fold', () => {
  assert.deepEqual(build().groups.map((g) => g.open), [true, false, false]);
  assert.deepEqual(build(data(), view({ fold: { claude: true, codex: false } })).groups.map((g) => g.open), [false, true, false]);
  assert.deepEqual(build(data(), view({ fold: {} })).groups.map((g) => g.open), [true, false, false]);
});

test('10: readiness and the default', () => {
  const off = build();
  const claude = group(off, 'claude');
  const codex = group(off, 'codex');
  assert.deepEqual([claude.state, claude.isDefault, claude.canDefault, claude.defaultHint], [null, true, false, '']);
  assert.deepEqual([codex.state, codex.isDefault, codex.canDefault, codex.defaultHint], [null, false, true, '']);
  const cat = build(data({
    engines: [{ name: 'claude', ready: true }, { name: 'codex', ready: false }, { name: 'copilot', ready: false }],
    engineLocks: [{ name: 'copilot', reason: 'Off while the credential broker is on' }],
  }));
  assert.deepEqual(cat.groups.map((g) => [g.isDefault, g.canDefault, g.defaultHint]), [
    [true, false, ''], [false, false, 'Not ready'], [false, false, 'Off while the credential broker is on'],
  ]);
  assert.deepEqual(cat.groups.map((g) => g.state), [
    { tone: 'ok', text: 'Ready' }, { tone: 'off', text: 'Not ready' }, { tone: 'off', text: 'Not ready' },
  ]);
  // A harness the engine list leaves out is not ready.
  const partial = build(data({ engines: [{ name: 'claude', ready: true }] }));
  assert.deepEqual(partial.groups.map((g) => [g.state?.text, g.canDefault, g.defaultHint]), [
    ['Ready', false, ''], ['Not ready', false, 'Not ready'], ['Not ready', false, 'Not ready'],
  ]);
  // The run engine names the default; a locked harness that reports ready is still refused.
  const run = build(data({ runEngine: 'codex', engineLocks: [{ name: 'copilot', reason: 'Locked' }] }));
  assert.deepEqual(run.groups.map((g) => [g.isDefault, g.canDefault, g.defaultHint]), [
    [false, true, ''], [true, false, ''], [false, false, 'Locked'],
  ]);
});

test('11 + 12: used text and the open row', () => {
  const uses = { 'claude-opus-5-5': [{ label: 'Deep thinking' }, { label: 'Review' }, { label: 'Design lead' }], 'gw-claude': [{ label: 'Plan' }] };
  const cat = build(data({ uses }), view({ open: 'CLAUDE-OPUS-5-5' }));
  const opus = rowIn(cat, 'claude-opus-5-5')[0];
  assert.deepEqual([opus.used, opus.usedText, opus.selected], [true, 'Deep thinking +2', true]);
  const haiku = rowIn(cat, 'claude-haiku-5-5')[0];
  assert.deepEqual([haiku.used, haiku.usedText, haiku.selected], [false, '', false]);
  assert.deepEqual([rowIn(cat, 'gw-claude')[0].usedText, rowIn(cat, 'gw-claude')[0].selected], ['Plan', false]);
  assert.equal(rowsOf(cat).filter((r) => r.selected).length, 1);
  const upper = build(data({ models: [...data().models, { id: 'Upper-GPT', label: 'Upper' }], uses: { 'upper-gpt': [{ label: 'Plan' }] } }));
  assert.equal(rowIn(upper, 'Upper-GPT')[0].used, true);
  assert.equal(upper.chips.used, 1);
  // An empty use list is no use.
  assert.equal(rowIn(build(data({ uses: { 'gw-claude': [] } })), 'gw-claude')[0].used, false);
});

test('displayName', () => {
  assert.equal(displayName({ id: 'x', label: 'GPT-6 Luna (Copilot)' }), 'GPT-6 Luna');
  assert.equal(displayName({ id: 'x', label: 'ERNIE 5.5 (free) (OpenRouter)' }), 'ERNIE 5.5 (free)');
  assert.equal(displayName({ id: 'x', label: 'Baidu: ERNIE 5.5 (free) (OpenRouter)', upstream: { model: 'baidu/ernie-5.5:free' } }), 'ERNIE 5.5 (free)');
  assert.equal(displayName({ id: 'x', label: 'Qwen3 Coder (Ollama)' }), 'Qwen3 Coder (Ollama)');
  // CAT-10: an OpenAI-compatible import's label ends in the connection's name, which the sub-header already says.
  assert.equal(displayName({ id: 'local-stub-a', label: 'stub-a (OpenAI-compatible)' }), 'stub-a');
  assert.equal(displayName({ id: 'x', label: 'Team: X' }), 'Team: X');
  assert.equal(displayName({ id: 'x', label: 'Team: X', upstream: { model: 'team-x' } }), 'Team: X');
  assert.equal(displayName({ id: 'only-id' }), 'only-id');
  assert.equal(displayName({ id: 'x', label: 'Meta: Llama 5 (OpenRouter)', upstream: { model: 'meta-llama/llama-5' } }), 'Llama 5');
  assert.equal(displayName(null), '');
  // The Catalogue's rows wear it.
  assert.equal(rowIn(build(), 'or-ernie')[0].name, 'ERNIE 5.5 (free)');
});

test('1: precedence and chips', () => {
  const luna = build(plus('policy', { id: 'gpt-6-luna', label: 'Team Luna', engine: 'codex', home: 'acme/policy' }));
  const rows = rowIn(luna, 'gpt-6-luna');
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].source, rows[0].chip, rows[0].name], ['team', 'Team', 'Team Luna']);
  const codex = group(luna, 'codex');
  assert.deepEqual(codex.subs.map((s) => [s.name, ids(s.rows)]), [['ChatGPT sign-in', ['gpt-6-luna']], ['Built in · ChatGPT sign-in', ['gpt-6.1-sol']]]);
  assert.equal(luna.count, BASE);
  const haikuTeam = rowIn(build(plus('policy', { id: 'claude-haiku-5-5', label: 'Team Haiku', home: 'acme/policy' })), 'claude-haiku-5-5');
  assert.deepEqual(haikuTeam.map((r) => [r.source, r.chip, r.name]), [['builtin', null, 'Haiku 5.5']]);
  const haikuPlugin = rowIn(build(plus('plugin', { id: 'claude-haiku-5-5', label: 'Plugin Haiku', plugin: 'acme-models' })), 'claude-haiku-5-5');
  assert.deepEqual(haikuPlugin.map((r) => [r.source, r.chip, r.plugin]), [['plugin', 'Plugin', 'acme-models']]);
  const legacy = rowIn(build(plus('legacy', { id: 'gw-claude', label: 'Old GW' })), 'gw-claude');
  assert.deepEqual(legacy.map((r) => [r.source, r.chip]), [['yours', null]]);
  const cpTeam = rowIn(build(plus('policy', { id: 'copilot/claude-opus-5.5', label: 'Team CP', engine: 'copilot', home: 'acme/policy' })), 'copilot/claude-opus-5.5');
  assert.deepEqual(cpTeam.map((r) => [r.source, r.chip]), [['team', 'Team']]);
  const teamOverProject = rowIn(build(plus('legacy', { id: 'team-glm', label: 'Old GLM' })), 'team-glm');
  assert.deepEqual(teamOverProject.map((r) => [r.source, r.chip]), [['team', 'Team']]);
  const cat = build();
  assert.deepEqual(rowIn(cat, 'acme-stable')[0].mark, { kind: 'plugin', key: 'acme-models' });
  assert.deepEqual(rowIn(cat, 'old-project-model')[0].mark, { kind: 'own', key: 'old-project-model' });
  assert.deepEqual(rowIn(cat, 'or-ernie')[0].mark, { kind: 'vendor', key: 'baidu' });
  assert.deepEqual(rowIn(cat, 'gpt-6.1-sol')[0].mark, { kind: 'vendor', key: 'openai' });
  assert.deepEqual(['team-glm', 'old-project-model', 'acme-stable', 'gw-claude', 'claude-opus-5-5'].map((id) => rowIn(cat, id)[0].chip), ['Team', 'Project', 'Plugin', null, null]);
  assert.deepEqual(['team-glm', 'old-project-model', 'acme-stable', 'gw-claude', 'claude-opus-5-5'].map((id) => rowIn(cat, id)[0].source), ['team', 'project', 'plugin', 'yours', 'builtin']);
});

test('6: the other search fields and In use', () => {
  const q = (query) => distinct(rowsOf(build(data(), view({ query }))));
  assert.deepEqual(q('acme/policy'), ['team-glm']);
  assert.deepEqual(q('baidu/'), ['or-ernie']);
  assert.deepEqual(q('acme-models'), ['acme-stable']);
  assert.deepEqual(q('OLD-PROJECT'), ['old-project-model']);
  assert.deepEqual(q('  haiku  '), ['claude-haiku-5-5']);
  assert.deepEqual(q('Luna'), ['gpt-6-luna']);
  assert.deepEqual(q('ernie 5.5 (free)'), ['or-ernie']);
  assert.deepEqual(q('baidu:'), []);
  const used = build(data({ uses: { 'gw-claude': [{ label: 'Plan' }] } }), view({ filter: 'used' }));
  assert.deepEqual(distinct(rowsOf(used)), ['gw-claude']);
  assert.equal(used.chips.used, 1);
  const plain = build();
  assert.equal(plain.chips.setup, 3);
  assert.equal(plain.chips.imported, null);
});

test('4 + 7: fix-less state, plural note', () => {
  const or = sub(group(build(data({ providers: { openrouter: { keySet: true } } })), 'claude'), 'openrouter');
  assert.deepEqual([or.state, or.fixRow], [{ tone: 'ok', text: 'Key set', fix: '' }, null]);
  const uses = { 'claude-opus-5-5': [{ label: 'Deep thinking' }], 'claude-haiku-5-5': [{ label: 'Review' }] };
  const b = sub(group(build(data({ uses, hiddenBuiltins: { claude: true, codex: false, copilot: false } })), 'claude'), 'builtin');
  assert.equal(b.note, 'Hidden from every model picker. 2 of them are still used by jobs and keep working.');
});

test('the input is never changed', () => {
  const d = data({ uses: { 'claude-opus-5-5': [{ label: 'Plan' }] } });
  const before = JSON.stringify(d);
  build(d, view({ query: 'opus', open: 'claude-opus-5-5' }));
  assert.equal(JSON.stringify(d), before);
  assert.equal(d.predefined[0].engine, undefined);
});
