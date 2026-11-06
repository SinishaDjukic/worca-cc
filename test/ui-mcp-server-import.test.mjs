// test/ui-mcp-server-import.test.mjs — Connectors › MCP servers › Import from other tools (ui/public/mcp-server-import.mjs,
// docs/mcp-servers.md "From the Servers view"): the list step (files, masked rows, pickable rule, cap, project re-scan,
// home note), the review step, Import with its digest, Review again after a 409, Back, the late-answer guards, and no
// secret in the DOM over the real server-side view.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { useTempHome } from './helpers/temp-home.mjs';
import { openMcpImport, pickable, targetText, IMPORT_MAX, IMPORT_HINT, HOME_NOTE } from '../ui/public/mcp-server-import.mjs';

useTempHome(after, 'worca-ui-mcp-import-');

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const click = (el) => el.dispatchEvent(new doc.defaultView.Event('click', { bubbles: true }));
const change = (el) => el.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
const type = (el, v) => { el.value = v; el.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true })); };
const tickBox = (row, on = true) => { const cb = row.querySelector('.mcp-imp-pick'); cb.checked = on; change(cb); };

const M = '••••';
const row = (over) => ({ id: 'cursor:user:x', tool: 'Cursor', scope: 'user', source: '~/.cursor/mcp.json', name: 'x', suggestedName: 'x',
  transport: 'stdio', command: 'x-mcp', args: [], hasSecrets: false, inWorca: false, importable: true, ...over });
const ROWS = [
  row({ id: 'cursor:user:files', name: 'files', suggestedName: 'files', command: '/opt/homebrew/bin/npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/me/My Documents', M] }),
  row({ id: 'cursor:user:openai', name: 'openai', suggestedName: 'openai', command: 'uvx', args: ['openai-mcp'], hasSecrets: true,
    env: { OPENAI_API_KEY: { value: M, secret: true }, GH: { value: M, secret: true, ref: 'GITHUB_TOKEN' }, LOG_LEVEL: { value: M, secret: false } },
    notes: ['env GH was the variable GITHUB_TOKEN: worca passes only MCP_ variables'] }),
  row({ id: 'cursor:user:docs', name: 'docs', suggestedName: 'docs', transport: 'http', command: undefined, args: undefined,
    url: 'https://docs.example.test/mcp', headers: { Authorization: { value: M, secret: true } }, hasSecrets: true, nameTaken: true }),
  row({ id: 'cursor:user:github', name: 'github', suggestedName: 'github', command: 'npx', inWorca: true, worcaName: 'github', importable: false }),
  row({ id: 'cursor:user:leaky', name: 'leaky', suggestedName: 'leaky', command: 'leak-mcp', args: ['--token', M], importable: false,
    problems: ['argument 2 looks like a secret — worca cannot keep a secret in an argument; pass it through env instead'] }),
  row({ id: 'claude-code:local@shop-1a2b3c4d:文書', tool: 'Claude Code', scope: 'local', project: 'shop-1a2b3c4d', source: '~/.claude.json',
    name: '文書', suggestedName: null, command: 'doc-mcp' }),
];
const FILES = [
  { tool: 'Cursor', source: '~/.cursor/mcp.json', status: 'ok', servers: 6 },
  { tool: 'Claude Code', source: '~/.claude.json', status: 'ok', servers: 1, truncated: true },
  { tool: 'Gemini CLI', source: '~/.gemini/settings.json', status: 'error', error: 'not valid JSON (line 3, column 25)' },
  { tool: 'Codex', source: '~/.codex/config.toml', status: 'missing' },
  { tool: 'VS Code', source: '~/.config/Code/User/mcp.json', status: 'missing' },
];
const DISC = { servers: ROWS, files: FILES, homeConfigs: true, project: null };
const REVIEW = { summary: 'Import 2 MCP servers: files, docs-2', names: ['files', 'docs-2'],
  changes: [{ op: 'add', label: 'files · From', after: 'Cursor · ~/.cursor/mcp.json' }, { op: 'add', label: 'files · Command', after: '/opt/homebrew/bin/npx' }],
  warnings: ['docs-2: Authorization is an empty secret field — the value in Cursor is not copied; paste it or pick an MCP_ variable on Connectors › MCP servers'],
  effects: ['Reaches no chat or run until it is in a set'], alreadyPresent: [{ id: 'cursor:user:github', name: 'github', from: 'Cursor · ~/.cursor/mcp.json' }], skipped: [] };
