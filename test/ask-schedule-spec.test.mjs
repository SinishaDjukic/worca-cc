// test/ask-schedule-spec.test.mjs
// The pure half of scheduled runs in Ask Worca (docs/scheduled-runs.md "Ask Worca"): the user's
// words → a schedule in their zone (resolveScheduleSpec), the schedule-change validator over
// injected rows, the event / notice texts, the proposal's `schedule` key, and the context block's
// timezone key, clock line and card lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveScheduleSpec, createScheduleChangeValidator, scheduleEventPrompt, scheduleNoticeText, scheduleRequestFields,
  effectiveTimeZone, MAX_AHEAD_MS,
} from '../src/core/ask/schedule-spec.mjs';
import { createProposalValidator } from '../src/core/ask/proposal.mjs';
import { validateClientContext, buildContextHeader } from '../src/core/ask/prompt.mjs';

// Fri 2026-09-18 10:00 UTC = 12:00 in Berlin (CEST) = 19:00 in Tokyo.
const NOW = Date.UTC(2026, 8, 18, 10, 0);

test('when: the user\'s words in THEIR zone, the instant, the text they read; past, far and malformed times are refused', () => {
  const b = resolveScheduleSpec({ when: 'tomorrow 02:00' }, { nowMs: NOW, timeZone: 'Europe/Berlin' });
  assert.deepEqual(b, { ok: true, schedule: { kind: 'once', runAt: '2026-09-19T00:00:00.000Z', when: 'Sat Sep 19, 02:00', timeZone: 'Europe/Berlin' } });
  const t = resolveScheduleSpec({ when: 'tomorrow 02:00' }, { nowMs: NOW, timeZone: 'Asia/Tokyo' });
  assert.equal(t.schedule.runAt, '2026-09-18T17:00:00.000Z', 'the same words, another zone, another instant');
  assert.equal(resolveScheduleSpec({ when: '+90m' }, { nowMs: NOW, timeZone: 'UTC' }).schedule.runAt, '2026-09-18T11:30:00.000Z');
  assert.equal(resolveScheduleSpec({ when: '11:00' }, { nowMs: NOW, timeZone: 'Europe/Berlin' }).schedule.when, 'Sat Sep 19, 11:00', 'a bare time is its NEXT occurrence');
  assert.equal(resolveScheduleSpec({ when: '2027-01-04 09:00' }, { nowMs: NOW, timeZone: 'UTC' }).schedule.when, 'Mon Jan 4 2027, 09:00', 'another year says so');
  const past = resolveScheduleSpec({ when: '2026-09-18 11:00' }, { nowMs: NOW, timeZone: 'Europe/Berlin' });
  assert.equal(past.ok, false);
  assert.match(past.errors[0], /^when: Fri Sep 18, 11:00 \(Europe\/Berlin\) is in the past$/);
  assert.match(resolveScheduleSpec({ when: '2028-01-01 00:00' }, { nowMs: NOW, timeZone: 'UTC' }).errors[0], /more than a year ahead/);
  assert.ok(MAX_AHEAD_MS > 365 * 86_400_000);
  assert.match(resolveScheduleSpec({ when: 'next tuesday' }, { nowMs: NOW, timeZone: 'UTC' }).errors[0], /^when: cannot read "next tuesday"/, 'the CLI flag name is not leaked');
  assert.match(resolveScheduleSpec({ when: '+1h', count: 3 }, { nowMs: NOW }).errors[0], /count only apply with every/);
  assert.match(resolveScheduleSpec({ when: '+1h', every: 'day 02:00' }, { nowMs: NOW }).errors[0], /not both/);
  assert.deepEqual(resolveScheduleSpec({}, { nowMs: NOW }), { ok: true, schedule: null }, 'no schedule fields = a plain run');
  assert.match(resolveScheduleSpec({ overlap: 'queue' }, { nowMs: NOW }).errors[0], /overlap only apply with every/);
});

