// test/ui-skill-import.test.mjs — the Import skill modal (skills registry spec §6.4, §5, §2b-8): the four sources and the
// source each builds (Paste's Name optional), Browse, a git repository's skill folders offered as a pick, the preview step
// (the name from SKILL.md, read-only; file tree with sizes and flags; summary, limits; the consent with its shell-block and
// hooks lines), Import, Back/Cancel discarding the stage, refusals in the modal, problems blocking Import, the hosted
// sources; and the Skills view's Import skill button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  openSkillImport, inspectionSummary, fileTree, SKILL_CONSENT, SKILL_SHELL_NOTE, SKILL_LIMITS_TEXT,
} from '../ui/public/skill-import.mjs';
import { SKILL_HOOKS_TEXT } from '../src/core/skills-registry/texts.mjs';
import { createMcpView } from '../ui/public/mcp-view.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const click = (el) => el.dispatchEvent(new doc.defaultView.Event('click', { bubbles: true }));
const type = (el, v) => { el.value = v; el.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true })); };

const INS = {
  name: 'db-migrations', description: 'Write, review and apply SQL migrations', whenToUse: null,
  frontmatter: { allowedTools: null, hooks: false, shell: true, disableModelInvocation: false, pluginRootRefs: true },
  files: [{ path: 'SKILL.md', bytes: 3482, executable: false }, { path: 'references/example.env', bytes: 205, executable: false },
    { path: 'references/setup.md', bytes: 921, executable: false }, { path: 'scripts/apply.sh', bytes: 600, executable: true },
    { path: 'scripts/plan.py', bytes: 1229, executable: true }],
  bytes: 6437, scripts: ['scripts/apply.sh', 'scripts/plan.py'], shellBlocks: 1, hash: 'h', problems: [],
  findings: [{ path: 'SKILL.md', kind: 'shell-block', text: '!`git status`' }, { path: 'scripts/apply.sh', kind: 'executable', text: 'executable' },
    { path: 'scripts/plan.py', kind: 'executable', text: 'executable' }, { path: 'references/setup.md', kind: 'plugin-root-ref', text: '${CLAUDE_PLUGIN_ROOT}/lib' },
    { path: 'references/example.env', kind: 'token', text: 'text shaped like an API token' },
    { path: 'references/example.env', kind: 'token', text: 'text shaped like an API token' }],
};
// An escaping symlink is a problem as well as a finding: never copied, and Import is blocked.
const LINKED = { ...INS, problems: ['references/schema.sql: a link that leaves the skill folder'],
  findings: [...INS.findings, { path: 'references/schema.sql', kind: 'symlink', text: '→ ../../db/schema.sql leaves the folder' }] };
const STAGE = '0123456789abcdef';

// `shows`: the fake modal answers app.js's `shows(node)` (is this node in the open dialog?), as the real shell does.
function harness({ over = {}, home = [{ name: 'graphify', description: 'Any input to a knowledge graph' }], folderImports, shows = false } = {}) {
  const calls = [];
  const done = [];
  const modal = { opened: null, open(title, body, actions) { this.opened = { title, body, actions }; }, close() { this.opened = null; },
    ...(shows ? { shows(node) { return !!this.opened && this.opened.body.contains(node); } } : {}) };
  const api = async (method, path, body) => {
    calls.push([method, path, body]);
    const key = `${method} ${path}`;
    if (Object.hasOwn(over, key)) return typeof over[key] === 'function' ? over[key](body) : over[key];
    if (key === 'POST /api/fs/pick-folder') return { ok: true, status: 200, data: { status: 'picked', path: '/Users/me/havn/.claude/skills/db-migrations' } };
    if (key === 'POST /api/skills/import/preview') return { ok: true, status: 200, data: { stage: STAGE, name: 'db-migrations', inspection: INS } };
    if (key === 'POST /api/skills/import') return { ok: true, status: 200, data: { ok: true, id: `skill:library:${body.name}` } };
    if (key === 'GET /api/skills/home') return { ok: true, status: 200, data: { skills: home } };
    return { ok: true, status: 200, data: { ok: true } };
  };
  openSkillImport({ api, modal, doc, onDone: (x) => { done.push(x); }, ...(folderImports === undefined ? {} : { folderImports }) });
  return { modal, calls, done, posts: () => calls.filter(([m]) => m !== 'GET') };
}
const body = (m) => m.opened.body;
const act = (m, label) => m.opened.actions.find(([l]) => l === label)[2]();
const msgOf = (m) => body(m).querySelector('.form-msg');
const sourceSent = (m) => m.calls.filter(([, p]) => p === '/api/skills/import/preview').at(-1)?.[2];