const D1 = 'a'.repeat(64); const D2 = 'b'.repeat(64);
const ok = (data) => ({ ok: true, status: 200, data });

/** `over`: per-key answers (a function gets the body); `shows`/`afterClose`: the app.js shell's optional hooks. */
function harness({ over = {}, shows = true, afterClose = false } = {}) {
  const calls = []; const done = []; const changed = [];
  const modal = { opened: null, hook: null, open(title, body, actions) { this.opened = { title, body, actions }; this.hook = null; },
    close() { this.opened = null; },
    ...(shows ? { shows(node) { return !!this.opened && this.opened.body.contains(node); } } : {}),
    ...(afterClose ? { afterClose(fn) { this.hook = fn; } } : {}) };
  const api = async (method, path, body) => {
    calls.push([method, path, body]);
    const key = `${method} ${path}`;
    if (Object.hasOwn(over, key)) return typeof over[key] === 'function' ? over[key](body) : over[key];
    if (key === 'GET /api/projects') return ok({ projects: [{ key: 'shop-1a2b3c4d', name: 'shop' }, { key: 'api-2b3c4d5e', name: 'api' }] });
    if (method === 'GET' && path.startsWith('/api/mcp/discover')) return ok(DISC);
    if (key === 'POST /api/mcp/import') return body.apply ? ok({ ok: true, names: ['files'], alreadyPresent: [], detail: 'Added files. It is in no set yet: turn it on in a set on Connectors › MCP servers' })
      : ok({ ok: true, digest: D1, review: REVIEW });
    return ok({});
  };
  openMcpImport({ api, modal, doc, onDone: (x) => { done.push(x); }, onChanged: () => { changed.push(1); } });
  return { modal, calls, done, changed, posts: () => calls.filter(([m, p]) => m === 'POST' && p === '/api/mcp/import').map(([, , b]) => b) };
}
const body = (m) => m.opened.body;
const act = (m, label) => m.opened.actions.find(([l]) => l === label)[2]();
const labels = (m) => m.opened.actions.map(([l]) => l);
const msgOf = (m) => body(m).querySelector('.form-msg');
const rowOf = (m, id) => body(m).querySelector(`.mcp-imp-row[data-id="${id}"]`);
const rowsOf = (m) => [...body(m).querySelectorAll('.mcp-imp-row')];

test('pure helpers: the pickable rule is discoveryView\'s importable; the target is the command line or the URL', () => {
  assert.equal(pickable({ importable: true }), true);
  for (const r of [{ importable: false }, {}, { importable: 'yes' }, null]) assert.equal(pickable(r), false);
  assert.equal(targetText(ROWS[0]), `/opt/homebrew/bin/npx -y @modelcontextprotocol/server-filesystem /Users/me/My Documents ${M}`);
  assert.equal(targetText(ROWS[2]), 'https://docs.example.test/mcp');
  assert.equal(targetText(row({ command: 'solo', args: [] })), 'solo');
  assert.equal(IMPORT_MAX, 10);
  assert.equal(IMPORT_HINT, 'Imported servers join no set: turn them on in a set on Connectors › MCP servers.');
  assert.equal(HOME_NOTE, 'This worca does not read the home-folder configs of the machine it runs on. Pick a project to scan its files.');
});

