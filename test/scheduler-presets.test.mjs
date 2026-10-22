// test/scheduler-presets.test.mjs — a schedule follows its run preset (#712 slice 3, D1–D5): the link is kept, the
// preset is read at fire time, and a broken or deleted preset fails the ticket with a reason that names the item.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { presetRunBody } from '../src/shared/run-presets.mjs';

useTempHome(after);

const H = 'X-Forwarded-Email';
let sandboxHome, projectsRoot, srv, base, project, projectDir;
const prevEnv = {};
const JSONH = { 'Content-Type': 'application/json' };
const get = (p) => fetch(`${base}${p}`);
const send = (method, p, b, who) => fetch(`${base}${p}`, { method, headers: { ...JSONH, ...(who ? { [H]: who } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) });
const post = (p, b, who) => send('POST', p, b ?? {}, who);
const DAY = () => new Date(Date.now() + 86400000).toISOString();

before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-cc-presets-home-'));
  projectsRoot = await mkdtemp(join(tmpdir(), 'worca-cc-presets-proot-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_PROJECTS_ROOT', 'WORCA_MOCK', 'WORCA_IDENTITY_HEADER']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_PROJECTS_ROOT = projectsRoot;
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_IDENTITY_HEADER = H;   // a request without the header is the local install (sees every preset)
  process.env.WORCA_IDENTITY_TRUSTED_PROXIES = '127.0.0.1,::1';   // X1: the in-process server's callers are loopback
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  const { addProject } = await import('../src/core/projects.mjs');
  projectDir = gitDir('presetsapi');
  project = (await addProject({ name: 'presetsapi', path: projectDir })).find((p) => p.name === 'presetsapi');
});
after(async () => {
  if (srv) await Promise.race([
    new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
    new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
  ]);
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true, maxRetries: 10 });
  await rm(projectsRoot, { recursive: true, force: true, maxRetries: 10 });
  if (projectDir) await rm(projectDir, { recursive: true, force: true, maxRetries: 10 });
});

// humanInLoop: false — a fired mock run must not park at wf_default's approval gates until the file's after().
const savePreset = async (name, setup) => (await (await post('/api/presets', { name, scope: { kind: 'project', projectDir: project.path },
  setup: { workflowId: 'wf_default', mock: true, humanInLoop: false, ...setup }, basis: { projectDir: project.path } })).json()).preset;
const scheduleFrom = async (preset, extra = {}) => {
  const body = { ...presetRunBody(preset, { projectDir: project.path, prompt: 'nightly' }), scheduledFor: DAY(), ...extra };
  const r = await post('/api/run', body);
  assert.equal(r.status, 202, await r.clone().text());
  return r.json();
};
const runNow = async (id) => (await post(`/api/schedules/${id}/run-now`)).json();
// run_setup is written when the run's row is created, after invokeStartRun returns (same idea as api-schedules `until`).
async function until(fn, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 50)); }
}

test('the schedule keeps the link, never a presetId inside its stored request', async () => {
  const preset = await savePreset('Keep link', { guardrailsId: 'normal' });
  const made = await scheduleFrom(preset);
  const { getTicket } = await import('../src/core/scheduler.mjs');
  const t = getTicket(made.runId, { withRequest: true });
  assert.equal(t.presetId, preset.id);
  assert.equal('presetId' in t.request, false);
  assert.equal(t.request.internal.presetName, 'Keep link');
});

test('editing a preset after scheduling changes the body the fired run uses', { timeout: 120000 }, async () => {
  const preset = await savePreset('Quick fix', { guardrailsId: 'normal', overlay: { nodes: { n_plan: { model: 'claude-haiku-4-5' } } } });
  const made = await scheduleFrom(preset);
  // claude-sonnet-4-6 is in the catalog (src/core/config.mjs); an id outside it would be refused at fire time.
  const put = await send('PUT', `/api/presets/${preset.id}`, { setup: { ...preset.setup, guardrailsId: 'secure',
    overlay: { ...preset.setup.overlay, nodes: { ...preset.setup.overlay.nodes, n_plan: { model: 'claude-sonnet-4-6', effort: 'high' } } } },
    basis: { projectDir: project.path } });
  assert.equal(put.status, 200, await put.clone().text());
  const fired = await runNow(made.runId);
  assert.equal(fired.status, 'fired', JSON.stringify(fired));
  // run-now's pipelineId is almost always null: fireTicket answers { ok: true } and the ticket learns its pipeline id
  // on the run's first `state` event. Wait for it on the ticket instead.
  const { getTicket } = await import('../src/core/scheduler.mjs');
  const { readRunSetup } = await import('../src/core/run-presets-store.mjs');
  const pid = await until(() => getTicket(made.runId)?.pipelineId);
  const kept = await until(() => readRunSetup(pid)?.setup);
  assert.equal(kept.guardrailsId, 'secure');
  assert.equal(kept.overlay.nodes.n_plan.model, 'claude-sonnet-4-6');
  assert.equal(kept.overlay.nodes.n_plan.effort, 'high');
});

test('deleting its guardrail set makes the ticket fail with a reason naming the set', async () => {
  const gr = (await (await post('/api/guardrails', { name: 'Tight', settings: {} })).json()).guardrails;
  const preset = await savePreset('Tight run', { guardrailsId: gr.id });
  const made = await scheduleFrom(preset);
  await send('DELETE', `/api/guardrails/${gr.id}`);
  const now = await runNow(made.runId);
  assert.equal(now.status, 'failed');
  assert.match(now.failReason, new RegExp(`Preset "Tight run" cannot start: Guardrail set ${gr.id} no longer exists`));
  assert.equal(now.pipelineId ?? null, null, 'no run was started');
});

