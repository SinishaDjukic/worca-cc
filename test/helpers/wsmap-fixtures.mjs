// test/helpers/wsmap-fixtures.mjs
// Fixture workspaces for the workspace-map detector tests (P3, P4). Each member
// is a fresh git repo with its files committed, so listMemberFiles sees them the
// way extract does. runDetector replays extract's per-member loop for ONE
// detector (claims → detect → finish) WITHOUT extract's try/catch: a detector
// that throws fails the test instead of being swallowed. It also stamps each
// fact with `norm` (normKey) and `test` (isTestPath) exactly as extract does.
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { listMemberFiles, readText, isTestPath } from '../../src/core/workspace-map/files.mjs';
import { normKey } from '../../src/shared/workspace-map/keys.mjs';

const KINDS = ['http', 'grpc', 'graphql', 'topic', 'pkg', 'db', 'service', 'other'];

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

/** Writes files into fresh git repos, one per member, commits them; returns Member[]
 *  (dir = projectDir) and a cleanup function. spec: { [memberName]: { [relPath]: string } }.
 *  remotes: { [memberName]: originUrl } adds `origin` to that member's repo. */
export async function makeWorkspace(spec, { prefix = 'worca-cc-wsmap-', remotes = {} } = {}) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const members = [];
  for (const name of Object.keys(spec).sort()) {
    const dir = join(root, name);
    await mkdir(dir, { recursive: true });
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'user.email', 't@t']);
    git(dir, ['config', 'user.name', 't']);
    git(dir, ['config', 'core.autocrlf', 'false']);
    git(dir, ['config', 'commit.gpgsign', 'false']);
    for (const [rel, content] of Object.entries(spec[name])) {
      const abs = join(dir, ...rel.split('/'));
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content);
    }
    if (remotes[name]) git(dir, ['remote', 'add', 'origin', remotes[name]]);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '--no-verify', '--allow-empty', '-m', 'fixture']); // no global hook (a secret scanner) sees the fake secrets
    members.push({ key: name, name, dir, projectDir: dir });
  }
  return { root, members, cleanup: () => rm(root, { recursive: true, force: true, maxRetries: 3 }) };
}

/** Runs one detector over one member the way extract does (claims → detect → finish). */
export async function runDetector(detector, member, members) {
  const { files } = await listMemberFiles(member.dir);
  const ctx = { member, members, files, state: {} };
  const out = { facts: [], aliases: [], unresolved: [], stack: [], role: null };
  const add = (r) => {
    if (!r) return;
    for (const f of r.facts || []) out.facts.push({ ...f, norm: normKey(f.kind, f.key), test: isTestPath(f.file) });
    for (const a of r.aliases || []) out.aliases.push({ ...a, member: a.member || member.key });
    out.unresolved.push(...(r.unresolved || []));
    for (const s of r.stack || []) if (!out.stack.includes(s)) out.stack.push(s);
    if (!out.role && r.role) out.role = r.role;
  };
  for (const rel of files) {
    if (!detector.claims(rel)) continue;
    const text = await readText(member.dir, rel);
    if (text == null) continue;
    add(detector.detect({ rel, text }, ctx));
  }
  if (typeof detector.finish === 'function') add(detector.finish(ctx));
  return out;
}

/** Sorted `key`s of the facts of one kind + dir (the usual assertion shape). */
export function keysOf(result, kind, dir) {
  return result.facts.filter((f) => f.kind === kind && f.dir === dir).map((f) => f.key).sort();
}

/** Every fact is well-formed and its `match` is a literal substring of its cited line. */
export function assertEvidence(member, result) {
  for (const f of result.facts) {
    const where = `${f.kind} ${f.dir} ${f.key} @ ${f.file}:${f.line}`;
    assert.ok(KINDS.includes(f.kind), `kind: ${where}`);
    assert.ok(f.dir === 'provides' || f.dir === 'consumes', `dir: ${where}`);
    assert.ok(typeof f.key === 'string' && f.key.length > 0, `key: ${where}`);
    assert.ok(!f.file.includes('\\') && !f.file.startsWith('/'), `posix member-relative file: ${where}`);
    assert.ok(Number.isInteger(f.line) && f.line >= 1, `line: ${where}`);
    assert.ok(typeof f.match === 'string' && f.match.length > 0 && f.match.length <= 200, `match size: ${where}`);
    const lines = readFileSync(join(member.dir, ...f.file.split('/')), 'utf8').split(/\r?\n/);
    assert.ok((lines[f.line - 1] || '').includes(f.match), `match "${f.match}" not on line: ${where}`);
  }
  for (const u of result.unresolved) {
    assert.ok(typeof u.raw === 'string' && typeof u.reason === 'string' && Number.isInteger(u.line), `unresolved shape: ${JSON.stringify(u)}`);
  }
}