test('list rendering: files with their status, every row\'s source, name, transport, full target, masked values, flags, problems and notes', async () => {
  const m = harness();
  assert.equal(m.modal.opened.title, 'Import from other tools');
  await settle();
  const b = body(m.modal);
  assert.ok(b.classList.contains('mcp-imp'));
  assert.match(b.textContent, /Worca reads these files and changes nothing in them\. Values are never shown; secrets become empty secret fields you fill in\./);
  assert.deepEqual([...b.querySelectorAll('.mcp-imp-files li')].map((li) => [li.textContent, li.className]), [
    ['Cursor · ~/.cursor/mcp.json · 6 servers', ''],
    ['Claude Code · ~/.claude.json · 1 server · truncated', ''],
    ['Gemini CLI · ~/.gemini/settings.json · not valid JSON (line 3, column 25)', 'err'],
    ['2 other files not found', 'hint'],
  ]);
  assert.deepEqual(rowsOf(m.modal).map((r) => r.dataset.id), ROWS.map((r) => r.id));
  const files = rowOf(m.modal, 'cursor:user:files');
  assert.equal(files.querySelector('b.mono').textContent, 'files');
  assert.match(files.textContent, /Cursor · ~\/\.cursor\/mcp\.json/);
  assert.equal(files.querySelector('.badge').textContent, 'stdio');
  assert.equal(files.querySelector('code.mono.mcp-imp-target').textContent, `/opt/homebrew/bin/npx -y @modelcontextprotocol/server-filesystem /Users/me/My Documents ${M}`);
  const openai = rowOf(m.modal, 'cursor:user:openai');
  const dl = openai.querySelector('dl.mcp-imp-values');
  assert.deepEqual([...dl.querySelectorAll('dt')].map((x) => x.textContent), ['OPENAI_API_KEY', 'GH', 'LOG_LEVEL']);
  assert.deepEqual([...dl.querySelectorAll('dd')].map((x) => x.textContent), [`${M}secret`, `${M}secretfrom $GITHUB_TOKEN`, M]);
  assert.ok([...openai.querySelectorAll('.badge')].some((x) => x.textContent === 'has secrets'));
  assert.deepEqual([...openai.querySelectorAll('ul.hint:not(.err) li')].map((x) => x.textContent), [ROWS[1].notes[0]]);
  const docs = rowOf(m.modal, 'cursor:user:docs');
  assert.equal(docs.querySelector('.mcp-imp-target').textContent, 'https://docs.example.test/mcp');
  assert.equal(docs.querySelector('dl.mcp-imp-values dt').textContent, 'Authorization');
  assert.ok([...docs.querySelectorAll('.badge')].some((x) => x.textContent === 'name taken'));
  assert.ok([...rowOf(m.modal, 'cursor:user:github').querySelectorAll('.badge')].some((x) => x.textContent === 'Already in worca as github'));
  assert.deepEqual([...rowOf(m.modal, 'cursor:user:leaky').querySelectorAll('ul.hint.err li')].map((x) => x.textContent), [ROWS[4].problems[0]]);
  assert.match(rowOf(m.modal, ROWS[5].id).textContent, /Claude Code · ~\/\.claude\.json \(local to shop-1a2b3c4d\)/);
  assert.equal(b.querySelector('.mcp-imp-home-note'), null, 'no home note on a local worca');
  assert.equal(b.querySelector('.mcp-imp-empty'), null);
});

test('moreServers and the empty state', async () => {
  const more = harness({ over: { 'GET /api/mcp/discover': ok({ ...DISC, moreServers: 7 }) } });
  await settle();
  assert.ok([...body(more.modal).querySelectorAll('p.hint')].some((p) => p.textContent === '7 more servers not listed'));
  const none = harness({ over: { 'GET /api/mcp/discover': ok({ servers: [], files: [], homeConfigs: true, project: null }) } });
  await settle();
  assert.equal(body(none.modal).querySelector('.mcp-imp-empty').textContent, 'No MCP servers found in other tools\' files.');
  assert.equal(rowsOf(none.modal).length, 0);
});

test('pickable rule: in-worca and problem rows are disabled; a taken name and a nameless row can be picked; the name input follows the tick', async () => {
  const m = harness();
  await settle();
  const dis = (id) => rowOf(m.modal, id).querySelector('.mcp-imp-pick').disabled;
  assert.deepEqual(ROWS.map((r) => dis(r.id)), [false, false, false, true, true, false]);
  const docs = rowOf(m.modal, 'cursor:user:docs');
  const name = docs.querySelector('input.mcp-imp-name');
  assert.deepEqual([name.value, name.disabled, name.maxLength], ['docs', true, 20]);
  assert.equal(rowOf(m.modal, ROWS[5].id).querySelector('input.mcp-imp-name').value, '', 'no suggestion: an empty name to type');
  tickBox(docs);
  assert.equal(name.disabled, false);
  tickBox(docs, false);
  assert.equal(name.disabled, true);
});

