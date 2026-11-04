// test/split-by-feature-runbook.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const doc = readFileSync(new URL('../docs/split-by-feature.md', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const STEPS = ['1. Prepare', '2. Keep ready', '3. Readiness', '4. Freeze day', '5. After the freeze', '6. Before the next release'];
const section = (h) => { const i = doc.indexOf(`\n${h}`); assert.ok(i >= 0, h); const j = doc.indexOf('\n## ', i + 1); return doc.slice(i, j < 0 ? undefined : j); };

test('the Inputs table records the owner and the freeze window', () => {
  assert.match(doc, /^\| Go\/no-go owner \|/m); assert.match(doc, /^\| Freeze window \|/m);
  assert.match(doc, /^\| Go\/no-go owner \| Emil Angelov \|$/m);
});

test('the runbook table has the six steps in order, each with what to run, who and what pass means', () => {
  const rows = doc.split('\n').filter((l) => /^\| \d\. /.test(l));
  assert.deepEqual(rows.map((r) => r.split('|')[1].trim()), STEPS);
  for (const r of rows) assert.equal(r.split('|').slice(1, -1).filter((c) => c.trim()).length, 4, r);
});

test('both rollback procedures and the PR catch-up recipe are there, each ending with a Pass: line', () => {
  for (const h of ['## Rollback A', '## Rollback B', '## PR catch-up recipe']) {
    const last = section(h).split('\n').filter((l) => l.trim()).at(-1);
    assert.ok(last.startsWith('Pass: '), `${h} ends with: ${last}`);
  }
});

test('the catch-up recipe lets the tool make its scratch clones: nobody writes the marker by hand', () => {
  assert.doesNotMatch(doc, /touch\s+\S*worca-readiness-scratch/);
  assert.match(section('## PR catch-up recipe'), /readiness\.mjs split --rev \S+ --splitter-rev M\^ --out /);
});

test('every tool file and npm script the runbook names exists', () => {
  for (const [, f] of doc.matchAll(/\b(tools\/[\w./-]+\.(?:mjs|json))/g)) assert.ok(existsSync(new URL(`../${f}`, import.meta.url)), f);
  for (const [, s] of doc.matchAll(/npm run ([\w:-]+)/g)) assert.ok(s in pkg.scripts, s);
});

test('every parity run command names --a, --b and --out with a known target kind', () => {
  const cmds = [...doc.matchAll(/npm run parity -- run ([^`;\n]+)/g)].map((m) => m[1]);
  assert.ok(cmds.length >= 3);
  for (const c of cmds) {
    assert.match(c, /--out \S+/, c);
    for (const k of ['--a', '--b']) assert.match(c, new RegExp(`${k} (?:tree|package|docker):\\S+`), c);
  }
});

test('freeze day names the exact apply command, run twice, and no "revised --apply" placeholder is left', () => {
  assert.doesNotMatch(doc, /revised `?--apply/);
  const row = doc.split('\n').find((l) => l.startsWith('| 4. Freeze day |'));
  assert.ok(row.includes('`git fetch origin dev && git switch -c split/feature-migration origin/dev && node tools/split-by-feature.mjs --apply && node tools/split-by-feature.mjs --apply && git add -A && git commit -m "Split large files by feature (#919)"`'), row);
});

test('the migration checklist: phases A–E in order, owner and freeze, 🔒 on every owner-only step, the rollback rule', () => {
  const s = section('## Migration checklist');
  assert.match(s, /Owner: Emil Angelov/); assert.match(s, /frozen since 2026-11-01 at `bf92e1579`/);
  const ids = s.split('\n').filter((l) => /^\| [A-E]\d/.test(l)).map((l) => l.split('|')[1].trim());
  assert.deepEqual([...new Set(ids.map((x) => x[0]))], ['A', 'B', 'C', 'D', 'E']);
  for (const step of ['A2', 'A3', 'B3', 'C2', 'C3', 'D1', 'D6']) assert.ok(ids.includes(`${step} 🔒`), step);
  for (const l of s.split('\n').filter((x) => /^\| [A-E]\d/.test(x))) assert.equal(l.split('|').slice(1, -1).filter((c) => c.trim()).length, 5, l);
  assert.match(s, /Rollback: before D6 .*fix and repeat.*After D6, red means\s+`git revert M`.*Never reset or force-push\./s);
});

test('tags, backups and restore points: feature-split/before|after are annotated, D1 keeps a local branch and a verified bundle outside the repo', () => {
  const s = section('## Migration checklist');
  const row = (id) => s.split('\n').find((l) => l.startsWith(`| ${id}`));
  for (const [id, tag, word] of [['D1', 'feature-split/before', 'before'], ['D7', 'feature-split/after', 'after']]) {
    assert.ok(row(id).includes(`git tag -a ${tag} origin/dev -m "#919 split large files by feature: dev ${word} the migration commit, dev $(git rev-parse origin/dev), $(date +%F)"`), row(id));
  }
  assert.ok(row('D1').includes('`git branch backup/dev-before-feature-split feature-split/before`') && row('D1').includes('never pushed over'), row('D1'));
  assert.ok(row('D1').includes('git bundle verify ~/Backups/worca/dev-before-feature-split.bundle'), row('D1'));
  assert.doesNotMatch(doc, /pre-919|post-919|dev-pre-919/);
  const r = section('## Rollback');
  for (const [what, against] of [['The local branch', 'a remote force-push or deletion'], ['The protected remote branch', 'losing this machine'],
    ['The bundle', 'a corrupted repo'], ['The annotated tags', 'named references for revert and catch-up']]) {
    assert.match(r, new RegExp(`^\\| ${what} .*${against}`, 'm'), what);
  }
});
