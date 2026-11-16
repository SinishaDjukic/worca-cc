#!/usr/bin/env node
// tools/stillhet-seed-schedules.mjs — a sandbox Worca whose Schedules hold one REAL record of every state the Schedules walk
// reads (Stillhet slice 6, D13, the plan's state table). Every record is the server's own, made through dev's routes: series
// and one-off tickets by POST /api/run (repeat / scheduledFor, three of them from a chat card), then dev's skip-next, pause and
// run-now routes. "Paused after failures" is real too: its preset is deleted and its Run now fails to start, which fails the
// ticket and pauses the series after its one allowed failure; "missed" is a ticket whose time passed while the scheduler
// slept (schedulerTick with a grace of 0); "ended" is a series of one run that fired.
//
// Run: PORT=4937 node tools/stillhet-seed-schedules.mjs   (pin a PORT: an agent inherits the host app's 4317)
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL = 'claude-opus-5-5';
const RULE = (time, extra = {}) => ({ freq: 'daily', interval: 1, time, tz: 'UTC', ...extra });

/** The state each seeded record is, in the state table's order; `chat: true` for the ones started from a chat card. */
export const SEEDED_SCHEDULES = Object.freeze([
  { key: 'next', what: 'next up: a daily series', chat: true },
  { key: 'skipped', what: 'skipped next: Skip next time pressed (Keep next time brings it back)', chat: true },
  { key: 'paused', what: 'paused by you', chat: true },
  { key: 'failing', what: 'paused after failures: its start failed for real (the folder is gone) and it paused itself', chat: false },
  { key: 'missed', what: 'a one-off ticket that missed its start', chat: false },
  { key: 'running', what: 'a series whose Run now is running a task', chat: false },   // not from a chat: dev refuses Run now on a chat-made series ("card is scheduled", plans/rail/findings.md)
  { key: 'waiting', what: 'a one-off ticket waiting for its time', chat: false },
  { key: 'ended', what: 'a series that reached its end', chat: false },
]);

/** A git repository with one commit. */
async function repo(prefix) {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 'seed@worca.local'], ['config', 'user.name', 'seed']]) execFileSync('git', a, { cwd: dir });
  await writeFile(path.join(dir, 'README.md'), '# seed project\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });
  return dir;
}

/**
 * Seeds the eight states into the running server at `base` (this process's ui/server.mjs). `tick` is its schedulerTick.
 * → { project, schedules: {key → schedule or ticket id}, tickets: {failed, missed} }
 */