test('cap: with 10 picked every other checkbox is disabled and a hint names the cap', async () => {
  const many = Array.from({ length: 12 }, (_, i) => row({ id: `cursor:user:s${i}`, name: `s${i}`, suggestedName: `s${i}` }));
  const m = harness({ over: { 'GET /api/mcp/discover': ok({ servers: many, files: [], homeConfigs: true, project: null }) } });
  await settle();
  const rows = rowsOf(m.modal);
  assert.equal(body(m.modal).querySelector('.mcp-imp-cap').hidden, true);
  for (const r of rows.slice(0, 10)) tickBox(r);
  assert.deepEqual(rows.map((r) => r.querySelector('.mcp-imp-pick').disabled), [...Array(10).fill(false), true, true]);
  const cap = body(m.modal).querySelector('.mcp-imp-cap');
  assert.equal(cap.hidden, false);
  assert.match(cap.textContent, /10/);
  tickBox(rows[10]);   // a change event on the disabled 11th box (a plain Event fires on it): still not picked
  assert.equal(rows[10].querySelector('.mcp-imp-pick').checked, false);
  await act(m.modal, 'Review');
  await settle();
  assert.equal(m.posts()[0].servers.length, 10);
  await act(m.modal, 'Back');
  tickBox(rowsOf(m.modal)[0], false);
  assert.equal(rowsOf(m.modal)[11].querySelector('.mcp-imp-pick').disabled, false);
  assert.equal(body(m.modal).querySelector('.mcp-imp-cap').hidden, true);
});

test('project change: the select re-scans with ?project= and clears the picks; a slower earlier answer does not paint', async () => {
  let release;
  const slow = new Promise((r) => { release = r; });
  const projRows = [row({ id: 'claude-code:project@shop-1a2b3c4d:p', tool: 'Claude Code', scope: 'project', name: 'p', suggestedName: 'p' })];
  const m = harness({ over: {
    'GET /api/mcp/discover?project=shop-1a2b3c4d': () => slow.then(() => ok({ ...DISC, servers: projRows, project: { key: 'shop-1a2b3c4d', name: 'shop' } })),
    'GET /api/mcp/discover?project=api-2b3c4d5e': ok({ ...DISC, servers: [row({ id: 'vscode:project@api-2b3c4d5e:q', name: 'q', suggestedName: 'q' })] }),
  } });
  await settle();
  const sel = body(m.modal).querySelector('select.mcp-imp-project');
  assert.deepEqual([...sel.options].map((o) => [o.value, o.textContent]), [['', 'No project'], ['shop-1a2b3c4d', 'shop'], ['api-2b3c4d5e', 'api']]);
  tickBox(rowOf(m.modal, 'cursor:user:files'));
  sel.value = 'shop-1a2b3c4d'; change(sel);
  await settle();
  sel.value = 'api-2b3c4d5e'; change(sel);
  await settle();
  assert.deepEqual(rowsOf(m.modal).map((r) => r.dataset.id), ['vscode:project@api-2b3c4d5e:q']);
  release();
  await settle();
  assert.deepEqual(rowsOf(m.modal).map((r) => r.dataset.id), ['vscode:project@api-2b3c4d5e:q'], 'the slower shop answer never paints');
  assert.deepEqual(m.calls.filter(([, p]) => p.startsWith('/api/mcp/discover')).map(([, p]) => p),
    ['/api/mcp/discover', '/api/mcp/discover?project=shop-1a2b3c4d', '/api/mcp/discover?project=api-2b3c4d5e']);
  sel.value = ''; change(sel);
  await settle();
  assert.equal(m.calls.at(-1)[1], '/api/mcp/discover', 'No project: no query');
  await act(m.modal, 'Review');
  assert.equal(msgOf(m.modal).textContent, 'Pick at least one server', 'the project change cleared the earlier pick');
});

test('home note: only when the server reads no home configs', async () => {
  const m = harness({ over: { 'GET /api/mcp/discover': ok({ ...DISC, homeConfigs: false, servers: [] }) } });
  await settle();
  assert.equal(body(m.modal).querySelector('p.hint.mcp-imp-home-note').textContent, HOME_NOTE);
});