test('every: the rule in the user\'s zone, its sentence and next three dates; policies validated; defaults from Settings', () => {
  const r = resolveScheduleSpec({ every: 'weekdays 02:00' }, { nowMs: NOW, timeZone: 'Europe/Berlin', defaults: { maxFailures: 5 } });
  assert.equal(r.ok, true);
  const s = r.schedule;
  assert.equal(s.kind, 'repeat');
  assert.deepEqual(s.rule, { freq: 'weekly', interval: 1, time: '02:00', tz: 'Europe/Berlin', weekdays: ['mo', 'tu', 'we', 'th', 'fr'], anchor: '2026-09-18', end: { type: 'never' } });
  assert.equal(s.sentence, 'Every weekday at 02:00');
  assert.deepEqual(s.next.map((n) => n.when), ['Mon Sep 21, 02:00', 'Tue Sep 22, 02:00', 'Wed Sep 23, 02:00']);
  assert.equal(s.overlap, 'skip');
  assert.equal(s.maxFailures, 5, 'the Settings default');
  const c = resolveScheduleSpec({ every: 'month last 03:00', count: 2, overlap: 'queue', maxFailures: 0 }, { nowMs: NOW, timeZone: 'UTC' }).schedule;
  assert.equal(c.sentence, 'Every month on the last day at 03:00, 2 times');
  assert.equal(c.next.length, 2);
  assert.equal(c.overlap, 'queue');
  assert.equal(c.maxFailures, 0);
  assert.equal(resolveScheduleSpec({ every: 'day 02:00', until: '2026-09-20' }, { nowMs: NOW, timeZone: 'UTC' }).schedule.sentence, 'Every day at 02:00, until 2026-09-20');
  assert.match(resolveScheduleSpec({ every: 'day 02:00', until: '2026-09-01' }, { nowMs: NOW, timeZone: 'UTC' }).errors[0], /no future run/);
  assert.match(resolveScheduleSpec({ every: 'fortnightly' }, { nowMs: NOW }).errors[0], /^every: /);
  assert.match(resolveScheduleSpec({ every: 'day 02:00', overlap: 'maybe' }, { nowMs: NOW }).errors[0], /overlap must be one of skip \| start \| queue/);
  assert.match(resolveScheduleSpec({ every: 'day 02:00', until: 'soon' }, { nowMs: NOW }).errors[0], /until must be a date/);
  assert.match(resolveScheduleSpec({ every: 'day 02:00', until: '2026-12-01', count: 3 }, { nowMs: NOW }).errors[0], /until OR count/);
  assert.deepEqual(scheduleRequestFields(s), { repeat: { rule: s.rule, overlap: 'skip', maxFailures: 5 } });
  assert.deepEqual(scheduleRequestFields({ kind: 'once', runAt: 'x' }), { scheduledFor: 'x' });
});

test('effectiveTimeZone: a known zone is kept; anything else falls back to this machine\'s', () => {
  assert.equal(effectiveTimeZone('America/New_York'), 'America/New_York');
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  assert.equal(effectiveTimeZone('Mars/Olympus'), local);
  assert.equal(effectiveTimeZone(null), local);
});

test('the proposal carries `schedule` only when asked, and a bad phrase is one more proposal error', async () => {
  const v = createProposalValidator({
    listProjects: async () => [{ key: 'demo-00000001', name: 'demo', path: '/x/demo' }],
    assertRunnableWorkflow: async (id) => ({ id, name: 'Default' }),
    readGuardrailSet: async () => ({ id: 'normal' }),
    pathExists: () => true,
  }).validateProposal;
  const plain = await v({ projectKey: 'demo-00000001', brief: 'do it' }, { nowMs: NOW, timeZone: 'UTC' });
  assert.equal(plain.ok, true);
  assert.equal('schedule' in plain.card, false, 'a plain run card keeps its key set');
  const once = await v({ projectKey: 'demo-00000001', brief: 'do it', when: 'tomorrow 02:00' }, { nowMs: NOW, timeZone: 'Europe/Berlin' });
  assert.equal(once.card.schedule.runAt, '2026-09-19T00:00:00.000Z');
  const bad = await v({ projectKey: 'demo-00000001', brief: '', every: 'someday' }, { nowMs: NOW });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.length, 2, 'the brief AND the schedule are reported together');
});