test('a deleted preset fails the ticket naming the preset; a repeating series fails its occurrence and stays', async () => {
  const preset = await savePreset('Gone soon', { guardrailsId: 'normal' });
  const made = await scheduleFrom(preset, { scheduledFor: undefined, repeat: { rule: { freq: 'daily', time: '03:00', tz: 'UTC' } } });
  assert.ok(made.scheduleId);
  const { getSchedule, getTicket } = await import('../src/core/scheduler.mjs');
  assert.equal(getTicket(made.runId).presetId, preset.id, 'the first occurrence follows the preset');
  await send('DELETE', `/api/presets/${preset.id}`);
  const now = await runNow(made.runId);
  assert.equal(now.status, 'failed');
  assert.equal(now.failReason, 'Preset "Gone soon" no longer exists');
  // The series "Run now" button (runScheduleNow) mints its own occurrence: it follows the preset too.
  const extra = await runNow(made.scheduleId);
  assert.notEqual(extra.runId, made.runId);
  assert.equal(getTicket(extra.runId).presetId, preset.id);
  assert.equal(extra.status, 'failed');
  assert.equal(extra.failReason, 'Preset "Gone soon" no longer exists');
  assert.equal(getSchedule(made.scheduleId).presetId, preset.id, 'the series still names it (shown as deleted)');
  const list = await (await get('/api/schedules')).json();
  const row = list.schedules.find((s) => s.id === made.scheduleId);
  assert.equal(row.presetName, null);
  assert.equal(row.presetGoneName, 'Gone soon');
});

// PR #769 review: the keys a start set apart from the preset are kept at fire time; the rest follow the preset.
test('overriddenKeys names the keys a start changed; bodyFollowingPreset keeps exactly those', async () => {
  const { overriddenKeys, bodyFollowingPreset } = await import('../src/shared/run-presets.mjs');
  const preset = { id: 'rp_x', scope: { kind: 'project', ref: 'p' }, setup: { workflowId: 'wf_default', engine: 'claude' } };
  // An Ask card on a Permissive preset (no guardrailsId) that had to name Normal, and picked another workflow.
  const card = { projectDir: '/p', prompt: 'x', workflowId: 'wf_other', engine: 'claude', guardrailsId: 'normal' };
  const keep = overriddenKeys(card, preset.setup);
  assert.deepEqual(keep, ['workflowId', 'guardrailsId']);
  const later = { ...preset, setup: { workflowId: 'wf_default', engine: 'codex' } };   // the preset edited after scheduling
  const body = bodyFollowingPreset(card, later, { keep });
  assert.equal(body.guardrailsId, 'normal', 'the card\'s guardrails win over a Permissive preset');
  assert.equal(body.workflowId, 'wf_other', 'the card\'s workflow is kept');
  assert.equal(body.engine, 'codex', 'a key left as the preset had it follows the preset');
  assert.equal(body.presetId, 'rp_x');
});

test('a field changed in the form before scheduling stays as set when the preset is edited later', { timeout: 120000 }, async () => {
  const preset = await savePreset('Form change', { guardrailsId: 'normal', overlay: { nodes: { n_plan: { model: 'claude-haiku-4-5' } } } });
  const made = await scheduleFrom(preset, { guardrailsId: 'secure' });   // the person picked Secure in the form
  const { getTicket } = await import('../src/core/scheduler.mjs');
  assert.deepEqual(getTicket(made.runId, { withRequest: true }).request.internal.presetOverrides, ['guardrailsId']);
  const put = await send('PUT', `/api/presets/${preset.id}`, { setup: { ...preset.setup, guardrailsId: 'normal',
    overlay: { nodes: { n_plan: { model: 'claude-sonnet-4-6', effort: 'high' } } } }, basis: { projectDir: project.path } });
  assert.equal(put.status, 200, await put.clone().text());
  const fired = await runNow(made.runId);
  assert.equal(fired.status, 'fired', JSON.stringify(fired));
  const { readRunSetup } = await import('../src/core/run-presets-store.mjs');
  const pid = await until(() => getTicket(made.runId)?.pipelineId);
  const kept = await until(() => readRunSetup(pid)?.setup);
  assert.equal(kept.guardrailsId, 'secure', 'the form change is kept');
  assert.equal(kept.overlay.nodes.n_plan.model, 'claude-sonnet-4-6', 'an untouched key follows the edited preset');
});

test('a ticket from an Ask card never fires on Permissive, whatever the preset resolves to', async () => {
  const preset = await savePreset('Loose', {});   // no guardrailsId: a start reads it as Permissive
  const { createTicket } = await import('../src/core/scheduler.mjs');
  // A ticket stored without presetOverrides (as one made before the fix): the card's Normal is not kept.
  const t = createTicket({ title: 'nightly', projectDir: project.path, runAtMs: Date.now() + 86400000,
    request: { projectDir: project.path, prompt: 'nightly', guardrailsId: 'normal', internal: { presetName: 'Loose' } },
    askThreadId: 'th_test', askCardId: 'card_test', presetId: preset.id });
  const now = await runNow(t.id);
  assert.equal(now.status, 'failed');
  assert.match(now.failReason, /scheduled from Chat and the run preset "Loose" now resolves to Permissive guardrails/);
  assert.equal(now.pipelineId ?? null, null, 'no run was started');
});