test('Review: no picks → a message and no POST; picks POST exactly { projectKey, servers }; the review step renders the card', async () => {
  const m = harness();
  await settle();
  await act(m.modal, 'Review');
  assert.equal(msgOf(m.modal).textContent, 'Pick at least one server');
  assert.deepEqual(m.posts(), []);
  tickBox(rowOf(m.modal, 'cursor:user:files'));
  const docs = rowOf(m.modal, 'cursor:user:docs');
  tickBox(docs);
  type(docs.querySelector('.mcp-imp-name'), '  docs-2 ');
  await act(m.modal, 'Review');
  await settle();
  assert.deepEqual(m.posts(), [{ projectKey: null, servers: [{ id: 'cursor:user:files', as: 'files' }, { id: 'cursor:user:docs', as: 'docs-2' }] }]);
  assert.equal(m.modal.opened.title, 'Import · review');
  const b = body(m.modal);
  assert.equal(b.querySelector('p').textContent, REVIEW.summary);
  assert.deepEqual([...b.querySelectorAll('table.mcp-imp-changes tr')].map((tr) => [...tr.children].map((c) => c.textContent)),
    REVIEW.changes.map((c) => [c.label, c.after]));
  assert.deepEqual([...b.querySelectorAll('ul.mcp-imp-warn li')].map((x) => x.textContent), REVIEW.warnings);
  assert.deepEqual([...b.querySelectorAll('ul.hint.mcp-imp-effects li')].map((x) => x.textContent), REVIEW.effects);
  assert.equal(b.querySelector('.mcp-imp-present').textContent, 'Already in worca, not added again: github (Cursor · ~/.cursor/mcp.json)');
  assert.ok([...b.querySelectorAll('p.hint')].some((p) => p.textContent === IMPORT_HINT));
  assert.deepEqual(labels(m.modal), ['Back', 'Cancel', 'Import']);
});

test('Review: a 400 stays on the list with the error; nothing to import names the present servers', async () => {
  const m = harness({ over: { 'POST /api/mcp/import': { ok: false, status: 400, data: { error: 'nothing to import: every picked server is already in worca or cannot be imported',
    code: 'NOTHING_TO_IMPORT', errors: [], alreadyPresent: [{ id: 'cursor:user:files', name: 'files', from: 'Cursor · ~/.cursor/mcp.json' }], skipped: [] } } } });
  await settle();
  tickBox(rowOf(m.modal, 'cursor:user:files'));
  await act(m.modal, 'Review');
  await settle();
  assert.equal(m.modal.opened.title, 'Import from other tools');
  assert.match(msgOf(m.modal).textContent, /^nothing to import: .*files/);
  assert.equal(rowOf(m.modal, 'cursor:user:files').querySelector('.mcp-imp-pick').checked, true, 'the picks stay');
});

test('Import: the body adds apply and the digest; a double click sends one POST; success closes and hands detail to onDone', async () => {
  let release;
  const hold = new Promise((r) => { release = r; });
  const m = harness({ over: { 'POST /api/mcp/import': (b) => (b.apply ? hold.then(() => ok({ ok: true, names: ['files'], alreadyPresent: [], detail: 'Added files.' }))
    : ok({ ok: true, digest: D1, review: REVIEW })) } });
  await settle();
  tickBox(rowOf(m.modal, 'cursor:user:files'));
  await act(m.modal, 'Review');
  await settle();
  const first = act(m.modal, 'Import');
  const second = act(m.modal, 'Import');
  release();
  await Promise.all([first, second]);
  await settle();
  assert.deepEqual(m.posts().slice(1), [{ projectKey: null, servers: [{ id: 'cursor:user:files', as: 'files' }], apply: true, digest: D1 }]);
  assert.equal(m.modal.opened, null);
  assert.deepEqual(m.done, [{ detail: 'Added files.', names: ['files'] }]);
});

test('Import: a 409 IMPORT_CHANGED offers Review again, which re-previews and the next Import sends the NEW digest', async () => {
  let applies = 0; let previews = 0;
  const m = harness({ over: { 'POST /api/mcp/import': (b) => {
    if (!b.apply) { previews += 1; return ok({ ok: true, digest: previews === 1 ? D1 : D2, review: REVIEW }); }
    applies += 1;
    return applies === 1 ? { ok: false, status: 409, data: { error: 'the other tools’ files or worca’s servers changed since the review — review the import again', code: 'IMPORT_CHANGED' } }
      : ok({ ok: true, names: ['files'], alreadyPresent: [], detail: 'Added files.' });
  } } });
  await settle();
  tickBox(rowOf(m.modal, 'cursor:user:files'));
  await act(m.modal, 'Review');
  await settle();
  await act(m.modal, 'Import');
  await settle();
  assert.match(msgOf(m.modal).textContent, /changed since the review/);
  assert.deepEqual(labels(m.modal), ['Back', 'Cancel', 'Review again']);
  await act(m.modal, 'Review again');
  await settle();
  assert.deepEqual(m.posts()[2], { projectKey: null, servers: [{ id: 'cursor:user:files', as: 'files' }] }, 'Review again previews (no apply)');
  assert.deepEqual(labels(m.modal), ['Back', 'Cancel', 'Import']);
  await act(m.modal, 'Import');
  await settle();
  assert.equal(m.posts()[3].digest, D2);
  assert.deepEqual(m.done.map((d) => d.detail), ['Added files.']);
});