test('Folder: Browse fills the path, Preview stages { kind: dir }; the preview shows the read-only name, tree, flags, summary, limits and consent', async () => {
  const m = harness();
  assert.equal(m.modal.opened.title, 'Import skill');
  assert.deepEqual([...body(m.modal).querySelectorAll('[data-imp-src]')].map((b) => [b.textContent, b.getAttribute('aria-pressed')]),
    [['Folder', 'true'], ['Git URL', 'false'], ['Paste', 'false'], ['From your Claude Code skills', 'false']]);
  click(body(m.modal).querySelector('[data-imp-browse]'));
  await settle();
  assert.equal(body(m.modal).querySelector('[data-imp="path"]').value, '/Users/me/havn/.claude/skills/db-migrations');
  await act(m.modal, 'Preview');
  await settle();
  assert.deepEqual(sourceSent(m), { source: { kind: 'dir', path: '/Users/me/havn/.claude/skills/db-migrations' } });
  assert.equal(m.modal.opened.title, 'Import skill · db-migrations');
  const b = body(m.modal);
  const name = b.querySelector('[data-imp="name"]');
  assert.deepEqual([name.value, name.readOnly], ['db-migrations', true], 'the library takes SKILL.md\'s name: shown, not edited');
  assert.equal(b.querySelector('.sk-name-note').textContent,
    'From SKILL.md’s name (or the folder’s, when SKILL.md has none). To change it, edit the name: line and preview again.');
  assert.equal(b.querySelector('.sk-home-note'), null);
  const rows = [...b.querySelectorAll('.sk-tree-row')].map((r) => [r.querySelector('.mono').textContent,
    [...r.querySelectorAll('.sk-flag')].map((f) => `${f.classList.contains('red') ? 'red' : 'amber'}:${f.textContent}`), r.querySelector('.sz').textContent]);
  assert.deepEqual(rows, [
    ['SKILL.md', ['amber:shell block'], '3.4 kB'],
    ['references/example.env', ['red:token-shaped text'], '0.2 kB'],
    ['references/setup.md', ['amber:plugin-root ref · ${CLAUDE_PLUGIN_ROOT}'], '0.9 kB'],
    ['scripts/apply.sh', ['amber:executable'], '0.6 kB'],
    ['scripts/plan.py', ['amber:executable'], '1.2 kB'],
  ]);
  assert.equal(b.querySelector('.sk-summary').textContent, '5 files · 6.3 kB · 2 scripts · 1 shell block · 2 token-shaped strings · 1 plugin-root ref');
  assert.ok([...b.querySelectorAll('small.hint')].some((s) => s.textContent === SKILL_LIMITS_TEXT));
  const consent = b.querySelector('.sk-consent');
  assert.equal(consent.querySelector('b').textContent, SKILL_CONSENT);
  assert.deepEqual([...consent.querySelectorAll('.sk-consent-note')].map((p) => p.textContent), [SKILL_SHELL_NOTE], 'a skill with shell blocks says what they do');
  assert.equal(SKILL_CONSENT, 'Worca copies these files into its library. Agents may read them and run the scripts where their guardrails allow.');
  assert.equal(SKILL_SHELL_NOTE, 'Its inline shell blocks (!`cmd`) run in pipeline runs without guardrail checks; Ask Worca never runs them.');
  await act(m.modal, 'Import');
  await settle();
  assert.deepEqual(m.calls.find(([, p]) => p === '/api/skills/import')[2], { stage: STAGE, name: 'db-migrations' });
  assert.equal(m.modal.opened, null, 'Import closes the modal');
  assert.deepEqual(m.done, [{ id: 'skill:library:db-migrations', name: 'db-migrations' }]);
  assert.equal(m.calls.filter(([meth]) => meth === 'DELETE').length, 0, 'a committed stage is not discarded');
});

