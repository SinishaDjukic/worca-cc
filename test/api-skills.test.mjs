// test/api-skills.test.mjs — /api/skills* (skills registry spec §7, §5): the catalog with library origins, the
// ~/.claude/skills listing, import stage → commit (409 name in use, 400 bad name / problems, 404 stage), discard,
// the read-only SKILL.md (a regular file inside the folder only), update preview/apply, remove (memberships first, a refused
// sweep removes nothing), refused body keys and ids, no host path in the catalog.
// Boots the real express app (imported => no port bind) against a sandboxed WORCA_HOME and HOME. The tests run in order and
// build on each other's library (release-notes, graphify): run the whole file, not one test by --test-name-pattern.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { appServer } from './helpers/app-server.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { readMcpStore, createSet } from '../src/core/mcp/store.mjs';
import { recordSkillUpdateCheck } from '../src/core/mcp/views.mjs';

useTempHome(after);
// ~/.claude/skills for GET /api/skills/home and { kind: 'home' } imports: os.homedir() reads HOME (USERPROFILE on Windows).
const prevHome = [process.env.HOME, process.env.USERPROFILE];
const userHome = mkdtempSync(join(tmpdir(), 'worca-skills-user-'));
process.env.HOME = userHome;
process.env.USERPROFILE = userHome;
const src = mkdtempSync(join(tmpdir(), 'worca-skills-src-'));
after(() => {
  [process.env.HOME, process.env.USERPROFILE] = prevHome;
  for (const d of [userHome, src]) rmSync(d, { recursive: true, force: true });
});

