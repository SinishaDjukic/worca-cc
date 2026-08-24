// test/ask-worktree-tools.test.mjs
// P4/T5: the worktree MCP tools over the real dep bundle in a temp home; the
// deps-split source scan; the diff/show redaction floor.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { addProject } from '../src/core/projects.mjs';
import { createThread } from '../src/core/ask/store.mjs';
import { createAskTools, AskToolError, splitUnifiedDiff } from '../src/core/ask/tools.mjs';
import { defaultToolDeps } from '../src/core/ask/tool-deps.mjs';
import { defaultWorktreeDeps } from '../src/core/ask/worktree-deps.mjs';

useTempHome(after);

const created = [];
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));
async function freshRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wtt-'));
  created.push(dir);
  const g = (args) => spawnSync('git', args, { cwd: dir });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  await writeFile(join(dir, 'README.md'), '# hi\n');
  await writeFile(join(dir, '.env'), 'API_KEY=supersecret\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']);
  return dir;
}

function realTools(threadId) {
  return createAskTools({ ...defaultToolDeps({ threadId }), ...defaultWorktreeDeps({ threadId }) });
}

test('tools/list exposes the four new tools with schemas', async () => {
  const tools = realTools('ask_00000001');
  const names = tools.list().map((t) => t.name);
  for (const n of ['open_worktree', 'list_worktrees', 'remove_worktree', 'git']) assert.ok(names.includes(n), n);
  const git = tools.list().find((t) => t.name === 'git');
  assert.deepEqual(git.inputSchema.required, ['worktreeId', 'args']);
  assert.equal(git.inputSchema.properties.args.type, 'array');
});

test('round trip: open → list → git log/diff/checkout → remove; row ref follows navigation', async () => {
  const repo = await freshRepo();
  const g = (args) => spawnSync('git', args, { cwd: repo });
  g(['checkout', '-qb', 'feature']);
  await writeFile(join(repo, 'feat.txt'), 'F\n');
  g(['add', '-A']); g(['commit', '-qm', 'feat']);
  g(['checkout', '-q', 'main']);
  const p = (await addProject({ name: 'wtt-one', path: repo })).find((x) => x.name === 'wtt-one');
  const t = createThread();
  const tools = realTools(t.id);
  const wt = await tools.call('open_worktree', { projectKey: p.key, ref: 'main' });
  assert.match(wt.worktreeId, /^wt_[0-9a-f]{8}$/);
  assert.match(wt.commit, /^[0-9a-f]{40}$/);
  const listed = await tools.call('list_worktrees', {});
  assert.deepEqual(listed.worktrees.map((w) => w.worktreeId), [wt.worktreeId]);
  const log = await tools.call('git', { worktreeId: wt.worktreeId, args: ['log', '--oneline'] });
  assert.match(log.text, /init/);
  assert.equal(log.command, 'git log --oneline');
  const diff = await tools.call('git', { worktreeId: wt.worktreeId, args: ['diff', 'main...feature'] });
  assert.match(diff.text, /feat\.txt/);
  await tools.call('git', { worktreeId: wt.worktreeId, args: ['checkout', 'feature'] });
  const after1 = await tools.call('list_worktrees', {});
  assert.equal(after1.worktrees[0].ref, 'feature', 'row follows navigation');
  assert.notEqual(after1.worktrees[0].commit, wt.commit);
  await tools.call('remove_worktree', { worktreeId: wt.worktreeId });
  assert.deepEqual((await tools.call('list_worktrees', {})).worktrees, []);
});

test('git tool: allowlist rejection, unknown worktree, unknown remote are AskToolErrors', async () => {
  const repo = await freshRepo();
  const p = (await addProject({ name: 'wtt-two', path: repo })).find((x) => x.name === 'wtt-two');
  const t = createThread();
  const tools = realTools(t.id);
  const wt = await tools.call('open_worktree', { projectKey: p.key, ref: 'main' });
  await assert.rejects(() => tools.call('git', { worktreeId: wt.worktreeId, args: ['push'] }), AskToolError);
  await assert.rejects(() => tools.call('git', { worktreeId: wt.worktreeId, args: ['pull'] }), /fetch/);
  await assert.rejects(() => tools.call('git', { worktreeId: 'wt_ffffffff', args: ['log'] }), /open_worktree first/);
  await assert.rejects(() => tools.call('git', { worktreeId: wt.worktreeId, args: ['fetch', 'nonexistent-remote'] }), /unknown remote/);
  await assert.rejects(() => tools.call('git', { worktreeId: wt.worktreeId, args: ['log', '-c', 'x=y'] }), /not allowed/);
  await assert.rejects(() => tools.call('git', { worktreeId: wt.worktreeId, args: ['cat-file', '-p', 'HEAD'] }), /allowlist/);
});