test('a skill that declares hooks: the library\'s hooks finding becomes a red badge, a flagged SKILL.md row and the consent line', async () => {
  const hooked = { ...INS, shellBlocks: 0, findings: [{ path: 'SKILL.md', kind: 'hooks', text: SKILL_HOOKS_TEXT }],
    frontmatter: { ...INS.frontmatter, hooks: true } };
  const m = harness({ over: { 'POST /api/skills/import/preview': { ok: true, status: 200, data: { stage: STAGE, name: 'db-migrations', inspection: hooked } } } });
  type(body(m.modal).querySelector('[data-imp="path"]'), '/src/db-migrations');
  await act(m.modal, 'Preview');
  assert.equal(body(m.modal).querySelector('.pl-head .badge.red').textContent, 'declares hooks');
  assert.deepEqual([...body(m.modal).querySelectorAll('.sk-consent-note')].map((p) => [p.textContent, p.classList.contains('err')]),
    [["This skill declares hooks — they run shell commands outside Worca's guardrails when the skill is used.", true]]);
  const row = [...body(m.modal).querySelectorAll('.sk-tree-row')].find((r) => r.querySelector('.mono').textContent === 'SKILL.md');
  assert.deepEqual([...row.querySelectorAll('.sk-flag')].map((f) => [f.textContent, f.title]), [['declares hooks', SKILL_HOOKS_TEXT]]);
  const plain = harness({ over: { 'POST /api/skills/import/preview': { ok: true, status: 200, data: { stage: STAGE, name: 'x', inspection: { ...INS, shellBlocks: 0 } } } } });
  type(body(plain.modal).querySelector('[data-imp="path"]'), '/src/x');
  await act(plain.modal, 'Preview');
  assert.equal(body(plain.modal).querySelector('.pl-head .badge.red'), null);
  assert.equal(body(plain.modal).querySelectorAll('.sk-consent-note').length, 0);
});

test('Git URL, Paste and your Claude Code skills build their sources; Paste\'s Name is optional; what is missing is said and nothing is posted', async () => {
  const m = harness();
  click(body(m.modal).querySelector('[data-imp-src="git"]'));
  await act(m.modal, 'Preview');
  assert.equal(msgOf(m.modal).textContent, 'type the repository URL');
  assert.equal(sourceSent(m), undefined);
  type(body(m.modal).querySelector('[data-imp="url"]'), ' https://github.com/havn/skills ');
  type(body(m.modal).querySelector('[data-imp="subdir"]'), 'release-notes');
  await act(m.modal, 'Preview');
  assert.deepEqual(sourceSent(m), { source: { kind: 'git', url: 'https://github.com/havn/skills', subdir: 'release-notes' } }, 'an empty ref is left out');
  const p = harness();
  click(body(p.modal).querySelector('[data-imp-src="paste"]'));
  assert.equal(body(p.modal).querySelector('[data-imp="pname"]').placeholder, 'used when the SKILL.md has no name');
  await act(p.modal, 'Preview');
  assert.equal(msgOf(p.modal).textContent, 'paste the SKILL.md');
  const md = '---\nname: frontend-design\ndescription: UI\n---\nBe bold.\n';
  type(body(p.modal).querySelector('[data-imp="content"]'), md);
  await act(p.modal, 'Preview');
  assert.deepEqual(sourceSent(p), { source: { kind: 'paste', content: md } }, 'no Name: the SKILL.md names the skill');
  const p2 = harness();
  click(body(p2.modal).querySelector('[data-imp-src="paste"]'));
  type(body(p2.modal).querySelector('[data-imp="pname"]'), ' notes ');
  // A SKILL.md with frontmatter but no name: (P1 refuses one with no frontmatter at all, so the Name never rescues that).
  type(body(p2.modal).querySelector('[data-imp="content"]'), '---\ndescription: Notes\n---\nPlain instructions.\n');
  await act(p2.modal, 'Preview');
  assert.deepEqual(sourceSent(p2), { source: { kind: 'paste', content: '---\ndescription: Notes\n---\nPlain instructions.\n', name: 'notes' } });
  const hm = harness();
  click(body(hm.modal).querySelector('[data-imp-src="home"]'));
  await settle();
  await act(hm.modal, 'Preview');
  assert.equal(msgOf(hm.modal).textContent, 'pick one of your Claude Code skills');
  const radio = body(hm.modal).querySelector('input[name="sk-home"][value="graphify"]');
  assert.match(radio.closest('.sk-pick-row').textContent, /graphify.*knowledge graph/);
  radio.checked = true;
  radio.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  await act(hm.modal, 'Preview');
  assert.deepEqual(sourceSent(hm), { source: { kind: 'home', name: 'graphify' } });
  assert.equal(body(hm.modal).querySelector('.sk-home-note').textContent,
    'Your personal /db-migrations keeps loading in pipelines; agents call this copy /<set>:db-migrations, and it changes only when you Check for updates.');
  const none = harness({ home: [] });
  click(body(none.modal).querySelector('[data-imp-src="home"]'));
  await settle();
  assert.match(body(none.modal).textContent, /No skills in ~\/\.claude\/skills\./);
  const nod = harness({ over: { 'POST /api/fs/pick-folder': { ok: true, status: 200, data: { status: 'unsupported' } } } });
  click(body(nod.modal).querySelector('[data-imp-browse]'));
  await settle();
  assert.equal(msgOf(nod.modal).textContent, 'No folder dialog here: type the path.');
  await act(nod.modal, 'Preview');
  assert.equal(msgOf(nod.modal).textContent, 'type or browse to the folder that holds SKILL.md');
});