let srv, base;
const JSONH = { 'Content-Type': 'application/json' };
const call = async (method, p, b) => {
  const r = await fetch(`${base}${p}`, { method, ...(b !== undefined ? { headers: JSONH, body: JSON.stringify(b) } : {}) });
  const text = await r.text();
  return { status: r.status, text, body: text ? JSON.parse(text) : null };
};
const enc = encodeURIComponent;
const ID = 'skill:library:release-notes';
const stageDir = (stage) => join(worcaHome(), 'tmp', 'skills', stage);
function skillDir(name, description, files = {}) {
  const d = join(src, name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\nUse it well.\n`);
  for (const [rel, text] of Object.entries(files)) { mkdirSync(join(d, rel, '..'), { recursive: true }); writeFileSync(join(d, rel), text); }
  return d;
}
const catalogRow = async (id) => (await call('GET', '/api/skills')).body.skills.find((s) => s.id === id);

before(async () => {
  const { app } = await import('../ui/server.mjs');
  srv = appServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => { if (srv) await new Promise((r) => srv.close(r)); });

test('import from a folder: the preview stages it, Import commits it to the catalog with its origin; a name in use is 409', async () => {
  let r = await call('POST', '/api/skills/import/preview', { source: { kind: 'dir', path: skillDir('release-notes', 'Draft release notes', { 'references/areas.md': '# Areas\n' }) } });
  assert.equal(r.status, 200, r.text);
  assert.match(r.body.stage, /^[0-9a-f]{16}$/);
  assert.equal(r.body.name, 'release-notes');
  assert.ok(r.body.inspection.files.some((f) => f.path === 'references/areas.md'), 'the preview lists the staged files');
  assert.ok(existsSync(stageDir(r.body.stage)), 'staged under <home>/tmp/skills/<stage>');
  r = await call('POST', '/api/skills/import', { stage: r.body.stage, name: 'release-notes' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.id, ID);
  const row = await catalogRow(ID);
  assert.equal(row.origin.kind, 'dir', 'GET /api/skills carries a library skill\'s origin');
  assert.equal(Object.hasOwn(row, 'dir'), false, 'the catalog\'s folder path (a host path) never reaches the browser');
  assert.deepEqual(row.inSets, []);
  const listing = (await call('GET', '/api/skills')).body;
  assert.equal(listing.folderImports, true, 'a local Worca offers folder imports');
  assert.deepEqual(listing.library, { newer: false, damaged: false });
  assert.equal(JSON.stringify(listing).includes('worca-skills-src-'), false, 'no host path (a folder origin\'s `path`) reaches the browser');
  const again = await call('POST', '/api/skills/import/preview', { source: { kind: 'dir', path: join(src, 'release-notes') } });
  r = await call('POST', '/api/skills/import', { stage: again.body.stage, name: 'release-notes' });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /already in the library/);
  r = await call('POST', '/api/skills/import', { stage: '0123456789abcdef', name: 'release-notes' });
  assert.equal(r.status, 409, 'the name is checked before the stage is looked up');
  assert.equal((await call('DELETE', `/api/skills/import/${again.body.stage}`)).status, 200);
  assert.equal(existsSync(stageDir(again.body.stage)), false, 'Discard removes the stage');
});

test('import refusals: stage ids, names, an unknown stage, a stage with problems, refused keys, sources', async () => {
  for (const stage of ['../../etc', '0123456789abcdef/../../etc', 'ABCDEF0123456789', '0123', 7]) {
    assert.equal((await call('POST', '/api/skills/import', { stage, name: 'x' })).status, 400, String(stage));
  }
  for (const name of ['Bad_Name', 'synced', 'a'.repeat(65), '', null]) {
    const r = await call('POST', '/api/skills/import', { stage: '0123456789abcdef', name });
    assert.equal(r.status, 400, String(name));
    assert.match(r.body.error, /skill name/);
  }
  let r = await call('POST', '/api/skills/import', { stage: '0123456789abcdef', name: 'ghost' });
  assert.equal(r.status, 404);
  assert.match(r.body.error, /preview again/);
  mkdirSync(stageDir('fedcba9876543210'), { recursive: true });
  writeFileSync(join(stageDir('fedcba9876543210'), 'notes.txt'), 'no SKILL.md here\n');
  r = await call('POST', '/api/skills/import', { stage: 'fedcba9876543210', name: 'bare' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /^cannot import: /);
  assert.equal(await catalogRow('skill:library:bare'), undefined);
  for (const k of ['hash', 'consent']) {
    r = await call('POST', '/api/skills/import', { stage: 'fedcba9876543210', name: 'bare', [k]: 'x' });
    assert.equal(r.status, 400, k);
    assert.match(r.body.error, new RegExp(`"${k}" cannot be set here`));
  }
  for (const body of [{}, { source: 'dir' }, { source: { kind: 'ftp', url: 'ftp://x' } }]) {
    r = await call('POST', '/api/skills/import/preview', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.body.error, /^source must be/);
  }
  assert.equal((await call('DELETE', '/api/skills/import/not-a-stage')).status, 400);
});

test('paste and ~/.claude/skills: the home listing; both import; a pasted skill has no origin and no update', async () => {
  mkdirSync(join(userHome, '.claude', 'skills', 'graphify'), { recursive: true });
  writeFileSync(join(userHome, '.claude', 'skills', 'graphify', 'SKILL.md'), '---\nname: graphify\ndescription: Any input to a knowledge graph\n---\nGo.\n');
  let r = await call('GET', '/api/skills/home');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.folderImports, true);
  assert.deepEqual(r.body.skills.map((s) => s.name), ['graphify']);
  assert.match(r.body.skills[0].description, /knowledge graph/);
  let p = await call('POST', '/api/skills/import/preview', { source: { kind: 'home', name: 'graphify' } });
  assert.equal(p.status, 200, p.text);
  assert.equal((await call('POST', '/api/skills/import', { stage: p.body.stage, name: 'graphify' })).status, 200);
  p = await call('POST', '/api/skills/import/preview', { source: { kind: 'paste', name: 'frontend-design', content: '---\nname: frontend-design\ndescription: Production-grade UI\n---\nBe bold.\n' } });
  assert.equal(p.status, 200, p.text);
  assert.equal((await call('POST', '/api/skills/import', { stage: p.body.stage, name: 'frontend-design' })).status, 200);
  assert.equal((await catalogRow('skill:library:graphify')).origin.kind, 'home');
  assert.equal((await catalogRow('skill:library:frontend-design')).origin, null);
  r = await call('POST', `/api/skills/${enc('skill:library:frontend-design')}/update/preview`);
  assert.equal(r.status, 409);
  assert.match(r.body.error, /import it again/);
});

test('a git repository holding several skills: the 400 names its candidate folders; the picked folder stages', async () => {
  const repo = join(src, 'multi');
  for (const n of ['a', 'b']) {
    mkdirSync(join(repo, 'skills', n), { recursive: true });
    writeFileSync(join(repo, 'skills', n, 'SKILL.md'), `---\nname: ${n}\ndescription: skill ${n}\n---\nGo.\n`);
  }
  const git = (...args) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: repo, encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  assert.equal(git('commit', '-qm', 'two skills').status, 0);
  const url = pathToFileURL(repo).href;
  let r = await call('POST', '/api/skills/import/preview', { source: { kind: 'git', url } });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /pick the skill's folder/);
  assert.deepEqual(r.body.candidates, ['skills/a', 'skills/b'], 'the modal offers these instead of an error to retype');
  r = await call('POST', '/api/skills/import/preview', { source: { kind: 'git', url, subdir: 'skills/b' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.name, 'b');
  assert.equal((await call('DELETE', `/api/skills/import/${r.body.stage}`)).status, 200);
});

test('SKILL.md: the read-only text of a catalog skill; 404 unknown, 400 bad id, 413 over the per-file limit; a link out or a FIFO is 404', { timeout: 30000 }, async () => {
  let r = await call('GET', `/api/skills/${enc(ID)}/skill-md`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.id, ID);
  assert.match(r.body.text, /^---\nname: release-notes\n/);
  assert.equal(r.body.bytes, Buffer.byteLength(r.body.text));
  assert.equal((await call('GET', `/api/skills/${enc('skill:library:ghost')}/skill-md`)).status, 404);
  assert.equal((await call('GET', `/api/skills/${enc('skill:library:Bad')}/skill-md`)).status, 400);
  // Exactly 1 MB is inside the limit P1 imports and mounts (inspect.mjs: `st.size > fileBytes`): the drawer reads it.
  const head = '---\nname: graphify\ndescription: big\n---\n';
  writeFileSync(join(worcaHome(), 'skills', 'graphify', 'SKILL.md'), head + 'x'.repeat(1048576 - head.length));
  r = await call('GET', `/api/skills/${enc('skill:library:graphify')}/skill-md`);
  assert.equal(r.status, 200, 'a SKILL.md of exactly 1 MB is not over the limit');
  assert.equal(r.body.bytes, 1048576);
  writeFileSync(join(worcaHome(), 'skills', 'graphify', 'SKILL.md'), `---\nname: graphify\ndescription: big\n---\n${'x'.repeat(1048577)}`);
  r = await call('GET', `/api/skills/${enc('skill:library:graphify')}/skill-md`);
  assert.equal(r.status, 413);
  // Only a regular file inside the skill's folder is read (a linked plugin keeps whatever links it holds): a link out of
  // the folder answers 404, never the other file's text; a FIFO answers 404 instead of a request that never ends.
  if (process.platform !== 'win32') {
    const md = join(worcaHome(), 'skills', 'graphify', 'SKILL.md');
    writeFileSync(join(src, 'secret.txt'), 'not for the browser\n');
    rmSync(md);
    symlinkSync(join(src, 'secret.txt'), md);
    r = await call('GET', `/api/skills/${enc('skill:library:graphify')}/skill-md`);
    assert.equal(r.status, 404, r.text);
    assert.doesNotMatch(r.text, /not for the browser/);
    // A sibling folder whose name starts with the skill's (skills/graphify-evil) is outside the folder too.
    const sibling = join(worcaHome(), 'skills', 'graphify-evil');
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(sibling, 'SKILL.md'), 'not for the browser either\n');
    rmSync(md);
    symlinkSync(join(sibling, 'SKILL.md'), md);
    r = await call('GET', `/api/skills/${enc('skill:library:graphify')}/skill-md`);
    assert.equal(r.status, 404, r.text);
    rmSync(sibling, { recursive: true, force: true });
    // A link loop is a missing file, not a 500 whose message names a server path.
    rmSync(md);
    symlinkSync(md, md);
    r = await call('GET', `/api/skills/${enc('skill:library:graphify')}/skill-md`);
    assert.equal(r.status, 404, r.text);
    assert.doesNotMatch(r.text, /skills\/graphify/);
    rmSync(md);
    assert.equal(spawnSync('mkfifo', [md]).status, 0);
    r = await call('GET', `/api/skills/${enc('skill:library:graphify')}/skill-md`);
    assert.equal(r.status, 404, r.text);
  }
});

test('update: the preview diffs the origin, Update applies the stage; plugin ids, bad stages and unknown skills refused', async () => {
  skillDir('release-notes', 'Draft release notes, version two', { 'references/areas.md': '# Areas\n', 'references/style.md': '# Style\n' });
  let r = await call('POST', `/api/skills/${enc(ID)}/update/preview`);
  assert.equal(r.status, 200, r.text);
  assert.match(r.body.stage, /^[0-9a-f]{16}$/);
  assert.equal(r.body.added.length, 1, 'references/style.md is new');
  assert.equal(r.body.changed.length, 1, 'SKILL.md changed');
  assert.ok(r.body.inspection, 'the update preview carries the staged inspection');
  assert.equal((await catalogRow(ID)).updateAvailable, true, 'a check that found changes badges the skill');
  assert.equal((await call('POST', `/api/skills/${enc(ID)}/update`, { stage: 'nope' })).status, 400);
  let bad = await call('POST', `/api/skills/${enc(ID)}/update`, { stage: '0123456789abcdef' });
  assert.equal(bad.status, 404);
  assert.match(bad.body.error, /check for updates again/);
  mkdirSync(stageDir('abcdefabcdefabcd'), { recursive: true });
  writeFileSync(join(stageDir('abcdefabcdefabcd'), 'notes.txt'), 'no SKILL.md here\n');
  bad = await call('POST', `/api/skills/${enc(ID)}/update`, { stage: 'abcdefabcdefabcd' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /^cannot update: /);
  const u = await call('POST', `/api/skills/${enc(ID)}/update`, { stage: r.body.stage });
  assert.equal(u.status, 200, u.text);
  assert.equal((await catalogRow(ID)).updateAvailable, false, 'Update clears the badge');
  assert.match((await call('GET', `/api/skills/${enc(ID)}/skill-md`)).body.text, /version two/);
  const plugin = enc('skill:plugin:acme/deploy-checklist');
  r = await call('POST', `/api/skills/${plugin}/update/preview`);
  assert.equal(r.status, 400);
  assert.match(r.body.error, /plugin skill/);
  assert.equal((await call('POST', `/api/skills/${plugin}/update`, { stage: '0123456789abcdef' })).status, 400);
  assert.equal((await call('POST', `/api/skills/${enc('skill:library:ghost')}/update/preview`)).status, 404);
  r = await call('POST', `/api/skills/${enc('skill:library:ghost')}/update`, { stage: '0123456789abcdef' });
  assert.equal(r.status, 404);
  assert.match(r.body.error, /skill not found/);
});

test('an update checked before another one was applied is refused: Update never puts older files back', async () => {
  const id = 'skill:library:style-guide';
  const dir = skillDir('style-guide', 'Style guide');
  const p = await call('POST', '/api/skills/import/preview', { source: { kind: 'dir', path: dir } });
  assert.equal((await call('POST', '/api/skills/import', { stage: p.body.stage, name: 'style-guide' })).status, 200);
  skillDir('style-guide', 'Style guide, two');
  const older = await call('POST', `/api/skills/${enc(id)}/update/preview`);
  assert.equal(older.status, 200, older.text);
  skillDir('style-guide', 'Style guide, three');
  const newer = await call('POST', `/api/skills/${enc(id)}/update/preview`);
  assert.equal((await call('POST', `/api/skills/${enc(id)}/update`, { stage: newer.body.stage })).status, 200);
  const r = await call('POST', `/api/skills/${enc(id)}/update`, { stage: older.body.stage });
  assert.equal(r.status, 409, r.text);
  assert.equal(r.body.error, 'the skill changed since this update was checked: check for updates again');
  assert.match((await call('GET', `/api/skills/${enc(id)}/skill-md`)).body.text, /Style guide, three/);
  // Two Updates checked against the same copy and posted together (two tabs) run one after the other: the second finds
  // the first one's copy and is refused, so the library holds what the Update that answered 200 applied.
  skillDir('style-guide', 'Style guide, four');
  const four = await call('POST', `/api/skills/${enc(id)}/update/preview`);
  skillDir('style-guide', 'Style guide, five');
  const five = await call('POST', `/api/skills/${enc(id)}/update/preview`);
  const both = await Promise.all([four, five].map((x) => call('POST', `/api/skills/${enc(id)}/update`, { stage: x.body.stage })));
  assert.deepEqual(both.map((x) => x.status).sort(), [200, 409], both.map((x) => x.text).join(' | '));
  const applied = both[0].status === 200 ? /Style guide, four/ : /Style guide, five/;
  assert.match((await call('GET', `/api/skills/${enc(id)}/skill-md`)).body.text, applied);
});

test('remove: memberships go first, then the library entry and folder; plugin ids 400, unknown 404, bad ids 400', async () => {
  await createSet('Billing');
  let r = await call('PUT', `/api/sets/billing/skills/${enc(ID)}`, { enabled: true });
  assert.equal(r.status, 200, r.text);
  assert.ok(((await readMcpStore()).sets.billing.skills ?? []).some((m) => m.skill === ID));
  assert.deepEqual((await catalogRow(ID)).inSets, [{ id: 'billing', name: 'Billing' }]);
  // Memberships go first: a refused sweep (sets.json from a newer Worca → 409) leaves the library entry and its folder.
  const setsFile = join(worcaHome(), 'mcp', 'sets.json');
  const setsText = readFileSync(setsFile, 'utf8');
  writeFileSync(setsFile, JSON.stringify({ ...JSON.parse(setsText), schema: 2 }));
  r = await call('DELETE', `/api/skills/${enc(ID)}`);
  writeFileSync(setsFile, setsText);
  assert.equal(r.status, 409, r.text);
  assert.ok(existsSync(join(worcaHome(), 'skills', 'release-notes')), 'a refused membership sweep removes nothing');
  assert.ok(await catalogRow(ID), 'the skill stays in the catalog');
  r = await call('DELETE', `/api/skills/${enc(ID)}`);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(((await readMcpStore()).sets.billing.skills ?? []).filter((m) => m.skill === ID), [], 'the membership left with it');
  assert.equal(existsSync(join(worcaHome(), 'skills', 'release-notes')), false, 'the folder is gone');
  assert.equal(await catalogRow(ID), undefined);
  r = await call('DELETE', `/api/skills/${enc('skill:plugin:acme/deploy-checklist')}`);
  assert.equal(r.status, 400);
  assert.match(r.body.error, /plugin skill comes and goes with its plugin/);
  assert.equal((await call('DELETE', `/api/skills/${enc(ID)}`)).status, 404);
  assert.equal((await call('DELETE', `/api/skills/${enc('skill:library:Bad_Name')}`)).status, 400);
});

test('Remove forgets the last Check for updates: the same name imported again carries no stale badge', async () => {
  const id = 'skill:library:lint-rules';
  const dir = skillDir('lint-rules', 'Lint rules');
  let p = await call('POST', '/api/skills/import/preview', { source: { kind: 'dir', path: dir } });
  assert.equal((await call('POST', '/api/skills/import', { stage: p.body.stage, name: 'lint-rules' })).status, 200);
  const same = await call('POST', `/api/skills/${enc(id)}/update/preview`);
  assert.equal(same.status, 200, same.text);
  assert.equal(same.body.added.length + same.body.removed.length + same.body.changed.length, 0, 'the origin has not changed');
  assert.equal((await catalogRow(id)).updateAvailable, false, 'a check that found no changes badges nothing');
  assert.equal((await call('DELETE', `/api/skills/import/${same.body.stage}`)).status, 200);
  skillDir('lint-rules', 'Lint rules, stricter');
  assert.equal((await call('POST', `/api/skills/${enc(id)}/update/preview`)).status, 200);
  assert.equal((await catalogRow(id)).updateAvailable, true);
  assert.equal((await call('DELETE', `/api/skills/${enc(id)}`)).status, 200);
  // A Check for updates still fetching when Remove ran lands afterwards and marks the name again: a new import of that
  // name starts unmarked all the same.
  recordSkillUpdateCheck(id, true);
  p = await call('POST', '/api/skills/import/preview', { source: { kind: 'dir', path: dir } });
  assert.equal((await call('POST', '/api/skills/import', { stage: p.body.stage, name: 'lint-rules' })).status, 200);
  assert.equal((await catalogRow(id)).updateAvailable, false);
});

test('a damaged or newer library.json: the catalog says so and every library route answers 409 in P1\'s words, never "skill not found"', async () => {
  assert.ok(await catalogRow('skill:library:frontend-design'), 'the pasted skill is in the library');
  const file = join(worcaHome(), 'skills', 'library.json');
  const text = readFileSync(file, 'utf8');
  const id = enc('skill:library:frontend-design');
  try {
    for (const [doc, library, error] of [
      ['{ not json', { newer: false, damaged: true }, 'the skill library file skills/library.json is damaged — fix it or remove it'],
      [JSON.stringify({ ...JSON.parse(text), schema: 2 }), { newer: true, damaged: false }, 'the skill library needs a newer Worca']]) {
      writeFileSync(file, doc);
      const cat = (await call('GET', '/api/skills')).body;
      assert.deepEqual(cat.library, library);
      assert.equal(cat.skills.some((s) => s.source === 'library'), false, 'no imported skill can be read');
      for (const [method, p, b] of [['DELETE', `/api/skills/${id}`], ['POST', `/api/skills/${id}/update/preview`],
        ['POST', `/api/skills/${id}/update`, { stage: '0123456789abcdef' }], ['POST', '/api/skills/import', { stage: '0123456789abcdef', name: 'fresh-skill' }]]) {
        const r = await call(method, p, b);
        assert.equal(r.status, 409, `${method} ${p}: ${r.text}`);
        assert.equal(r.body.error, error);
      }
    }
  } finally {
    writeFileSync(file, text);
  }
  assert.deepEqual((await call('GET', '/api/skills')).body.library, { newer: false, damaged: false });
  assert.ok(await catalogRow('skill:library:frontend-design'), 'the library reads again once the file is fixed');
});
