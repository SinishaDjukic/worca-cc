// test/stillhet-schedules-page-host.test.mjs — a schedule's page in both kinds: the demo's DraftBar and Delete's Undo, the
// preset and run-after facts, the Ended section, one TaskCard per fire, and one word per schedule on every surface that
// draws it (RailSchedules.wordOf / nextOf / skipItem) for the seeded states (Schedules D6, D8, D10, D11, Step 9).
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { stillhetHost } from './helpers/stillhet-host.mjs';
import { liveHost, go, settle, closeHosts, clone, SOURCES, THREAD } from './helpers/stillhet-chat-live-host.mjs';

afterEach(closeHosts);
const toastText = (d) => [...d.querySelectorAll('body > .rc-toast')].map((e) => e.textContent).filter(Boolean).join(' | ');
const line = (d) => d.querySelector('#route-schedule .convo-card-line')?.textContent || '';
const facts = (d) => d.querySelector('#route-schedule .place-head')?.textContent || '';

test('demo: a picker change shows the DraftBar with 1 change; Discard drops it', async () => {
  const w = stillhetHost({ hash: '#schedule/s2', after }); await settle(200);
  const d = w.document;
  d.querySelector('#route-schedule [data-menu="sc-at"]').click(); await settle(10);
  d.querySelector('#route-schedule [data-menu-pick="sc-at|10:00"]').click(); await settle(20);
  assert.match(d.querySelector('#route-schedule .draft-bar').textContent, /1 change/);
  assert.equal(w.RailSchedules.find('s2').at, '09:00', 'the schedule keeps its time until Save');
  d.querySelector('#route-schedule [data-sched-discard]').click(); await settle(20);
  assert.equal(d.querySelector('#route-schedule .draft-bar'), null);
});

test('demo: Delete hides the schedule and says "Deleted TITLE" with Undo; Undo brings it back', async () => {
  const w = stillhetHost({ hash: '#schedule/s2', after }); await settle(200);
  const d = w.document;
  w.RailSchedules.act('s2', 'delete'); await settle(20);
  assert.equal(w.RailSchedules.find('s2'), undefined);
  assert.match(toastText(d), /^Deleted Weekly deps update/);
  d.querySelector('body > .rc-toast button').click(); await settle(20);
  assert.ok(w.RailSchedules.find('s2'));
});

test('demo: a preset-backed schedule says where it comes from; an ended one reads Ended, with no Run now, in its own section', async () => {
  const w = stillhetHost({ hash: '#schedule/s7', after }); await settle(200);
  const d = w.document;
  assert.match(facts(d), /from Flaky sweep/);
  w.location.hash = '#schedule/s8'; await settle(80);
  assert.match(line(d), /^Ended/);
  assert.equal(d.querySelector('#route-schedule [data-sched-now]'), null);
  assert.match(d.querySelector('#bar-schedules').textContent, /Ended/, 'the Ended section');
  assert.ok(d.querySelector('#bar-schedules [data-menu="row:sched:s8"]'));
});

test('demo: a schedule\'s Chat card reads its word and why; its More › Delete says "Deleted TITLE" with Undo, and Undo brings it back', async () => {
  const w = stillhetHost({ hash: '#chat/c1', after }); await settle(300);
  const d = w.document, S = w.RailSchedules;
  const card = d.querySelector('#route-chat [data-menu="card:s1"]').closest('.task-card, [data-anchor]');
  assert.equal(card.querySelector('.kind-mark').getAttribute('title'), `${S.wordOf('s1')} · ${S.nextOf('s1')}`, 'its mark says the word, as the bar row\'s does');
  assert.ok(card.textContent.includes(S.nextOf('s1')), card.textContent);
  w.RailSchedules.act('s1', 'skip'); await settle(40);
  assert.ok(d.querySelector('#route-chat [data-menu="card:s1"]').closest('.task-card, [data-anchor]').textContent.includes('Skips next time, then as usual'), 'a skip shows on the card too');
  d.querySelector('#route-chat [data-menu="card:s1"]').click(); await settle(10);
  d.querySelector('#route-chat [data-menu-pick="card:s1|Delete"]').click(); await settle(40);
  assert.match(toastText(d), /^Deleted /);
  assert.equal(S.find('s1'), undefined);
  d.querySelector('body > .rc-toast button').click(); await settle(40);
  assert.ok(S.find('s1'), 'Undo brings it back');
});

test('a failed ticket\'s task page: Open project opens projects/KEY and says which', async () => {
  const w = stillhetHost({ hash: '#run/ticket-failed', after }); await settle(300);
  const said = []; const say = w.RailPulse.say; w.RailPulse.say = (t, u) => { said.push(t); return say(t, u); };
  w.document.querySelector('#card [data-label="Open project"]').click(); await settle(100);
  assert.equal(w.location.hash, '#projects/worca-cc');
  assert.deepEqual(said, ['Opened worca-cc']);
});

