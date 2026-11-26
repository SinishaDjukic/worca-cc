// test/exec-env-docker-pipeline.test.mjs — the Local sandbox (Docker) backend through the generic pipeline, the way
// test/exec-env-backend-plugin.test.mjs runs the loopback backend: an in-process mock run on the docker client over the
// fake docker (backends/docker-fake.mjs). Every `docker run` the run made is checked for the hardening, and a container
// removed mid-run fails the run cleanly through classifyError.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { getDb } from '../src/core/db.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { autoChoice } from '../src/core/run-harness.mjs';
import { _resetSlotsForTests } from '../src/core/exec-env/slots.mjs';
import { _setDockerRunnerForTests, assertHardened, KEPT_CAPS } from '../src/core/exec-env/backends/docker.mjs';
import { createFakeDocker } from '../src/core/exec-env/backends/docker-fake.mjs';
import { defaultImageName } from '../src/core/exec-env/backends/docker-image.mjs';
import { updateProjectExecEnv } from '../src/core/config.mjs';
import { projectKey } from '../src/core/store.mjs';
import { sweepOrphans } from '../src/core/exec-env/sweep.mjs';
import { dockerBackend } from '../src/core/exec-env/backends/docker.mjs';
import { instanceTag } from '../src/core/exec-env/policy.mjs';

const POSIX = { skip: process.platform === 'win32' ? 'remote execution is POSIX-only' : false, timeout: 180_000 };
useTempHome(after, 'worca-docker-pipeline-home-');
const userHome = mkdtempSync(join(tmpdir(), 'worca-docker-pipeline-user-'));
const prevEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL };
const realGitConfig = join(process.env.HOME || '', '.gitconfig');
before(() => {
  if (!process.env.GIT_CONFIG_GLOBAL && existsSync(realGitConfig)) process.env.GIT_CONFIG_GLOBAL = realGitConfig;
  process.env.HOME = userHome; process.env.USERPROFILE = userHome;
});
after(() => {
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(userHome, { recursive: true, force: true });
});
const scratch = []; after(() => scratch.forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };
const fake = createFakeDocker({ root: tmp('worca-docker-fake-') });
_setDockerRunnerForTests(fake.runner); after(() => _setDockerRunnerForTests(null));

function freshRepo() {
  const dir = templateRepo('docker-pipeline-repo', { branch: 'main', user: true, files: { 'seed.txt': 'seed\n' } });
  scratch.push(dir);
  return dir;
}
const rowOf = (id) => getDb().prepare('SELECT id, status, outcome, branch FROM pipelines WHERE id = ?').get(id);
function answerAll(orch) {
  orch.on('question', (q) => setImmediate(() => {
    const payload = q.kind === 'gate' ? { decision: 'continue' } : { answers: (q.questions || []).map((x) => ({ id: x.id, choice: autoChoice(x) })) };
    orch.answer(q.id, payload);
  }));
}
async function runOn(repo, extra = {}) {
  _resetSlotsForTests();
  const logs = [];
  const orch = createOrchestrator({ projectDir: repo, prompt: 'docker task', claude: { mock: true }, execEnv: 'docker', ...extra });
  orch.on('log', (e) => logs.push(e));
  answerAll(orch);
  const r = await orch.run();
  return { r, orch, logs, row: rowOf(orch.state.id) };
}
/** The flags of a recorded `docker run`, labels left out (their values are free text). */
const flagsOf = (args) => {
  const at = args.findIndex((a, i) => i > 0 && !a.startsWith('-') && !['run'].includes(a) && !args[i - 1]?.startsWith('-'));
  return args.slice(1, at).filter((a, i, all) => !(a === '--label' || all[i - 1] === '--label'));
};