// Rows as scheduler.mjs maps them (rowToTicket / rowToSchedule), trimmed to what the validator reads.
const TICKET = { id: '11111111-2222-3333-4444-555555555555', kind: 'once', scheduleId: null, title: 'Upgrade deps', projectDir: '/x/shop', workspaceId: null, runAt: '2026-09-19T00:00:00.000Z', status: 'scheduled' };
const RULE = { freq: 'daily', interval: 1, time: '04:00', tz: 'UTC', anchor: '2026-09-01', end: { type: 'never' } };
const SERIES = { id: 'sch_0000abcd', kind: 'recurring', title: 'Nightly', projectDir: '/x/shop', workspaceId: null, rule: RULE, sentence: 'Every day at 04:00',
  status: 'active', nextRunAt: '2026-09-19T04:00:00.000Z', overlap: 'skip', maxFailures: 3 };
const rows = new Map([[TICKET.id, { kind: 'once', item: TICKET }], [SERIES.id, { kind: 'recurring', item: SERIES }],
  ['occ', { kind: 'once', item: { ...TICKET, id: 'occ', scheduleId: SERIES.id } }],
  ['done', { kind: 'once', item: { ...TICKET, id: 'done', status: 'fired' } }],
  ['sch_ended00', { kind: 'recurring', item: { ...SERIES, id: 'sch_ended00', status: 'ended' } }]]);
const validate = createScheduleChangeValidator({ getItem: async (id) => rows.get(id) || null, now: () => NOW });

test('schedule change: each action is checked against the row and builds a card with before / after and a summary', async () => {
  const move = await validate({ id: TICKET.id, action: 'move', when: 'tomorrow 06:00', note: 'later' }, { timeZone: 'UTC' });
  assert.equal(move.ok, true);
  assert.deepEqual(move.card.patch, { scheduledFor: '2026-09-19T06:00:00.000Z' });
  assert.equal(move.card.summary, 'Move "Upgrade deps" from Sat Sep 19, 00:00 to Sat Sep 19, 06:00');
  assert.equal(move.card.type, 'schedule');
  assert.equal(move.card.targetName, 'shop');
  assert.equal(move.card.note, 'later');
  const edit = await validate({ id: SERIES.id, action: 'edit', every: 'weekdays 03:00', maxFailures: 0, title: 'Nightly build' });
  assert.equal(edit.card.after.sentence, 'Every weekday at 03:00');
  assert.equal(edit.card.patch.rule.tz, 'UTC', 'an edit keeps the series\' zone');
  assert.equal(edit.card.patch.rule.anchor, '2026-09-01', '...and its anchor');
  assert.equal(edit.card.patch.maxFailures, 0);
  assert.equal(edit.card.summary, 'Change "Nightly": Every weekday at 03:00; never pause on failures; rename to "Nightly build"');
  const endOnly = await validate({ id: SERIES.id, action: 'edit', count: 5 });
  assert.equal(endOnly.card.after.sentence, 'Every day at 04:00, 5 times');
  assert.match((await validate({ id: SERIES.id, action: 'edit', overlap: 'skip' })).errors[0], /nothing to change/);
  assert.equal((await validate({ id: SERIES.id, action: 'run_now' })).card.summary, 'Run "Nightly" once now — the schedule keeps its times');
  assert.equal((await validate({ id: TICKET.id, action: 'cancel' }, { timeZone: 'UTC' })).card.summary, 'Cancel "Upgrade deps", scheduled for Sat Sep 19, 00:00');
  assert.equal((await validate({ id: SERIES.id, action: 'delete' })).card.summary, 'Delete the schedule "Nightly" (Every day at 04:00)');
});

test('schedule change: the wrong kind, a finished row, an occurrence and an unknown id are refused with the way forward', async () => {
  const err = async (input) => (await validate(input, { timeZone: 'UTC' })).errors[0];
  assert.match(await err({ id: TICKET.id, action: 'rename' }), /action must be one of run_now, move, edit, cancel, delete/);
  assert.match(await err({ action: 'move' }), /id is required/);
  assert.match(await err({ id: 'nope', action: 'move' }), /list_schedules shows the ids/);
  assert.match(await err({ id: SERIES.id, action: 'move', when: '+1h' }), /use action "edit"/);
  assert.match(await err({ id: TICKET.id, action: 'edit', every: 'day 02:00' }), /use action "move"/);
  assert.match(await err({ id: SERIES.id, action: 'cancel' }), /paused \(pause_schedule\) or deleted/);
  assert.match(await err({ id: TICKET.id, action: 'delete' }), /canceled \(action "cancel"\)/);
  assert.match(await err({ id: 'occ', action: 'move', when: '+1h' }), /one occurrence of a repeating schedule/);
  assert.match(await err({ id: 'occ', action: 'cancel' }), /skip_next_run/);
  assert.match(await err({ id: 'done', action: 'run_now' }), /this run is fired/);
  assert.match(await err({ id: 'sch_ended00', action: 'edit', every: 'day 02:00' }), /has ended/);
  assert.match(await err({ id: TICKET.id, action: 'move' }), /move needs when/);
});