test('git diff/show/log: protected sections dropped, redaction fires on KEPT sections, escapes closed', async () => {
  // GHP is the GitHub PAT shape redactAskText masks (ask/redact.mjs). CRITICAL: it
  // lives in ok.md (a NON-protected, KEPT section) so redaction is actually
  // exercised — a secret in .env alone is dropped whole and would pass even with
  // deps.redact deleted.
  const GHP = `ghp_${'A'.repeat(36)}`;
  const repo = await freshRepo();
  const g = (args) => spawnSync('git', args, { cwd: repo });
  g(['checkout', '-qb', 'leak']);
  await writeFile(join(repo, '.env'), 'DB_PASSWORD=hunter2-plaintext\n');           // protected → dropped whole
  await writeFile(join(repo, 'ok.md'), `token: ${GHP}\n`);                          // KEPT → must be redacted
  g(['add', '-A']); g(['commit', '-qm', 'leak the env']);
  g(['checkout', '-q', 'main']);
  const p = (await addProject({ name: 'wtt-three', path: repo })).find((x) => x.name === 'wtt-three');
  const t = createThread();
  const tools = realTools(t.id);
  const wt = await tools.call('open_worktree', { projectKey: p.key, ref: 'main' });

  const diff = await tools.call('git', { worktreeId: wt.worktreeId, args: ['diff', 'main...leak'] });
  assert.ok(diff.text.includes('ok.md'), 'harmless section kept');
  assert.ok(!diff.text.includes('.env'), 'protected section dropped whole');
  assert.ok(!diff.text.includes('hunter2-plaintext'), 'protected file body never appears');
  assert.ok(!diff.text.includes(GHP), 'redaction fired on the KEPT section (non-vacuous)');

  // `show` keeps a commit-message preamble (header-less WITH a header present),
  // but drops the protected .env patch:
  const show = await tools.call('git', { worktreeId: wt.worktreeId, args: ['show', 'leak'] });
  assert.match(show.text, /leak the env/, 'commit message survives');
  assert.ok(!show.text.includes('hunter2-plaintext'));

  // log -p runs through the SAME filter:
  const logp = await tools.call('git', { worktreeId: wt.worktreeId, args: ['log', '-p', 'leak'] });
  assert.ok(!logp.text.includes('hunter2-plaintext'), 'log -p is filtered too');
  assert.ok(!logp.text.includes(GHP), 'log -p redaction fires');

  // Escapes that must be REFUSED, not filtered:
  await assert.rejects(() => tools.call('git', { worktreeId: wt.worktreeId, args: ['diff', '--color=always', 'main...leak'] }), /not allowed/);
  await assert.rejects(() => tools.call('git', { worktreeId: wt.worktreeId, args: ['cat-file', '-p', 'HEAD:.env'] }), AskToolError);
  await assert.rejects(() => tools.call('git', { worktreeId: wt.worktreeId, args: ['show', 'HEAD:.env'] }), /protected path/);
  await assert.rejects(() => tools.call('git', { worktreeId: wt.worktreeId, args: ['diff', '--no-index', '/etc/hosts', '/etc/passwd'] }), /not allowed/);

  // a `show` that resolves to a raw blob/tree is refused (closes ls-tree -> sha -> show)
  const sha = String(spawnSync('git', ['rev-parse', 'main:README.md'], { cwd: repo }).stdout).trim();
  await assert.rejects(() => tools.call('git', { worktreeId: wt.worktreeId, args: ['show', sha] }), /displays commits/);

  // grep/ls-files LINE filter: a protected path never appears in a path list
  const lsf = await tools.call('git', { worktreeId: wt.worktreeId, args: ['ls-files'] });
  assert.ok(lsf.text.includes('README.md'));
  assert.ok(!lsf.text.includes('.env'), 'ls-files line filter drops the protected path');

  // grep with no match is exit 1 = DATA, not a tool failure:
  const nohit = await tools.call('git', { worktreeId: wt.worktreeId, args: ['grep', '-n', 'DEFINITELY-NOT-PRESENT'] });
  assert.equal(nohit.text, '', 'no-match grep is empty, not an error');

  const paged = await tools.call('git', { worktreeId: wt.worktreeId, args: ['log', '--oneline'], maxBytes: 8 });
  assert.equal(paged.truncated, paged.totalBytes > 8);
});