test('a Local sandbox (Docker) run: one hardened container, code home, the run log names it, nothing left behind', POSIX, async () => {
  const from = fake.runs.length;
  const repo = freshRepo();
  const { r, logs, row } = await runOn(repo);
  assert.equal(r.status, 'done', r.error);
  const runs = fake.runs.slice(from);
  assert.equal(runs.length, 1, 'one container per run');
  const args = runs[0];
  assert.ok(args.includes(defaultImageName()));
  assert.doesNotThrow(() => assertHardened(flagsOf(args)));
  // Never anything that reaches into the host, whatever the run did.
  for (const call of fake.calls) {
    assert.ok(!call.some((a) => /docker\.sock/.test(a)), call.join(' '));
    assert.ok(!call.some((a) => /^(-v|--volume|--mount|--privileged|--device)$/.test(a)), call.join(' '));
    const caps = call.flatMap((a, i) => (call[i - 1] === '--cap-add' ? [a] : []));
    assert.ok(caps.every((c) => KEPT_CAPS.includes(c)), caps.join(','));
  }
  // Every agent and script command ran as the sandbox user; root only for the mirrored dirs.
  const execs = fake.calls.filter((c) => c[0] === 'exec');
  const users = new Set(execs.map((c) => c[c.indexOf('-u') + 1]));
  assert.deepEqual([...users].sort(), ['0:0', '1000:1000', '990:990']);
  for (const c of execs.filter((x) => x[x.indexOf('-u') + 1] === '0:0')) assert.match(c.at(-1), /chown -h user:user/, 'root runs mkdirsScript only');
  assert.equal(JSON.parse(row.outcome).execEnv, 'docker');
  assert.ok(logs.some((l) => l.source === 'docker' && /agents and scripts run in Local sandbox \(Docker\) worca-[\w-]+ \(image worca-local-sandbox:[0-9a-f]{12} from the default, the loopback fake \(mock mode\)\)/.test(l.text)),
    JSON.stringify(logs.filter((l) => l.source === 'docker').map((l) => l.text)));
  assert.ok(logs.some((l) => l.source === 'docker' && /no mounts, network only through Worca \(open\)/.test(l.text)));
  assert.equal(fake.containers.size, 0, 'the container was removed at the end');
  assert.equal(existsSync(join(worcaHome(), 'tmp', 'docker', row.id)), false);
  assert.match(execFileSync('git', ['-C', repo, 'show', `${JSON.parse(row.branch).feature}:src/feature.mjs`], { encoding: 'utf8' }), /\S/);
});

test('a project image setting and the allow network reach the container: labels carry the policy', POSIX, async () => {
  const repo = freshRepo(); const key = projectKey(repo);
  updateProjectExecEnv(key, (v) => { v.config.docker = { image: 'acme/tools:2', egress: 'allow' }; });
  const from = fake.runs.length;
  const { r, logs } = await runOn(repo);
  assert.equal(r.status, 'done', r.error);
  const args = fake.runs[from];
  assert.ok(args.includes('acme/tools:2'));
  assert.ok(!args.includes('--pull'), 'another image may be pulled');
  const net = JSON.parse(args[args.findIndex((a) => a.startsWith('worca.network='))].slice('worca.network='.length));
  assert.ok(net.allowOut.includes('api.anthropic.com'));
  assert.ok(logs.some((l) => /sandbox network: allow, so the sandbox reaches only api\.anthropic\.com.*raw socket reaches nothing/.test(l.text)));
});

test('a container removed mid-run fails the run cleanly (gone), and the sweep removes leftovers of ended runs', POSIX, async () => {
  _resetSlotsForTests();
  const orch = createOrchestrator({ projectDir: freshRepo(), workflowId: 'wf_default', prompt: 'loss on docker', auto: true, claude: { mock: true }, execEnv: 'docker' });
  let removed = false;
  orch.on('state', (st) => {
    if (!removed && orch.execEnv && (st.steps || []).some((s) => s.status === 'done')) { removed = true; fake.remove(orch.execEnv.sandboxId); }
  });
  const r = await orch.run();
  assert.equal(r.status, 'error');
  assert.match(r.error, /Local sandbox \(Docker\) worca-[\w-]+ is gone/);

  // A leftover of an ended run and one of a live run: the sweep removes only the first.
  const client = await dockerBackend.open({});
  const instance = instanceTag(worcaHome());
  const dead = await client.create({ environment: 'acme/tools:1', tags: { worca: '1', worcaInstance: instance, worcaRunId: 'ended' }, timeoutMs: 60_000 });
  const live = await client.create({ environment: 'acme/tools:1', tags: { worca: '1', worcaInstance: instance, worcaRunId: 'live' }, timeoutMs: 60_000 });
  const res = await sweepOrphans({ client, instance, keepRun: (id) => id === 'live' });
  assert.deepEqual(res.killed.map((k) => k.sandboxId), [dead.id]);
  assert.deepEqual(res.kept.map((k) => k.sandboxId), [live.id]);
  assert.equal(fake.containers.has(dead.id), false);
  await client.remove(live.id);
});
