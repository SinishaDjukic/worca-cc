// test/readiness-report.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, validateReport, missingEvidence, renderMarkdown, commentBody, CHECKS, SECTIONS, ROLLBACK_NOTE, GATE_NOTE, SPLITTER_NOTE, cell, code } from '../tools/readiness/report.mjs';

const SHA = '04370c0f6cc31ae00f53c3b4c286211b970c3084';
const ev = (id) => [{ label: `${id}.log`, href: `evidence/${id}.log` }];
const all = (status = 'pass') => Object.keys(CHECKS).map((id) => ({ id, title: id, status, detail: 'ok', evidence: ev(id) }));
const make = (checks = all(), openPrs = []) => buildReport({ repo: 'SinishaDjukic/worca-cc', sha: SHA, generatedAt: '2026-10-30T12:00:00Z', toolCommit: SHA, checks, openPrs });

test('a full passing report validates, is go, and links the dev commit on GitHub', () => {
  const r = make();
  assert.deepEqual(validateReport(r), []);
  assert.equal(r.verdict.value, 'go');
  assert.equal(r.devCommit.evidence[0].href, `https://github.com/SinishaDjukic/worca-cc/commit/${SHA}`);
});

test('validateReport rejects an unclear row, a row without evidence and a missing check', () => {
  const checks = all(); checks[0].status = 'unclear'; checks[1].evidence = []; checks.pop();
  const p = validateReport(make(checks));
  assert.ok(p.some((x) => /status must be pass or fail, not unclear/.test(x)));
  assert.ok(p.some((x) => /no evidence link/.test(x)));
  assert.ok(p.some((x) => /missing check gh-auth/.test(x)));
});

test('one failing row makes the verdict no-go, and the verdict section names it with its detail', () => {
  const checks = all(); Object.assign(checks.find((c) => c.id === 'split-check'), { status: 'fail', detail: 'spike gate FAILED: ui/server.mjs 9980 lines > ceiling 9972' });
  const r = make(checks);
  assert.deepEqual(r.verdict.failing, ['split-check']);
  const md = renderMarkdown(r);
  assert.match(md, /^- split-check: spike gate FAILED: ui\/server\.mjs 9980 lines &gt; ceiling 9972$/m);
  assert.ok(md.includes(`The rollback rehearsal proves the revert ${GATE_NOTE}.`));
  assert.ok(!renderMarkdown(make()).includes(GATE_NOTE));
});

test('a thrown step\'s error detail is a code span in the row and the verdict list: no live mention or link', () => {
  const checks = all(); Object.assign(checks.find((c) => c.id === 'open-prs'), { status: 'fail', detail: 'error: gh pr list failed: @someone see [x](https://e.vil)' });
  const md = renderMarkdown(make(checks));
  assert.match(md, /^- open-prs: error: `gh pr list failed: @someone see \[x\]\(https:\/\/e\.vil\)`$/m);
  assert.ok(md.includes('| open-prs | ✖ fail | error: `gh pr list failed: @someone see [x](https://e.vil)` |'));
});

test('missingEvidence names each relative href with no file and skips GitHub URLs', () => {
  const r = make();
  assert.deepEqual(missingEvidence(r, () => true), []);
  const p = missingEvidence(r, (h) => h !== 'evidence/open-prs.log');
  assert.deepEqual(p, ['evidence file missing: evidence/open-prs.log']);
});

