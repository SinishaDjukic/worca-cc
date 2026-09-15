// test/run-report-issue-url.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIssueUrl, renderIssueBody, issueTitle, ISSUE_URL_MAX }
  from '../src/core/run-report.mjs';

const BUGS = 'https://github.com/SinishaDjukic/worca-cc/issues';

/**
 * A MAXIMAL payload: every opt-in field a reporter can unlock is present, each
 * carrying a distinctive marker string. The projection guard at the bottom of this
 * file can only fire on a field the fixture actually carries, so a fixture that
 * omits `branch`/`title`/`prompt`/`review.issues`/`files.newFiles` makes that guard
 * dead in both directions — it passed no matter what renderIssueBody printed.
 */
function payload(over = {}) {
  return {
    schemaVersion: 1, generatedAt: '2026-09-15T10:00:00.000Z',
    reason: 'too-expensive', expectation: 'I expected under a dollar',
    included: { paths: true, prompt: true, names: true },
    app: { worca: '1.2.0', node: 'v22.13.0', platform: 'darwin', arch: 'arm64' },
    run: { id: '62132be1', target: 'project', status: 'done', phase: 'done', cycle: 2,
           sourceType: 'prompt', engine: 2, startedAt: null, updatedAt: null,
           wallClockMs: 1800000, activeMs: 640000, costUsd: 4.21, costCapOverride: false,
           branch: { source: 'dev', feature: 'feat/acme-billing' },
           title: 'Secret Project rework', prompt: 'rewrite the billing module' },
    workflow: { manifestVersion: 2, template: { builtin: true, id: 'wf_default', name: 'Default' },
                auto: null, nodes: [], wires: [] },
    tools: { tool: 'graphify', kind: 'cli', graphify: true, codeReviewGraph: false },
    steps: [], subAgents: [],
    review: { reviewCount: 1, blockingIssues: 1,
              issueCounts: { critical: 0, major: 1, minor: 2, suggestion: 0 }, byReview: [],
              issues: [{ severity: 'major', title: 'unguarded write',
                         location: 'src/acme/billing.mjs:42', kind: 'code', cycle: 1 }] },
    files: { filesNew: 2, filesChanged: 19, linesAdded: 634, linesRemoved: 95,
             newFiles: [{ path: 'src/acme/billing.mjs', status: 'A', added: 46, removed: 0 }],
             changedFiles: [{ path: 'ui/public/app.js', status: 'M', added: 12, removed: 3 }] },
    evidence: { budget: { pipelineLimitUsd: 1 } },
    ...over,
  };
}

test('the body is a narrative + a metrics table, and asks for the JSON paste', () => {
  const body = renderIssueBody(payload());
  assert.match(body, /Too expensive/, 'the reason is spelled out in words');
  assert.match(body, /I expected under a dollar/, 'the free text rides the body');
  assert.match(body, /\| Metric \| Value \|/, 'a compact markdown metrics table');
  assert.match(body, /\| worca \| 1\.2\.0 \|/, 'the worca version is in every body');
  assert.match(body, /Paste the full JSON report below/,
    'the body asks for the paste rather than asserting one already happened');
  assert.match(body, /Copy JSON/,
    'and names the button that provides it, for a reporter whose clipboard was blocked');
  assert.doesNotMatch(body, /"schemaVersion"/, 'the full JSON is NOT inlined into the body');
});

test('the title carries no user text', () => {
  const t = issueTitle(payload({ expectation: 'ACME Corp internal secret' }));
  assert.doesNotMatch(t, /ACME/, 'the title rides the URL and must stay short and inert');
  assert.match(t, /worca 1\.2\.0/);
});

test('the URL is issues/new with the reason as the label', () => {
  const { url, truncated } = buildIssueUrl(payload(), { bugsUrl: BUGS });
  assert.equal(truncated, false, 'a normal report fits comfortably');
  assert.ok(url.startsWith(`${BUGS}/new?`), 'it targets package.json bugs.url');
  assert.match(url, /[?&]labels=too-expensive(&|$)/, 'the reason IS the issue label');
  assert.match(url, /[?&]title=/);
  assert.match(url, /[?&]body=/);
});

test('a trailing slash on bugs.url does not produce a double slash', () => {
  const { url } = buildIssueUrl(payload(), { bugsUrl: `${BUGS}/` });
  assert.ok(url.startsWith(`${BUGS}/new?`), 'the base is normalised');
  assert.doesNotMatch(url, /issues\/\/new/, 'no doubled slash');
});

test('an empty bugs.url yields no url at all, never a relative one', () => {
  const { url, truncated } = buildIssueUrl(payload(), { bugsUrl: '' });
  assert.equal(url, '', 'a relative "/new?…" would navigate the SPA instead of failing closed');
  assert.equal(truncated, false);
});

test('an over-long body is truncated so the URL never exceeds the cap', () => {
  const huge = payload({ expectation: 'x'.repeat(40000) });
  const { url, body, truncated } = buildIssueUrl(huge, { bugsUrl: BUGS });
  assert.equal(truncated, true, 'the builder admits it trimmed');
  assert.ok(url.length <= ISSUE_URL_MAX, `URL is ${url.length}, cap is ${ISSUE_URL_MAX}`);
  assert.match(body, /truncated/i, 'the trimmed body says so, so the reporter is not misled');
  assert.match(body, /Copy JSON/, 'and still points at the full report');
});

// ── the cap, one branch per test ──────────────────────────────────────────────
// These replace a single `url.length <= 120 || !url.includes('body=')` assertion.
// The drop-the-body branch ALWAYS removes `body=`, so that right-hand disjunct was
// true exactly whenever the left one failed: a test named "the cap is honoured"
// that no overflow could ever fail. Each branch now gets its own unconditional
// length assertion.