test('a git repository holding several skills: its folders are offered as a pick, and the pick previews again', async () => {
  const error = "pick the skill's folder in https://github.com/havn/skills at 4c1e9a7: skills/db-migrations, skills/release-notes";
  const m = harness({ over: { 'POST /api/skills/import/preview': (b) => (b.source.subdir
    ? { ok: true, status: 200, data: { stage: STAGE, name: 'release-notes', inspection: { ...INS, name: 'release-notes' } } }
    : { ok: false, status: 400, data: { error, candidates: ['skills/db-migrations', 'skills/release-notes'] } }) } });
  click(body(m.modal).querySelector('[data-imp-src="git"]'));
  type(body(m.modal).querySelector('[data-imp="url"]'), 'https://github.com/havn/skills');
  await act(m.modal, 'Preview');
  assert.equal(m.modal.opened.title, 'Import skill');
  assert.equal(msgOf(m.modal).textContent, error);
  const sel = body(m.modal).querySelector('[data-imp-candidate]');
  assert.deepEqual([...sel.options].map((o) => o.value), ['', 'skills/db-migrations', 'skills/release-notes']);
  assert.equal(body(m.modal).querySelector('[data-imp="url"]').value, 'https://github.com/havn/skills', 'what was typed is kept');
  sel.value = 'skills/release-notes';
  sel.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  await settle();
  assert.deepEqual(sourceSent(m), { source: { kind: 'git', url: 'https://github.com/havn/skills', subdir: 'skills/release-notes' } });
  assert.equal(m.modal.opened.title, 'Import skill · release-notes');
});

test('a wrong folder in a repository whose root holds a SKILL.md: "the repository root" is offered, and picking it previews without a folder', async () => {
  const m = harness({ over: { 'POST /api/skills/import/preview': (b) => (b.source.subdir === 'nope'
    ? { ok: false, status: 400, data: { error: 'no SKILL.md in folder "nope" of https://github.com/havn/skills at 4c1e9a7', candidates: ['', 'skills/release-notes'] } }
    : { ok: true, status: 200, data: { stage: STAGE, name: 'skills', inspection: { ...INS, name: 'skills' } } }) } });
  click(body(m.modal).querySelector('[data-imp-src="git"]'));
  type(body(m.modal).querySelector('[data-imp="url"]'), 'https://github.com/havn/skills');
  type(body(m.modal).querySelector('[data-imp="subdir"]'), 'nope');
  await act(m.modal, 'Preview');
  const sel = body(m.modal).querySelector('[data-imp-candidate]');
  assert.deepEqual([...sel.options].map((o) => [o.value, o.textContent]),
    [['', 'Pick the skill’s folder…'], ['/', 'the repository root'], ['skills/release-notes', 'skills/release-notes']]);
  sel.value = '/';
  sel.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  await settle();
  assert.deepEqual(sourceSent(m), { source: { kind: 'git', url: 'https://github.com/havn/skills' } });
  assert.equal(m.modal.opened.title, 'Import skill · skills');
});