test('Import failures: a 500 (or a partial "Added …") calls onChanged; a 400 does not', async () => {
  for (const [answer, calls] of [
    [{ ok: false, status: 500, data: { error: 'Added files, then could not add docs-2: disk full', code: 'ERROR' } }, 1],
    [{ ok: false, status: 409, data: { error: 'Added files, then could not add docs-2: the name "docs-2" is taken — choose another', code: 'STORE' } }, 1],
    [{ ok: false, status: 400, data: { error: 'the name "files" is taken — choose another', code: 'IMPORT_INVALID' } }, 0],
  ]) {
    const m = harness({ over: { 'POST /api/mcp/import': (b) => (b.apply ? answer : ok({ ok: true, digest: D1, review: REVIEW })) } });
    await settle();
    tickBox(rowOf(m.modal, 'cursor:user:files'));
    await act(m.modal, 'Review');
    await settle();
    await act(m.modal, 'Import');
    await settle();
    assert.equal(msgOf(m.modal).textContent, answer.data.error);
    assert.equal(m.changed.length, calls, answer.data.error);
    assert.deepEqual(m.done, []);
    assert.equal(m.modal.opened.title, 'Import · review');
  }
});

test('Back keeps the picks and the typed names, with no new scan', async () => {
  const m = harness();
  await settle();
  const docs = rowOf(m.modal, 'cursor:user:docs');
  tickBox(docs);
  type(docs.querySelector('.mcp-imp-name'), 'docs-2');
  await act(m.modal, 'Review');
  await settle();
  const scans = m.calls.filter(([, p]) => p.startsWith('/api/mcp/discover')).length;
  await act(m.modal, 'Back');
  await settle();
  assert.equal(m.modal.opened.title, 'Import from other tools');
  const again = rowOf(m.modal, 'cursor:user:docs');
  assert.equal(again.querySelector('.mcp-imp-pick').checked, true);
  assert.deepEqual([again.querySelector('.mcp-imp-name').value, again.querySelector('.mcp-imp-name').disabled], ['docs-2', false]);
  assert.equal(m.calls.filter(([, p]) => p.startsWith('/api/mcp/discover')).length, scans);
});