test('the binary-search branch keeps the URL under the cap', () => {
  const huge = payload({ expectation: 'x'.repeat(40000) });
  const { url, body, truncated } = buildIssueUrl(huge, { bugsUrl: BUGS, maxLength: 400 });
  assert.equal(truncated, true, 'the builder admits it trimmed');
  assert.ok(url.includes('body='), 'this branch keeps a body — it is the one under test');
  assert.ok(url.length <= 400, `URL is ${url.length}, cap is 400`);
  assert.match(body, /truncated/i, 'and says so');
});

test('under the body threshold the body is dropped, and the URL is exactly labels + title', () => {
  const p = payload();
  // 200 clears the 131-char labels+title head but not that head plus the encoded
  // truncation notice, so this lands squarely in the drop-the-body branch.
  const { url, body, truncated, length } = buildIssueUrl(p, { bugsUrl: BUGS, maxLength: 200 });
  assert.equal(truncated, true);
  assert.equal(body, '', 'the body is dropped whole, not trimmed');
  assert.equal(url, `${BUGS}/new?labels=${p.reason}&title=${encodeURIComponent(issueTitle(p))}`,
    'labels + title only — no body parameter');
  assert.ok(url.length <= 200, `URL is ${url.length}, cap is 200`);
  assert.equal(length, url.length, 'the reported length is the URL actually returned');
});

test('the URL NEVER exceeds maxLength — below the head it sheds the title, then the query', () => {
  // Plan §15 checklist item 7 is stated unconditionally, so it is tested that way.
  // The previous version returned the full 131-char labels+title head at every cap
  // from 130 down to 0, overflowing every one of them.
  const p = payload();
  for (const maxLength of [400, 200, 131, 130, 100, 73, 72, 60, 52, 51, 10, 1, 0]) {
    const { url, truncated, length } = buildIssueUrl(p, { bugsUrl: BUGS, maxLength });
    assert.ok(url.length <= maxLength,
      `maxLength ${maxLength} returned a ${url.length}-char URL`);
    assert.equal(truncated, true, `maxLength ${maxLength}: the builder must admit it degraded`);
    assert.equal(length, url.length, `maxLength ${maxLength}: length must equal url.length`);
  }
});

test('percent-encoding is counted, not the raw character count', () => {
  // Newlines and pipes encode to 3 chars each; a naive length check would pass a
  // body that the encoded URL blows past.
  const { url } = buildIssueUrl(payload({ expectation: '\n'.repeat(2000) }),
    { bugsUrl: BUGS, maxLength: 4000 });
  assert.ok(url.length <= 4000, `encoded URL is ${url.length}`);
});

test('an emoji in the free text does not crash the truncator', () => {
  // A prefix slice can cut a surrogate PAIR in half, and bare encodeURIComponent
  // throws `URIError: URI malformed` on a lone surrogate. One 🙂 is enough.
  const emoji = payload({ expectation: '🙂'.repeat(4000) });
  const { url, truncated } = buildIssueUrl(emoji, { bugsUrl: BUGS });
  assert.equal(truncated, true);
  assert.ok(url.length <= ISSUE_URL_MAX);
  assert.doesNotThrow(() => decodeURIComponent(new URL(url).searchParams.get('body') ?? ''),
    'the body parameter round-trips');
});

// ── the body is a STRICT PROJECTION of the payload ────────────────────────────
// The preview <pre> shows the payload; the issue BODY is the other thing that
// leaves the machine, and it is NOT in the preview. Plan checklist #15 calls that
// safe only because the body prints a FIXED row set — a short, curated projection —
// so a field landing in the payload never silently lands in the issue too.
//
// These tests are what keep that true as the body grows, so they run against the
// MAXIMAL fixture above: every gated field present, each with its own marker. A
// fixture missing those fields cannot fail these regexes whatever the body prints.
test('the body prints only its curated rows, never the payload fields it does not name', () => {
  const p = payload();
  const body = renderIssueBody(p);

  // Each marker below IS carried by `p` — assert it against the payload first, so a
  // future fixture edit that drops the field turns these into failures, not no-ops.
  assert.equal(p.files.newFiles[0].path, 'src/acme/billing.mjs');
  assert.equal(p.review.issues[0].location, 'src/acme/billing.mjs:42');
  assert.equal(p.review.issues[0].title, 'unguarded write');
  assert.equal(p.run.branch.feature, 'feat/acme-billing');
  assert.equal(p.run.title, 'Secret Project rework');
  assert.equal(p.run.prompt, 'rewrite the billing module');

  assert.doesNotMatch(body, /\b(src|test|ui)\//, 'no file path reaches the prefilled body');
  assert.doesNotMatch(body, /worktree|\/Users\//, 'no absolute path either');
  assert.doesNotMatch(body, /unguarded write/, 'no review issue title either');
  assert.doesNotMatch(body, /feat\/acme-billing/, 'no branch name');
  assert.doesNotMatch(body, /Secret Project/, 'no run title');
  assert.doesNotMatch(body, /rewrite the billing/, 'no prompt');
  assert.doesNotMatch(body, /cached overview/,
    'and with no narrative on the payload, that whole section is omitted');
});

test('a paths-opted payload puts the narrative in the body, and only then', () => {
  const withNarrative = payload({ narrative: 'Rewrote src/acme/billing.mjs end to end.' });
  const body = renderIssueBody(withNarrative);
  assert.match(body, /Rewrote src\/acme\/billing\.mjs/,
    'the reporter opted paths in, read the narrative in the preview, and it ships verbatim');
  assert.match(body, /cached overview/, 'under its own labelled heading');
});
