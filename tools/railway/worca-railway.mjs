#!/usr/bin/env node
// tools/railway/worca-railway.mjs — operate a hosted worca on Railway (docs/deploy-railway.md,
// "Operate your deployment"). Generic: every deployment detail comes from a local TARGET file,
// ~/.config/worca/targets/<name>.env (tools/railway/targets.example.env), never from the repo.
//
//   node tools/railway/worca-railway.mjs <command> <target> [args]
//
// Read-only:  targets | status <t> | logs <t> [--lines N] | verify <t> [--in-container] [--clone <url>]
//             | ssh <t> [-- <command>]
// Changes (need --yes):
//             upgrade <t> <image ref | version> | rollback <t> | deploy-branch <t> --tag <tag>
//             | redeploy <t> | set <t> <KEY> [--from-file <path>] [--skip-deploys]
//             | unset <t> <KEY> [--skip-deploys] | mock <t> on|off
//
// Secret rules (enforced here, not left to the caller):
//  - a secret VALUE never appears on a command line, in output or in this process's logs:
//    `set` reads it from stdin or a file and hands it to `railway variable set --stdin`;
//  - variables are listed by NAME only (`railway variable list --json` includes raw values,
//    so its output is parsed here and only the keys are printed);
//  - every line printed from Railway or from the container passes through redact();
//  - --service is always explicit: a folder linked to the cloudflared service must never
//    receive the worca service's variables.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const TARGETS_DIR = process.env.WORCA_TARGETS_DIR || join(homedir(), '.config', 'worca', 'targets');
const KEY_RE = /^[A-Z_][A-Z0-9_]{0,99}$/;
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const IMAGE_RE = /^[a-z0-9.-]+(?::\d+)?\/[a-z0-9._/-]+(?::[A-Za-z0-9._-]{1,128}|@sha256:[0-9a-f]{64})$/;
const REQUIRED = ['RAILWAY_PROJECT_ID', 'RAILWAY_ENVIRONMENT_ID', 'RAILWAY_WORCA_SERVICE', 'RAILWAY_WORCA_SERVICE_ID', 'WORCA_URL'];

// ── pure helpers (exported for tests) ─────────────────────────────────────────

/** KEY=VALUE lines -> object (comments, blanks and malformed lines ignored; no expansion). */
export function parseEnvFile(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i <= 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    if (KEY_RE.test(k)) out[k] = v;
  }
  return out;
}

const tilde = (p) => (p && p.startsWith('~/') ? join(homedir(), p.slice(2)) : p);

/** Load and validate a target; throws a message naming the missing keys. */
export function loadTarget(name, { dir = TARGETS_DIR, read = readFileSync, exists = existsSync } = {}) {
  if (!NAME_RE.test(String(name || ''))) throw new Error(`a target name is required (letters, digits, - and _), e.g. "status mydeploy"`);
  const file = join(dir, `${name}.env`);
  if (!exists(file)) throw new Error(`no target "${name}": create ${file} from tools/railway/targets.example.env`);
  const t = parseEnvFile(read(file, 'utf8'));
  const missing = REQUIRED.filter((k) => !t[k]);
  if (missing.length) throw new Error(`target "${name}" is missing ${missing.join(', ')} (${file})`);
  if (!/^https:\/\/[a-z0-9.-]+\/?$/i.test(t.WORCA_URL)) throw new Error(`WORCA_URL must be https://<host> (${file})`);
  return {
    name, file,
    projectId: t.RAILWAY_PROJECT_ID, environmentId: t.RAILWAY_ENVIRONMENT_ID,
    service: t.RAILWAY_WORCA_SERVICE, serviceId: t.RAILWAY_WORCA_SERVICE_ID,
    cloudflaredService: t.RAILWAY_CLOUDFLARED_SERVICE || 'cloudflared',
    url: t.WORCA_URL.replace(/\/$/, ''), host: new URL(t.WORCA_URL).hostname,
    imageRepo: t.IMAGE_REPO || 'ghcr.io/sinishadjukic/worca',
    branchImageRepo: t.BRANCH_IMAGE_REPO || null,
    accessTokenFile: tilde(t.ACCESS_SERVICE_TOKEN_FILE) || null,
    sshKey: tilde(t.SSH_KEY) || null,
  };
}