// ---- the live kind: the seeded states of the state table, one word on every surface ----
const iso = (h, dd = 12) => new Date(2026, 10, dd, h).toISOString();
const STATES = [
  // [state, schedule or ticket, the table's word, its skip item, the history (for running)]
  ['next up', { id: 'sch_next', askThreadId: 'ask_1', kind: 'recurring', title: 'Next one', status: 'active', nextRunAt: iso(2, 13), rule: { freq: 'daily', interval: 1, time: '02:00', tz: 'UTC' }, presetId: 'pr1', presetName: 'Nightly preset' }, 'Next up', 'Skip next time'],
  ['skipped next', { id: 'sch_skip', askThreadId: 'ask_1', kind: 'recurring', title: 'Skipped one', status: 'active', nextRunAt: iso(2, 14), skippedRunAt: iso(2, 13), rule: { freq: 'daily', interval: 1, time: '02:00', tz: 'UTC' } }, 'Next up', 'Keep next time'],
  ['paused by you', { id: 'sch_pyou', askThreadId: 'ask_1', kind: 'recurring', title: 'Paused one', status: 'paused', pauseReason: 'user', nextRunAt: null }, 'Paused', 'Skip next time'],
  ['paused after failures', { id: 'sch_pfail', kind: 'recurring', title: 'Self paused', status: 'paused', pauseReason: 'failed 3 times in a row', nextRunAt: null, presetId: 'pr9', presetName: null }, 'Paused', 'Skip next time'],
  ['missed one-off', { id: 'tk_miss', kind: 'once', title: 'Missed one', status: 'missed', runAt: iso(3), failReason: 'Worca was off' }, 'Missed', null],
  ['running', { id: 'sch_run', kind: 'recurring', title: 'Running one', status: 'active', nextRunAt: iso(2, 13) }, null, 'Skip next time', [{ id: 'run-b', status: 'fired', pipelineId: 'pb', runAt: iso(14), title: 'Running one' }]],
  ['one-off waiting', { id: 'tk_wait', kind: 'once', title: 'Waiting one', status: 'scheduled', runAt: iso(18) }, 'Next up', null],
  ['ended', { id: 'sch_end', kind: 'recurring', title: 'Ended one', status: 'ended', nextRunAt: null }, 'Ended', null],
];
// the state table's chat:true states (DEVIATIONS 5: running is not made from a chat card)
const CHAT = ['sch_next', 'sch_skip', 'sch_pyou'];
async function liveWorld() {
  const src = clone(SOURCES);
  src.schedules.schedules = STATES.filter(([, x]) => x.kind === 'recurring').map(([, x]) => x);
  src.schedules.tickets = [...STATES.filter(([, x]) => x.kind === 'once').map(([, x]) => x), { id: 'tk_after', kind: 'once', title: 'After one', status: 'scheduled', runAt: '9999-12-31T00:00:00.000Z', after: { kind: 'pipeline', id: 'pa', title: 'Ask me' } }];
  const history = Object.fromEntries(STATES.filter((x) => x[4]).map(([, x, , , h]) => [x.id, h]));
  history.sch_next = [{ id: 'f1', status: 'fired', pipelineId: 'h2', runAt: iso(2, 11), title: 'Next one' }, { id: 'f2', status: 'failed', runAt: iso(2, 10), failReason: 'the folder is gone', title: 'Next one' }, { id: 'f3', status: 'missed', runAt: iso(2, 9), title: 'Next one' }];
  const read = (u) => { const m = /^\/api\/schedules\/([\w-]+)$/.exec(u); return m ? [200, { item: {}, history: history[m[1]] || [], notifications: [] }] : null; };
  // the chat:true states were scheduled from ask_1: dev flips each one's proposal card to `scheduled` with its scheduleId
  const thread = clone(THREAD);
  thread.messages.push({ id: 'm9', role: 'assistant', text: 'Scheduled.', status: 'done', createdAt: iso(13, 12), blocks: CHAT.map((id) => ({ kind: 'card', id: `card_${id}`, state: 'scheduled', card: { title: id, scheduleId: id } })) });
  return liveHost({ sources: src, read, thread: () => [200, thread] });
}

test('live: the page lists one TaskCard per fire of its history', async () => {
  const { w, d } = await liveWorld();
  await go(w, '#schedule/sch_next', 150); await settle(400);
  assert.equal(d.querySelectorAll('#route-schedule .task-card, #route-schedule [data-sched-run], #route-schedule [data-sched-ticket$="|now"]').length >= 3, true);
  assert.equal(w.RailSchedules.find('sch_next').runs.length, 3);
  assert.match(facts(d), /from Nightly preset/);
});