test('Cancel or Close before an answer lands: nothing opens, nothing is handed on', async () => {
  // Cancel before the scan lands (a modal without shows: closed alone must hold it).
  let release;
  const hold = new Promise((r) => { release = r; });
  const m = harness({ shows: false, over: { 'GET /api/mcp/discover': () => hold.then(() => ok(DISC)) } });
  await act(m.modal, 'Cancel');
  release();
  await settle();
  assert.equal(m.modal.opened, null, 'a late scan reopens nothing');

  // The dialog's own Close (afterClose) on the review step, then a pending Import answer lands.
  let releaseApply;
  const holdApply = new Promise((r) => { releaseApply = r; });
  const c = harness({ afterClose: true, shows: false, over: { 'POST /api/mcp/import': (b) => (b.apply ? holdApply.then(() => ok({ ok: true, names: ['files'], alreadyPresent: [], detail: 'Added files.' }))
    : ok({ ok: true, digest: D1, review: REVIEW })) } });
  await settle();
  assert.equal(typeof c.modal.hook, 'function', 'the list step registers its Close');
  tickBox(rowOf(c.modal, 'cursor:user:files'));
  await act(c.modal, 'Review');
  await settle();
  assert.equal(typeof c.modal.hook, 'function', 'the review step registers its Close again after its open');
  const pending = act(c.modal, 'Import');
  const hook = c.modal.hook;
  c.modal.close();
  hook();
  releaseApply();
  await pending;
  await settle();
  assert.equal(c.modal.opened, null);
  assert.deepEqual(c.done, []);
  assert.equal(c.changed.length, 1, 'a write that lands after Close still reloads the Servers list');

  // Closed while an Import is in flight that then fails with a 400: nothing was written, so no reload.
  let releaseBad;
  const holdBad = new Promise((r) => { releaseBad = r; });
  const e = harness({ over: { 'POST /api/mcp/import': (b) => (b.apply ? holdBad.then(() => ({ ok: false, status: 400, data: { error: 'the name "files" is taken — choose another', code: 'IMPORT_INVALID' } }))
    : ok({ ok: true, digest: D1, review: REVIEW })) } });
  await settle();
  tickBox(rowOf(e.modal, 'cursor:user:files'));
  await act(e.modal, 'Review');
  await settle();
  const pendingBad = act(e.modal, 'Import');
  e.modal.close();
  releaseBad();
  await pendingBad;
  await settle();
  assert.deepEqual([e.modal.opened, e.done, e.changed.length], [null, [], 0]);

  // Close on the list step while a review is in flight: the late review opens nothing.
  let releasePre;
  const holdPre = new Promise((r) => { releasePre = r; });
  const d = harness({ afterClose: true, over: { 'POST /api/mcp/import': () => holdPre.then(() => ok({ ok: true, digest: D1, review: REVIEW })) } });
  await settle();
  tickBox(rowOf(d.modal, 'cursor:user:files'));
  const pre = act(d.modal, 'Review');
  const listHook = d.modal.hook;
  d.modal.close();
  listHook();
  releasePre();
  await pre;
  await settle();
  assert.equal(d.modal.opened, null);
});

test('no secret in the DOM: the real discovery view and review over a fixture home with secrets', async () => {
  const SECRET = 'sk-live-123';
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'worca-ui-mcp-import-home-')));
  try {
    mkdirSync(join(home, '.cursor'), { recursive: true });
    writeFileSync(join(home, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: {
      openai: { command: 'uvx', args: ['openai-mcp'], env: { OPENAI_API_KEY: SECRET, LOG_LEVEL: 'debug' } },
      github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' } },
      pg: { command: 'pg-mcp', args: ['--dsn', 'postgres://app:hunter2@db.test/shop'], env: { DATABASE_URL: 'postgres://app:hunter2@db.test/shop' } },
      upstream: { url: 'https://up.example.test/mcp', headers: { 'X-Upstream': 'Bearer hunter9' } },
    } }));
    const { discoverForSettings, previewMcpImport } = await import('../src/core/ask/mcp-deps.mjs');
    const { discoverMcpConfigs } = await import('../src/core/mcp/discover.mjs');
    const io = { env: {}, discover: (o) => discoverMcpConfigs({ ...o, home, platform: 'linux', env: {} }) };
    const view = { ...(await discoverForSettings({}, io)), project: null };
    const m = harness({ over: {
      'GET /api/mcp/discover': ok(view),
      'POST /api/mcp/import': async (b) => { const r = await previewMcpImport({ servers: b.servers }, io); return r.ok ? ok({ ok: true, digest: r.digest, review: r.review }) : { ok: false, status: 400, data: r }; },
    } });
    await settle();
    for (const r of rowsOf(m.modal)) if (!r.querySelector('.mcp-imp-pick').disabled) tickBox(r);
    const leaks = (where) => {
      const html = doc.body.outerHTML + body(m.modal).outerHTML + [...body(m.modal).querySelectorAll('input')].map((i) => i.value).join('\n');
      for (const v of [SECRET, 'hunter2', 'hunter9']) assert.equal(html.includes(v), false, `${v} in the ${where} step`);
    };
    leaks('list');
    await act(m.modal, 'Review');
    await settle();
    assert.equal(m.modal.opened.title, 'Import · review', msgOf(m.modal)?.textContent);
    leaks('review');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('source scan: no quoted string ending in the word that names a module load', () => {
  const src = readFileSync(new URL('../ui/public/mcp-server-import.mjs', import.meta.url), 'utf8');
  assert.equal(/\bimport\s*\(?\s*['"]/.test(src), false);
  assert.equal(/innerHTML/.test(src), false, 'text goes in with textContent only');
});