/** Remove secrets from text shown to a person: JWTs, GitHub/Anthropic/Cloudflare-looking tokens,
 *  PEM blocks, credentials in URLs, and any exact values passed in `known`. */
export function redact(text, known = []) {
  let s = String(text);
  for (const v of known) if (typeof v === 'string' && v.length >= 8) s = s.split(v).join('<redacted>');
  return s
    .replace(/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, '<redacted pem>')
    .replace(/eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+){1,2}/g, '<redacted jwt>')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, '<redacted github token>')
    .replace(/\bsk-ant-[A-Za-z0-9_-]{10,}/g, '<redacted anthropic key>')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/g, '$1<redacted>@');
}

/** "1.5.0" -> "<imageRepo>:1.5.0"; a full reference is validated as is. */
export function imageRef(target, spec) {
  const s = String(spec || '').trim();
  const ref = /^[0-9][0-9A-Za-z.-]*$/.test(s) ? `${target.imageRepo}:${s}` : s;
  if (!IMAGE_RE.test(ref)) throw new Error(`not an image reference: ${s} (use a version like 1.5.0 or registry/repo:tag)`);
  if (/:latest$/.test(ref)) throw new Error('pin an exact tag, not :latest, so upgrades and rollbacks are deliberate');
  return ref;
}

/** Parse argv: command, target, positionals, and --flags (value flags listed in VALUE_FLAGS). */
const VALUE_FLAGS = new Set(['--lines', '--clone', '--from-file', '--tag']);
export function parseArgs(argv) {
  const out = { cmd: argv[0] || null, target: null, pos: [], flags: {}, rest: [] };
  const a = argv.slice(1);
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (x === '--') { out.rest = a.slice(i + 1); break; }
    if (x.startsWith('--')) {
      if (VALUE_FLAGS.has(x)) {
        if (a[i + 1] === undefined) throw new Error(`${x} needs a value`);
        out.flags[x.slice(2)] = a[++i];
      } else out.flags[x.slice(2)] = true;
    } else if (!out.target && out.cmd !== 'targets') out.target = x;
    else out.pos.push(x);
  }
  return out;
}

// ── process runner (injectable for tests) ────────────────────────────────────