test('git tool: grep cannot hide the path, context lines stay filtered, combined merge diffs refused', async () => {
  const repo = await freshRepo();
  const g = (args) => spawnSync('git', args, { cwd: repo });
  // An EXACT-name protected file (id_rsa). `.env` is protected by the `.env*` PREFIX
  // glob, which accidentally also matched its `-C1` context lines (`.env-1-<body>`);
  // an exact-name pattern does not, so this is what actually pins the tokenizer.
  await writeFile(join(repo, 'id_rsa'), 'above\nPRIVATE-KEY-MARKER\nbelow\n');
  g(['add', '-A']); g(['commit', '-qm', 'key']);
  // An evil merge resolving .env to a third value: its patch is a COMBINED diff
  // (`diff --cc .env`), a shape splitUnifiedDiff cannot section.
  g(['checkout', '-qb', 'side']);
  await writeFile(join(repo, '.env'), 'DB_PASSWORD=SIDE_SECRET\n');
  g(['commit', '-qam', 'side']);
  g(['checkout', '-q', 'main']);
  await writeFile(join(repo, '.env'), 'DB_PASSWORD=MAIN_SECRET\n');
  g(['commit', '-qam', 'mainline']);
  g(['merge', 'side']);                                                    // conflicts on .env
  await writeFile(join(repo, '.env'), 'DB_PASSWORD=RESOLVED_THIRD_SECRET\n');
  g(['add', '-A']); g(['commit', '-qm', 'evil merge']);
  const p = (await addProject({ name: 'wtt-four', path: repo })).find((x) => x.name === 'wtt-four');
  const t = createThread();
  const tools = realTools(t.id);
  const wt = await tools.call('open_worktree', { projectKey: p.key, ref: 'main' });
  const git = (args) => tools.call('git', { worktreeId: wt.worktreeId, args });

  // The path-suppressing grep forms never reach git (they would dump a protected
  // file's body with no path token for the LINE filter to catch).
  for (const args of [['grep', '-h', 'SECRET'], ['grep', '--heading', 'SECRET'],
    ['grep', '-nh', 'SECRET'], ['grep', '-z', 'SECRET']]) {
    await assert.rejects(() => git(args), /filename/);
  }
  // The attached short form of --file reads an arbitrary absolute path.
  await assert.rejects(() => git(['grep', '-f/etc/passwd']), /not allowed/);

  // Every kept line carries its path, so a protected hit is dropped — including the
  // `id_rsa-<n>-<content>` CONTEXT lines an attached -C1 emits.
  const ctx = await git(['grep', '-n', '-C1', 'PRIVATE-KEY-MARKER']);
  assert.ok(!ctx.text.includes('PRIVATE-KEY-MARKER'), 'protected match line dropped');
  assert.ok(!ctx.text.includes('above') && !ctx.text.includes('below'), 'protected CONTEXT lines dropped too');

  // Combined merge diffs are refused, not filtered: `diff --cc` is not unified-diff
  // shaped, so the section filter would pass the merged .env through raw.
  await assert.rejects(() => git(['log', '-p', '--cc']), /combined merge diff/);
  await assert.rejects(() => git(['log', '-p', '--diff-merges=combined']), /combined merge diff/);
  const okLog = await git(['log', '-p', 'main~2..main~1']);          // the non-merge 'mainline' commit
  assert.ok(!okLog.text.includes('MAIN_SECRET'), 'an ordinary log -p is still section-filtered');

  // `log --stat` names files with no `diff --git` header — the diffstat must not
  // disclose a protected filename either (get_run_diff omits protected files whole).
  const stat = await git(['log', '--stat']);
  assert.ok(stat.text.includes('mainline'), 'ordinary history survives');
  assert.ok(!stat.text.includes('.env'), 'protected filename absent from the diffstat');
});

test('source scans: tools.mjs still write-free; worktree-deps.mjs holds only the worktree bundle', () => {
  const tools = readFileSync(new URL('../src/core/ask/tools.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(tools, /from '\.\.\/db\.mjs'|getDb\(|\btx\(|node:sqlite/);
  const deps = readFileSync(new URL('../src/core/ask/worktree-deps.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(deps, /from '\.\.\/db\.mjs'|node:sqlite|writeStoreMeta|writeFile|appendFile|rmSync/);
  for (const m of ['./worktrees.mjs', '../worktree.mjs', './git-allowlist.mjs']) {
    assert.ok(deps.includes(`from '${m}'`), `worktree-deps imports ${m}`);
  }
  const stdio = readFileSync(new URL('../src/core/ask/mcp-stdio.mjs', import.meta.url), 'utf8');
  // Match the WIRING, not the import line — `/defaultWorktreeDeps/` alone passes
  // even if the createAskTools spread is deleted.
  assert.match(stdio, /createAskTools\(\{[\s\S]*?defaultWorktreeDeps/, 'the MCP child spreads the worktree bundle into createAskTools');
});

test('splitUnifiedDiff: sections carry header:true/false, incl. member headers', () => {
  const s = splitUnifiedDiff('message text\ndiff --git a/x.md b/x.md\n+++ b/x.md\n+x\n');
  assert.deepEqual(s.map((x) => [x.path, x.header]), [[null, false], ['x.md', true]]);
  // member-header sections carry header:false too (they have no diff --git line):
  const ws = splitUnifiedDiff('# alpha-00000001\ndiff --git a/y.md b/y.md\n+++ b/y.md\n+y\n');
  assert.deepEqual(ws.map((x) => [x.path, x.member, x.header]), [[null, true, false], ['y.md', false, true]]);
});
