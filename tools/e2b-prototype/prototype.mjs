#!/usr/bin/env node
// tools/e2b-prototype/prototype.mjs
// A standalone end-to-end check of the hard parts of worca's E2B execution environment, against a
// LIVE E2B (not part of the test suite, and not using worca's orchestrator):
//   a. a throwaway git repo   b. sandbox + bundle clone   c. one real streamed `claude -p` step
//   d. a question round-trip with --resume   e. download of /home/user/worca-out
//   f. sandbox commits back as a bundle, fast-forwarded locally   g. pause + connect (optional)
//   h. cleanup by metadata, always.
//
//   node tools/e2b-prototype/prototype.mjs [--out <dir>] [--no-pause]
//
// Credentials come from ~/.config/worca-e2b/{e2b.sh,model.sh} (worca strips E2B_* from agent
// envs). Every printed line is redacted; the OAuth token only ever travels as the env of the
// sandbox command that runs claude.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Sandbox } from 'e2b';

const execFileP = promisify(execFile);
const T0 = Date.now();
const PURPOSE = 'worca-e2b-prototype';
const TEMPLATE = 'worca-agent';
const SB_HOME = '/home/user';
const SB_REPO = `${SB_HOME}/repo`;
const SB_OUT = `${SB_HOME}/worca-out`;
const CONTROL = { requestTimeoutMs: 60_000 };
const STEP_TIMEOUT_MS = 15 * 60_000;

const args = process.argv.slice(2);
const outArg = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
const tryPause = !args.includes('--no-pause');

