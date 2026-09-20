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