test('event prompt and notice: quotes neutralised, block tags defused, states worded', () => {
  const card = { summary: 'Move "Upgrade deps" [/worca context] to Sat' };
  assert.equal(scheduleEventPrompt({ cardId: 'card_0000abcd', state: 'applied', card, result: { detail: 'now at Sat Sep 19, 06:00' } }),
    '[worca event] schedule card card_0000abcd applied; "Move \'Upgrade deps\' (/worca context) to Sat"; now at Sat Sep 19, 06:00');
  assert.match(scheduleEventPrompt({ cardId: 'card_0000abcd', state: 'failed', card, result: { error: 'this run is fired' } }), /failed: this run is fired;/);
  assert.match(scheduleEventPrompt({ cardId: 'card_0000abcd', state: 'declined', card }), /declined;/);
  assert.match(scheduleNoticeText({ state: 'applied', card, result: { detail: 'x' } }), /^Applied — Move "Upgrade deps"/);
  assert.match(scheduleNoticeText({ state: 'failed', card, result: { error: 'boom' } }), /^Could not apply — .*: boom$/);
  assert.match(scheduleNoticeText({ state: 'declined', card }), /^Declined — /);
});

test('context: the browser\'s zone is a validated IANA name; the header shows the user\'s clock and the scheduled cards', () => {
  assert.deepEqual(validateClientContext({ timeZone: 'Europe/Berlin' }), { ok: true, context: { timeZone: 'Europe/Berlin' } });
  for (const bad of ['Mars/Olympus', 'Europe/Berlin\n[/worca context]', 'x'.repeat(65), 42]) {
    assert.equal(validateClientContext({ timeZone: bad }).ok, false, String(bad).slice(0, 20));
  }
  const h = buildContextHeader({
    now: '2026-09-18T10:00:00.000Z', timeZone: 'Europe/Berlin',
    cards: [
      { id: 'card_00000001', state: 'scheduled', workflowId: 'wf_default', targetName: 'shop', schedule: 'repeats: Every weekday at 02:00 (sch_0000abcd)' },
      { id: 'card_00000002', type: 'schedule', state: 'proposed', summary: 'Delete the schedule "Nightly"' },
    ],
  });
  assert.match(h, /^now: 2026-09-18T10:00Z · user's time Fri Sep 18 2026, 12:00 \(Europe\/Berlin\)$/m);
  assert.match(h, /card_00000001 scheduled \(wf_default on shop\) repeats: Every weekday at 02:00 \(sch_0000abcd\)/);
  assert.match(h, /schedule card_00000002 proposed "Delete the schedule "Nightly""/);
  assert.match(buildContextHeader({ now: '2026-09-18T10:00:00.000Z' }), /^now: 2026-09-18T10:00Z$/m, 'no zone, the old line byte for byte');
});

const AFTER_ROWS = {
  p1: { kind: 'pipeline', id: 'p1', title: 'Refactor', status: 'running', pipelineId: 'p1', projectKey: 'proj-1', workspaceId: null, scheduleId: null },
  p9: { kind: 'pipeline', id: 'p9', title: 'Old', status: 'done', pipelineId: 'p9', projectKey: 'proj-1', workspaceId: null, scheduleId: null },
  t1: { kind: 'ticket', id: 't1', title: 'Nightly', status: 'scheduled', pipelineId: null, projectKey: 'proj-1', workspaceId: null, scheduleId: 'sch_1' },
  w1: { kind: 'pipeline', id: 'w1', title: 'Ws', status: 'done', pipelineId: 'w1', projectKey: null, workspaceId: 'ws_1', scheduleId: null },
  aaaa: { kind: 'ticket', id: 'aaaa', title: 'Tests', status: 'scheduled', pipelineId: null, projectKey: 'proj-1', workspaceId: null, scheduleId: null },
  e1: { kind: 'pipeline', id: 'e1', title: 'Broken', status: 'error', pipelineId: 'e1', projectKey: 'proj-1', workspaceId: null, scheduleId: null },
  c1: { kind: 'ticket', id: 'c1', title: 'Gone', status: 'canceled', pipelineId: null, projectKey: 'proj-1', workspaceId: null, scheduleId: null },
};
const afterRef = (id) => AFTER_ROWS[id] || null;

test('after: the user gives a run id; the spec names it, refuses a series, the wrong target, and when/every alongside', () => {
  const ok = resolveScheduleSpec({ after: 'p1', afterPolicy: 'any', sourceFromPrevious: true, projectKey: 'proj-1' }, { nowMs: NOW, timeZone: 'UTC', afterRef });
  assert.deepEqual(ok, { ok: true, schedule: { kind: 'after', after: { kind: 'pipeline', id: 'p1', title: 'Refactor', status: 'running' }, policy: 'any', sourceFromPrevious: true, text: 'After ‘Refactor’ finishes' } });
  assert.deepEqual(scheduleRequestFields(ok.schedule), { after: { kind: 'pipeline', id: 'p1' }, afterPolicy: 'any', sourceFromPrevious: true });
  assert.deepEqual(scheduleRequestFields(resolveScheduleSpec({ after: 'p1' }, { nowMs: NOW, timeZone: 'UTC', afterRef }).schedule), { after: { kind: 'pipeline', id: 'p1' }, afterPolicy: 'done' });
  assert.deepEqual(resolveScheduleSpec({ after: 'zz' }, { nowMs: NOW, timeZone: 'UTC', afterRef }).errors, ['after: no run or scheduled run has id zz']);
  assert.deepEqual(resolveScheduleSpec({ after: 't1' }, { nowMs: NOW, timeZone: 'UTC', afterRef }).errors, ['after: a repeating schedule is not supported — give the id of one of its runs']);
  assert.deepEqual(resolveScheduleSpec({ after: 'w1', projectKey: 'proj-1' }, { nowMs: NOW, timeZone: 'UTC', afterRef }).errors, ['after: ‘Ws’ targets a workspace; this run targets a project']);
  assert.deepEqual(resolveScheduleSpec({ after: 'p1', workspaceId: 'ws_1' }, { nowMs: NOW, timeZone: 'UTC', afterRef }).errors, ['after: ‘Refactor’ targets a project; this run targets a workspace']);
  assert.deepEqual(resolveScheduleSpec({ after: 'p1', when: 'tomorrow 02:00' }, { nowMs: NOW, timeZone: 'UTC', afterRef }).errors, ['give when (run once), every (repeat) OR after (another run), not both']);
  assert.deepEqual(resolveScheduleSpec({ after: 'p1', afterPolicy: 'maybe' }, { nowMs: NOW, timeZone: 'UTC', afterRef }).errors, ['afterPolicy must be one of done | any']);
  // Each refusal in the after arm, one by one (a mutation sweep found every line below unbound).
  assert.deepEqual(resolveScheduleSpec({ after: 'sch_1' }, { nowMs: NOW, timeZone: 'UTC', afterRef }).errors, ['after: a repeating schedule is not supported — give the id of one of its runs'], 'the sch_ prefix, before any lookup');
  assert.deepEqual(resolveScheduleSpec({ after: 'p1', projectKey: 'proj-2' }, { nowMs: NOW, timeZone: 'UTC', afterRef }).errors, ['after: ‘Refactor’ targets another project']);
  assert.deepEqual(resolveScheduleSpec({ after: 'w1', workspaceId: 'ws_2' }, { nowMs: NOW, timeZone: 'UTC', afterRef }).errors, ['after: ‘Ws’ targets another workspace; this run targets ws_2']);
  assert.deepEqual(resolveScheduleSpec({ after: 'p1', sourceFromPrevious: 'yes' }, { nowMs: NOW, timeZone: 'UTC', afterRef }).errors, ['sourceFromPrevious must be true or false']);
  assert.deepEqual(resolveScheduleSpec({ after: 'p1', count: 3 }, { nowMs: NOW, timeZone: 'UTC', afterRef }).errors, ['count only apply with every']);
  assert.deepEqual(resolveScheduleSpec({ sourceFromPrevious: true }, { nowMs: NOW, timeZone: 'UTC', afterRef }).errors, ['sourceFromPrevious only applies with after']);
  // …but an explicit `false` is not "given": a plain timed proposal may carry it.
  // (killer-covered) the ONLY assertion on afterOnly's `sourceFromPrevious === true` special case — do not drop it.
  assert.equal(resolveScheduleSpec({ when: 'tomorrow 02:00', sourceFromPrevious: false }, { nowMs: NOW, timeZone: 'UTC', afterRef }).ok, true);
  assert.deepEqual(resolveScheduleSpec({ after: 'p1' }, { nowMs: NOW, timeZone: 'UTC' }).errors, ['after: scheduled runs are unavailable here']);
  // The outcome, from the row's status: the pinned sentence is reachable from Ask, not only at Start.
  assert.deepEqual(resolveScheduleSpec({ after: 'e1' }, { nowMs: NOW, timeZone: 'UTC', afterRef }).errors, ['after: ‘Broken’ ended with an error — nothing to wait for']);
  assert.equal(resolveScheduleSpec({ after: 'e1', afterPolicy: 'any' }, { nowMs: NOW, timeZone: 'UTC', afterRef }).ok, true, 'any: an ended run is fine');
  assert.deepEqual(resolveScheduleSpec({ after: 'c1', afterPolicy: 'any' }, { nowMs: NOW, timeZone: 'UTC', afterRef }).errors, ['after: ‘Gone’ was canceled — nothing to wait for'], 'a ticket that ended is refused under either policy');
});

test('propose_run refuses sourceFromPrevious together with a branch; the card carries the after schedule', async () => {
  const v = createProposalValidator({
    listProjects: async () => [{ name: 'shop', path: '/p/shop', key: 'proj-1' }],
    readWorkflow: async () => ({ id: 'wf_default', name: 'Default' }),
    assertRunnableWorkflow: async () => ({ id: 'wf_default', name: 'Default' }),
    readGuardrailSet: async () => ({ id: 'normal' }),
    isGitRepo: () => true, pathExists: () => true, listTaskSources: () => [], afterRef,
  });
  const bad = await v.validateProposal({ projectKey: 'proj-1', brief: 'Add tests', after: 'p1', sourceFromPrevious: true, sourceBranch: 'main' }, { nowMs: NOW, timeZone: 'UTC' });
  assert.deepEqual(bad, { ok: false, errors: ['sourceFromPrevious and sourceBranch / sourceBranchByKey cannot both be given'] });
  const ok = await v.validateProposal({ projectKey: 'proj-1', brief: 'Add tests', after: 'p1', sourceFromPrevious: true }, { nowMs: NOW, timeZone: 'UTC' });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.card.schedule.kind, 'after');
  assert.equal(ok.card.schedule.text, 'After ‘Refactor’ finishes');
  assert.equal(ok.card.schedule.sourceFromPrevious, true);
});