// ---- credentials and redaction -------------------------------------------------------------
async function readExports(file) {
  const out = {};
  for (const line of (await readFile(file, 'utf8')).split('\n')) {
    const m = line.match(/^\s*export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}
const secrets = [];
const redact = (s) => secrets.reduce((acc, k) => acc.split(k).join(`${k.slice(0, 4)}…`), String(s));
const stamp = () => `[${new Date().toISOString().slice(11, 23)} +${((Date.now() - T0) / 1000).toFixed(1).padStart(6)}s]`;
const log = (...parts) => console.log(redact(`${stamp()} ${parts.join(' ')}`));
const results = [];
const record = (step, ok, detail) => { results.push({ step, ok, detail }); log(ok ? 'PASS' : 'FAIL', step, '-', detail); };

const shq = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;
const git = async (cwd, ...a) => (await execFileP('git', ['-c', 'user.name=prototype', '-c', 'user.email=prototype@worca.invalid', ...a], { cwd, maxBuffer: 64 << 20 })).stdout;

// ---- sandbox helpers ------------------------------------------------------------------------
async function sh(sbx, cmd, opts = {}) {
  try {
    const r = await sbx.commands.run(cmd, { cwd: SB_REPO, timeoutMs: 120_000, ...opts });
    return { code: r.exitCode, stdout: r.stdout, stderr: r.stderr };
  } catch (err) {
    if (typeof err?.exitCode === 'number') return { code: err.exitCode, stdout: err.stdout || '', stderr: err.stderr || '' };
    throw err;
  }
}
async function mustSh(sbx, cmd, opts) {
  const r = await sh(sbx, cmd, opts);
  if (r.code !== 0) throw new Error(`sandbox command failed (${r.code}): ${cmd}\n${r.stderr.slice(-2000)}`);
  return r.stdout;
}

/** One `claude -p` run in the sandbox clone, its stream-json stdout parsed line by line as it arrives. */
async function claudeStep(sbx, { label, prompt, resume, token }) {
  const cmd = ['claude', '-p', shq(prompt), '--output-format', 'stream-json', '--verbose',
    '--dangerously-skip-permissions', '--max-turns', '30', ...(resume ? ['--resume', shq(resume)] : [])].join(' ');
  log(`${label}: start${resume ? ` (--resume ${resume})` : ''}`);
  const started = Date.now();
  const arrivals = [];
  const tools = [];
  let buf = ''; let sessionId = null; let result = null; let stderr = '';
  const onLine = (line) => {
    if (!line.trim()) return;
    let ev; try { ev = JSON.parse(line); } catch { log(`${label}: non-JSON line (${line.length} chars)`); return; }
    arrivals.push(Date.now());
    let what = ev.type + (ev.subtype ? `/${ev.subtype}` : '');
    if (ev.type === 'system' && ev.subtype === 'init') { sessionId = ev.session_id; what += ` session=${ev.session_id} model=${ev.model}`; }
    if (ev.type === 'assistant') for (const c of ev.message?.content || []) if (c.type === 'tool_use') tools.push(c.name);
    if (ev.type === 'assistant') what += ` [${(ev.message?.content || []).map((c) => c.type === 'tool_use' ? `tool_use:${c.name}` : c.type).join(',')}]`;
    if (ev.type === 'user') what += ` [${(ev.message?.content || []).map((c) => c.type).join(',')}]`;
    if (ev.type === 'result') { result = ev; what += ` turns=${ev.num_turns} is_error=${ev.is_error}`; }
    if (ev.type === 'system' && ev.subtype === 'api_retry') what += ` ${JSON.stringify({ attempt: ev.attempt, status: ev.error_status, error: ev.error }).slice(0, 300)}`;
    if (ev.type === 'result' && ev.is_error) what += ` result=${JSON.stringify(String(ev.result ?? '')).slice(0, 300)}`;
    log(`${label}: event ${what}`);
  };
  let code;
  try {
    const r = await sbx.commands.run(cmd, {
      cwd: SB_REPO, timeoutMs: STEP_TIMEOUT_MS,
      envs: { CLAUDE_CODE_OAUTH_TOKEN: token, DISABLE_AUTOUPDATER: '1' },
      onStdout: (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1); } },
      onStderr: (d) => { stderr += d; },
    });
    code = r.exitCode;
  } catch (err) {
    if (typeof err?.exitCode !== 'number') throw err;
    code = err.exitCode;
  }
  if (buf) onLine(buf);
  const ended = Date.now();
  if (stderr.trim()) log(`${label}: stderr tail: ${stderr.trim().slice(-500)}`);
  // Live, not buffered: most events arrived well before the command returned.
  const early = arrivals.filter((t) => ended - t > 1000).length;
  const live = arrivals.length >= 3 && early >= Math.ceil(arrivals.length / 2);
  // The gap between the first event and the process exit: a buffered stream would make it ~0.
  const firstToExit = arrivals.length ? (ended - arrivals[0]) / 1000 : 0;
  log(`${label}: exit ${code} after ${((ended - started) / 1000).toFixed(1)}s; ${arrivals.length} events, ${early} of them more than 1 s before exit`
    + (arrivals.length ? `, first after ${((arrivals[0] - started) / 1000).toFixed(1)}s (${firstToExit.toFixed(1)}s before exit), last ${((ended - arrivals.at(-1)) / 1000).toFixed(1)}s before exit` : '')
    + `; ${tools.length} tool calls${tools.length ? ` (${tools.join(', ')})` : ''}`);
  return { code, sessionId, result, live, events: arrivals.length, early, firstToExit, tools, seconds: (ended - started) / 1000 };
}

async function makeRepo(dir) {
  await git(dir, 'init', '-q', '-b', 'main');
  await writeFile(join(dir, 'README.md'), '# prototype\n\nA throwaway repo for the worca E2B prototype.\n');
  await mkdir(join(dir, 'src'));
  await writeFile(join(dir, 'src', 'greet.js'), 'export function greet(name) {\n  return `Hello, ${name}`;\n}\n');
  await writeFile(join(dir, 'src', 'shout.js'), 'export function shout(text) {\n  return text.toUpperCase();\n}\n');
  await writeFile(join(dir, 'check.mjs'), "import { greet } from './src/greet.js';\nimport { shout } from './src/shout.js';\n\nconsole.log(greet('Ada'));\nconsole.log(shout(greet('Ada')));\n");
  await writeFile(join(dir, 'package.json'), '{ "name": "prototype", "version": "0.0.0", "type": "module" }\n');
  await git(dir, 'add', '-A');
  await git(dir, 'commit', '-q', '-m', 'initial commit');
  return (await git(dir, 'rev-parse', 'HEAD')).trim();
}

