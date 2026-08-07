// test/run-context.test.mjs
// Phase 3: src/core/run-context.mjs — the generated run context.
//   §5.4 <runRoot>/CLAUDE.md   (memory discovery, @import resolution, caps, placeholder)
//   §5.5 <runRoot>/mcp.json    (pinned read order, transforms, cd-wrap, renames, warnings)
//   §5.6 skill mount           (copy default, symlink opt-in, collision renames, tracked guard)
//   §5.2 run.json extension    (injectedPaths / skillResolutions / renames / bytes / warnings)
//   §8.6 ancestor audit, §8.20 ENOENT tolerance
//
// Everything here is pure fs work: no claude spawn, no DB, no orchestrator. The
// module takes projectsRoot / homeDir / platform as EXPLICIT inputs precisely so
// these tests never depend on the developer's real home. The three settings
// scalars (contextMaxBytesPerFile / contextMaxBytesTotal / skillMount) are the one
// exception — they are read from settings.json, so the tests that exercise them
// sandbox HOME.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile, realpath, lstat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';

import {
  MCP_GRANT_MODE,
  assembleRunContext,
  renderContextAudit,
  discoverMemorySources,
  resolveImports,
  assembleSkills,
  mergeMcpConfigs,
  auditAncestors,
} from '../src/core/run-context.mjs';
import { readRunManifest } from '../src/core/run-manifest.mjs';

const created = [];
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));

async function tmp(prefix = 'worca-cc-rc-') {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  created.push(dir);
  return realpath(dir);            // macOS /var -> /private/var
}

/** Write a { relPath: contents } tree under `dir`. Creates parents. */
async function writeTree(dir, files) {
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, body, 'utf8');
  }
  return dir;
}

/** A run root whose BASENAME is the pipelineId (§8.13 / the CLAUDE.md title token). */
async function mkRunRoot(id = 'pid12345') {
  const rr = join(await tmp('worca-cc-rc-rr-'), id);
  await mkdir(rr, { recursive: true });
  return rr;
}

/** An empty dir usable as a neutral projectsRoot / homeDir. */
const emptyDir = () => tmp('worca-cc-rc-empty-');