test('Back and Cancel discard the stage; refusals show in the modal (a taken name says what to do); problems block Import', async () => {
  const m = harness();
  type(body(m.modal).querySelector('[data-imp="path"]'), '/src/db-migrations');
  await act(m.modal, 'Preview');
  await act(m.modal, 'Back');
  assert.deepEqual(m.calls.at(-1), ['DELETE', `/api/skills/import/${STAGE}`, undefined]);
  assert.equal(m.modal.opened.title, 'Import skill');
  assert.equal(body(m.modal).querySelector('[data-imp="path"]').value, '/src/db-migrations', 'Back keeps what was typed');
  await act(m.modal, 'Preview');
  await act(m.modal, 'Cancel');
  assert.equal(m.modal.opened, null);
  assert.equal(m.calls.filter(([meth]) => meth === 'DELETE').length, 2);
  const refused = harness({ over: { 'POST /api/skills/import/preview': { ok: false, status: 400, data: { error: 'folder not found' } } } });
  type(body(refused.modal).querySelector('[data-imp="path"]'), '/nope');
  await act(refused.modal, 'Preview');
  assert.equal(msgOf(refused.modal).textContent, 'folder not found');
  assert.ok(msgOf(refused.modal).classList.contains('err'));
  const taken = harness({ over: { 'POST /api/skills/import': { ok: false, status: 409, data: { error: 'a skill named db-migrations is already in the library' } } } });
  type(body(taken.modal).querySelector('[data-imp="path"]'), '/src/db-migrations');
  await act(taken.modal, 'Preview');
  await act(taken.modal, 'Import');
  assert.equal(msgOf(taken.modal).textContent, 'a skill named db-migrations is already in the library — remove the existing one in Connectors › Skills first, or change the name in its SKILL.md.');
  assert.ok(taken.modal.opened);
  assert.deepEqual(taken.done, []);
  const damaged = harness({ over: { 'POST /api/skills/import': { ok: false, status: 409,
    data: { error: 'the skill library file skills/library.json is damaged — fix it or remove it' } } } });
  type(body(damaged.modal).querySelector('[data-imp="path"]'), '/src/db-migrations');
  await act(damaged.modal, 'Preview');
  await act(damaged.modal, 'Import');
  assert.equal(msgOf(damaged.modal).textContent, 'the skill library file skills/library.json is damaged — fix it or remove it',
    'the name advice only for a taken name');
  const bad = harness({ over: { 'POST /api/skills/import/preview': { ok: true, status: 200, data: { stage: STAGE, name: 'db-migrations', inspection: LINKED } } } });
  type(body(bad.modal).querySelector('[data-imp="path"]'), '/src/db-migrations');
  await act(bad.modal, 'Preview');
  assert.deepEqual([...body(bad.modal).querySelectorAll('.sk-problem')].map((p) => p.textContent), ['references/schema.sql: a link that leaves the skill folder']);
  assert.ok([...body(bad.modal).querySelectorAll('.sk-tree-row')].some((r) => r.textContent.includes('symlink leaves the folder · not copied')));
  await act(bad.modal, 'Import');
  assert.equal(msgOf(bad.modal).textContent, 'This folder cannot be imported: see the problems above.');
  assert.equal(bad.calls.filter(([, p]) => p === '/api/skills/import').length, 0);
});