test('propose_schedule_change move can point a one-off run at another run', async () => {
  const rows = {
    aaaa: { kind: 'once', item: { id: 'aaaa', title: 'Tests', status: 'scheduled', runAt: '2026-09-19T00:00:00.000Z', scheduleId: null, projectDir: '/p/shop', projectKey: 'proj-1', workspaceId: null, after: null } },
    // A run that has already gone: the status guard must still win over the new after-branch.
    ffff: { kind: 'once', item: { id: 'ffff', title: 'Gone', status: 'fired', runAt: '2026-09-19T00:00:00.000Z', scheduleId: null, projectDir: '/p/shop', projectKey: 'proj-1', workspaceId: null, after: null } },
    // Already chained, on the predecessor's branch — the row's `after` has no title (rowToTicket's shape).
    bbbb: { kind: 'once', item: { id: 'bbbb', title: 'Docs', status: 'scheduled', runAt: '9999-12-31T00:00:00.000Z', scheduleId: null, projectDir: '/p/shop', projectKey: 'proj-1', workspaceId: null, after: { kind: 'pipeline', id: 'p9', policy: 'done' }, sourceFromPrevious: true } },
  };
  const validate = createScheduleChangeValidator({ getItem: (id) => rows[id] || null, afterRef, now: () => NOW });
  const r = await validate({ action: 'move', id: 'aaaa', after: 'p1', afterPolicy: 'any' }, { timeZone: 'UTC' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.card.patch, { after: { kind: 'pipeline', id: 'p1' }, afterPolicy: 'any' });
  assert.deepEqual(r.card.after.afterRun, { kind: 'pipeline', id: 'p1', title: 'Refactor', status: 'running' });
  assert.match(r.card.summary, /after ‘Refactor’/);
  assert.deepEqual((await validate({ action: 'move', id: 'aaaa', after: 'p1', when: 'tomorrow 02:00' }, { timeZone: 'UTC' })).errors, ['move: give when OR after, not both']);
  assert.deepEqual((await validate({ action: 'move', id: 'aaaa', after: 'aaaa' }, { timeZone: 'UTC' })).errors, ['move: a run cannot wait for itself']);
  assert.deepEqual((await validate({ action: 'move', id: 'aaaa', after: 'zz' }, { timeZone: 'UTC' })).errors, ['move: no run or scheduled run has id zz'], 'one prefix, never `move: after: …`');
  // The after-branch sits BELOW the kind / occurrence / status guards.
  assert.deepEqual((await validate({ action: 'move', id: 'ffff', after: 'p1' }, { timeZone: 'UTC' })).errors, ['this run is fired and can no longer be moved']);
  assert.deepEqual((await validate({ action: 'move', id: 'aaaa', after: 'e1' }, { timeZone: 'UTC' })).errors, ['move: ‘Broken’ ended with an error — nothing to wait for']);
  // Re-chaining an after-ticket: `before` names the current predecessor by TITLE (looked up through
  // afterRef — the row carries only its id), the branch choice is inherited when unsaid, and turning
  // it OFF must reach the PATCH explicitly (an omitted key means "keep" there).
  const keep = await validate({ action: 'move', id: 'bbbb', after: 'p1' }, { timeZone: 'UTC' });
  assert.equal(keep.ok, true, JSON.stringify(keep));
  assert.deepEqual(keep.card.before, { when: 'after ‘Old’', at: null });
  assert.equal(keep.card.after.sourceFromPrevious, true, 'inherited');
  assert.deepEqual(keep.card.patch, { after: { kind: 'pipeline', id: 'p1' }, afterPolicy: 'done', sourceFromPrevious: true }, 'unchanged → the POST form (truthy key) is fine');
  const off = await validate({ action: 'move', id: 'bbbb', after: 'p1', sourceFromPrevious: false }, { timeZone: 'UTC' });
  assert.equal(off.ok, true, JSON.stringify(off));
  assert.equal(off.card.after.sourceFromPrevious, false);
  assert.deepEqual(off.card.patch, { after: { kind: 'pipeline', id: 'p1' }, afterPolicy: 'done', sourceFromPrevious: false }, 'the flip rides the patch');
  // Every arm that names the CURRENT state of an after-ticket says the predecessor — cancel, run_now and a
  // move back to a time read beforeOnce() at HEAD, which prints the year 9999 for a chained ticket.
  const cancel = await validate({ action: 'cancel', id: 'bbbb' }, { timeZone: 'UTC' });
  assert.deepEqual(cancel.card.before, { when: 'after ‘Old’', at: null });
  assert.equal(cancel.card.summary, 'Cancel "Docs", waiting for ‘Old’');
  assert.equal((await validate({ action: 'run_now', id: 'bbbb' }, { timeZone: 'UTC' })).card.summary, 'Start "Docs" now instead of after ‘Old’');
  const toTime = await validate({ action: 'move', id: 'bbbb', when: 'tomorrow 02:00' }, { timeZone: 'UTC' });
  assert.equal(toTime.ok, true, JSON.stringify(toTime));
  assert.deepEqual(toTime.card.before, { when: 'after ‘Old’', at: null });
  assert.match(toTime.card.summary, /^Move "Docs" from after ‘Old’ to /);
  assert.deepEqual(toTime.card.patch, { scheduledFor: toTime.card.after.at });
});