export async function seedSchedules({ base, projectDir, projectName = 'Seed project', tick }) {
  const ask = await import('../src/core/ask/store.mjs');
  const { getDb } = await import('../src/core/db.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  const call = async (method, p, body) => {
    const r = await fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${method} ${p}: HTTP ${r.status} ${JSON.stringify(data)}`);
    return data;
  };
  await call('POST', '/api/projects', { name: projectName, path: projectDir });
  const key = projectKey(projectDir);
  const run = (body) => call('POST', '/api/run', { projectDir, mock: true, ...body });
  // a schedule proposed in a chat, as Chat's propose card makes it, then scheduled from that card
  const fromChat = async (title, body) => {
    const threadId = ask.createThread({ title: `Seed · ${title}`, model: MODEL, effort: 'high' }).id;
    ask.updateThread(threadId, { context: { pinned: true, projectKey: key } });
    ask.appendMessage(threadId, { role: 'user', text: `${title}, every night` });
    const cardId = ask.newAskId('card');
    ask.appendMessage(threadId, { role: 'assistant', text: 'Here is the schedule.', status: 'done', model: MODEL, blocks: [{ kind: 'card', id: cardId, state: 'proposed', card: { target: 'project', projectKey: key, projectDir, projectName, brief: title, title, sourceBranch: 'main' } }] });
    return run({ prompt: title, title, askThreadId: threadId, askCardId: cardId, ...body });
  };
  const schedules = {}, tickets = {};

  schedules.next = (await fromChat('Nightly export check', { repeat: { rule: RULE('02:00') } })).scheduleId;
  schedules.skipped = (await fromChat('Release notes draft', { repeat: { rule: RULE('03:00') } })).scheduleId;
  await call('POST', `/api/schedules/${schedules.skipped}/skip-next`);
  schedules.paused = (await fromChat('Cost report', { repeat: { rule: RULE('04:00') } })).scheduleId;
  await call('POST', `/api/schedules/${schedules.paused}/pause`);

  // paused after failures: a series that follows a saved preset, which is then deleted; its Run now cannot start (dev's
  // fireTicket: the preset no longer exists, a permanent failure), so the ticket fails and, with one failure allowed, the
  // series pauses itself (failure_streak). It also reads "preset deleted" (D10).
  const { preset } = await call('POST', '/api/presets', { name: 'Docs preset', scope: { kind: 'global' }, setup: {} });
  schedules.failing = (await run({ prompt: 'Docs sync', title: 'Docs sync', presetId: preset.id, repeat: { rule: RULE('05:00'), maxFailures: 1 } })).scheduleId;
  await call('DELETE', `/api/presets/${preset.id}`);
  tickets.failed = (await call('POST', `/api/schedules/${schedules.failing}/run-now`)).runId;

  // missed: a one-off whose time passed while the scheduler slept, with no grace
  const soon = new Date(Date.now() + 3600_000).toISOString();
  schedules.missed = tickets.missed = (await run({ prompt: 'Weekly deps update', title: 'Weekly deps update', scheduledFor: soon, ifMissed: 'skip', graceMin: 0 })).runId;
  getDb().prepare('UPDATE scheduled_runs SET run_at = ? WHERE id = ?').run(new Date(Date.now() - 10 * 60_000).toISOString(), tickets.missed);
  await tick();

  schedules.running = (await run({ prompt: 'Changelog digest', title: 'Changelog digest', repeat: { rule: RULE('06:00') } })).scheduleId;
  tickets.running = (await call('POST', `/api/schedules/${schedules.running}/run-now`)).runId;

  schedules.waiting = (await run({ prompt: 'Flaky test sweep', title: 'Flaky test sweep', scheduledFor: new Date(Date.now() + 26 * 3600_000).toISOString() })).runId;

  // ended: a series of one run (end after 1); its time comes (moved a minute back) and the tick fires it, so it ends
  schedules.ended = (await run({ prompt: 'Q3 migration check', title: 'Q3 migration check', repeat: { rule: RULE('07:00', { end: { type: 'count', count: 1 } }) } })).scheduleId;
  tickets.ended = getDb().prepare("SELECT id FROM scheduled_runs WHERE schedule_id = ? AND status = 'scheduled'").get(schedules.ended).id;
  getDb().prepare('UPDATE scheduled_runs SET run_at = ? WHERE id = ?').run(new Date(Date.now() - 60_000).toISOString(), tickets.ended);
  await tick();

  return { project: key, schedules, tickets };
}

async function main() {
  const port = Number(process.env.PORT_SEED || process.env.PORT);
  if (!port || port === 4317) { console.error('set PORT to a free port other than the host app\'s 4317, e.g. PORT=4937'); return 2; }
  const home = await mkdtemp(path.join(tmpdir(), 'worca-seed-schedules-home-'));
  process.env.HOME = home; process.env.USERPROFILE = home;
  process.env.WORCA_HOME = path.join(home, '.worca-cc');
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  await mkdir(path.join(home, '.worca-cc'), { recursive: true });
  await writeFile(path.join(home, '.worca-cc', 'settings.json'), JSON.stringify({ onboarding: { welcomeSeen: true }, flags: { rail: true }, uiLevel: 'expert' }));
  const proj = await repo('worca-seed-schedules-proj-');
  const { server, schedulerTick } = await import(new URL('../ui/server.mjs', import.meta.url).href);
  await new Promise((r, j) => { server.once('error', j); server.listen(port, '127.0.0.1', r); });
  const base = `http://127.0.0.1:${port}`;
  const out = await seedSchedules({ base, projectDir: proj, tick: () => schedulerTick() });
  console.log(`Seeded ${base}  (HOME ${home}, project ${proj})`);
  for (const s of SEEDED_SCHEDULES) console.log(`  ${base}/#schedule/${out.schedules[s.key]}  ${s.what}${s.chat ? ' (from a chat)' : ''}`);
  console.log('The server stays up for the walk; Ctrl-C ends it.');
  await new Promise(() => {});
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
