// test/docs-sessions.test.mjs — the operator docs name every trace record, code and constant the code ships.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TRACE_KINDS, TRACE_FIELDS } from '../src/core/session-trace.mjs';
import { SESSION_HOST_CODES, HOST_MAX_TURNS } from '../src/core/engines/session-dispatch.mjs';
import { HOST_ROTATE_DISPATCHES, HOST_ROTATE_CONTEXT_TOKENS } from '../src/core/session-host.mjs';
import { CLAUDE_AGENTS_FILE_MIN } from '../src/core/session-mode.mjs';
import { RECONCILE_ABS_USD, RECONCILE_REL, RECONCILE_EST_ABS_USD, RECONCILE_EST_REL } from '../src/core/session-cost.mjs';
import { MAX_SESSION_MEMBERS, SESSION_MIN_MEMBERS } from '../src/shared/graph/constants.mjs';
import { flagByKey } from '../src/shared/flags/registry.mjs';
import { SESSION_SUBAGENTS_VERIFIED } from '../src/shared/engine-switch.mjs';
import { RECOVERY_MAX_AUTO_ATTEMPTS } from '../src/core/failure-policy.mjs';
import { sessionStartNotices } from '../src/shared/graph/sessions.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { realPortsFn } from './helpers/graph-ports.mjs';

const doc = readFileSync(new URL('../docs/sessions.md', import.meta.url), 'utf8');
test('every record kind, error code and pinned constant is documented', () => {
  for (const k of TRACE_KINDS) assert.match(doc, new RegExp('`' + k + '`'), k);
  for (const c of SESSION_HOST_CODES) assert.ok(doc.includes(c), c);
  for (const v of ['WORCA_SESSIONS_DISABLE=1', 'sessionGroups', '2.1.281', 'max($0.001, 2%)', 'max($0.01, 15%)', 'sessions/<sid>/trace.ndjson', '120000', '24',
    '--forward-subagent-text', 'carriedBy', 'TOPOLOGY_CONFIG', 'the main agent did not dispatch']) assert.ok(doc.includes(v), v);
  assert.doesNotMatch(doc, /\bgroups?\b/i, 'the word is "session"');
  assert.doesNotMatch(doc, /cheaper|faster|saves? (?:tokens|money|time)|cold starts? saved|cache savings/i, 'no promise v1 does not keep (X5)');
});

// ── v2: every field of every record, the figures as the code has them, the gate said plainly, and the links ──
test('v2 — every trace field, and the common ones, is named in the record table', () => {
  for (const [kind, fields] of Object.entries(TRACE_FIELDS)) {
    const row = doc.split('\n').find((l) => l.startsWith(`| \`${kind}\` |`));
    assert.ok(row, `a table row for ${kind}`);
    for (const f of fields) assert.ok(row.includes(`\`${f}\``), `${kind}.${f}`);
  }
  for (const f of ['v', 'ts', 'seq', 'kind', 'runId', 'sid', 'hostEpoch', 'hostSessionId']) assert.ok(doc.includes(`\`${f}\``), f);
});

test('v2 — the figures are the code\'s: a changed constant breaks this until the doc follows', () => {
  assert.ok(doc.includes(`--max-turns ${HOST_MAX_TURNS}`));
  assert.ok(doc.includes(`after ${HOST_ROTATE_DISPATCHES} dispatches`));
  assert.ok(doc.includes(`held ${HOST_ROTATE_CONTEXT_TOKENS}`));
  assert.ok(doc.includes(`at least ${CLAUDE_AGENTS_FILE_MIN}`));
  assert.ok(doc.includes(`MAX_SESSION_MEMBERS = ${MAX_SESSION_MEMBERS}`) && doc.includes(`${SESSION_MIN_MEMBERS} to ${MAX_SESSION_MEMBERS} steps`));
  const pct = (x) => `${Math.round(x * 100)}%`;
  assert.ok(doc.includes(`max($${RECONCILE_ABS_USD}, ${pct(RECONCILE_REL)})`) && doc.includes(`max($${RECONCILE_EST_ABS_USD}, ${pct(RECONCILE_EST_REL)})`));
  // v4: the watchdog's retry budget is the recovery budget (C1), named twice.
  assert.ok(doc.includes(`up to ${RECOVERY_MAX_AUTO_ATTEMPTS} times by default`) && doc.includes(`the recovery attempts, ${RECOVERY_MAX_AUTO_ATTEMPTS} by default`));
});

test('v3 — the quoted lines are the code\'s own: the run-start notice and the kill switch\'s audit line', () => {
  const t = structuredClone(SEED_TEMPLATES.find((s) => s.id === 'wf_no-clarify'));
  for (const id of ['n_refine', 'n_decompose']) t.nodes.find((n) => n.id === id).config.session = 's_aaaaaaaa';
  const [line] = sessionStartNotices(t, realPortsFn(), { engine: 'claude', verified: { claude: true }, labelOf: (id) => ({ n_refine: 'Refine Plan', n_decompose: 'Decompose' })[id] });
  assert.ok(doc.replace(/\n\s*/g, ' ').includes(line), line);
  const harness = readFileSync(new URL('../src/core/run-harness.mjs', import.meta.url), 'utf8');
  const kill = 'Sessions disabled by WORCA_SESSIONS_DISABLE=1: every session runs as separate sessions.';
  assert.ok(harness.includes(`'${kill}'`) && doc.replace(/\n\s*/g, ' ').includes(kill));
});

test('v2 — the Claude gate is said plainly: only after the owner\'s spikes and the S7b go/no-go', () => {
  // v4: the sentence follows the gate itself, so Task 53's flip of SESSION_SUBAGENTS_VERIFIED.claude fails here until
  // the doc says the gate is open.
  assert.equal(/Sub-agents on Claude are not on yet\./.test(doc), SESSION_SUBAGENTS_VERIFIED.claude !== true, 'the gate sentence matches the shipped gate');
  assert.match(doc, /Sub-agents on Claude are not on yet\.\*\* Claude Code sessions run their steps as sub-agents only after the owner has\s+run the Phase 0 spikes/);
  assert.match(doc, /S7b go\/no-go/);
  assert.doesNotMatch(doc, /Claude Code \| Sub-agents\b/, 'the engine table promises no sub-agents on Claude');
});

test('v2 — the flag, the flags page and the telemetry page point here', () => {
  assert.equal(flagByKey('sessionGroups').docs, 'docs/sessions.md');
  const flags = readFileSync(new URL('../docs/feature-flags.md', import.meta.url), 'utf8');
  assert.match(flags.split('\n').find((l) => l.startsWith('| `sessionGroups` |')), /\(\[docs\]\(sessions\.md\)\)/);
  const tel = readFileSync(new URL('../docs/run-telemetry.md', import.meta.url), 'utf8');
  assert.match(tel, /^\| `host` \| A step that ran inside a \[session\]\(sessions\.md\) is booked \|.*a sum, not a context size/m);
  assert.ok(doc.includes('[run-telemetry.md](run-telemetry.md)') && /one `host` record per booked host turn/.test(doc));
  // v4: the one case without a record (Task 63: a resumed run's harness never saw the cut turn's turn_end), said on both pages.
  assert.ok(/cut by a pause or a crash and booked after the resume gets none/.test(doc.replace(/\n\s*/g, ' ')) && tel.includes('booked after the resume has none'));
});