/** Run a command; stdin is a string or null. Resolves { code, stdout, stderr }. Never throws. */
export function defaultExec(cmd, args, { input = null, env = process.env, cwd } = {}) {
  return new Promise((done) => {
    let child;
    try { child = spawn(cmd, args, { env, cwd, stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'] }); }
    catch (e) { done({ code: -1, stdout: '', stderr: e.message }); return; }
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (b) => { stdout += b; });
    child.stderr.on('data', (b) => { stderr += b; });
    child.on('error', (e) => done({ code: -1, stdout, stderr: stderr || e.message }));
    child.on('close', (c) => done({ code: c ?? -1, stdout, stderr }));
    if (input != null) child.stdin.end(input);
  });
}

// ── Railway calls ────────────────────────────────────────────────────────────

async function gql(ctx, query, variables) {
  const r = await ctx.exec('railway', ['api', query, '--variables', JSON.stringify(variables), '--compact']);
  if (r.code !== 0) throw new Error(`railway api failed: ${redact(r.stderr || r.stdout).trim().split('\n').pop()}`);
  let j;
  try { j = JSON.parse(r.stdout); } catch { throw new Error('railway api returned no JSON'); }
  if (j.errors?.length) throw new Error(`railway api: ${redact(j.errors.map((e) => e.message).join('; '))}`);
  return j.data;
}

const svcArgs = (t, service = t.service) => ['--service', service, '--environment', t.environmentId, '--project', t.projectId];

async function currentImage(ctx, t) {
  const d = await gql(ctx, 'query($s:String!,$e:String!){ serviceInstance(serviceId:$s, environmentId:$e){ source { image } } }', { s: t.serviceId, e: t.environmentId });
  return d?.serviceInstance?.source?.image || null;
}

async function latestDeployment(ctx, t) {
  const d = await gql(ctx, 'query($s:String!,$e:String!){ deployments(first:1, input:{serviceId:$s, environmentId:$e}){ edges{ node{ id status createdAt } } } }', { s: t.serviceId, e: t.environmentId });
  return d?.deployments?.edges?.[0]?.node || null;
}

async function variableNames(ctx, t, service = t.service) {
  const r = await ctx.exec('railway', ['variable', 'list', ...svcArgs(t, service), '--json']);
  if (r.code !== 0) throw new Error(`railway variable list failed: ${redact(r.stderr).trim().split('\n').pop()}`);
  let j;
  try { j = JSON.parse(r.stdout); } catch { throw new Error('railway variable list returned no JSON'); }
  // Values are parsed and dropped here: only names (and whether a value is sealed) leave this function.
  return Object.keys(j).sort().map((k) => ({ name: k, sealed: j[k] === null }));
}

async function deploy(ctx, t) {
  await gql(ctx, 'mutation($s:String!,$e:String!){ serviceInstanceDeploy(serviceId:$s, environmentId:$e) }', { s: t.serviceId, e: t.environmentId });
}

async function waitDeployment(ctx, t, { after = null, timeoutMs = 600_000, pollMs = 8000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let dep = null;
  while (Date.now() < deadline) {
    dep = await latestDeployment(ctx, t);
    const fresh = dep && (!after || Date.parse(dep.createdAt) > after);
    if (fresh && ['SUCCESS', 'FAILED', 'CRASHED', 'REMOVED'].includes(dep.status)) return dep;
    await ctx.sleep(pollMs);
  }
  return dep;
}

async function deploymentLogs(ctx, deploymentId, lines = 40) {
  const d = await gql(ctx, 'query($d:String!,$n:Int){ deploymentLogs(deploymentId:$d, limit:$n){ message severity } }', { d: deploymentId, n: lines });
  return (d?.deploymentLogs || []).map((l) => redact(l.message));
}

function historyFile(t) { return join(dirname(t.file), `${t.name}.history`); }
function recordImage(t, image) {
  try { appendFileSync(historyFile(t), `${new Date().toISOString()} ${image}\n`, { mode: 0o600 }); } catch { /* history is a convenience */ }
}
function previousImage(t, current) {
  let lines = [];
  try { lines = readFileSync(historyFile(t), 'utf8').trim().split('\n').filter(Boolean); } catch { /* none */ }
  const images = lines.map((l) => l.split(' ')[1]).filter(Boolean);
  for (let i = images.length - 1; i >= 0; i--) if (images[i] !== current) return images[i];
  return null;
}

async function setImage(ctx, t, image) {
  const before = await currentImage(ctx, t);
  if (before) recordImage(t, before);
  await gql(ctx, 'mutation($s:String!,$e:String!,$i:ServiceInstanceUpdateInput!){ serviceInstanceUpdate(serviceId:$s, environmentId:$e, input:$i) }',
    { s: t.serviceId, e: t.environmentId, i: { source: { image } } });
  const started = Date.now();
  await deploy(ctx, t);
  recordImage(t, image);
  ctx.out(`image ${before || '(none)'} -> ${image}; deploying…`);
  const dep = await waitDeployment(ctx, t, { after: started - 60_000 });
  ctx.out(`deployment ${dep?.status || 'unknown'}`);
  for (const l of (dep ? await deploymentLogs(ctx, dep.id, 30) : []).slice(-15)) ctx.out(`  ${l}`);
  return dep;
}

// ── verify through Access ────────────────────────────────────────────────────

function accessHeaders(t, read = readFileSync) {
  if (!t.accessTokenFile) return null;
  let v;
  try { v = parseEnvFile(read(t.accessTokenFile, 'utf8')); } catch { throw new Error(`cannot read ACCESS_SERVICE_TOKEN_FILE (${t.accessTokenFile})`); }
  if (!v.CF_ACCESS_CLIENT_ID || !v.CF_ACCESS_CLIENT_SECRET) throw new Error('ACCESS_SERVICE_TOKEN_FILE needs CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET');
  return { 'CF-Access-Client-Id': v.CF_ACCESS_CLIENT_ID, 'CF-Access-Client-Secret': v.CF_ACCESS_CLIENT_SECRET };
}

async function verifyAccess(ctx, t, { clone = null } = {}) {
  let fails = 0;
  const check = (label, ok, detail = '') => { ctx.out(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` (${detail})` : ''}`); if (!ok) fails += 1; };
  const anon = await ctx.fetch(`${t.url}/api/projects`, { redirect: 'manual' }).catch((e) => ({ status: `error ${e.code || e.message}` }));
  check('anonymous request is sent to sign-in', anon.status === 302 || anon.status === 401 || anon.status === 403, String(anon.status));
  const H = accessHeaders(t, ctx.read);
  if (!H) { ctx.out('skip  checks through Access (no ACCESS_SERVICE_TOKEN_FILE)'); return fails; }
  const known = Object.values(H);
  const get = async (path, init = {}) => {
    const r = await ctx.fetch(`${t.url}${path}`, { ...init, redirect: 'manual', headers: { ...H, 'Content-Type': 'application/json', ...(init.headers || {}) } });
    let body = null; try { body = await r.json(); } catch { /* not JSON */ }
    return { status: r.status, body };
  };
  const health = await get('/api/health');
  check('service token passes Access; /api/health', health.status === 200 && health.body?.name === '@worca/app', `${health.status} ${health.body?.version || ''}`.trim());
  const who = await get('/api/whoami');
  check('/api/whoami answers', who.status === 200, redact(JSON.stringify(who.body), known));
  const bad = await get('/api/projects/clone', { method: 'POST', body: JSON.stringify({ url: 'https://u:p@github.com/a/b' }) });
  check('a clone URL with credentials is refused', bad.status === 400);
  if (clone) {
    const name = `verify-${Date.now().toString(36)}`;
    const start = await get('/api/projects/clone', { method: 'POST', body: JSON.stringify({ url: clone, name }) });
    check('clone starts', start.status === 202, String(start.status));
    if (start.status === 202) {
      let job = start.body.job;
      const t0 = Date.now();
      while (job?.state === 'running' && Date.now() - t0 < 600_000) {
        await ctx.sleep(3000);
        job = (await get(`/api/projects/clone/${start.body.jobId}`)).body?.job;
      }
      check('clone finishes and registers the project', job?.state === 'done', `${job?.state} ${job?.code || ''} ${Math.round((Date.now() - t0) / 1000)} s`.trim());
      if (job?.state === 'done') ctx.out(`info  registered ${name} at ${job.project?.path}; remove it in Projects when done`);
    }
  }
  return fails;
}

// ── ssh ──────────────────────────────────────────────────────────────────────

async function sshConfig(ctx, t) {
  if (!t.sshKey) throw new Error('SSH_KEY is not set in the target');
  const dir = join(dirname(t.file), `${t.name}.ssh`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const cfg = join(dir, 'config');
  const r = await ctx.exec('railway', ['ssh', 'config', '--project', t.projectId, '--environment', t.environmentId, '--service', t.service,
    '--alias', `worca-${t.name}`, '--identity-file', t.sshKey, '--path', cfg]);
  if (r.code !== 0) throw new Error(`railway ssh config failed: ${redact(r.stderr).trim().split('\n').pop()} (is the key registered? railway ssh keys add)`);
  return { cfg, known: join(dir, 'known_hosts'), alias: `worca-${t.name}` };
}

/** ssh joins its remote arguments with spaces for the remote shell: quote each one. */
export const shellQuote = (a) => (/^[A-Za-z0-9_./:=@%+-]+$/.test(a) ? a : `'${String(a).replace(/'/g, `'\\''`)}'`);

async function sshRun(ctx, t, remoteArgs, input = null) {
  const s = await sshConfig(ctx, t);
  return ctx.exec('ssh', ['-F', s.cfg, '-o', 'StrictHostKeyChecking=accept-new', '-o', `UserKnownHostsFile=${s.known}`, '-o', 'IdentitiesOnly=yes', s.alias,
    remoteArgs.map(shellQuote).join(' ')], { input });
}

// ── commands ─────────────────────────────────────────────────────────────────

const needYes = (a, what) => { if (!a.flags.yes) throw new Error(`${what} changes the deployment: re-run with --yes`); };

export async function main(argv, ctx) {
  const a = parseArgs(argv);
  const cmd = a.cmd;
  if (!cmd || cmd === 'help' || a.flags.help) { ctx.out(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 22).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); return 0; }
  if (cmd === 'targets') {
    let names = [];
    try { names = readdirSync(TARGETS_DIR).filter((f) => f.endsWith('.env')).map((f) => f.slice(0, -4)); } catch { /* none */ }
    ctx.out(names.length ? names.join('\n') : `no targets in ${TARGETS_DIR} (copy tools/railway/targets.example.env)`);
    return 0;
  }
  const t = ctx.loadTarget(a.target);
  switch (cmd) {
    case 'status': {
      const image = await currentImage(ctx, t);
      const dep = await latestDeployment(ctx, t);
      ctx.out(`target     ${t.name} (${t.url})`);
      ctx.out(`image      ${image || '(none)'}`);
      ctx.out(`deployment ${dep ? `${dep.status} ${dep.createdAt}` : '(none)'}`);
      const vars = await variableNames(ctx, t);
      ctx.out(`variables  ${vars.filter((v) => !v.name.startsWith('RAILWAY_')).map((v) => v.name + (v.sealed ? ' (sealed)' : '')).join(', ')}`);
      if (dep) for (const l of (await deploymentLogs(ctx, dep.id, 40)).filter((l) => /worca-entrypoint|worca-ui|error/i.test(l)).slice(-12)) ctx.out(`  ${l}`);
      return 0;
    }
    case 'logs': {
      const dep = await latestDeployment(ctx, t);
      if (!dep) { ctx.out('no deployment'); return 1; }
      for (const l of await deploymentLogs(ctx, dep.id, Math.min(Number(a.flags.lines) || 100, 500))) ctx.out(l);
      return 0;
    }
    case 'upgrade': {
      needYes(a, 'upgrade');
      const dep = await setImage(ctx, t, imageRef(t, a.pos[0]));
      return dep?.status === 'SUCCESS' ? 0 : 1;
    }
    case 'rollback': {
      needYes(a, 'rollback');
      const current = await currentImage(ctx, t);
      const prev = previousImage(t, current);
      if (!prev) throw new Error(`no earlier image recorded for ${t.name} (${historyFile(t)}); use upgrade <ref>`);
      const dep = await setImage(ctx, t, prev);
      return dep?.status === 'SUCCESS' ? 0 : 1;
    }
    case 'deploy-branch': {
      needYes(a, 'deploy-branch');
      if (!t.branchImageRepo) throw new Error('BRANCH_IMAGE_REPO is not set in the target');
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(String(a.flags.tag || ''))) throw new Error('--tag <tag> is required (e.g. --tag pr-480-1)');
      const ref = imageRef(t, `${t.branchImageRepo}:${a.flags.tag}`);
      const root = resolve(HERE, '..', '..');
      ctx.out(`building ${ref} (linux/amd64) from ${root} …`);
      const b = await ctx.exec('npm', ['run', 'docker:build', '--', '--platform', 'linux/amd64', '--tag', ref], { cwd: root });
      if (b.code !== 0) { ctx.out(redact(b.stdout + b.stderr).split('\n').slice(-15).join('\n')); throw new Error('image build failed'); }
      const p = await ctx.exec('docker', ['push', ref]);
      if (p.code !== 0) throw new Error(`docker push failed: ${redact(p.stderr).trim().split('\n').pop()} (logged in to the registry?)`);
      const dep = await setImage(ctx, t, ref);
      return dep?.status === 'SUCCESS' ? 0 : 1;
    }
    case 'redeploy': {
      needYes(a, 'redeploy');
      const started = Date.now();
      await deploy(ctx, t);
      const dep = await waitDeployment(ctx, t, { after: started - 60_000 });
      ctx.out(`deployment ${dep?.status || 'unknown'}`);
      return dep?.status === 'SUCCESS' ? 0 : 1;
    }
    case 'set': {
      needYes(a, 'set');
      const key = a.pos[0];
      if (!KEY_RE.test(String(key || ''))) throw new Error('set <target> <KEY>: KEY must be an environment variable name');
      if (key.startsWith('RAILWAY_')) throw new Error('RAILWAY_* variables are Railway\'s own; set them in the dashboard');
      let value;
      if (a.flags['from-file']) {
        try { value = ctx.read(tilde(a.flags['from-file']), 'utf8'); } catch { throw new Error(`cannot read ${a.flags['from-file']}`); }
      } else value = await ctx.stdin();
      value = String(value).replace(/\r?\n$/, '');
      if (!value) throw new Error(`no value for ${key} on stdin${a.flags['from-file'] ? ' / in the file' : ''}`);
      const r = await ctx.exec('railway', ['variable', 'set', key, '--stdin', ...svcArgs(t), ...(a.flags['skip-deploys'] ? ['--skip-deploys'] : [])], { input: value });
      if (r.code !== 0) throw new Error(`railway variable set ${key} failed (exit ${r.code})`);   // no stderr: it could echo the value
      ctx.out(`set ${key} on ${t.service}${a.flags['skip-deploys'] ? ' (no deploy; run redeploy when done)' : ' (deploying)'}; seal it in the dashboard if it is a secret`);
      return 0;
    }
    case 'unset': {
      needYes(a, 'unset');
      const key = a.pos[0];
      if (!KEY_RE.test(String(key || ''))) throw new Error('unset <target> <KEY>');
      const r = await ctx.exec('railway', ['variable', 'delete', key, ...svcArgs(t), ...(a.flags['skip-deploys'] ? ['--skip-deploys'] : [])]);
      if (r.code !== 0) throw new Error(`railway variable delete ${key} failed: ${redact(r.stderr).trim().split('\n').pop()}`);
      ctx.out(`removed ${key} from ${t.service}`);
      return 0;
    }
    case 'mock': {
      needYes(a, 'mock');
      const on = a.pos[0];
      if (on !== 'on' && on !== 'off') throw new Error('mock <target> on|off');
      const r = on === 'on'
        ? await ctx.exec('railway', ['variable', 'set', 'WORCA_MOCK', '--stdin', ...svcArgs(t)], { input: '1' })
        : await ctx.exec('railway', ['variable', 'delete', 'WORCA_MOCK', ...svcArgs(t)]);
      if (r.code !== 0) throw new Error(`could not turn mock ${on}: ${redact(r.stderr).trim().split('\n').pop()}`);
      ctx.out(`mock mode ${on} on ${t.service} (deploying)`);
      return 0;
    }
    case 'verify': {
      let fails = await verifyAccess(ctx, t, { clone: a.flags.clone || null });
      if (a.flags['in-container']) {
        const probe = readFileSync(join(HERE, 'in-container-probe.sh'), 'utf8');
        const r = await sshRun(ctx, t, ['sh', '-s', '--', t.host], probe);
        for (const l of redact(r.stdout).split('\n').filter(Boolean)) ctx.out(l);
        if (r.code !== 0) fails += 1;
      }
      ctx.out(fails ? `${fails} check(s) FAILED` : 'verify: all checks passed');
      return fails ? 1 : 0;
    }
    case 'ssh': {
      const s = await sshConfig(ctx, t);
      if (!a.rest.length) { ctx.out(`ssh -F ${s.cfg} -o UserKnownHostsFile=${s.known} -o IdentitiesOnly=yes ${s.alias}`); return 0; }
      const r = await sshRun(ctx, t, a.rest);
      ctx.out(redact(r.stdout + r.stderr).trimEnd());
      return r.code;
    }
    default:
      throw new Error(`unknown command "${cmd}" (run: help)`);
  }
}

// ── entry ────────────────────────────────────────────────────────────────────

function readStdin() {
  return new Promise((done) => {
    if (process.stdin.isTTY) { done(''); return; }
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { s += c; });
    process.stdin.on('end', () => done(s));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ctx = {
    exec: defaultExec, fetch: globalThis.fetch, read: readFileSync, stdin: readStdin,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)), out: (s) => console.log(s), loadTarget: (n) => loadTarget(n),
  };
  main(process.argv.slice(2), ctx).then((code) => { process.exitCode = code; }, (e) => {
    console.error(`worca-railway: ${redact(e.message)}`);
    process.exitCode = 2;
  });
}