test('a preview that lands after Cancel, after another source was picked or after the modal closed opens nothing and drops its stage; Back then Import commits nothing', async () => {
  const later = () => { let land; const answer = new Promise((r) => { land = () => r({ ok: true, status: 200, data: { stage: STAGE, name: 'db-migrations', inspection: INS } }); }); return { answer, land }; };
  const dropped = (h) => h.calls.at(-1)[0] === 'DELETE' && h.calls.at(-1)[1] === `/api/skills/import/${STAGE}`;
  let d = later();
  const c = harness({ over: { 'POST /api/skills/import/preview': () => d.answer } });
  type(body(c.modal).querySelector('[data-imp="path"]'), '/src/db-migrations');
  let reading = act(c.modal, 'Preview');
  assert.equal(msgOf(c.modal).textContent, 'Reading…');
  const again = act(c.modal, 'Preview');
  assert.equal(c.calls.filter(([, p]) => p === '/api/skills/import/preview').length, 1, 'a second click waits for the first');
  await act(c.modal, 'Cancel');
  d.land();
  await Promise.all([reading, again]);
  await settle();
  assert.equal(c.modal.opened, null, 'Cancel stays cancelled');
  assert.ok(dropped(c), 'the late stage is discarded');
  d = later();
  const s = harness({ over: { 'POST /api/skills/import/preview': () => d.answer } });
  type(body(s.modal).querySelector('[data-imp="path"]'), '/src/db-migrations');
  reading = act(s.modal, 'Preview');
  click(body(s.modal).querySelector('[data-imp-src="paste"]'));
  d.land();
  await reading;
  await settle();
  assert.deepEqual([s.modal.opened.title, !!body(s.modal).querySelector('[data-imp="content"]')], ['Import skill', true], 'the Paste step stays');
  assert.ok(dropped(s));
  d = later();
  const x = harness({ shows: true, over: { 'POST /api/skills/import/preview': () => d.answer } });
  type(body(x.modal).querySelector('[data-imp="path"]'), '/src/db-migrations');
  reading = act(x.modal, 'Preview');
  x.modal.opened = null;   // the shell's own Close: no Cancel runs
  d.land();
  await reading;
  await settle();
  assert.equal(x.modal.opened, null, 'closed by the shell stays closed');
  assert.ok(dropped(x));
  let homes;
  const hm = harness({ over: { 'GET /api/skills/home': () => new Promise((r) => { homes = () => r({ ok: true, status: 200, data: { skills: [] } }); }) } });
  click(body(hm.modal).querySelector('[data-imp-src="home"]'));
  await act(hm.modal, 'Cancel');
  homes();
  await settle();
  assert.equal(hm.modal.opened, null, 'your Claude Code skills landing after Cancel reopen nothing');
  const b = harness();
  type(body(b.modal).querySelector('[data-imp="path"]'), '/src/db-migrations');
  await act(b.modal, 'Preview');
  const importOld = b.modal.opened.actions.find(([l]) => l === 'Import')[2];
  const back = act(b.modal, 'Back');
  await importOld();
  await back;
  assert.equal(b.calls.filter(([, p]) => p === '/api/skills/import').length, 0, 'the old step\'s Import commits nothing');
  assert.equal(b.modal.opened.title, 'Import skill');
  let posted;
  const i = harness({ over: { 'POST /api/skills/import': () => new Promise((r) => { posted = () => r({ ok: true, status: 200, data: { ok: true, id: 'skill:library:db-migrations' } }); }) } });
  type(body(i.modal).querySelector('[data-imp="path"]'), '/src/db-migrations');
  await act(i.modal, 'Preview');
  const importing = act(i.modal, 'Import');
  await act(i.modal, 'Cancel');
  posted();
  await importing;
  assert.equal(i.calls.filter(([meth]) => meth === 'DELETE').length, 0, 'Cancel never discards a stage an Import is committing');
  assert.deepEqual([i.modal.opened, i.done.length], [null, 1]);
});