test('live: each seeded state reads the same word, why and skip item on its page, its center card, its bar row and its Pulse row', async () => {
  const { w, d } = await liveWorld();
  await go(w, '#schedules', 150); await settle(500);
  const S = w.RailSchedules, fails = [];
  d.querySelector('#bar-schedules [data-menu="by"]').click(); await settle(10);
  d.querySelector('#bar-schedules [data-pick="by|state"]').click(); await settle(40);   // every section open: one row per schedule
  for (const [state, x, word, skip] of STATES) {
    const got = S.wordOf(x.id);
    if (got !== (word || w.RailUI.runState('working').word)) fails.push(`${state}: wordOf ${got} ≠ ${word}`);
    const card = d.querySelector(`[data-c-card="${x.id}"]`);
    if (!card) fails.push(`${state}: no center card`);
    else if (!card.textContent.includes(got)) fails.push(`${state}: card lacks ${got}`);
    const mark = d.querySelector(`#bar-schedules [data-menu="row:sched:${x.id}"]`)?.closest('li, .row, [role="row"], [data-row]')?.querySelector('.kind-mark');
    if (!mark) fails.push(`${state}: no bar row`);
    else if (!mark.getAttribute('title').startsWith(got)) fails.push(`${state}: bar row ${mark.getAttribute('title')} ≠ ${got}`);
    if (skip && S.skipItem(x.id).text !== skip) fails.push(`${state}: skip ${S.skipItem(x.id).text} ≠ ${skip}`);
  }
  for (const [state, x] of STATES) {
    await go(w, `#schedule/${x.id}`, 120);
    const got = S.wordOf(x.id);
    if (!line(d).startsWith(got)) fails.push(`${state}: page word ${line(d)} ≠ ${got}`);
    if (S.nextOf(x.id) && !line(d).includes(S.nextOf(x.id))) fails.push(`${state}: page why lacks ${S.nextOf(x.id)}`);
  }
  // Pulse: a schedule still to come or missed is a row there (Scheduled, or Needs you), with the same word and why
  w.RailPulse.open('now'); await settle(80);
  const rowed = [];
  for (const [state, x] of STATES) {
    const b = d.querySelector(`#app .pz-popover [data-row="r:sched:${x.id}"] button[data-open]`);
    if (!b) continue;
    rowed.push(state);
    const words = [S.wordOf(x.id), S.nextOf(x.id)].filter(Boolean).join(' · ');
    if (!b.getAttribute('title').includes(words)) fails.push(`${state}: Pulse row ${b.getAttribute('title')} lacks ${words}`);
  }
  assert.deepEqual(rowed, ['next up', 'skipped next', 'missed one-off', 'running', 'one-off waiting'], 'paused and ended ones have no time to come');
  assert.deepEqual(fails, []);
  assert.equal(S.nextOf('sch_skip'), 'Skips next time, then as usual');
  assert.equal(S.nextOf('sch_pyou'), 'by you');
  assert.equal(S.nextOf('sch_pfail'), 'failed 3 times in a row');
  assert.equal(S.nextOf('sch_end'), '');
  assert.equal(S.nextOf('tk_after'), 'after Ask me', 'a run-after ticket says what it waits for in place of a time');
  await go(w, '#schedule/sch_pfail', 120);
  assert.match(facts(d), /preset deleted/);
});

test('live: a schedule made from a chat has its Chat card, with the same word and why as its page; the other states have none', async () => {
  const { w, d } = await liveWorld();
  await go(w, '#chat/ask_1', 300); await settle(300);
  const S = w.RailSchedules, fails = [];
  for (const [state, x] of STATES) {
    const card = d.querySelector(`#route-chat [data-menu="card:${x.id}"]`)?.closest('.task-card, [data-anchor]');
    if (!CHAT.includes(x.id)) { if (card) fails.push(`${state}: a Chat card it was not made from`); continue; }
    if (!card) { fails.push(`${state}: no Chat card`); continue; }
    const words = [S.wordOf(x.id), S.nextOf(x.id)].filter(Boolean).join(' · ');
    if (card.querySelector('.kind-mark').getAttribute('title') !== words) fails.push(`${state}: mark ${card.querySelector('.kind-mark').getAttribute('title')} ≠ ${words}`);
    if (!card.textContent.includes(S.nextOf(x.id))) fails.push(`${state}: card ${card.textContent} lacks ${S.nextOf(x.id)}`);   // the word is its mark's, as the demo card's (page-host 'demo: a schedule\'s Chat card')
  }
  assert.deepEqual(fails, []);
  // its More menu offers the series' own skip item, as the page's does
  d.querySelector('#route-chat [data-menu="card:sch_skip"]').click(); await settle(10);
  assert.ok(d.querySelector('#route-chat [data-menu-pick="card:sch_skip|Skip"]').textContent.includes(S.skipItem('sch_skip').text));
});