async function sweepLeftovers(conn) {
  const pager = Sandbox.list({ ...conn, ...CONTROL, query: { metadata: { purpose: PURPOSE } } });
  const ids = [];
  while (pager.hasNext) for (const info of await pager.nextItems()) ids.push(info.sandboxId);
  for (const id of ids) await Sandbox.kill(id, { ...conn, ...CONTROL }).catch(() => false);
  return ids;
}

// ---- main -----------------------------------------------------------------------------------
async function main() {
  const cfg = join(homedir(), '.config', 'worca-e2b');
  const e2b = await readExports(join(cfg, 'e2b.sh'));
  const model = await readExports(join(cfg, 'model.sh'));
  for (const k of ['E2B_API_KEY', 'E2B_API_URL', 'E2B_SANDBOX_URL']) if (!e2b[k]) throw new Error(`${k} missing from e2b.sh`);
  if (!model.CLAUDE_CODE_OAUTH_TOKEN) throw new Error('CLAUDE_CODE_OAUTH_TOKEN missing from model.sh');
  secrets.push(e2b.E2B_API_KEY, model.CLAUDE_CODE_OAUTH_TOKEN);
  const token = model.CLAUDE_CODE_OAUTH_TOKEN;
  const conn = { apiKey: e2b.E2B_API_KEY, apiUrl: e2b.E2B_API_URL, sandboxUrl: e2b.E2B_SANDBOX_URL };
  log(`E2B API ${e2b.E2B_API_URL}, sandbox URL ${e2b.E2B_SANDBOX_URL}, key ${e2b.E2B_API_KEY}, token ${token}`);

  const work = await mkdtemp(join(tmpdir(), 'worca-e2b-proto-'));
  const repo = join(work, 'repo'); await mkdir(repo);
  const outDir = outArg || join(work, 'worca-out');
  const codeword = `KITE-${randomBytes(3).toString('hex').toUpperCase()}`;
  let sbx = null;

  try {
    // a. throwaway repo
    const base = await makeRepo(repo);
    record('a. local repo', true, `${repo} at ${base.slice(0, 8)} (5 files, 1 commit)`);

    // b. sandbox + bundle clone
    let t = Date.now();
    sbx = await Sandbox.create(TEMPLATE, { ...conn, ...CONTROL, metadata: { purpose: PURPOSE }, timeoutMs: 30 * 60_000 });
    log(`sandbox ${sbx.sandboxId} created from ${TEMPLATE} in ${((Date.now() - t) / 1000).toFixed(1)}s`);
    const bundle = join(work, 'repo.bundle');
    await git(repo, 'bundle', 'create', bundle, 'main');
    t = Date.now();
    await sbx.files.write(`${SB_HOME}/repo.bundle`, new Blob([await readFile(bundle)]), { requestTimeoutMs: 120_000 });
    await mustSh(sbx, `git clone -q -b main ${SB_HOME}/repo.bundle ${SB_REPO} && mkdir -p ${SB_OUT}`, { cwd: SB_HOME });
    const sbHead = (await mustSh(sbx, 'git rev-parse HEAD')).trim();
    const who = (await mustSh(sbx, 'echo "$(id -un) $HOME $(claude --version) $(git --version) node $(node --version)"')).trim();
    record('b. sandbox + bundle clone', sbHead === base, `clone HEAD ${sbHead.slice(0, 8)} (local ${base.slice(0, 8)}) in ${((Date.now() - t) / 1000).toFixed(1)}s; ${who}`);
    const noRemote = (await sh(sbx, 'git remote get-url origin')).stdout.trim();
    log(`sandbox clone's origin is the bundle file: ${noRemote}`);

    // c. one real streamed claude step: a longer turn (reads, an edit, two commands, a write) so the
    // stream has to deliver events across many seconds, not in one burst at exit
    const s1 = await claudeStep(sbx, {
      label: 'step1', token,
      prompt: `You are in a small JavaScript repo. Remember this code word for later: ${codeword}. Do not write it anywhere yet.\n`
        + 'Work through these steps one at a time, one tool call each:\n'
        + '1. Read README.md.\n2. Read src/greet.js.\n3. Read src/shout.js.\n4. Read check.mjs.\n'
        + '5. Run `node check.mjs` and note its output.\n'
        + '6. Change src/greet.js so greet(name) returns `Hi, ${name}!` instead of `Hello, ${name}`.\n'
        + '7. Run `node check.mjs` again.\n'
        + `8. Write ${SB_OUT}/step1.txt with exactly two lines: the output line of step 5's first console.log, then the same line from step 7.\n`
        + 'Do not commit. Be brief.',
    });
    const greet1 = (await sh(sbx, 'cat src/greet.js')).stdout;
    const step1Out = (await sh(sbx, `cat ${SB_OUT}/step1.txt`)).stdout.trim();
    const changed1 = /Hi, \$\{name\}!/.test(greet1);
    const ranCheck = /Hello, Ada/.test(step1Out) && /Hi, Ada!/.test(step1Out);
    record('c. streamed claude step', s1.code === 0 && !!s1.sessionId && s1.live && s1.tools.length >= 5 && s1.firstToExit >= 10 && changed1 && ranCheck,
      `exit ${s1.code}, session ${s1.sessionId}, ${s1.events} events (${s1.early} more than 1 s before exit), ${s1.tools.length} tool calls, live=${s1.live}, `
      + `first event ${s1.firstToExit.toFixed(1)}s before exit, ${s1.seconds.toFixed(1)}s total; greet.js changed=${changed1}; check.mjs output before/after=${ranCheck}; step1.txt: ${JSON.stringify(step1Out)}`);

    // d. question round-trip
    // Step 2 already resumes step 1, so the code-word check in step 3 spans two resumes.
    const s2 = await claudeStep(sbx, {
      label: 'step2', token, resume: s1.sessionId,
      prompt: 'Next I want a farewell(name) function in src/greet.js, but you must not pick its greeting word yourself. '
        + `Write ${SB_OUT}/question.json with exactly this shape: {"id":"q1","question":"<your question>","options":["Goodbye","Farewell","See you"]} `
        + 'asking which word farewell should use, and then stop. Do not change any other file.',
    });
    const qRaw = (await sh(sbx, `cat ${SB_OUT}/question.json`)).stdout;
    let question = null; try { question = JSON.parse(qRaw); } catch { /* reported below */ }
    log(`question.json: ${qRaw.trim()}`);
    const greet2 = (await sh(sbx, 'cat src/greet.js')).stdout;
    record('d1. question written', s2.code === 0 && question?.id === 'q1' && greet2 === greet1,
      `exit ${s2.code}, session ${s2.sessionId}, parsed=${!!question}, greet.js untouched=${greet2 === greet1}`);
    const answer = 'See you';
    log(`answering ${question?.id ?? 'q1'} with ${JSON.stringify(answer)}`);
    const s3 = await claudeStep(sbx, {
      label: 'step3', token, resume: s2.sessionId || s1.sessionId,
      prompt: `The answer to q1 is: "${answer}". Add export function farewell(name) to src/greet.js that returns \`${answer}, \${name}!\`. `
        + `Then write ${SB_OUT}/answer-used.txt with two lines: line 1 the answer you used, line 2 the code word I gave you in my first message. Do not commit.`,
    });
    const used = (await sh(sbx, `cat ${SB_OUT}/answer-used.txt`)).stdout.trim().split('\n');
    const greet3 = (await sh(sbx, 'cat src/greet.js')).stdout;
    record('d2. resume used earlier context', s3.code === 0 && used[0]?.includes(answer) && used[1]?.includes(codeword) && greet3.includes('farewell'),
      `exit ${s3.code}, session ${s3.sessionId} (resumed ${s2.sessionId || s1.sessionId}), answer-used.txt=${JSON.stringify(used)}, expected code word ${codeword}, farewell added=${greet3.includes('farewell')}`);

    // e. download /home/user/worca-out
    t = Date.now();
    await mustSh(sbx, `tar -czf /tmp/worca-out.tgz -C ${SB_HOME} worca-out`, { cwd: SB_HOME });
    const tgz = join(work, 'worca-out.tgz');
    await writeFile(tgz, Buffer.from(await sbx.files.read('/tmp/worca-out.tgz', { format: 'bytes', requestTimeoutMs: 120_000 })));
    await mkdir(outDir, { recursive: true });
    await execFileP('tar', ['-xzf', tgz, '-C', outDir, '--strip-components', '1']);
    const listed = (await execFileP('find', [outDir, '-type', 'f'])).stdout.trim().split('\n').filter(Boolean);
    record('e. download worca-out', listed.length >= 3, `${listed.length} files to ${outDir} in ${((Date.now() - t) / 1000).toFixed(1)}s: ${listed.map((f) => f.slice(outDir.length + 1)).join(', ')}`);

    // f. commit in the sandbox, bundle back, fast-forward locally
    t = Date.now();
    // When the agent changed nothing (e.g. it could not sign in), the prototype makes its own change
    // so the bundle-back path is still exercised; the log says so.
    if (!(await mustSh(sbx, 'git status --porcelain')).trim()) {
      log('f: the agent left no changes; writing a fallback change so the transfer is still tested');
      await mustSh(sbx, "printf 'export const fallback = true;\\n' > src/fallback.js && printf '\\nChanged in the sandbox.\\n' >> README.md");
    }
    await mustSh(sbx, 'git add -A && git commit -q -m "prototype: changes from the sandbox"');
    const sbNew = (await mustSh(sbx, 'git rev-parse HEAD')).trim();
    const sbStat = (await mustSh(sbx, `git diff --stat ${base} HEAD`)).trim();
    const sbSum = (await mustSh(sbx, `git diff --no-ext-diff --full-index --binary ${base} HEAD | sha256sum`)).trim().split(/\s+/)[0];
    await mustSh(sbx, `git bundle create /tmp/new.bundle ${base}..main`);
    const nb = join(work, 'new.bundle');
    await writeFile(nb, Buffer.from(await sbx.files.read('/tmp/new.bundle', { format: 'bytes', requestTimeoutMs: 120_000 })));
    await git(repo, 'bundle', 'verify', '-q', nb);
    await git(repo, 'fetch', '-q', nb, 'main:refs/remotes/sandbox/main');
    const merge = (await git(repo, 'merge', '--ff-only', 'sandbox/main')).trim();
    const localNew = (await git(repo, 'rev-parse', 'HEAD')).trim();
    const localDiff = await git(repo, 'diff', '--no-ext-diff', '--full-index', '--binary', base, 'HEAD');
    const localSum = createHash('sha256').update(localDiff).digest('hex');
    log(`sandbox diff --stat:\n${sbStat}`);
    log(`local merge: ${merge.split('\n')[0]}`);
    record('f. bundle back + fast-forward', localNew === sbNew && localSum === sbSum && /Fast-forward/.test(merge),
      `sandbox HEAD ${sbNew.slice(0, 8)}, local HEAD ${localNew.slice(0, 8)}, diff sha256 sandbox ${sbSum.slice(0, 12)} local ${localSum.slice(0, 12)}, ${((Date.now() - t) / 1000).toFixed(1)}s`);

    // g. pause + connect (optional; a failure is a finding). pause() returning true is not proof:
    // the API must report the sandbox as paused, and a process started before the pause shows
    // whether memory survived (a full snapshot) or the sandbox rebooted from disk.
    if (tryPause) {
      try {
        const id = sbx.sandboxId;
        const stateOf = async () => (await Sandbox.getInfo(id, { ...conn, ...CONTROL })).state;
        const pausedIds = async () => {
          const pager = Sandbox.list({ ...conn, ...CONTROL, query: { metadata: { purpose: PURPOSE }, state: ['paused'] } });
          const found = [];
          while (pager.hasNext) for (const info of await pager.nextItems()) found.push(info.sandboxId);
          return found;
        };
        await mustSh(sbx, `echo alive > ${SB_HOME}/pause-marker`, { cwd: SB_HOME });
        const pid = (await mustSh(sbx, 'nohup sleep 3600 >/dev/null 2>&1 & echo $!', { cwd: SB_HOME })).trim();
        const bootBefore = (await mustSh(sbx, 'cat /proc/sys/kernel/random/boot_id', { cwd: SB_HOME })).trim();
        const stateBefore = await stateOf();
        t = Date.now();
        const paused = await sbx.pause({ requestTimeoutMs: 300_000 });
        const tp = (Date.now() - t) / 1000;
        const stateDuring = await stateOf();
        const listedPaused = (await pausedIds()).includes(id);
        // A command on the old handle must fail while the sandbox is paused.
        const probe = await sh(sbx, 'true', { cwd: SB_HOME, timeoutMs: 15_000, requestTimeoutMs: 15_000 })
          .then((r) => `answered (exit ${r.code})`, (e) => `refused (${e?.name || 'Error'})`);
        log(`pause() returned ${paused} after ${tp.toFixed(1)}s; state before ${stateBefore}, after ${stateDuring}; listed as paused=${listedPaused}; command on the paused sandbox ${probe}`);
        t = Date.now();
        sbx = await Sandbox.connect(id, { ...conn, requestTimeoutMs: 300_000 });
        const tc = (Date.now() - t) / 1000;
        const stateAfter = await stateOf();
        const marker = (await mustSh(sbx, `cat ${SB_HOME}/pause-marker`, { cwd: SB_HOME })).trim();
        const headAfter = (await mustSh(sbx, 'git rev-parse HEAD')).trim();
        const bootAfter = (await mustSh(sbx, 'cat /proc/sys/kernel/random/boot_id', { cwd: SB_HOME })).trim();
        const pidAlive = (await sh(sbx, `test -d /proc/${pid} && echo yes || echo no`, { cwd: SB_HOME })).stdout.trim() === 'yes';
        const reallyPaused = stateDuring === 'paused' && listedPaused;
        log(`after connect: state ${stateAfter}; boot id kept=${bootAfter === bootBefore}; process ${pid} from before the pause alive=${pidAlive}`);
        record('g. pause + connect', reallyPaused && stateAfter === 'running' && marker === 'alive' && headAfter === sbNew,
          `pause ${tp.toFixed(1)}s, connect ${tc.toFixed(1)}s; really paused=${reallyPaused} (state ${stateDuring}, listed=${listedPaused}, command ${probe}); `
          + `state after connect ${stateAfter}; marker=${marker}, HEAD kept=${headAfter === sbNew}; memory kept=${pidAlive && bootAfter === bootBefore}`);
      } catch (err) {
        record('g. pause + connect', false, `finding: ${err?.name || 'Error'}: ${err?.message}`);
      }
    } else log('g. pause + connect: skipped (--no-pause)');
  } catch (err) {
    record('run', false, `${err?.name || 'Error'}: ${err?.stack || err?.message}`);
  } finally {
    // h. cleanup: this sandbox, then anything else tagged with the prototype's metadata
    if (sbx) {
      const ok = await Sandbox.kill(sbx.sandboxId, { ...conn, ...CONTROL }).catch((e) => `error ${e?.message}`);
      log(`removed sandbox ${sbx.sandboxId}: ${ok}`);
    }
    const left = await sweepLeftovers(conn).catch((e) => { log(`leftover sweep failed: ${e?.message}`); return null; });
    const after = left === null ? null : await sweepLeftovers(conn).catch(() => null);
    record('h. cleanup', left !== null && after?.length === 0, `leftovers removed: ${left?.length ?? '?'}${left?.length ? ` (${left.join(', ')})` : ''}; remaining after: ${after?.length ?? '?'}`);
    if (!outArg) log(`local work dir kept for inspection: ${work}`);
    else await rm(work, { recursive: true, force: true });
  }

  console.log('\nSummary');
  for (const r of results) console.log(redact(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.step}`));
  console.log(`  total ${((Date.now() - T0) / 1000).toFixed(1)}s`);
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}

main().catch((err) => { console.error(redact(err?.stack || String(err))); process.exitCode = 2; });