test('renderMarkdown writes the eleven sections in order, the rollback note, and an empty PR list says so', () => {
  const md = renderMarkdown(make());
  const heads = [...md.matchAll(/^## (\d+)\. (.+)$/gm)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(heads, SECTIONS.map((s, i) => `${i + 1} ${s.title}`));
  assert.ok(md.includes(ROLLBACK_NOTE));
  assert.match(md, /No open PRs or dependabot branches\./);
});

test('PR titles, branches and files render as code spans: no table break, no link, no @mention', () => {
  assert.equal(code('a | [x](https://e.vil) @team `y`'), "`a \\| [x](https://e.vil) @team 'y'`");
  assert.equal(code(''), '—');
  assert.equal(cell('a | <b>'), 'a \\| &lt;b&gt;');
  const t = { number: 7, url: 'https://github.com/o/r/pull/7', branch: 'feat/x', title: 'see [x](https://e.vil) @team',
    dev: { conflict: false }, split: { conflict: true, files: ['ui/server.mjs'] }, action: 'catch up after the freeze (runbook recipe)' };
  const row = renderMarkdown(make(all(), [t])).split('\n').find((l) => l.startsWith('| [#7]'));
  assert.ok(row.includes('`see [x](https://e.vil) @team`'), row);
  assert.ok(!row.replace(/`[^`]*`/g, '').includes('](https://e.vil)'), row);   // no bare link outside code spans
  assert.ok(row.includes('`ui/server.mjs`'));
});

test('commentBody starts with the marker, turns evidence and parity-reverted links into anchors and stays under 60 000 characters', () => {
  const checks = all(); checks.find((c) => c.id === 'rollback').evidence.push({ label: 'parity', href: 'parity-reverted/report.md' });
  checks.find((c) => c.id === 'open-prs').evidence = [{ label: 'open-prs.json', href: 'evidence/open-prs.json' }];
  const r = make(checks); const md = renderMarkdown(r);
  // one 70 000-character line: the last-40-lines cut keeps it whole, so only the size cap can omit it
  const read = (h) => (h === 'evidence/suite-migrated.log' ? 'x'.repeat(70000) : `tail of ${h}`);
  const { marker, text, omitted } = commentBody(r, md, read);
  assert.equal(text.split('\n')[0], marker);
  assert.match(marker, /^\*\*Readiness dry run\*\* · dev 04370c0f6 · /);
  assert.match(text, /\]\(#ev-evidence-suite-migrated-log\)/);
  assert.match(text, /\]\(#ev-parity-reverted-report-md\)/);
  assert.match(text, /```text\ntail of evidence\/open-prs\.json\n```/);       // .json evidence gets its tail too
  assert.ok(text.length <= 60000, String(text.length));
  assert.match(text, /tail omitted: too long; see \$OUT\/evidence\/suite-migrated\.log/);
  assert.deepEqual(omitted, [{ href: 'evidence/suite-migrated.log', reason: 'too long' }]);
});

test('commentBody: every #ev- link has exactly one <a id> target, a missing file included', () => {
  const r = make(); const md = renderMarkdown(r);
  const { text, omitted } = commentBody(r, md, (h) => (h === 'evidence/baseline.log' ? null : 'ok'));
  const links = new Set([...text.matchAll(/\]\(#(ev-[a-z0-9-]+)\)/g)].map((m) => m[1]));
  const ids = [...text.matchAll(/<a id="(ev-[a-z0-9-]+)"><\/a>/g)].map((m) => m[1]);
  assert.ok(links.size >= Object.keys(CHECKS).length);
  assert.deepEqual([...links].sort(), [...ids].sort());                       // each link resolves, no id twice
  assert.match(text, /tail not attached: no such file; see \$OUT\/evidence\/baseline\.log/);
  assert.deepEqual(omitted, [{ href: 'evidence/baseline.log', reason: 'no such file' }]);
});

test('commentBody omits a tail the scan flags and keeps its anchor', () => {
  const r = make();
  const read = (h) => (h === 'evidence/split-check.log' ? 'fine\nbad line\n' : 'ok');
  const { text, omitted } = commentBody(r, renderMarkdown(r), read,
    { flag: (s) => (s.includes('bad') ? [{ line: 2, label: 'a home-directory path' }] : []) });
  assert.match(text, /<a id="ev-evidence-split-check-log"><\/a>/);
  assert.match(text, /tail omitted: the secret scan flagged line 2 \(a home-directory path\); see \$OUT\/evidence\/split-check\.log/);
  assert.ok(!text.includes('bad line'));
  assert.equal(omitted.length, 1);
});

test('verdict cause: a missing splitter prints the splitter note, never the gate sentence; exit N prints neither', () => {
  const miss = all(); Object.assign(miss.find((c) => c.id === 'split-check'), { status: 'fail', detail: 'splitter missing: tools/split-by-feature.mjs is not in the dev commit 5701cdee4 (the #919 tooling is not merged into dev)' });
  const md = renderMarkdown(make(miss));
  assert.equal(make(miss).verdict.cause, 'splitter-missing');
  assert.ok(md.includes(SPLITTER_NOTE)); assert.ok(!md.includes(GATE_NOTE));
  const other = all(); Object.assign(other.find((c) => c.id === 'split-check'), { status: 'fail', detail: 'exit 1' });
  assert.equal(make(other).verdict.cause, null);
  assert.ok(!renderMarkdown(make(other)).includes(GATE_NOTE));
});

test('Risks: every accepted delta, the capped server and the pins; its .json evidence resolves to an anchor in the comment', () => {
  const risks = { acceptedDeltas: [{ probe: 'GET //index.html', before: { status: 200, csp: null }, after: { status: 200, csp: "default-src 'self'" } }, { note: '/style.css: a Range request gets 200 with the full body instead of 206' }],
    serverLines: 9972, ceiling: 9972, pins: 11, evidence: [{ label: 'accepted-deltas.json', href: 'evidence/accepted-deltas.json' }, { label: 'dry-run.log', href: 'evidence/dry-run.log' }] };
  const r = buildReport({ repo: 'SinishaDjukic/worca-cc', sha: SHA, generatedAt: '2026-10-30T12:00:00Z', toolCommit: SHA, checks: all(), risks });
  assert.deepEqual(validateReport(r), []);
  const md = renderMarkdown(r);
  assert.match(md, /^## 10\. Risks and surprises$/m);
  assert.match(md, /^ {2}- `GET \/\/index\.html`: 200 without CSP → 200 with the rendered shell CSP$/m);
  assert.match(md, /^- Routes pinned in `ui\/server\.mjs`: 11/m);
  const { text } = commentBody(r, md, () => 'tail');
  const links = new Set([...text.matchAll(/\]\(#(ev-[a-z0-9-]+)\)/g)].map((m) => m[1]));
  const ids = new Set([...text.matchAll(/<a id="(ev-[a-z0-9-]+)"><\/a>/g)].map((m) => m[1]));
  assert.ok(ids.has('ev-evidence-accepted-deltas-json'));
  assert.deepEqual([...links].sort(), [...ids].sort());
  assert.deepEqual(missingEvidence(r, (h) => h !== 'evidence/accepted-deltas.json'), ['evidence file missing: evidence/accepted-deltas.json']);
});

test('Risks: a recorded ceiling raise renders one sign-off line; a bad raise entry fails validation', () => {
  const risks = { acceptedDeltas: [], serverLines: 10085, ceiling: 10085, pins: 11,
    ceilingRaises: [{ file: 'ui/server.mjs', from: 9972, to: 10085, why: 'dev growth | #711' }], evidence: [{ label: 'dry-run.log', href: 'evidence/dry-run.log' }] };
  const r = buildReport({ repo: 'SinishaDjukic/worca-cc', sha: SHA, generatedAt: '2026-10-30T12:00:00Z', toolCommit: SHA, checks: all(), risks });
  assert.deepEqual(validateReport(r), []);
  assert.match(renderMarkdown(r), /^- Ceiling raised: `ui\/server\.mjs` 9,972 → 10,085 lines \(dev growth \\\| #711\): needs the owner's sign-off$/m);
  for (const bad of [{ file: 'ui/server.mjs', from: 10085, to: 9972, why: 'x' }, { file: 'ui/server.mjs', from: 1, to: 2 }, { from: 1, to: 2, why: 'x' }]) {
    const p = validateReport(buildReport({ repo: 'o/r', sha: SHA, generatedAt: 'x', toolCommit: SHA, checks: all(), risks: { ...risks, ceilingRaises: [bad] } }));
    assert.ok(p.some((x) => /ceiling raise/.test(x)), JSON.stringify(bad));
  }
});

test('notLocal: listed under the rollback table as "Not run locally", and validated as { name, ci } strings', () => {
  const r = buildReport({ repo: 'o/r', sha: SHA, generatedAt: 'x', toolCommit: SHA, checks: all(), notLocal: [{ name: 'e2e:firefox-smoke', ci: 'firefox-e2e' }] });
  assert.deepEqual(validateReport(r), []);
  assert.match(renderMarkdown(r), /^Not run locally: `e2e:firefox-smoke` → CI job `firefox-e2e`$/m);
  assert.ok(!renderMarkdown(make()).includes('Not run locally'));
  assert.ok(validateReport({ ...r, notLocal: [{ name: 'x' }] }).some((x) => /notLocal/.test(x)));
});

test('the open-PR table has a Catch-up column: works, needs hand fix with the reason code-spanned, or not run', () => {
  const t = (catchUp, n) => ({ number: n, url: `https://github.com/o/r/pull/${n}`, branch: 'feat/x', title: 't', dev: { conflict: false }, split: { conflict: false }, action: 'none', catchUp });
  const rows = [t({ verdict: 'works', reasons: [] }, 1), t({ verdict: 'needs hand fix', reasons: ['merge with M^ conflicts in: ui/server.mjs'] }, 2), t({ verdict: 'not run', reasons: [] }, 3)];
  const md = renderMarkdown(make(all(), rows));
  assert.ok(md.includes('| # | Branch | Title | Conflicts with dev | Conflicts after the split | Action | Catch-up |'));
  const line = (n) => md.split('\n').find((l) => l.startsWith(`| [#${n}]`));
  assert.ok(line(1).endsWith('| none | works |'), line(1));
  assert.ok(line(2).endsWith('| none | needs hand fix `merge with M^ conflicts in: ui/server.mjs` |'), line(2));
  assert.ok(line(3).endsWith('| none | not run |'), line(3));
  assert.deepEqual(validateReport(make(all(), rows)), []);
  assert.ok(validateReport(make(all(), [t({ verdict: 'maybe', reasons: [] }, 4)])).some((x) => /catch-up verdict/.test(x)));
});

test('a waived row: only parity may be waived, with an owner and reason; only fail rows count as failing', () => {
  const W = { owner: 'Emil Angelov', reason: 'row h waived' };
  const checks = all(); Object.assign(checks.find((c) => c.id === 'parity'), { status: 'waived', waived: W });
  const r = make(checks);
  assert.deepEqual(validateReport(r), []);
  assert.deepEqual(r.verdict.failing, []); assert.equal(r.verdict.value, 'go');
  const md = renderMarkdown(r);
  assert.match(md, /^- parity: waived by Emil Angelov: row h waived$/m);
  assert.ok(!md.includes('every check passes'));
  const other = all(); Object.assign(other.find((c) => c.id === 'suite-migrated'), { status: 'waived', waived: W });
  assert.ok(validateReport(make(other)).some((x) => /suite-migrated: status must be pass or fail, not waived/.test(x)));
  const bare = all(); Object.assign(bare.find((c) => c.id === 'parity'), { status: 'waived' });
  assert.ok(validateReport(make(bare)).some((x) => /parity: a waived row names its owner and reason/.test(x)));
});