async function gitRepo(prefix = 'worca-cc-rc-git-') {
  const dir = await tmp(prefix);
  const g = (args) => spawnSync('git', args, { cwd: dir });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  await writeFile(join(dir, 'seed.txt'), 'seed\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'init']);
  return dir;
}

/** Run `fn` with HOME/USERPROFILE sandboxed and settings.json seeded from `settings`. */
async function withSettings(settings, fn) {
  const home = await tmp('worca-cc-rc-home-');
  const prev = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK,
  };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  await mkdir(join(home, '.worca-cc'), { recursive: true });
  await writeFile(join(home, '.worca-cc', 'settings.json'), JSON.stringify(settings, null, 2), 'utf8');
  try {
    return await fn(home);
  } finally {
    for (const [k, v] of [['HOME', prev.HOME], ['USERPROFILE', prev.USERPROFILE],
      ['WORCA_TEST_ALLOW_HOME_FALLBACK', prev.ALLOW]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

/** assembleRunContext with neutral defaults; `over` supplies what a test cares about. */
async function assemble(over = {}) {
  return assembleRunContext({
    runRoot: over.runRoot,
    members: over.members || [],
    projectsRoot: over.projectsRoot ?? (await emptyDir()),
    isWorkspace: !!over.isWorkspace,
    requiredSkillResolutions: over.requiredSkillResolutions ?? new Map(),
    graphInstructions: over.graphInstructions ?? new Map(),
    homeDir: over.homeDir ?? (await emptyDir()),
    ...(over.honorByKey ? { honorByKey: over.honorByKey } : {}),
    ...(over.platform ? { platform: over.platform } : {}),
  });
}

// ── the V1 outcome, burned in ────────────────────────────────────────────────

test('MCP_GRANT_MODE is the Phase-0 V1(a) outcome: server-wildcard grants', () => {
  assert.equal(MCP_GRANT_MODE, 'server');
});

// ── §5.4 memory discovery + ordering ────────────────────────────────────────

test('discoverMemorySources: CLAUDE.md, .claude/CLAUDE.md, .claude/rules/*.md (lex), CLAUDE.local.md', async () => {
  const dir = await writeTree(await tmp(), {
    'CLAUDE.md': 'root\n',
    'CLAUDE.local.md': 'local\n',
    '.claude/CLAUDE.md': 'dotclaude\n',
    '.claude/rules/b-second.md': 'B\n',
    '.claude/rules/a-first.md': 'A\n',
    '.claude/rules/notes.txt': 'ignored (not .md)\n',
  });
  const got = (await discoverMemorySources(dir)).map((s) => s.rel);
  assert.deepEqual(got, [
    'CLAUDE.md',
    join('.claude', 'CLAUDE.md'),
    join('.claude', 'rules', 'a-first.md'),
    join('.claude', 'rules', 'b-second.md'),
    'CLAUDE.local.md',
  ]);
});

test('discoverMemorySources: a missing directory and missing files are both silent (§8.20)', async () => {
  assert.deepEqual(await discoverMemorySources(join(await tmp(), 'nope')), []);
  assert.deepEqual(await discoverMemorySources(await tmp()), []);
});

// ── §5.4 @import resolution ─────────────────────────────────────────────────

test('resolveImports: inlines a relative @import, recursively', async () => {
  const dir = await writeTree(await tmp(), {
    'CLAUDE.md': 'top\n@./child.md\nend\n',
    'child.md': 'CHILD\n@./grand.md\n',
    'grand.md': 'GRAND\n',
  });
  const r = await resolveImports(
    await readFile(join(dir, 'CLAUDE.md'), 'utf8'), join(dir, 'CLAUDE.md'), 0, { homeDir: dir },
  );
  assert.match(r.text, /CHILD/);
  assert.match(r.text, /GRAND/);
  assert.deepEqual(r.unresolved, []);
});

test('resolveImports: ~ is expanded against homeDir', async () => {
  const home = await writeTree(await tmp(), { 'notes.md': 'HOMENOTE\n' });
  const dir = await writeTree(await tmp(), { 'CLAUDE.md': '@~/notes.md\n' });
  const r = await resolveImports('@~/notes.md\n', join(dir, 'CLAUDE.md'), 0, { homeDir: home });
  assert.match(r.text, /HOMENOTE/);
  assert.deepEqual(r.unresolved, []);
});

test('resolveImports: depth is capped at 4 and the cap is reported, never looped', async () => {
  const dir = await tmp();
  // d0 -> d1 -> ... -> d6, plus a SELF-import that would spin forever uncapped.
  const files = { 'd6.md': 'DEEP6\n', 'loop.md': 'LOOP\n@./loop.md\n' };
  for (let i = 0; i < 6; i++) files[`d${i}.md`] = `L${i}\n@./d${i + 1}.md\n`;
  await writeTree(dir, files);
  const r = await resolveImports('@./d0.md\n', join(dir, 'CLAUDE.md'), 0, { homeDir: dir });
  assert.match(r.text, /L0/);
  assert.doesNotMatch(r.text, /DEEP6/, 'the depth cap stops the chain before d6');
  assert.ok(r.unresolved.some((u) => /depth/i.test(u)), `depth cap reported: ${JSON.stringify(r.unresolved)}`);

  const loop = await resolveImports('@./loop.md\n', join(dir, 'CLAUDE.md'), 0, { homeDir: dir });
  assert.match(loop.text, /LOOP/);   // terminated, not hung
});

test('resolveImports: fenced blocks and inline code spans are NOT imports', async () => {
  const dir = await writeTree(await tmp(), { 'child.md': 'SHOULD-NOT-APPEAR\n' });
  const text = [
    '```md', '@./child.md', '```',
    'inline `@./child.md` stays literal',
    'mail me at foo@./child.md is not an import either',
  ].join('\n');
  const r = await resolveImports(text, join(dir, 'CLAUDE.md'), 0, { homeDir: dir });
  assert.doesNotMatch(r.text, /SHOULD-NOT-APPEAR/);
  assert.deepEqual(r.unresolved, []);
});

test('resolveImports: an unresolvable import stays literal and is listed as a warning', async () => {
  const dir = await tmp();
  const r = await resolveImports('@./missing.md\n', join(dir, 'CLAUDE.md'), 0, { homeDir: dir });
  assert.match(r.text, /@\.\/missing\.md/, 'left as literal text');
  assert.equal(r.unresolved.length, 1);
  assert.match(r.unresolved[0], /missing\.md/);
});

// ── §5.4 the generated document ─────────────────────────────────────────────

test('generated CLAUDE.md: title + rosters + per-member sections, byte-identical across calls', async () => {
  const a = await writeTree(await tmp('worca-cc-rc-alpha-'), { 'CLAUDE.md': 'ALPHA MEMORY\n' });
  const b = await writeTree(await tmp('worca-cc-rc-beta-'), { '.claude/CLAUDE.md': 'BETA MEMORY\n' });
  const members = [
    { projectKey: 'alpha-1', projectName: 'Alpha', projectDir: a, worktreeDir: join(await tmp(), 'wa') },
    { projectKey: 'beta-2', projectName: 'Beta', projectDir: b, worktreeDir: join(await tmp(), 'wb') },
  ];
  const rr1 = await mkRunRoot('pidaaaa1');
  const rr2 = await mkRunRoot('pidaaaa1');   // same pipelineId -> same bytes
  const projectsRoot = await emptyDir();
  const homeDir = await emptyDir();
  const graphInstructions = new Map([['alpha-1', 'Use the graph.']]);

  const rc1 = await assemble({ runRoot: rr1, members, projectsRoot, homeDir, graphInstructions, isWorkspace: true });
  const rc2 = await assemble({ runRoot: rr2, members, projectsRoot, homeDir, graphInstructions, isWorkspace: true });

  const t1 = await readFile(rc1.claudeMdPath, 'utf8');
  const t2 = await readFile(rc2.claudeMdPath, 'utf8');
  assert.equal(t1, t2, 'same inputs => byte-identical output (no timestamps in the body)');

  assert.equal(basename(rc1.claudeMdPath), 'CLAUDE.md');
  assert.match(t1, /^# Worca CC run pidaaaa1\n/, 'the pipelineId is the only run-specific token');
  assert.match(t1, /repos\/alpha-1/);
  assert.match(t1, /Use the graph\./, 'the per-member graphify instruction is in the roster');
  assert.match(t1, /^## Project: Alpha — repos\/alpha-1$/m);
  assert.match(t1, /^## Project: Beta — repos\/beta-2$/m);
  assert.match(t1, /ALPHA MEMORY/);
  assert.match(t1, /BETA MEMORY/);
  assert.ok(t1.indexOf('## Project: Alpha') < t1.indexOf('## Project: Beta'), 'members sorted by projectKey');
  assert.match(t1, /run root holds run metadata only/i);
  assert.match(t1, /deferred behind tool search/i, 'the MCP roster carries the tool-search note');
  assert.equal(rc1.memberCount, 2);
});

test('generated CLAUDE.md: a zero-memory member still renders its section with the placeholder', async () => {
  const empty = await tmp('worca-cc-rc-nomem-');
  const rr = await mkRunRoot();
  const rc = await assemble({
    runRoot: rr,
    members: [{ projectKey: 'k1', projectName: 'Nomem', projectDir: empty, worktreeDir: join(await tmp(), 'w') }],
  });
  const text = await readFile(rc.claudeMdPath, 'utf8');
  assert.match(text, /^## Project: Nomem — repos\/k1$/m);
  assert.match(text, /\*\(no CLAUDE\.md found in this project\)\*/);
});

test('generated CLAUDE.md: the root layer renders as "## Root instructions (<projectsRoot>)"', async () => {
  const projectsRoot = await writeTree(await tmp('worca-cc-rc-proot-'), {
    'CLAUDE.md': 'ROOT MEMORY\n',
    '.claude/rules/style.md': 'ROOT RULE\n',
  });
  const rr = await mkRunRoot();
  const rc = await assemble({ runRoot: rr, projectsRoot, members: [] });
  const text = await readFile(rc.claudeMdPath, 'utf8');
  assert.match(text, new RegExp(`^## Root instructions \\(${projectsRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)$`, 'm'));
  assert.match(text, /ROOT MEMORY/);
  assert.match(text, /ROOT RULE/);
});

test('generated CLAUDE.md: the plain root CLAUDE.md/CLAUDE.local.md are SKIPPED when the run root is a descendant', async () => {
  const projectsRoot = await writeTree(await tmp('worca-cc-rc-desc-'), {
    'CLAUDE.md': 'ROOT-PLAIN\n',
    'CLAUDE.local.md': 'ROOT-LOCAL\n',
    '.claude/CLAUDE.md': 'ROOT-DOT\n',
  });
  const rr = join(projectsRoot, 'runs', 'piddesc1');
  await mkdir(rr, { recursive: true });
  const rc = await assemble({ runRoot: rr, projectsRoot, members: [] });
  const text = await readFile(rc.claudeMdPath, 'utf8');
  assert.doesNotMatch(text, /ROOT-PLAIN/, 'E1 loads it natively on the ancestor walk — inlining would double-load');
  assert.doesNotMatch(text, /ROOT-LOCAL/);
  assert.match(text, /ROOT-DOT/, '.claude/CLAUDE.md ancestor-load was never probed, so it IS inlined');
});

test('generated CLAUDE.md: the home special case never inlines user scope (E11)', async () => {
  const home = await writeTree(await tmp('worca-cc-rc-userscope-'), {
    '.claude/CLAUDE.md': 'USER-SCOPE-MEMORY\n',
    '.claude/rules/r.md': 'USER-SCOPE-RULE\n',
  });
  const rr = await mkRunRoot();
  const rc = await assemble({ runRoot: rr, projectsRoot: home, homeDir: home, members: [] });
  const text = await readFile(rc.claudeMdPath, 'utf8');
  assert.doesNotMatch(text, /USER-SCOPE-MEMORY/);
  assert.doesNotMatch(text, /USER-SCOPE-RULE/);
});

test('generated CLAUDE.md: single mode de-dups a member file byte-identical to the worktree copy', async () => {
  const real = await writeTree(await tmp('worca-cc-rc-dedup-'), { 'CLAUDE.md': 'SAME BYTES\n' });
  const wt = await writeTree(await tmp('worca-cc-rc-dedupwt-'), { 'CLAUDE.md': 'SAME BYTES\n' });
  const member = { projectKey: 'k1', projectName: 'P', projectDir: real, worktreeDir: wt };
  const same = await assemble({ runRoot: await mkRunRoot(), members: [member], isWorkspace: false });
  assert.doesNotMatch(await readFile(same.claudeMdPath, 'utf8'), /SAME BYTES/,
    'the committed copy loads natively at cwd (E1/P1); inlining it would double-load');

  // A DIFFERENT working copy is inlined (that is the uncommitted-edit case E6 creates).
  await writeFile(join(real, 'CLAUDE.md'), 'EDITED BYTES\n', 'utf8');
  const diff = await assemble({ runRoot: await mkRunRoot(), members: [member], isWorkspace: false });
  assert.match(await readFile(diff.claudeMdPath, 'utf8'), /EDITED BYTES/);

  // Workspace mode NEVER de-dups (cwd is the run root, not the checkout).
  await writeFile(join(real, 'CLAUDE.md'), 'SAME BYTES\n', 'utf8');
  const ws = await assemble({ runRoot: await mkRunRoot(), members: [member], isWorkspace: true });
  assert.match(await readFile(ws.claudeMdPath, 'utf8'), /SAME BYTES/);
});

test('§8.20: a DELETED member real dir degrades to worktree-only context with a named warning, never a throw', async () => {
  const gone = join(await tmp('worca-cc-rc-gone-'), 'deleted-project');   // never created
  const rr = await mkRunRoot();
  const rc = await assemble({
    runRoot: rr,
    members: [{ projectKey: 'ghost-1', projectName: 'Ghost', projectDir: gone, worktreeDir: join(await tmp(), 'w') }],
  });
  const text = await readFile(rc.claudeMdPath, 'utf8');
  assert.match(text, /^## Project: Ghost — repos\/ghost-1$/m, 'the roster stays symmetric');
  assert.match(text, /\*\(no CLAUDE\.md found in this project\)\*/);
  assert.ok(rc.warnings.some((w) => w.includes('ghost-1') && w.includes(gone)),
    `a warning names the member AND the missing path: ${JSON.stringify(rc.warnings)}`);
});

test('§8.20: a nonexistent projectsRoot contributes nothing and warns exactly ONCE by name', async () => {
  const missing = join(await tmp('worca-cc-rc-noroot-'), 'not-there');
  const rr = await mkRunRoot();
  const rc = await assemble({
    runRoot: rr,
    projectsRoot: missing,
    members: [
      { projectKey: 'a-1', projectName: 'A', projectDir: await tmp(), worktreeDir: join(await tmp(), 'wa') },
      { projectKey: 'b-2', projectName: 'B', projectDir: await tmp(), worktreeDir: join(await tmp(), 'wb') },
    ],
  });
  const hits = rc.warnings.filter((w) => w.includes(missing));
  assert.equal(hits.length, 1, `exactly one warning, not one per read: ${JSON.stringify(rc.warnings)}`);
  assert.match(hits[0], /projects root/i);
});

// ── §5.4 caps ───────────────────────────────────────────────────────────────

test('§5.4 caps: the per-file cap truncates with a marker and a warning naming file + both byte counts', async () => {
  const big = 'X'.repeat(5000) + '\n';
  const real = await writeTree(await tmp('worca-cc-rc-bigmem-'), { 'CLAUDE.md': big });
  const rr = await mkRunRoot();
  const rc = await withSettings({ contextMaxBytesPerFile: 1000 }, async () => assemble({
    runRoot: rr, isWorkspace: true,
    members: [{ projectKey: 'big-1', projectName: 'Big', projectDir: real, worktreeDir: join(await tmp(), 'w') }],
  }));
  const text = await readFile(rc.claudeMdPath, 'utf8');
  assert.match(text, /truncated/i, 'an explicit truncation marker is in the document');
  assert.ok(Buffer.byteLength(text, 'utf8') < 5000, 'the 5000-byte source was actually cut');
  const w = rc.warnings.find((x) => x.includes('CLAUDE.md') && /truncated/.test(x));
  assert.ok(w, `truncation warning present: ${JSON.stringify(rc.warnings)}`);
  assert.ok(w.includes(join(real, 'CLAUDE.md')), 'names the REAL path');
  assert.ok(w.includes('big-1'), 'names the member');
  assert.match(w, /5,?001/, 'names the original byte size');
  assert.match(w, /1,?000/, 'names the cap');
  assert.match(w, /contextMaxBytesPerFile/, 'names the settings key to raise');
  assert.equal(rc.bytes.bySource[join(real, 'CLAUDE.md')], 1000, 'byte accounting records what was inlined');
});

test('§5.4 caps: when the TOTAL budget binds, the roster is trimmed BEFORE any member memory', async () => {
  const mem = 'MEMBER-MEMORY-KEEPME '.repeat(40);          // ~800 bytes
  const real = await writeTree(await tmp('worca-cc-rc-total-'), { 'CLAUDE.md': mem });
  const rr = await mkRunRoot();
  const rc = await withSettings({ contextMaxBytesTotal: 1200, contextMaxBytesPerFile: 20480 }, async () => assemble({
    runRoot: rr, isWorkspace: true,
    members: [{ projectKey: 'tot-1', projectName: 'Total', projectDir: real, worktreeDir: join(await tmp(), 'w') }],
  }));
  const text = await readFile(rc.claudeMdPath, 'utf8');
  assert.ok(Buffer.byteLength(text, 'utf8') <= 1200, `document honors the total cap: ${Buffer.byteLength(text)}`);
  assert.match(text, /MEMBER-MEMORY-KEEPME/, 'instructions are never sacrificed to metadata');
  assert.doesNotMatch(text, /deferred behind tool search/, 'the metadata roster was trimmed first');
  assert.ok(rc.warnings.some((w) => /contextMaxBytesTotal/.test(w)),
    `the total-budget trim is warned: ${JSON.stringify(rc.warnings)}`);
  assert.equal(rc.bytes.total, Buffer.byteLength(text, 'utf8'));
});

// ── §5.6 skills: mount mode ─────────────────────────────────────────────────

test('§5.6: COPY is the default mount — the entry is a real dir and edits do not reach the source', async () => {
  const real = await writeTree(await tmp('worca-cc-rc-skcopy-'), {
    '.claude/skills/deploy/SKILL.md': '---\nname: deploy\n---\nbody\n',
  });
  const wt = await tmp('worca-cc-rc-skcopy-wt-');
  const rr = await mkRunRoot();
  const rc = await withSettings({}, async () => assemble({
    runRoot: rr, isWorkspace: false,
    members: [{ projectKey: 'k1', projectName: 'P', projectDir: real, worktreeDir: wt }],
  }));
  const mounted = join(wt, '.claude', 'skills', 'deploy');
  assert.ok(!(await lstat(mounted)).isSymbolicLink(), 'default delivery is a COPY (isolation, §5.6)');
  assert.deepEqual(rc.injectedSkillNames, ['deploy']);
  await writeFile(join(mounted, 'SKILL.md'), 'AGENT EDIT\n', 'utf8');
  assert.match(await readFile(join(real, '.claude', 'skills', 'deploy', 'SKILL.md'), 'utf8'), /name: deploy/,
    'the user\'s live checkout is untouched by an edit to the copy');
});

test('§5.6: skillMount:"symlink" is opt-in, records mount:"symlink", and warns about write-through', async () => {
  const real = await writeTree(await tmp('worca-cc-rc-sklink-'), {
    '.claude/skills/deploy/SKILL.md': '---\nname: deploy\n---\nbody\n',
  });
  const wt = await tmp('worca-cc-rc-sklink-wt-');
  const rr = await mkRunRoot();
  const rc = await withSettings({ skillMount: 'symlink' }, async () => assemble({
    runRoot: rr, isWorkspace: false,
    members: [{ projectKey: 'k1', projectName: 'P', projectDir: real, worktreeDir: wt }],
  }));
  assert.ok((await lstat(join(wt, '.claude', 'skills', 'deploy'))).isSymbolicLink());
  const entry = rc.injectedPaths.k1.find((e) => e.path.endsWith('deploy'));
  assert.equal(entry.mount, 'symlink', 'the §8.20 rescue exemption is recorded on the entry');
  assert.ok(rc.warnings.some((w) => /symlink/i.test(w) && /write-through|isolation/i.test(w)),
    `the trade-off is named: ${JSON.stringify(rc.warnings)}`);
});

// ── §5.6 collision renames, all three source classes + the numeric tiebreak ──

test('§5.6: collision renames cover member / root / worca-cc classes with frontmatter rewrite + numeric tiebreak', async () => {
  const alpha = await writeTree(await tmp('worca-cc-rc-alpha-'), {
    '.claude/skills/deploy/SKILL.md': '---\nname: deploy\ndescription: alpha\n---\nALPHA\n',
  });
  // projectName "root" makes this member's slug collide with the ROOT rename slug,
  // which is exactly what forces the deterministic numeric tiebreak.
  const beta = await writeTree(await tmp('worca-cc-rc-beta-'), {
    '.claude/skills/deploy/SKILL.md': '---\nname: deploy\ndescription: beta\n---\nBETA\n',
  });
  const projectsRoot = await writeTree(await tmp('worca-cc-rc-proot-'), {
    '.claude/skills/deploy/SKILL.md': '---\nname: deploy\n---\nROOTSKILL\n',
  });
  const bundle = await writeTree(await tmp('worca-cc-rc-bundle-'), {
    'deploy/SKILL.md': '---\nname: deploy\n---\nBUNDLE\n',
  });
  const rr = await mkRunRoot();
  const rc = await withSettings({}, async () => assemble({
    runRoot: rr, isWorkspace: true, projectsRoot,
    members: [
      { projectKey: 'a-alpha', projectName: 'Alpha', projectDir: alpha, worktreeDir: join(rr, 'repos', 'a-alpha') },
      { projectKey: 'b-beta', projectName: 'root', projectDir: beta, worktreeDir: join(rr, 'repos', 'b-beta') },
    ],
    requiredSkillResolutions: new Map([
      ['deploy', { source: 'bundle', path: join(bundle, 'deploy'), requiredBy: ['artDirector'] }],
    ]),
  }));
  const mount = join(rr, '.claude', 'skills');
  const names = (await readdir(mount)).sort();
  assert.deepEqual(names, ['deploy', 'root-deploy', 'root-deploy-2', 'worca-cc-deploy'],
    'nothing is DROPPED — R2 requires every member\'s skills');
  // First occupant (lowest projectKey) keeps the bare name.
  assert.match(await readFile(join(mount, 'deploy', 'SKILL.md'), 'utf8'), /ALPHA/);
  // Member-sourced later occupant: <memberSlug>-<name>, slug = "root" here.
  assert.match(await readFile(join(mount, 'root-deploy', 'SKILL.md'), 'utf8'), /BETA/);
  // Root-sourced occupant collides with that rename => deterministic -2.
  assert.match(await readFile(join(mount, 'root-deploy-2', 'SKILL.md'), 'utf8'), /ROOTSKILL/);
  // Bundle/plugin-sourced occupant: worca-cc-<name>.
  assert.match(await readFile(join(mount, 'worca-cc-deploy', 'SKILL.md'), 'utf8'), /BUNDLE/);

  // Frontmatter `name:` is rewritten to match the directory (V2's mechanism).
  for (const n of ['root-deploy', 'root-deploy-2', 'worca-cc-deploy']) {
    const fm = await readFile(join(mount, n, 'SKILL.md'), 'utf8');
    assert.match(fm, new RegExp(`^name: ${n}$`, 'm'), `frontmatter rewritten for ${n}`);
    assert.doesNotMatch(fm, /^name: deploy$/m);
  }
  assert.match(await readFile(join(mount, 'root-deploy', 'SKILL.md'), 'utf8'), /description: beta/,
    'other frontmatter keys are preserved');
  assert.deepEqual(rc.renames.skills, {
    'root-deploy': 'deploy', 'root-deploy-2': 'deploy', 'worca-cc-deploy': 'deploy',
  });
  assert.deepEqual(rc.injectedSkillNames.slice().sort(),
    ['deploy', 'root-deploy', 'root-deploy-2', 'worca-cc-deploy']);
});

test('§5.6: root skills are SKIPPED when projectsRoot === homeDir (already on the scan path, E4)', async () => {
  const home = await writeTree(await tmp('worca-cc-rc-homeskill-'), {
    '.claude/skills/deploy/SKILL.md': '---\nname: deploy\n---\nHOME\n',
  });
  const rr = await mkRunRoot();
  const rc = await withSettings({}, async () => assemble({
    runRoot: rr, isWorkspace: true, projectsRoot: home, homeDir: home, members: [],
  }));
  assert.deepEqual(rc.injectedSkillNames, []);
  assert.ok(!existsSync(join(rr, '.claude', 'skills', 'deploy')));
});

test('§5.6: never overwrite a TRACKED skill in the worktree — skip + a named warning', async () => {
  const wt = await gitRepo('worca-cc-rc-tracked-wt-');
  await writeTree(wt, { '.claude/skills/deploy/SKILL.md': 'COMMITTED VERSION\n' });
  spawnSync('git', ['add', '-A'], { cwd: wt });
  spawnSync('git', ['commit', '-qm', 'track the skill'], { cwd: wt });
  const real = await writeTree(await tmp('worca-cc-rc-tracked-real-'), {
    '.claude/skills/deploy/SKILL.md': '---\nname: deploy\n---\nMOUNT VERSION\n',
    '.claude/skills/other/SKILL.md': '---\nname: other\n---\nOTHER\n',
  });
  const rr = await mkRunRoot();
  const rc = await withSettings({}, async () => assemble({
    runRoot: rr, isWorkspace: false,
    members: [{ projectKey: 'k1', projectName: 'P', projectDir: real, worktreeDir: wt }],
  }));
  assert.equal(await readFile(join(wt, '.claude', 'skills', 'deploy', 'SKILL.md'), 'utf8'),
    'COMMITTED VERSION\n', "the project's own committed skill wins");
  assert.ok(!rc.injectedSkillNames.includes('deploy'));
  assert.ok(rc.injectedSkillNames.includes('other'), 'untracked names still mount');
  assert.ok(rc.warnings.some((w) => /deploy/.test(w) && /tracked/i.test(w)),
    `the skip is logged by name: ${JSON.stringify(rc.warnings)}`);
  assert.ok(!(rc.injectedPaths.k1 || []).some((e) => e.path.endsWith('deploy')),
    'a skipped tracked skill is NOT recorded as injected (teardown must not delete it)');
});

test('§5.6: injectedPaths records source provenance + kind for every materialized entry', async () => {
  const real = await writeTree(await tmp('worca-cc-rc-prov-'), {
    '.claude/skills/deploy/SKILL.md': '---\nname: deploy\n---\nX\n',
  });
  const rr = await mkRunRoot();
  // single mode -> the mount lives in the worktree, keyed by projectKey
  const single = await withSettings({}, async () => assemble({
    runRoot: rr, isWorkspace: false,
    members: [{ projectKey: 'k1', projectName: 'P', projectDir: real, worktreeDir: join(rr, 'repos', 'k1') }],
  }));
  assert.deepEqual(single.injectedPaths.k1, [{
    path: join('.claude', 'skills', 'deploy'),
    source: join(real, '.claude', 'skills', 'deploy'),
    kind: 'skill',
  }]);
  assert.equal(single.skillMountDir, join(rr, 'repos', 'k1', '.claude', 'skills'));

  // workspace mode -> the mount lives at the run root, keyed 'runRoot'
  const rr2 = await mkRunRoot('pidws001');
  const ws = await withSettings({}, async () => assemble({
    runRoot: rr2, isWorkspace: true,
    members: [{ projectKey: 'k1', projectName: 'P', projectDir: real, worktreeDir: join(rr2, 'repos', 'k1') }],
  }));
  assert.deepEqual(ws.injectedPaths.runRoot, [{
    path: join('.claude', 'skills', 'deploy'),
    source: join(real, '.claude', 'skills', 'deploy'),
    kind: 'skill',
  }]);
  assert.equal(ws.skillMountDir, join(rr2, '.claude', 'skills'));
  assert.equal(ws.injectedPaths.k1, undefined, 'workspace runs keep worktrees clean of skill mounts');
});

test('§8.20: a broken skill source warns and skips — assembly is not aborted', async () => {
  const real = await tmp('worca-cc-rc-broken-');
  await mkdir(join(real, '.claude', 'skills'), { recursive: true });
  // A skills "entry" that is a FILE, not a directory: cp -r of it into a dir path
  // still works, so make the target unusable instead by using a dangling symlink.
  await writeTree(real, { '.claude/skills/ok/SKILL.md': '---\nname: ok\n---\n' });
  const { symlink } = await import('node:fs/promises');
  await symlink(join(real, 'nowhere-at-all'), join(real, '.claude', 'skills', 'broken'));
  const rr = await mkRunRoot();
  const rc = await withSettings({}, async () => assemble({
    runRoot: rr, isWorkspace: true,
    members: [{ projectKey: 'k1', projectName: 'P', projectDir: real, worktreeDir: join(rr, 'repos', 'k1') }],
  }));
  assert.ok(rc.injectedSkillNames.includes('ok'), 'the healthy entry still mounts');
  assert.ok(rc.warnings.some((w) => /broken/.test(w)), `the broken entry is named: ${JSON.stringify(rc.warnings)}`);
});

// ── §5.5 mcp.json ───────────────────────────────────────────────────────────

test('§5.5: no server anywhere => mcpConfigPath is null and no mcp.json is written', async () => {
  const rr = await mkRunRoot();
  const rc = await assemble({
    runRoot: rr,
    members: [{ projectKey: 'k1', projectName: 'P', projectDir: await tmp(), worktreeDir: join(rr, 'repos', 'k1') }],
  });
  assert.equal(rc.mcpConfigPath, null, 'so --mcp-config is omitted entirely');
  assert.deepEqual(rc.mcpServerNames, []);
  assert.ok(!existsSync(join(rr, 'mcp.json')));
});

test('§5.5: relative command + path-like args are absolutized; ${CLAUDE_PROJECT_DIR} is substituted', async () => {
  const real = await writeTree(await tmp('worca-cc-rc-mcpabs-'), {
    '.mcp.json': JSON.stringify({
      mcpServers: {
        srv: {
          command: './bin/serve.js',
          args: ['--root', './data', '${CLAUDE_PROJECT_DIR}/cfg.json', '--flag'],
          env: { PROJ: '${CLAUDE_PROJECT_DIR}' },
          type: 'stdio',
        },
      },
    }),
  });
  const out = await mergeMcpConfigs({
    members: [{ projectKey: 'k1', projectName: 'P', projectDir: real, worktreeDir: null }],
    projectsRoot: await emptyDir(), homeDir: await emptyDir(), isWorkspace: true, platform: 'darwin',
  });
  const s = out.servers.srv;
  // The relative command forces the cd-wrap, so the ORIGINAL command is inside args.
  const argv = s.command === '/bin/sh' ? s.args.slice(4) : [s.command, ...s.args];
  assert.equal(argv[0], join(real, 'bin', 'serve.js'), 'relative command absolutized');
  assert.deepEqual(argv.slice(1), ['--root', join(real, 'data'), join(real, 'cfg.json'), '--flag']);
  assert.equal(s.env.PROJ, real, '${CLAUDE_PROJECT_DIR} -> the source member real dir');
  assert.equal(s.type, 'stdio', 'type passes through');
});

test('§5.5: the cd-wrap is argv-safe for a dir with a space AND a single quote', async () => {
  const base = await tmp('worca-cc-rc-mcpq-');
  const real = join(base, "My Drive's proj");
  await writeTree(real, {
    'server.js': '// the arg IS a path: it exists next to the config\n',
    '.mcp.json': JSON.stringify({ mcpServers: { srv: { command: 'node', args: ['server.js'], cwd: '.' } } }),
  });
  const out = await mergeMcpConfigs({
    members: [{ projectKey: 'k1', projectName: 'P', projectDir: real, worktreeDir: null }],
    projectsRoot: await emptyDir(), homeDir: await emptyDir(), isWorkspace: true, platform: 'darwin',
  });
  const s = out.servers.srv;
  assert.equal(s.command, '/bin/sh');
  assert.equal(s.args[0], '-c');
  assert.equal(s.args[1], 'cd "$1" && shift && exec "$@"');
  assert.equal(s.args[2], 'worca-cc-cd-wrap');
  assert.equal(s.args[3], real, 'the raw path is ONE argv slot — never re-parsed by a shell');
  assert.equal(s.args[4], 'node');
  assert.equal(s.args[5], join(real, 'server.js'));
  assert.ok(!s.args.some((a) => a.includes('\\')), 'nothing is shell-escaped: every element is a distinct slot');
});

test('§5.5: on win32 the cd-wrap is UNAVAILABLE — include un-wrapped + warn by name', async () => {
  const real = await writeTree(await tmp('worca-cc-rc-mcpwin-'), {
    '.mcp.json': JSON.stringify({ mcpServers: { srv: { command: 'node', args: ['s.js'], cwd: '.' } } }),
  });
  const out = await mergeMcpConfigs({
    members: [{ projectKey: 'k1', projectName: 'P', projectDir: real, worktreeDir: null }],
    projectsRoot: await emptyDir(), homeDir: await emptyDir(), isWorkspace: true, platform: 'win32',
  });
  assert.equal(out.servers.srv.command, 'node', 'not wrapped: /bin/sh does not exist on Windows');
  assert.ok(out.warnings.some((w) => /`srv`/.test(w) && /Windows|WSL/i.test(w)),
    `warned by name with the remedy: ${JSON.stringify(out.warnings)}`);
});

test('§5.5: every server name is normalized (__ -> _) and the mapping is recorded', async () => {
  const real = await writeTree(await tmp('worca-cc-rc-mcpnorm-'), {
    '.mcp.json': JSON.stringify({ mcpServers: { 'my__server': { command: 'node', args: ['x.js'] } } }),
  });
  const out = await mergeMcpConfigs({
    members: [{ projectKey: 'k1', projectName: 'P', projectDir: real, worktreeDir: null }],
    projectsRoot: await emptyDir(), homeDir: await emptyDir(), isWorkspace: true, platform: 'darwin',
  });
  assert.deepEqual(Object.keys(out.servers), ['my_server'],
    'otherwise mcp__my__server__ping mis-splits into server `my` / tool `server__ping`');
  assert.equal(out.renames.mcpServers.my_server, 'my__server');
});

test('§5.5: byte-identical definitions de-dup; genuinely different ones are RENAMED, never dropped', async () => {
  const def = { command: 'node', args: ['/abs/x.js'] };
  const a = await writeTree(await tmp('worca-cc-rc-dupa-'), { '.mcp.json': JSON.stringify({ mcpServers: { db: def, same: def } }) });
  const b = await writeTree(await tmp('worca-cc-rc-dupb-'), {
    '.mcp.json': JSON.stringify({ mcpServers: { db: { command: 'node', args: ['/abs/other.js'] }, same: def } }),
  });
  const projectsRoot = await writeTree(await tmp('worca-cc-rc-dupr-'), {
    '.mcp.json': JSON.stringify({ mcpServers: { db: { command: 'node', args: ['/abs/root.js'] } } }),
  });
  const out = await mergeMcpConfigs({
    members: [
      { projectKey: 'a-1', projectName: 'Alpha', projectDir: a, worktreeDir: null },
      { projectKey: 'b-2', projectName: 'Beta', projectDir: b, worktreeDir: null },
    ],
    projectsRoot, homeDir: await emptyDir(), isWorkspace: true, platform: 'darwin',
  });
  assert.deepEqual(Object.keys(out.servers).sort(), ['beta-db', 'db', 'root-db', 'same']);
  assert.equal(out.servers.db.args[0], '/abs/x.js', 'the first occupant in the PINNED read order keeps the name');
  assert.equal(out.servers['beta-db'].args[0], '/abs/other.js', 'member-sourced later occupant: <memberSlug>-<server>');
  assert.equal(out.servers['root-db'].args[0], '/abs/root.js', 'root-sourced later occupant: root-<server>');
  assert.deepEqual(out.renames.mcpServers, { 'beta-db': 'db', 'root-db': 'db' });
});

test('§5.5: the pinned read order is members (by projectKey) then the root layer LAST', async () => {
  const mk = async (p, file) => writeTree(await tmp(p), {
    '.mcp.json': JSON.stringify({ mcpServers: { db: { command: 'node', args: [file] } } }),
  });
  const b = await mk('worca-cc-rc-ordb-', '/abs/b.js');
  const a = await mk('worca-cc-rc-orda-', '/abs/a.js');
  const projectsRoot = await mk('worca-cc-rc-ordr-', '/abs/root.js');
  const out = await mergeMcpConfigs({
    // deliberately passed out of order: the module sorts by projectKey itself
    members: [
      { projectKey: 'zz-b', projectName: 'B', projectDir: b, worktreeDir: null },
      { projectKey: 'aa-a', projectName: 'A', projectDir: a, worktreeDir: null },
    ],
    projectsRoot, homeDir: await emptyDir(), isWorkspace: true, platform: 'darwin',
  });
  assert.equal(out.servers.db.args[0], '/abs/a.js', 'lowest projectKey is the first occupant');
  assert.equal(out.servers['b-db'].args[0], '/abs/b.js');
  assert.equal(out.servers['root-db'].args[0], '/abs/root.js', 'a root server never silently claims a member name');
});

test('§5.5 / V3(d): a cross-scope duplicate in single mode warns by name; an identical one is skipped but still granted', async () => {
  const committed = { mcpServers: { db: { command: 'node', args: ['/abs/db.js'] } } };
  const wt = await writeTree(await tmp('worca-cc-rc-xs-wt-'), { '.mcp.json': JSON.stringify(committed) });
  const real = await writeTree(await tmp('worca-cc-rc-xs-real-'), { '.mcp.json': JSON.stringify(committed) });
  const member = { projectKey: 'k1', projectName: 'P', projectDir: real, worktreeDir: wt };
  const base = { projectsRoot: await emptyDir(), homeDir: await emptyDir(), isWorkspace: false, platform: 'darwin' };

  const identical = await mergeMcpConfigs({ members: [member], ...base });
  assert.equal(identical.servers.db, undefined, 'nothing to disambiguate: the generated entry is skipped');
  assert.deepEqual(identical.nativeOnly, ['db'], 'but the server IS effective, so it must still be granted');

  // Now the working copy differs from the commit (E6's whole point).
  await writeFile(join(real, '.mcp.json'),
    JSON.stringify({ mcpServers: { db: { command: 'node', args: ['/abs/db-edited.js'] } } }), 'utf8');
  const differing = await mergeMcpConfigs({ members: [member], ...base });
  assert.equal(differing.servers.db.args[0], '/abs/db-edited.js', 'the generated (config-scope) definition is effective');
  const w = differing.warnings.find((x) => /`db`/.test(x));
  assert.ok(w, `warned by name: ${JSON.stringify(differing.warnings)}`);
  assert.match(w, /V3\(d\)/);
  assert.match(w, /config/, 'V3(d) recorded CONFIG scope as effective on this CLI version');
});

test('§5.5 source 3 / V4: local scope is harvested under the GIT ROOT key, not the member path', async () => {
  const repo = await gitRepo('worca-cc-rc-v4-');
  const sub = join(repo, 'packages', 'app');
  await mkdir(sub, { recursive: true });
  const home = await tmp('worca-cc-rc-v4-home-');
  await writeFile(join(home, '.claude.json'), JSON.stringify({
    projects: {
      [repo]: { mcpServers: { local1: { command: 'node', args: ['/abs/local.js'] } } },
      [sub]: { mcpServers: { wrongkey: { command: 'node', args: ['/abs/nope.js'] } } },
    },
  }), 'utf8');
  const out = await mergeMcpConfigs({
    members: [{ projectKey: 'k1', projectName: 'P', projectDir: sub, worktreeDir: null }],
    projectsRoot: await emptyDir(), homeDir: home, isWorkspace: true, platform: 'darwin',
  });
  assert.ok(out.servers.local1, `the git-root key was used: ${JSON.stringify(Object.keys(out.servers))}`);
  assert.equal(out.servers.wrongkey, undefined,
    'the CLI\'s "[project: …]" line lies — projects[] is keyed by the git toplevel (V4)');
});

test('§5.5 source 3: a local-scope SHAPE mismatch produces a named warning, never silence', async () => {
  const dir = await tmp('worca-cc-rc-v4bad-');
  const home = await tmp('worca-cc-rc-v4bad-home-');
  await writeFile(join(home, '.claude.json'),
    JSON.stringify({ projects: { [dir]: { mcpServers: 'not-an-object' } } }), 'utf8');
  const out = await mergeMcpConfigs({
    members: [{ projectKey: 'shape-1', projectName: 'P', projectDir: dir, worktreeDir: null }],
    projectsRoot: await emptyDir(), homeDir: home, isWorkspace: true, platform: 'darwin',
  });
  assert.deepEqual(Object.keys(out.servers), []);
  const w = out.warnings.find((x) => x.includes('shape-1'));
  assert.ok(w, `named by member: ${JSON.stringify(out.warnings)}`);
  assert.match(w, /local[- ]scope/i);
  assert.match(w, /\.mcp\.json/, 'the remedy is stated');
});

test('§5.5: a missing .mcp.json is SILENT (absence is normal); an unparseable one warns by path', async () => {
  const none = await tmp('worca-cc-rc-mcpnone-');
  const bad = await writeTree(await tmp('worca-cc-rc-mcpbad-'), { '.mcp.json': '{ not json' });
  const base = { projectsRoot: await emptyDir(), homeDir: await emptyDir(), isWorkspace: true, platform: 'darwin' };
  const quiet = await mergeMcpConfigs({
    members: [{ projectKey: 'k1', projectName: 'P', projectDir: none, worktreeDir: null }], ...base,
  });
  assert.deepEqual(quiet.warnings, []);
  const loud = await mergeMcpConfigs({
    members: [{ projectKey: 'k2', projectName: 'P', projectDir: bad, worktreeDir: null }], ...base,
  });
  assert.ok(loud.warnings.some((w) => w.includes(join(bad, '.mcp.json'))), JSON.stringify(loud.warnings));
});

test('§5.5: the generated mcp.json is written, valid JSON, and its servers are granted mcp__<name>', async () => {
  const real = await writeTree(await tmp('worca-cc-rc-mcpwrite-'), {
    '.mcp.json': JSON.stringify({ mcpServers: { db: { command: 'node', args: ['/abs/db.js'] } } }),
  });
  const rr = await mkRunRoot();
  const rc = await assemble({
    runRoot: rr, isWorkspace: true,
    members: [{ projectKey: 'k1', projectName: 'P', projectDir: real, worktreeDir: join(rr, 'repos', 'k1') }],
  });
  assert.equal(rc.mcpConfigPath, join(rr, 'mcp.json'));
  const parsed = JSON.parse(await readFile(rc.mcpConfigPath, 'utf8'));
  assert.ok(parsed.mcpServers.db, 'the CLI-expected { mcpServers: {...} } envelope');
  assert.deepEqual(rc.mcpServerNames, ['db']);
  const text = await readFile(rc.claudeMdPath, 'utf8');
  assert.match(text, /`db`/, 'the server roster is published to the model');
});

// ── §8.6 ancestor audit ─────────────────────────────────────────────────────

test('auditAncestors: every CLAUDE.md / .claude/skills from <runRoot> up to / is warned about', async () => {
  const base = await tmp('worca-cc-rc-anc-');
  await writeTree(base, { 'CLAUDE.md': 'contaminant\n', 'mid/.claude/skills/sneaky/SKILL.md': 'x\n' });
  const rr = join(base, 'mid', 'runs', 'pidanc01');
  await mkdir(rr, { recursive: true });
  const warnings = await auditAncestors(rr);
  assert.ok(warnings.some((w) => w.includes(join(base, 'CLAUDE.md'))), JSON.stringify(warnings));
  assert.ok(warnings.some((w) => w.includes(join(base, 'mid', '.claude', 'skills'))), JSON.stringify(warnings));
  // the run root's OWN generated files are worca-cc's, not contamination
  await writeTree(rr, { 'CLAUDE.md': 'mine\n' });
  const again = await auditAncestors(rr);
  assert.ok(!again.some((w) => w.includes(join(rr, 'CLAUDE.md'))), 'the run root itself is not an ancestor');
});

// ── §5.2 run.json extension ─────────────────────────────────────────────────

test('run.json: assembly extends the manifest with injectedPaths / skillResolutions / renames / bytes / warnings', async () => {
  const real = await writeTree(await tmp('worca-cc-rc-man-'), {
    'CLAUDE.md': 'MEM\n',
    '.claude/skills/deploy/SKILL.md': '---\nname: deploy\n---\nX\n',
    '.mcp.json': JSON.stringify({ mcpServers: { 'db__x': { command: 'node', args: ['/abs/d.js'] } } }),
  });
  const bundle = await writeTree(await tmp('worca-cc-rc-manb-'), { 'imagegen/SKILL.md': '---\nname: imagegen\n---\n' });
  const rr = await mkRunRoot('pidman01');
  // Phase 1 already wrote a minimal manifest; assembly must EXTEND, not replace it.
  const { writeRunManifest } = await import('../src/core/run-manifest.mjs');
  await writeRunManifest(rr, { pipelineId: 'pidman01', runRootMode: 'detached', isWorkspace: true, members: [] });

  const resolutions = new Map([
    ['imagegen', { source: 'bundle', path: join(bundle, 'imagegen'), requiredBy: ['artDirector'] }],
  ]);
  const rc = await withSettings({}, async () => assemble({
    runRoot: rr, isWorkspace: true,
    members: [{ projectKey: 'k1', projectName: 'P', projectDir: real, worktreeDir: join(rr, 'repos', 'k1') }],
    requiredSkillResolutions: resolutions,
  }));

  const m = await readRunManifest(rr);
  assert.equal(m.pipelineId, 'pidman01', 'the Phase-1 fields survive');
  assert.equal(m.runRootMode, 'detached');
  assert.deepEqual(m.injectedPaths, rc.injectedPaths);
  assert.deepEqual(m.skillResolutions, {
    imagegen: { source: 'bundle', path: join(bundle, 'imagegen'), requiredBy: ['artDirector'] },
  }, 'the resume path feeds this back as requiredSkillResolutions (§5.2 — three keys)');
  assert.deepEqual(m.renames, rc.renames);
  assert.equal(m.bytes.total, rc.bytes.total);
  assert.deepEqual(m.warnings, rc.warnings);
  assert.equal(m.capabilities.mcpGrants, MCP_GRANT_MODE);
  assert.equal(m.mcpServerNames.length, 1);

  // A plain-OBJECT resolutions map (what readRunManifest returns on resume) works too.
  const rr2 = await mkRunRoot('pidman02');
  const again = await withSettings({}, async () => assemble({
    runRoot: rr2, isWorkspace: true,
    members: [{ projectKey: 'k1', projectName: 'P', projectDir: real, worktreeDir: join(rr2, 'repos', 'k1') }],
    requiredSkillResolutions: m.skillResolutions,
  }));
  assert.ok(again.injectedSkillNames.includes('imagegen'), 'resume restores the bundle mount from run.json');
});

test('assembleRunContext is idempotent: a second call over the same run root reproduces the bytes', async () => {
  const real = await writeTree(await tmp('worca-cc-rc-idem-'), {
    'CLAUDE.md': 'MEM\n',
    '.claude/skills/deploy/SKILL.md': '---\nname: deploy\n---\nX\n',
    '.mcp.json': JSON.stringify({ mcpServers: { db: { command: 'node', args: ['/abs/d.js'] } } }),
  });
  const rr = await mkRunRoot('pididem1');
  const members = [{ projectKey: 'k1', projectName: 'P', projectDir: real, worktreeDir: join(rr, 'repos', 'k1') }];
  const first = await withSettings({}, async () => assemble({ runRoot: rr, isWorkspace: true, members }));
  const md1 = await readFile(first.claudeMdPath, 'utf8');
  const mcp1 = await readFile(first.mcpConfigPath, 'utf8');
  const second = await withSettings({}, async () => assemble({ runRoot: rr, isWorkspace: true, members }));
  assert.equal(await readFile(second.claudeMdPath, 'utf8'), md1, 'self-healing re-assembly is byte-stable');
  assert.equal(await readFile(second.mcpConfigPath, 'utf8'), mcp1);
  assert.deepEqual(second.injectedPaths, first.injectedPaths);
});

// ── §8.21: project sub-agents lost at a run-root cwd ────────────────────────
// The carrier set is derived INSIDE the assembly from each member's WORKTREE (the
// same committed-blob source, E6), so a resume re-assembly reproduces the roster note
// and the warning with no extra manifest state. Assembly runs on detached runs only,
// and this is gated on isWorkspace inside it — so legacy (no assembly at all) and
// single-project generated docs are untouched.

/** Extract one `## <heading>` section (up to the next `## `) from generated markdown. */
function sectionOf(md, heading) {
  const i = md.indexOf(`## ${heading}`);
  if (i < 0) return null;
  const rest = md.slice(i + 3);
  const j = rest.indexOf('\n## ');
  return j < 0 ? rest : rest.slice(0, j);
}

test('§8.21: a workspace member with committed .claude/agents is WARNED and named in the roster', async () => {
  const rr = await mkRunRoot('pidagent1');
  const dirA = await writeTree(await tmp('worca-cc-rc-a-'), { 'CLAUDE.md': 'A\n' });
  const dirB = await writeTree(await tmp('worca-cc-rc-b-'), { 'CLAUDE.md': 'B\n' });
  // The worktree is what the agent's cwd would have carried: committed blobs only.
  const wtA = await writeTree(join(rr, 'repos', 'a-1111'), {
    '.claude/agents/db-migrator.md': '---\nname: db-migrator\n---\nbody\n',
    '.claude/agents/notes.txt': 'not an agent\n',
  });
  const wtB = join(rr, 'repos', 'b-2222');
  await mkdir(wtB, { recursive: true });

  const rc = await withSettings({}, async () => assemble({
    runRoot: rr, isWorkspace: true,
    members: [
      { projectKey: 'a-1111', projectName: 'alpha', projectDir: dirA, worktreeDir: wtA },
      { projectKey: 'b-2222', projectName: 'beta', projectDir: dirB, worktreeDir: wtB },
    ],
  }));

  // (1) run.json.warnings / rc.warnings — one entry, for the carrier only.
  const warns = rc.warnings.filter((w) => /sub-agents/.test(w));
  assert.equal(warns.length, 1, `only the carrier warns: ${JSON.stringify(warns)}`);
  assert.match(warns[0], /alpha/);
  assert.match(warns[0], /not discoverable on workspace runs \(cwd is the run root\)/);
  assert.match(warns[0], /~\/\.claude\/agents/);
  assert.match(warns[0], /db-migrator\.md/);
  assert.doesNotMatch(warns[0], /notes\.txt/, 'only .md agents count');
  const manifest = await readRunManifest(rr);
  assert.ok((manifest.warnings || []).some((w) => /sub-agents/.test(w)), 'durable in run.json');

  // (2) the generated roster carries the note, naming the carrier and NOT the other.
  const md = await readFile(rc.claudeMdPath, 'utf8');
  const note = sectionOf(md, 'Project sub-agents NOT in force');
  assert.ok(note, `the roster note is present:\n${md.slice(0, 900)}`);
  assert.match(note, /alpha/);
  assert.match(note, /db-migrator\.md/);
  assert.match(note, /~\/\.claude\/agents/, 'personal agents still work');
  assert.doesNotMatch(note, /beta/, 'a member with no committed agents is not named');
  // …and the member's own roster entry says so too.
  assert.match(sectionOf(md, 'Projects in this run'), /sub-agents/);
});

test('§8.21: the roster note is idempotent across a re-assembly (the resume path)', async () => {
  const rr = await mkRunRoot('pidagent2');
  const real = await writeTree(await tmp('worca-cc-rc-idemag-'), { 'CLAUDE.md': 'M\n' });
  const wt = await writeTree(join(rr, 'repos', 'k1'), {
    '.claude/agents/b.md': 'b\n', '.claude/agents/a.md': 'a\n',
  });
  const members = [{ projectKey: 'k1', projectName: 'P', projectDir: real, worktreeDir: wt }];
  const first = await withSettings({}, async () => assemble({ runRoot: rr, isWorkspace: true, members }));
  const md1 = await readFile(first.claudeMdPath, 'utf8');
  const second = await withSettings({}, async () => assemble({ runRoot: rr, isWorkspace: true, members }));
  assert.equal(await readFile(second.claudeMdPath, 'utf8'), md1, 'byte-stable re-assembly');
  assert.deepEqual(second.warnings.filter((w) => /sub-agents/.test(w)),
    first.warnings.filter((w) => /sub-agents/.test(w)), 'one warning, not two');
  assert.match(md1, /a\.md, b\.md/, 'agent names render in sorted order (deterministic)');
});

test('§8.21: NO note for a workspace with no carriers, and NONE for single-project runs', async () => {
  // (a) workspace, nobody carries agents.
  const rr1 = await mkRunRoot('pidagent3');
  const d1 = await writeTree(await tmp('worca-cc-rc-n1-'), { 'CLAUDE.md': 'X\n' });
  const wt1 = join(rr1, 'repos', 'k1');
  await mkdir(wt1, { recursive: true });
  const rc1 = await withSettings({}, async () => assemble({
    runRoot: rr1, isWorkspace: true,
    members: [{ projectKey: 'k1', projectName: 'P', projectDir: d1, worktreeDir: wt1 }],
  }));
  const md1 = await readFile(rc1.claudeMdPath, 'utf8');
  assert.doesNotMatch(md1, /sub-agents/, 'no carriers -> the note is absent entirely');
  assert.equal(rc1.warnings.filter((w) => /sub-agents/.test(w)).length, 0);

  // (b) SINGLE-PROJECT detached run whose worktree DOES carry agents: cwd is that
  // checkout, so the agents are discoverable and nothing is lost (§5.7).
  const rr2 = await mkRunRoot('pidagent4');
  const d2 = await writeTree(await tmp('worca-cc-rc-n2-'), { 'CLAUDE.md': 'Y\n' });
  const wt2 = await writeTree(join(rr2, 'repos', 'k2'), { '.claude/agents/keep.md': 'k\n' });
  const rc2 = await withSettings({}, async () => assemble({
    runRoot: rr2, isWorkspace: false,
    members: [{ projectKey: 'k2', projectName: 'Q', projectDir: d2, worktreeDir: wt2 }],
  }));
  const md2 = await readFile(rc2.claudeMdPath, 'utf8');
  assert.doesNotMatch(md2, /sub-agents/, 'single-project generated docs are unchanged');
  assert.equal(rc2.warnings.filter((w) => /sub-agents/.test(w)).length, 0);
});

// ── §5.1: the containment warning ───────────────────────────────────────────
// Registration is deliberately UNCONSTRAINED (§5.1) — a project or workspace member
// may live anywhere. That freedom is only honest if the surprise is named, so a member
// whose real dir is not under `projectsRoot` is WARNED about, never rejected. Derived
// inside the assembly like §8.21, so it is resume-idempotent and rides run.json.

const containment = (ws) => ws.filter((w) => /projects root/.test(w) && /not under/.test(w));

test('§5.1: a member OUTSIDE projectsRoot is warned by name; the run proceeds', async () => {
  const proot = await tmp('worca-cc-rc-proot-');
  const inside = await writeTree(join(proot, 'nested', 'in-root'), { 'CLAUDE.md': 'IN\n' });
  const outside = await writeTree(await tmp('worca-cc-rc-outside-'), { 'CLAUDE.md': 'OUT\n' });
  const rr = await mkRunRoot('pidcontain1');
  const rc = await assemble({
    runRoot: rr, isWorkspace: true, projectsRoot: proot,
    members: [
      { projectKey: 'a-in', projectName: 'Inside', projectDir: inside, worktreeDir: join(rr, 'repos', 'a-in') },
      { projectKey: 'z-out', projectName: 'Outside', projectDir: outside, worktreeDir: join(rr, 'repos', 'z-out') },
    ],
  });
  const hits = containment(rc.warnings);
  assert.equal(hits.length, 1, `only the outsider warns: ${JSON.stringify(rc.warnings)}`);
  assert.match(hits[0], /Outside/, 'names the member');
  assert.ok(hits[0].includes(outside), 'names its real dir');
  assert.ok(hits[0].includes(proot), 'names the projects root it is not under');
  assert.doesNotMatch(hits[0], /Inside/);
  // Never a failure: both members still render and the doc is written.
  const md = await readFile(rc.claudeMdPath, 'utf8');
  assert.match(md, /^## Project: Outside — repos\/z-out$/m);
  assert.match(md, /OUT/, 'the outsider still contributes its memory');
  // Durable (§5.2) and idempotent across a re-assembly (the resume path).
  const manifest = await readRunManifest(rr);
  assert.deepEqual(containment(manifest.warnings || []), hits, 'durable in run.json');
  const again = await assemble({
    runRoot: rr, isWorkspace: true, projectsRoot: proot,
    members: [
      { projectKey: 'a-in', projectName: 'Inside', projectDir: inside, worktreeDir: join(rr, 'repos', 'a-in') },
      { projectKey: 'z-out', projectName: 'Outside', projectDir: outside, worktreeDir: join(rr, 'repos', 'z-out') },
    ],
  });
  assert.deepEqual(containment(again.warnings), hits, 're-assembly re-derives it once, not twice');
});

test('§5.1: a member AT projectsRoot, or below it, does NOT warn (the home-as-root shape)', async () => {
  const proot = await tmp('worca-cc-rc-proot-at-');
  await writeFile(join(proot, 'CLAUDE.md'), 'ROOT\n', 'utf8');
  const rr = await mkRunRoot('pidcontain2');
  const rc = await assemble({
    runRoot: rr, isWorkspace: true, projectsRoot: proot,
    // projectDir === projectsRoot exactly: `isUnder` treats equality as inside.
    members: [{ projectKey: 'k1', projectName: 'AtRoot', projectDir: proot, worktreeDir: join(rr, 'repos', 'k1') }],
  });
  assert.deepEqual(containment(rc.warnings), [], JSON.stringify(rc.warnings));
});

test('§5.1: NO per-member containment noise when projectsRoot itself is unusable', async () => {
  // The whole root layer is already reported as contributing nothing (§8.20); adding
  // one "not under" line per member would say the same thing N more times.
  const missing = join(await tmp('worca-cc-rc-proot-gone-'), 'not-there');
  const rc = await assemble({
    runRoot: await mkRunRoot('pidcontain3'), isWorkspace: true, projectsRoot: missing,
    members: [{ projectKey: 'k1', projectName: 'P', projectDir: await tmp(), worktreeDir: 'x' }],
  });
  assert.deepEqual(containment(rc.warnings), [], JSON.stringify(rc.warnings));
  assert.equal(rc.warnings.filter((w) => w.includes(missing)).length, 1, 'still exactly the one root warning');
});

// ── §8.19: committed project settings lost at a run-root cwd ────────────────
// Read off the member's WORKTREE — the committed blob (E6) is exactly the file the
// CLI WOULD have loaded back when a workspace node's cwd was the config-source
// member's checkout. Same derivation site and idempotency as §8.21.

const settingsWarn = (ws) => ws.filter((w) => /project hooks\/permissions/.test(w));

test('§8.19: a workspace member with a committed .claude/settings.json is warned by name + keys', async () => {
  const rr = await mkRunRoot('pidsettings1');
  const dirA = await writeTree(await tmp('worca-cc-rc-sa-'), { 'CLAUDE.md': 'A\n' });
  const dirB = await writeTree(await tmp('worca-cc-rc-sb-'), { 'CLAUDE.md': 'B\n' });
  const wtA = await writeTree(join(rr, 'repos', 'a-1111'), {
    '.claude/settings.json': JSON.stringify({
      permissions: { allow: ['Bash(npm run lint)'] },
      hooks: { PostToolUse: [] },
      statusLine: { type: 'command', command: 'x' },
    }),
  });
  const wtB = join(rr, 'repos', 'b-2222');
  await mkdir(wtB, { recursive: true });

  const rc = await assemble({
    runRoot: rr, isWorkspace: true,
    members: [
      { projectKey: 'a-1111', projectName: 'alpha', projectDir: dirA, worktreeDir: wtA },
      { projectKey: 'b-2222', projectName: 'beta', projectDir: dirB, worktreeDir: wtB },
    ],
  });

  const hits = settingsWarn(rc.warnings);
  assert.equal(hits.length, 1, `only the carrier warns: ${JSON.stringify(rc.warnings)}`);
  assert.match(hits[0], /alpha/);
  assert.match(hits[0], /do not apply on workspace runs \(cwd is the run root\)/);
  assert.match(hits[0], /frontmatter `tools:`/, 'the documented remedy is stated');
  assert.match(hits[0], /requiresSkills/);
  assert.match(hits[0], /hooks, permissions, statusLine/, 'the keys found are named, sorted');
  assert.doesNotMatch(hits[0], /beta/, 'a member without the file is not named');
  const manifest = await readRunManifest(rr);
  assert.deepEqual(settingsWarn(manifest.warnings || []), hits, 'durable in run.json');
});

test('§8.19: idempotent across a re-assembly (the resume path)', async () => {
  const rr = await mkRunRoot('pidsettings2');
  const real = await writeTree(await tmp('worca-cc-rc-sidem-'), { 'CLAUDE.md': 'M\n' });
  const wt = await writeTree(join(rr, 'repos', 'k1'), {
    '.claude/settings.json': JSON.stringify({ hooks: { PostToolUse: [{ matcher: 'Edit' }] } }),
  });
  const members = [{ projectKey: 'k1', projectName: 'P', projectDir: real, worktreeDir: wt }];
  const first = await assemble({ runRoot: rr, isWorkspace: true, members });
  const second = await assemble({ runRoot: rr, isWorkspace: true, members });
  assert.equal(settingsWarn(first.warnings).length, 1);
  assert.deepEqual(settingsWarn(second.warnings), settingsWarn(first.warnings), 'one warning, not two');
});

test('§8.19: NO warning for single-project runs, an absent file, or an empty {}', async () => {
  // (a) SINGLE-project detached run: cwd IS a checkout, so its committed settings apply.
  const rr1 = await mkRunRoot('pidsettings3');
  const d1 = await writeTree(await tmp('worca-cc-rc-s1-'), { 'CLAUDE.md': 'X\n' });
  const wt1 = await writeTree(join(rr1, 'repos', 'k1'), {
    '.claude/settings.json': JSON.stringify({ hooks: { PostToolUse: [] } }),
  });
  const rc1 = await assemble({
    runRoot: rr1, isWorkspace: false,
    members: [{ projectKey: 'k1', projectName: 'P', projectDir: d1, worktreeDir: wt1 }],
  });
  assert.deepEqual(settingsWarn(rc1.warnings), [], 'single mode is unaffected');

  // (b) workspace, but the file is absent / carries nothing.
  const rr2 = await mkRunRoot('pidsettings4');
  const d2 = await writeTree(await tmp('worca-cc-rc-s2-'), { 'CLAUDE.md': 'Y\n' });
  const wtNone = join(rr2, 'repos', 'none');
  await mkdir(wtNone, { recursive: true });
  const wtEmpty = await writeTree(join(rr2, 'repos', 'empty'), { '.claude/settings.json': '{}' });
  const rc2 = await assemble({
    runRoot: rr2, isWorkspace: true,
    members: [
      { projectKey: 'none', projectName: 'None', projectDir: d2, worktreeDir: wtNone },
      { projectKey: 'empty', projectName: 'Empty', projectDir: d2, worktreeDir: wtEmpty },
    ],
  });
  assert.deepEqual(settingsWarn(rc2.warnings), [], `nothing carried => nothing lost: ${JSON.stringify(rc2.warnings)}`);
});

test('§8.19: an UNPARSEABLE committed settings.json still warns (we cannot prove it carries nothing)', async () => {
  const rr = await mkRunRoot('pidsettings5');
  const real = await writeTree(await tmp('worca-cc-rc-sbad-'), { 'CLAUDE.md': 'M\n' });
  const wt = await writeTree(join(rr, 'repos', 'k1'), { '.claude/settings.json': '{ not json' });
  const rc = await assemble({
    runRoot: rr, isWorkspace: true,
    members: [{ projectKey: 'k1', projectName: 'P', projectDir: real, worktreeDir: wt }],
  });
  const hits = settingsWarn(rc.warnings);
  assert.equal(hits.length, 1, JSON.stringify(rc.warnings));
  assert.match(hits[0], /could not be parsed/i);
});

test('§8.19 v2: member DENY rules are LIFTED by default; warning names only the remaining keys', async () => {
  const rr = await mkRunRoot('pidsettings6');
  const real = await writeTree(await tmp('worca-cc-rc-slift-'), { 'CLAUDE.md': 'M\n' });
  const wt = await writeTree(join(rr, 'repos', 'k1'), {
    '.claude/settings.json': JSON.stringify({
      permissions: { deny: ['Read(.env*)', 'Bash(curl:*)'], allow: ['Bash(npm run lint)'] },
      hooks: { PostToolUse: [] },
    }),
  });
  const rc = await assemble({
    runRoot: rr, isWorkspace: true,
    members: [{ projectKey: 'k1', projectName: 'alpha', projectDir: real, worktreeDir: wt }],
  });
  assert.deepEqual(rc.projectPermissions, { deny: ['Read(.env*)', 'Bash(curl:*)'] },
    'deny lifted; allow NOT lifted');
  const hits = settingsWarn(rc.warnings);
  assert.equal(hits.length, 1, JSON.stringify(rc.warnings));
  assert.match(hits[0], /keys: hooks\)/, 'only the remaining keys are named');
  assert.doesNotMatch(hits[0], /keys:.*permissions/, 'permissions left the not-in-force list');
  assert.match(hits[0], /deny rules WERE lifted/, 'the appended sentence says so');
  const manifest = await readRunManifest(rr);
  assert.deepEqual(manifest.projectPermissions, { deny: ['Read(.env*)', 'Bash(curl:*)'] },
    'durable in run.json (the audit record)');
});

test('§8.19 v2: a deny-only permissions-ONLY settings file lifts silently — no warning for that member', async () => {
  const rr = await mkRunRoot('pidsettings7');
  const real = await writeTree(await tmp('worca-cc-rc-ssilent-'), { 'CLAUDE.md': 'M\n' });
  const wt = await writeTree(join(rr, 'repos', 'k1'), {
    '.claude/settings.json': JSON.stringify({ permissions: { deny: ['Edit(secrets/**)'] } }),
  });
  const rc = await assemble({
    runRoot: rr, isWorkspace: true,
    members: [{ projectKey: 'k1', projectName: 'P', projectDir: real, worktreeDir: wt }],
  });
  assert.deepEqual(rc.projectPermissions, { deny: ['Edit(secrets/**)'] });
  assert.deepEqual(settingsWarn(rc.warnings), [], `nothing remains unhonored: ${JSON.stringify(rc.warnings)}`);
});

test('§8.19 v2: per-member honor — an opted-out member is NOT lifted (full warning), its neighbour still is', async () => {
  const rr = await mkRunRoot('pidsettings8');
  const realA = await writeTree(await tmp('worca-cc-rc-sha-'), { 'CLAUDE.md': 'A\n' });
  const realB = await writeTree(await tmp('worca-cc-rc-shb-'), { 'CLAUDE.md': 'B\n' });
  const wtA = await writeTree(join(rr, 'repos', 'a-1111'), {
    '.claude/settings.json': JSON.stringify({
      permissions: { deny: ['Read(a-secret*)'] }, hooks: { PostToolUse: [] },
    }),
  });
  const wtB = await writeTree(join(rr, 'repos', 'b-2222'), {
    '.claude/settings.json': JSON.stringify({ permissions: { deny: ['Read(b-secret*)'] } }),
  });
  const rc = await assemble({
    runRoot: rr, isWorkspace: true,
    members: [
      { projectKey: 'a-1111', projectName: 'alpha', projectDir: realA, worktreeDir: wtA },
      { projectKey: 'b-2222', projectName: 'beta', projectDir: realB, worktreeDir: wtB },
    ],
    // alpha SAVED honorProjectSettings:false; beta is ABSENT from the map
    // (unconfigured => honored) — the `.get() !== false` default under test.
    honorByKey: new Map([['a-1111', false]]),
  });
  assert.deepEqual(rc.projectPermissions, { deny: ['Read(b-secret*)'] },
    'only the honored member lifts; a neighbour can never force-lift alpha');
  const hits = settingsWarn(rc.warnings);
  assert.equal(hits.length, 1, `alpha warns in full, beta lifts silently: ${JSON.stringify(rc.warnings)}`);
  assert.match(hits[0], /alpha/);
  assert.match(hits[0], /keys: hooks, permissions\)/, 'not-honored keeps today\'s full keys list');
  assert.doesNotMatch(hits[0], /WERE lifted/, 'no appended sentence when nothing lifted');
});

// ── S2: the manifest-rehydration skill-name guard ───────────────────────────
// `run.json` is read off disk on resume; a corrupt or hand-edited one must never
// become a write primitive through `join(target, effective)`. §8.20 posture applies:
// SKIP the entry with a named warning — never a throw, or a bad manifest would make a
// paused run unresumable.

test('S2: a manifest skillResolution with a traversing name is SKIPPED with a warning, never mounted', async () => {
  const rr = await mkRunRoot('pidevil1');
  const src = await writeTree(await tmp('worca-cc-rc-evilsrc-'), { 'SKILL.md': '---\nname: pwn\n---\nP\n' });
  const real = await writeTree(await tmp('worca-cc-rc-evilreal-'), { 'CLAUDE.md': 'R\n' });
  const rc = await assemble({
    runRoot: rr, isWorkspace: true,
    members: [{ projectKey: 'k1', projectName: 'P', projectDir: real, worktreeDir: join(rr, 'repos', 'k1') }],
    requiredSkillResolutions: {
      '../../../escape': { source: 'bundle', path: src, requiredBy: ['a'] },
      '..': { source: 'bundle', path: src, requiredBy: ['a'] },
      'ok': { source: 'bundle', path: src, requiredBy: ['a'] },
    },
  });

  assert.deepEqual(rc.injectedSkillNames, ['ok'], 'only the well-shaped entry is mounted');
  const skipped = rc.warnings.filter((w) => /invalid skill name/i.test(w));
  assert.equal(skipped.length, 2, `both offenders are named: ${JSON.stringify(rc.warnings)}`);
  assert.ok(skipped.some((w) => w.includes('../../../escape')));
  assert.ok(skipped.some((w) => w.includes('run.json')), 'the warning says where the entry came from');

  // Nothing landed outside `<runRoot>/.claude/skills/`.
  for (const rec of rc.injectedPaths.runRoot || []) {
    assert.match(rec.path, /^\.claude\/skills\/[A-Za-z0-9._-]+$/, `mount stays inside the mount dir: ${rec.path}`);
  }
  assert.ok(!existsSync(join(dirname(rr), 'escape')), 'no sibling of the run root was created');
  assert.deepEqual((await readdir(join(rr, '.claude', 'skills'))).sort(), ['ok']);

  // The corrupt entries are dropped from the persisted manifest too, so the corruption
  // does not survive into the next resume.
  const manifest = await readRunManifest(rr);
  assert.deepEqual(Object.keys(manifest.skillResolutions || {}), ['ok']);
});

// ── the audit line ──────────────────────────────────────────────────────────

test('renderContextAudit: the documented one-liner', () => {
  const line = renderContextAudit({
    memberCount: 2,
    bytes: { total: 41208, bySource: Object.fromEntries([...Array(7)].map((_, i) => [`/s${i}`, 1])) },
    injectedSkillNames: ['a', 'b', 'c', 'd', 'e'],
    mcpServerNames: ['x', 'y', 'z'],
    renames: { skills: { 'p-a': 'a' }, mcpServers: { 'p-x': 'x' } },
    warnings: ['w1', 'w2'],
  });
  assert.equal(
    line,
    'Context: 2 members, 7 memory sources inlined (41,208 bytes), 5 skills mounted (1 renamed), ' +
    '3 MCP servers merged (1 renamed), 2 warnings.',
  );
});

test('renderContextAudit: singulars, and the rename parenthetical is omitted at zero', () => {
  const line = renderContextAudit({
    memberCount: 1,
    bytes: { total: 12, bySource: { '/s': 12 } },
    injectedSkillNames: ['a'],
    mcpServerNames: [],
    renames: { skills: {}, mcpServers: {} },
    warnings: [],
  });
  assert.equal(
    line,
    'Context: 1 member, 1 memory source inlined (12 bytes), 1 skill mounted, 0 MCP servers merged, 0 warnings.',
  );
});

test('re-assembly PRUNES a stale skill mount whose source disappeared (never committed)', async () => {
  const real = await writeTree(await tmp('worca-cc-rc-stale-'), {
    '.claude/skills/keep/SKILL.md': '---\nname: keep\n---\nK\n',
    '.claude/skills/gone/SKILL.md': '---\nname: gone\n---\nG\n',
  });
  const rr = await mkRunRoot('pidstale');
  const wt = join(rr, 'repos', 'k1');
  const members = [{ projectKey: 'k1', projectName: 'P', projectDir: real, worktreeDir: wt }];
  const first = await withSettings({}, async () => assemble({ runRoot: rr, isWorkspace: false, members }));
  assert.deepEqual(first.injectedSkillNames.slice().sort(), ['gone', 'keep']);
  assert.ok(existsSync(join(wt, '.claude', 'skills', 'gone')));

  // The user deletes the skill while the run sits paused, then resumes.
  await rm(join(real, '.claude', 'skills', 'gone'), { recursive: true, force: true });
  const second = await withSettings({}, async () => assemble({ runRoot: rr, isWorkspace: false, members }));
  assert.deepEqual(second.injectedSkillNames, ['keep']);
  assert.ok(!existsSync(join(wt, '.claude', 'skills', 'gone')),
    'an entry we no longer record is no longer pathspec-excluded, so it must not be left in the checkout');
  assert.ok(second.warnings.some((w) => /stale skill mount/.test(w) && /gone/.test(w)),
    JSON.stringify(second.warnings));
});

test('§8.20 (resume shape): a member dir deleted BETWEEN assemblies degrades to worktree-only, never throws', async () => {
  const real = await writeTree(await tmp('worca-cc-rc-vanish-'), {
    'CLAUDE.md': 'REAL MEMORY\n',
    '.claude/skills/deploy/SKILL.md': '---\nname: deploy\n---\nD\n',
    '.mcp.json': JSON.stringify({ mcpServers: { db: { command: 'node', args: ['/abs/db.js'] } } }),
  });
  const rr = await mkRunRoot('pidvanis');
  const wt = join(rr, 'repos', 'k1');
  const members = [{ projectKey: 'k1', projectName: 'Vanish', projectDir: real, worktreeDir: wt }];
  const first = await withSettings({}, async () => assemble({ runRoot: rr, isWorkspace: true, members }));
  assert.match(await readFile(first.claudeMdPath, 'utf8'), /REAL MEMORY/);
  assert.deepEqual(first.mcpServerNames, ['db']);

  // The user moves/deletes the project while the run sits paused, then resumes.
  await rm(real, { recursive: true, force: true });
  const second = await withSettings({}, async () => assemble({ runRoot: rr, isWorkspace: true, members }));
  const text = await readFile(second.claudeMdPath, 'utf8');
  assert.match(text, /^## Project: Vanish — repos\/k1$/m, 'the roster stays symmetric');
  assert.match(text, /\*\(no CLAUDE\.md found in this project\)\*/, 'degraded to worktree-only context');
  assert.ok(second.warnings.some((w) => w.includes('k1') && w.includes(real)),
    `named warning, no throw: ${JSON.stringify(second.warnings)}`);
  assert.equal(second.mcpConfigPath, null, 'the vanished member contributes no servers');
  assert.deepEqual(second.injectedSkillNames, []);
});

// ── ENOENT vs a REAL read error (§5.5 source 3 "read error", §8.16 warn-by-name) ──
// Only ABSENCE is normal (§8.20). An EACCES/EIO on a source that IS there must warn
// by name — silence would let a permission change quietly delete a member's whole
// MCP or memory contribution. The source still degrades exactly as an absent one:
// it contributes nothing and the run proceeds (never a throw).

const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;

/** Run `fn` with `p` unreadable, restoring the mode in finally. */
async function withUnreadable(p, fn) {
  const { chmod: ch, stat: st } = await import('node:fs/promises');
  const mode = (await st(p)).mode & 0o777;
  await ch(p, 0o000);
  try { return await fn(); } finally { await ch(p, mode); }
}

test('an UNREADABLE ~/.claude.json warns by member and skips ONLY local scope (§5.5 source 3)', { skip: asRoot && 'root ignores file modes' }, async () => {
  const real = await writeTree(await tmp('worca-cc-rc-eacces-local-'), {
    '.mcp.json': JSON.stringify({ mcpServers: { projsrv: { command: 'node', args: ['/abs/p.js'] } } }),
  });
  const home = await tmp('worca-cc-rc-eacces-home-');
  const claudeJson = join(home, '.claude.json');
  await writeFile(claudeJson, JSON.stringify({ projects: {} }), 'utf8');
  const out = await withUnreadable(claudeJson, async () => mergeMcpConfigs({
    members: [{ projectKey: 'perm-1', projectName: 'P', projectDir: real, worktreeDir: null }],
    projectsRoot: await emptyDir(), homeDir: home, isWorkspace: true, platform: 'darwin',
  }));
  // Other sources are unaffected — project scope still delivers.
  assert.ok(out.servers.projsrv, `project scope still merged: ${JSON.stringify(Object.keys(out.servers))}`);
  const named = out.warnings.filter((w) => w.includes('perm-1') && /local[- ]scope/i.test(w));
  assert.equal(named.length, 1, `exactly one named warning: ${JSON.stringify(out.warnings)}`);
  assert.match(named[0], /EACCES/, 'the error code is named, not swallowed as "absence is normal"');
  assert.match(named[0], /\.mcp\.json/, 'and the remedy is stated');
});

test('an UNREADABLE member .mcp.json warns by path + code and contributes nothing', { skip: asRoot && 'root ignores file modes' }, async () => {
  const real = await writeTree(await tmp('worca-cc-rc-eacces-mcp-'), {
    '.mcp.json': JSON.stringify({ mcpServers: { hidden: { command: 'node', args: ['/abs/h.js'] } } }),
  });
  const file = join(real, '.mcp.json');
  const out = await withUnreadable(file, async () => mergeMcpConfigs({
    members: [{ projectKey: 'k1', projectName: 'P', projectDir: real, worktreeDir: null }],
    projectsRoot: await emptyDir(), homeDir: await emptyDir(), isWorkspace: true, platform: 'darwin',
  }));
  assert.deepEqual(Object.keys(out.servers), [], 'it degrades exactly like an absent file');
  const w = out.warnings.find((x) => x.includes(file));
  assert.ok(w, `warned by path: ${JSON.stringify(out.warnings)}`);
  assert.match(w, /EACCES/);
});

test('an UNREADABLE member CLAUDE.md warns by path + code and renders the §8.20 placeholder', { skip: asRoot && 'root ignores file modes' }, async () => {
  const real = await writeTree(await tmp('worca-cc-rc-eacces-md-'), { 'CLAUDE.md': 'SECRET MEMORY\n' });
  const file = join(real, 'CLAUDE.md');
  const rr = await mkRunRoot('pidperm1');
  const rc = await withUnreadable(file, async () => assemble({
    runRoot: rr, isWorkspace: true,
    members: [{ projectKey: 'md-1', projectName: 'Md', projectDir: real, worktreeDir: join(rr, 'repos', 'md-1') }],
  }));
  const text = await readFile(rc.claudeMdPath, 'utf8');
  assert.doesNotMatch(text, /SECRET MEMORY/, 'nothing was inlined');
  assert.match(text, /^## Project: Md — repos\/md-1$/m, 'the roster stays symmetric');
  assert.match(text, /\*\(no CLAUDE\.md found in this project\)\*/);
  const w = rc.warnings.find((x) => x.includes(file));
  assert.ok(w, `warned by path: ${JSON.stringify(rc.warnings)}`);
  assert.match(w, /EACCES/);
  assert.equal(rc.bytes.bySource[file], undefined, 'and it is not counted as inlined bytes');
});

test('an unreadable source warns ONCE per file per assembly, and a missing one stays silent', { skip: asRoot && 'root ignores file modes' }, async () => {
  const real = await writeTree(await tmp('worca-cc-rc-eacces-once-'), {
    'CLAUDE.md': 'A\n',
    '.claude/CLAUDE.md': 'B\n',
  });
  const rr = await mkRunRoot('pidonce1');
  const file = join(real, 'CLAUDE.md');
  const rc = await withUnreadable(file, async () => assemble({
    runRoot: rr, isWorkspace: true,
    members: [{ projectKey: 'o-1', projectName: 'O', projectDir: real, worktreeDir: join(rr, 'repos', 'o-1') }],
  }));
  assert.equal(rc.warnings.filter((w) => w.includes(file)).length, 1, JSON.stringify(rc.warnings));
  assert.match(await readFile(rc.claudeMdPath, 'utf8'), /^B$/m, 'the readable sibling is still inlined');
  // A file that simply is not there produces NO warning at all (absence is normal).
  // The member is placed UNDER projectsRoot so the §5.1 containment warning — a real
  // finding about registration, not about absence — stays out of this assertion.
  const proot = await tmp('worca-cc-rc-once-proot-');
  const under = join(proot, 'o-1');
  await mkdir(under, { recursive: true });
  const plain = await assemble({
    runRoot: await mkRunRoot('pidonce2'), isWorkspace: true, projectsRoot: proot,
    members: [{ projectKey: 'o-1', projectName: 'O', projectDir: under, worktreeDir: join(rr, 'repos', 'o-1') }],
  });
  assert.deepEqual(plain.warnings, [], `absence is silent: ${JSON.stringify(plain.warnings)}`);
});