test('a hosted Worca: only Git URL and Paste; the summary counts only the finding kinds present; a link inside the folder is copied', () => {
  const m = harness({ folderImports: false });
  assert.deepEqual([...body(m.modal).querySelectorAll('[data-imp-src]')].map((b) => [b.textContent, b.getAttribute('aria-pressed')]),
    [['Git URL', 'true'], ['Paste', 'false']]);
  assert.ok(body(m.modal).querySelector('[data-imp="url"]'), 'Git URL is the first source');
  assert.match(body(m.modal).textContent, /Folder and Claude Code imports need a local Worca\./);
  assert.equal(inspectionSummary({ files: [{ path: 'SKILL.md', bytes: 1024 }], bytes: 1024, scripts: [], shellBlocks: 0, findings: [] }),
    '1 file · 1.0 kB · 0 scripts · 0 shell blocks');
  // P1 reports a link that stays inside the folder as a `symlink` finding AND lists it among the files (imported as a copy).
  const inside = { files: [{ path: 'SKILL.md', bytes: 1024 }, { path: 'docs/link.md', bytes: 10 }], bytes: 1034, scripts: [], shellBlocks: 0,
    findings: [{ path: 'docs/link.md', kind: 'symlink', text: 'symlink inside the skill folder (imported as a copy)' }] };
  assert.equal(inspectionSummary(inside), '2 files · 1.0 kB · 0 scripts · 0 shell blocks', 'a copied link is not counted as a dropped one');
  const link = [...fileTree(doc, inside).querySelectorAll('.sk-tree-row')].find((r) => r.querySelector('.mono').textContent === 'docs/link.md');
  assert.deepEqual([...link.querySelectorAll('.sk-flag')].map((f) => `${f.className}|${f.textContent}`), ['badge amber sk-flag|symlink · imported as a copy']);
  // P1 lists at most 50 findings of a kind, then one "… and N more": the summary counts the rest too.
  const many = Array.from({ length: 50 }, () => ({ path: 'SKILL.md', kind: 'expansion', text: '${HOME}' }));
  assert.equal(inspectionSummary({ files: [{ path: 'SKILL.md', bytes: 1024 }], bytes: 1024, scripts: [], shellBlocks: 0,
    findings: [...many, { path: 'SKILL.md', kind: 'expansion', text: '… and 70 more' }] }), '1 file · 1.0 kB · 0 scripts · 0 shell blocks · 120 ${…} references');
});

test('Connectors › Skills: Import skill opens the modal (hosted: Git URL and Paste only); a finished import reloads the catalog', async () => {
  const boot = async (folderImports) => {
    const calls = [];
    const modal = { opened: null, open(title, b, actions) { this.opened = { title, body: b, actions }; }, close() { this.opened = null; } };
    const api = async (method, path, b) => {
      calls.push([method, path, b]);
      if (path === '/api/skills') return { ok: true, status: 200, data: { newer: false, folderImports, skills: [] } };
      if (path === '/api/mcp/sets') return { ok: true, status: 200, data: { newer: false, sets: [] } };
      if (path === '/api/skills/import/preview') return { ok: true, status: 200, data: { stage: STAGE, name: 'db-migrations', inspection: INS } };
      if (path === '/api/skills/import') return { ok: true, status: 200, data: { ok: true, id: 'skill:library:db-migrations' } };
      return { ok: true, status: 200, data: {} };
    };
    const host = doc.createElement('section');
    doc.body.replaceChildren(host);
    const ctl = createMcpView({ host, api, navigate: () => {}, confirm: async () => true, modal, doc });
    await ctl.show('skills');
    click(host.querySelector('[data-act="import-skill"]'));
    return { calls, modal, host };
  };
  const hosted = await boot(false);
  assert.deepEqual([...hosted.modal.opened.body.querySelectorAll('[data-imp-src]')].map((b) => b.textContent), ['Git URL', 'Paste']);
  const { calls, modal, host } = await boot(true);
  assert.equal(modal.opened.title, 'Import skill');
  type(modal.opened.body.querySelector('[data-imp="path"]'), '/src/db-migrations');
  await modal.opened.actions.find(([l]) => l === 'Preview')[2]();
  await modal.opened.actions.find(([l]) => l === 'Import')[2]();
  await settle();
  assert.equal(calls.filter(([m, p]) => m === 'GET' && p === '/api/skills').length, 2, 'the catalog is read again');
  assert.equal(host.querySelector('.form-msg').textContent, 'Imported db-migrations');
});
