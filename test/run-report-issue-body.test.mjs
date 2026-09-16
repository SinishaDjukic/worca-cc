// test/run-report-issue-body.test.mjs — the FULL issue body: the same narrative +
// metrics table renderIssueBody prints, but with the complete JSON report embedded
// in a collapsed <details> block instead of a "paste it yourself" placeholder.
//
// This body never rides a URL (a measured run reaches 40 KB pretty, and the
// issues/new cap is ~8 KB encoded); it is written to a file and handed to
// `gh issue create --body-file`, so the only ceiling is GitHub's own 65536-char
// issue body. The contract that matters is round-tripping: what a maintainer
// copies out of the fence must JSON.parse back to the exact payload the reporter
// saw in the preview.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderIssueBodyFull, repoSlugFromBugsUrl, ISSUE_BODY_MAX,
} from '../src/core/run-report.mjs';

function payload(over = {}) {
  return {
    schemaVersion: 1, generatedAt: '2026-09-15T10:00:00.000Z',
    reason: 'too-slow', expectation: 'I expected it under ten minutes',
    included: { paths: false, prompt: false },
    app: { worca: '1.2.0', node: 'v22.13.0', platform: 'darwin', arch: 'arm64' },
    run: { id: '62132be1', target: 'project', status: 'done', phase: 'done', cycle: 2,
           sourceType: 'prompt', engine: 2, startedAt: null, updatedAt: null,
           wallClockMs: 1800000, activeMs: 640000, costUsd: 4.21, costCapOverride: false },
    workflow: { manifestVersion: 2, template: { builtin: true, id: 'wf_default', name: 'Default' },
                auto: null, nodes: [], wires: [] },
    tools: { tool: 'graphify', kind: 'cli', graphify: true, codeReviewGraph: false },
    steps: [{ nodeId: 'n1', agentKey: 'planner', cycle: 1, status: 'done', activeMs: 1000 }],
    subAgents: [{ agentKey: 'reviewer', status: 'done' }],
    review: { reviewCount: 1, blockingIssues: 0,
              issueCounts: { critical: 0, major: 0, minor: 2, suggestion: 0 }, byReview: [] },
    files: { filesNew: 2, filesChanged: 19, linesAdded: 634, linesRemoved: 95 },
    evidence: null,
    ...over,
  };
}

/** Pull the one fenced block out of the <details> and parse it. */
function embeddedJson(body) {
  const m = /^(`{3,})json\n([\s\S]*?)\n\1$/m.exec(body);
  assert.ok(m, 'the body carries exactly one ```json fence');
  return JSON.parse(m[2]);
}

test('the full body keeps the narrative + table and embeds the whole payload', () => {
  const p = payload();
  const body = renderIssueBodyFull(p);
  assert.match(body, /Too slow/, 'the reason is still spelled out in words');
  assert.match(body, /I expected it under ten minutes/, 'the free text still rides the body');
  assert.match(body, /\| Metric \| Value \|/, 'the compact metrics table survives');
  assert.match(body, /<details>/, 'the JSON is collapsed, not dumped inline');
  assert.match(body, /<summary>Full JSON report \(schema v1 — 1 step, 1 sub-agent\)<\/summary>/,
    'the summary says what is inside without opening it');
  assert.doesNotMatch(body, /paste the copied JSON/i,
    'nobody is asked to paste anything — that is the whole point');
  assert.deepEqual(embeddedJson(body), p, 'round-trips byte-for-byte through JSON.parse');
});

test('the fence widens past any backtick run inside the payload', () => {
  // A `prompt` opt-in carries the user's own text, which routinely contains fenced
  // code. A fixed ``` fence would be closed early by the payload and the rest of the
  // JSON would land as prose — unparseable, and a silent leak of the tail out of the
  // collapsed block.
  const p = payload({ run: { ...payload().run, prompt: 'fix this:\n```js\nfoo()\n```\nthanks' } });
  const body = renderIssueBodyFull(p);
  assert.deepEqual(embeddedJson(body), p, 'still round-trips with ``` inside the JSON');
  assert.match(body, /^`{4,}json$/m, 'the opening fence is longer than the longest run inside');
});

test('a payload too big for a GitHub issue degrades rather than overflowing', () => {
  const steps = Array.from({ length: 4000 }, (_, i) => ({
    nodeId: `node-${i}`, agentKey: 'implementer', cycle: 1, status: 'done',
    activeMs: 1234, costUsd: 0.5, note: 'x'.repeat(40),
  }));
  const body = renderIssueBodyFull(payload({ steps }));
  assert.ok(body.length <= ISSUE_BODY_MAX,
    `body is ${body.length} chars; GitHub rejects anything over ${ISSUE_BODY_MAX}`);
  assert.match(body, /Copy JSON/,
    'an oversized report falls back to asking for the paste, naming the button that provides it');
});

test('a big-but-legal payload is embedded minified rather than dropped', () => {
  // Pretty-printing costs ~50% on a step-heavy run. A payload that overflows only
  // because of indentation must still ship whole.
  const steps = Array.from({ length: 600 }, (_, i) => ({
    nodeId: `node-${i}`, agentKey: 'implementer', cycle: 1, status: 'done', activeMs: 1234,
  }));
  const p = payload({ steps });
  assert.ok(JSON.stringify(p, null, 2).length > ISSUE_BODY_MAX, 'the fixture really is too big pretty');
  assert.ok(JSON.stringify(p).length < ISSUE_BODY_MAX, 'and really does fit minified');
  const body = renderIssueBodyFull(p);
  assert.ok(body.length <= ISSUE_BODY_MAX);
  assert.deepEqual(embeddedJson(body), p, 'the complete payload still round-trips');
});

test('repoSlugFromBugsUrl reduces package.json bugs.url to OWNER/REPO', () => {
  assert.equal(repoSlugFromBugsUrl('https://github.com/SinishaDjukic/worca-cc/issues'),
    'SinishaDjukic/worca-cc');
  assert.equal(repoSlugFromBugsUrl('https://github.com/SinishaDjukic/worca-cc/issues/'),
    'SinishaDjukic/worca-cc', 'a trailing slash is not part of the repo name');
  assert.equal(repoSlugFromBugsUrl('https://github.com/SinishaDjukic/worca-cc'),
    'SinishaDjukic/worca-cc', 'bugs.url may point at the repo itself');
  assert.equal(repoSlugFromBugsUrl('https://gitlab.com/acme/thing/issues'), '',
    'only github.com is addressable by `gh issue create`');
  assert.equal(repoSlugFromBugsUrl(''), '');
  assert.equal(repoSlugFromBugsUrl(null), '');
});
