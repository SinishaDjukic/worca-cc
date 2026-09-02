#!/usr/bin/env node
// src/cli/worca-cc.mjs
//
// CLI entry point. Parses flags, creates a core orchestrator, subscribes to its events,
// renders a phase tracker + streamed agent logs to the terminal, and drives interactive
// Q&A (clarify) and loop gates via node:readline. Supports --yes (auto), --mock,
// --install <dir> (delegates to scripts/install.mjs), --ui (spawns ui/server.mjs),
// and -v/-V/--version (also the bare word `version`).
//
// ESM, no external dependencies.

import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { fstatSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, basename } from 'node:path';
import process from 'node:process';

import { preflightNode } from '../core/preflight-node.mjs';
import { createOrchestratorFor } from '../core/engine-select.mjs';
import {
  addProject,
  listProjects,
  removeProject,
  normalizeProjectPath,
} from '../core/projects.mjs';
import { projectKey } from '../core/store.mjs';
import { formatExecLine, formatGateHeader, formatRunSummary } from './render.mjs';

// ── node:sqlite runtime guard + warning filter ──────────────────────────────────
// Drop ONLY the one-time ExperimentalWarning emitted by node:sqlite (the module is
// stable enough for our use but still flagged experimental). Everything else (deprec-
// ations, etc.) is re-printed unchanged. Belt-and-suspenders with the npm scripts'
// --disable-warning=ExperimentalWarning (the primary suppressor): this filter is the
// direct-bin fallback. We removeAllListeners('warning') FIRST so Node's default
// printer no longer fires (a bare listener would NOT suppress the warning and would
// double-print every OTHER warning), then attach our single filtering listener.
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w && w.name === 'ExperimentalWarning' && /SQLite/i.test(w.message)) return;
  process.stderr.write(`${w?.stack || w?.message || w}\n`);
});
// ── --version ──────────────────────────────────────────────────────────────────
// Answered BEFORE the Node preflight and before any flag validation: "which worca is
// this?" is the first question asked when something else is broken, so it must work
// on an unsupported Node and alongside an otherwise-bad command line. The bare word
// `version` is only honoured in the subcommand slot (like `help`); the flags anywhere.
// Output is the GNU/gh/go form, `<prog> <semver>`, on stdout, exit 0.
const PKG_VERSION = createRequire(import.meta.url)('../../package.json').version;
const VERSION_FLAGS = new Set(['-v', '-V', '--version']);
if (process.argv[2] === 'version' || process.argv.slice(2).some((a) => VERSION_FLAGS.has(a))) {
  process.stdout.write(`worca ${PKG_VERSION}\n`);
  process.exit(0);
}
// Fail fast on an unsupported Node / missing node:sqlite BEFORE any DB is opened.
preflightNode();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

// ── arg parsing ────────────────────────────────────────────────────────────────

/**
 * The permission modes a pipeline run may be launched with. Deliberately NOT the
 * full set claude accepts: `dontAsk` belongs to the Ask Worca runner alone
 * (core/ask/spawn.mjs), which owns its own spawn options and never comes through
 * here.
 */
const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions', 'dontAsk'];

/**
 * Parse argv into a flags object. Supports "--flag value" and "--flag=value", plus the
 * boolean flags --mock, --yes/--non-interactive, --ui, -h/--help. (-v/-V/--version
 * never reach here: they are answered at module top, before the Node preflight.)
 */
function parseArgs(argv) {
  const out = {
    project: process.cwd(),
    prompt: null,
    file: null,
    title: null,
    extras: [],
    ui: false,
    model: undefined,
    permissionMode: undefined,
    workflow: undefined,
    mock: false,
    auto: false,
    install: null,
    sourceBranch: undefined,
    featureBranch: undefined,
    help: false,
    _: [],
  };
  const takesValue = new Set([
    '--project',
    '--prompt',
    '--file',
    '--title',
    '--extras',
    '--model',
    '--permission-mode',
    '--workflow',
    '--install',
    '--source-branch',
    '--branch',
  ]);
  const map = {
    '--project': 'project',
    '--prompt': 'prompt',
    '--file': 'file',
    '--title': 'title',
    '--extras': 'extras',
    '--model': 'model',
    '--permission-mode': 'permissionMode',
    '--workflow': 'workflow',
    '--install': 'install',
    '--source-branch': 'sourceBranch',
    '--branch': 'featureBranch',
  };

  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      out.help = true;
      continue;
    }
    if (arg === '--mock') {
      out.mock = true;
      continue;
    }
    if (arg === '--yes' || arg === '--non-interactive') {
      out.auto = true;
      continue;
    }
    if (arg === '--ui') {
      out.ui = true;
      continue;
    }

    let inlineValue;
    const eq = arg.indexOf('=');
    if (arg.startsWith('--') && eq !== -1) {
      inlineValue = arg.slice(eq + 1);
      arg = arg.slice(0, eq);
    }

    if (takesValue.has(arg)) {
      const key = map[arg];
      const value = inlineValue !== undefined ? inlineValue : argv[++i];
      if (value === undefined) {
        fail(`Flag ${arg} requires a value.`);
      }
      if (key === 'extras') {
        // Comma-separated and/or repeatable; accumulate non-empty paths.
        for (const part of String(value).split(',')) {
          const p = part.trim();
          if (p) out.extras.push(p);
        }
      } else if (key === 'permissionMode' && !PERMISSION_MODES.includes(String(value))) {
        // A pipeline run's mode reaches claude-runner as-is. `dontAsk` is a legitimate
        // headless mode for a REAL run (allowedTools decide what runs); only the
        // MOCK runner treats it as the Ask Worca recipe — that pair is refused below,
        // after --mock/WORCA_MOCK are known (review of PR #376).
        fail(`--permission-mode must be one of ${PERMISSION_MODES.join(', ')}, got: ${value}`);
      } else {
        out[key] = value;
      }
      continue;
    }

    if (arg.startsWith('-')) {
      fail(`Unknown flag: ${arg}`);
    }
    out._.push(arg);
  }
  return out;
}

function fail(msg) {
  process.stderr.write(`worca: ${msg}\n`);
  process.exit(2);
}

/** Budget-refusal line: "$X of $Y spent this week; resets 2026-09-01 00:00 (in 24d 12h)". */
function budgetRefusalDetail(b) {
  const p = (x) => String(x).padStart(2, '0');
  const d = new Date(b.windowEndMs);
  const when = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  const days = Math.floor(b.msUntilReset / 86400000);
  const hours = Math.floor((b.msUntilReset % 86400000) / 3600000);
  const periodWord = b.resetPeriod === 'weekly' ? 'week' : 'month';
  return `$${b.windowSpendUsd.toFixed(2)} of $${b.totalLimitUsd.toFixed(2)} spent this ${periodWord}; `
    + `resets ${when} (in ${days}d ${hours}h)`;
}

const HELP = `worca — node-graph multi-agent pipelines

Usage:
  worca <subcommand> [args]
  worca --prompt "<task>" [--project <dir>] [options]
  worca --file <task.md> [--project <dir>] [options]
  worca "<task>" [--project <dir>] [options]   (bare prompt; quote it)
  worca --ui
  worca --install <targetDir> [--force]

Subcommands:
  add [name] [--path <dir>]   Register a project. Defaults: name = basename(path), path = cwd.
  list                        List registered projects (tab-separated; missing dirs are flagged).
  remove <name>               Remove a registered project by name (case-insensitive).
  resume <pipelineId>         Continue a paused pipeline (re-attaches Claude sessions).
    [--ignore-cost-cap]       Resume past this pipeline's cost cap (persists on the run).
  doctor                      Reconcile crashed runs and sweep leftover run roots.
  plugin <cmd> [...]          Manage plugins: add|install|list|update|remove|purge|enable|
                              disable|doctor|link|reimport|init|validate|exec. See: worca plugin help
  marketplace <cmd> [...]     Manage plugin marketplaces: add|list|refresh|remove. See: worca marketplace help
  config [get|set|unset]      Budget & cost-limit settings
  help                        Print this help (same as --help).
  version                     Print the version (same as --version).

Options:
  --project <dir>          Target project directory (default: cwd)
  --prompt <text>          Task prompt text
  --file <md>              Markdown file used as the prompt (alternative to --prompt)
  --title <text>           Human-readable run title
  --extras <paths>         Extra files copied into the pipeline's extras/ folder
                           (comma-separated; repeatable)
  --model <m>              Claude model id
  --permission-mode <m>    Claude permission mode: default | acceptEdits | plan |
                           bypassPermissions (default acceptEdits)
  --workflow <id>          Saved pipeline template to run (default: wf_default — the built-in graph)
  --source-branch <name>   Branch to fork the per-run worktree from (default: current HEAD)
  --branch <name>          Feature branch name (default: claude proposes one)
  --mock                   Offline mock mode (no claude, no tokens)
  --yes, --non-interactive Auto-answer clarify (first option) and gates (continue)
  --ui                     Launch the web UI (ui/server.mjs) and exit
  --install <targetDir>    Copy agents + /worca skill into <targetDir>/.claude
  -h, --help               Show this help
  -v, -V, --version        Print the version (worca <semver>) and exit
`;

// ── terminal rendering ───────────────────────────────────────────────────────────

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};
const useColor = process.stdout.isTTY;
function c(name, s) {
  if (!useColor) return s;
  return `${COLORS[name] || ''}${s}${COLORS.reset}`;
}

function out(s) {
  process.stdout.write(s + '\n');
}



const LEVEL_COLOR = { info: 'reset', debug: 'gray', warn: 'yellow', error: 'red' };

// ── interactive prompts (readline) ───────────────────────────────────────────────

function makeRl() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // In a real TTY, readline consumes Ctrl+C itself: with no rl 'SIGINT' listener it
  // silently close()s and the process-level pause/stop ladder in attachAndDrive never
  // sees the 1st Ctrl+C. Forward it so Ctrl+C — including during an open question
  // prompt — routes to pause() (which rejects the pending question with the pause
  // sentinel and unwinds to paused). Not unit-testable without a PTY; verified manually.
  rl.on('SIGINT', () => process.emit('SIGINT'));
  return rl;
}

function question(rl, q) {
  return new Promise((res) => rl.question(q, (a) => res(a)));
}

/**
 * Ask the clarify questions interactively. Each question shows its options (2–4) plus a
 * "type your own" choice. Returns { answers: [{ id, choice }] }.
 */
async function askClarify(rl, questions) {
  const answers = [];
  for (const q of questions) {
    out('');
    out(c('bold', `Q: ${q.question}`));
    const opts = (q.options || []).filter((o) => o && o.trim());
    opts.forEach((o, i) => out(`  ${i + 1}) ${o}`));
    const ownIndex = opts.length + 1;
    out(`  ${ownIndex}) type your own`);
    let choice = '';
    while (!choice) {
      const raw = (await question(rl, c('cyan', 'Choose [number or text]: '))).trim();
      if (!raw) {
        // Empty input defaults to the first option.
        choice = opts[0] || '';
        if (choice) break;
        continue;
      }
      const n = Number(raw);
      if (Number.isInteger(n) && n >= 1 && n <= opts.length) {
        choice = opts[n - 1];
      } else if (Number.isInteger(n) && n === ownIndex) {
        choice = (await question(rl, c('cyan', 'Your answer: '))).trim();
      } else {
        // Treat any other free text as the answer directly.
        choice = raw;
      }
    }
    answers.push({ id: q.id, choice });
  }
  return { answers };
}

/**
 * Ask a loop gate interactively. Shows the open blocking issues and the two choices.
 * Returns { decision: "continue" | "another" }.
 */
async function askGate(rl, issues, header) {
  out('');
  // A graph run names the wire and its budget (`? Loop gate · Reviewer → Implementer  3/3 cycles used`).
  out(c('yellow', c('bold', header || 'Loop gate — maximum cycles reached.')));
  out(c('yellow', 'Open critical/major issues:'));
  if (!issues || issues.length === 0) {
    out('  (none reported)');
  } else {
    for (const it of issues) {
      out(`  - ${c('red', `[${it.severity}]`)} ${it.title}${it.location ? c('gray', ` (${it.location})`) : ''}`);
      if (it.detail) out(c('gray', `      ${it.detail}`));
    }
  }
  out('  1) Don\'t have another cycle and continue');
  out('  2) I approve another cycle');
  let decision = '';
  while (!decision) {
    const raw = (await question(rl, c('cyan', 'Choose [1-2]: '))).trim();
    if (raw === '1' || /^cont/i.test(raw)) decision = 'continue';
    else if (raw === '2' || /^(another|approve)/i.test(raw)) decision = 'another';
  }
  return { decision };
}

/**
 * Ask the user how to handle a recoverable error (auth / rate-limit / quota /
 * network). Shows the cause and waits for retry / abort. Returns { decision }.
 */
async function askRecovery(rl, recovery) {
  const rec = recovery || {};
  out('');
  out(c('yellow', c('bold', `Recoverable ${String(rec.cls || 'error').replace('_', ' ')} error — the pipeline could not reach the model.`)));
  if (rec.message) out(c('gray', `  ${rec.message}`));
  if (rec.cls === 'auth') out(c('gray', '  Fix: re-authenticate (claude setup-token or /login) in another terminal, then retry.'));
  else out(c('gray', '  Fix: wait out the limit / restore connectivity / top up credit, then retry.'));
  out('  1) Retry');
  out('  2) Abort the run');
  let decision = '';
  while (!decision) {
    const raw = (await question(rl, c('cyan', 'Choose [1-2]: '))).trim();
    if (raw === '1' || /^retry/i.test(raw)) decision = 'retry';
    else if (raw === '2' || /^abort/i.test(raw)) decision = 'abort';
  }
  return { decision };
}

// ── shared drive loop ────────────────────────────────────────────────────────────

/**
 * Whether stdin could ever deliver an interactive answer.
 *
 * A TTY always can. A pipe, socket or file redirect MAY — a wrapper script that
 * feeds answers is legitimate — so those pass. `/dev/null` never can: it EOFs on
 * the first read, so the run would start, spend a real agent call, and then be
 * abandoned mid-question. Measured on darwin (and matching linux): `< /dev/null`,
 * a closed fd 0 (Node reopens it on /dev/null) and `spawn(…, {stdio:['ignore',…]})`
 * are all non-TTY CHARACTER devices, while a pipe is a fifo/socket and a redirect
 * is a regular file. An fstat that throws answers "yes" — never refuse a run on a
 * guess.
 */
function stdinCanAnswer() {
  if (process.stdin.isTTY) return true;
  try {
    return !fstatSync(0).isCharacterDevice();
  } catch {
    return true;
  }
}

/**
 * Wire readline Q&A, log/phase rendering, and SIGINT pause/stop onto an
 * orchestrator, then drive it. `start` launches run() or resume(). Returns the
 * process exit code (0 for done/paused, 1 otherwise).
 */
async function attachAndDrive(orch, flags, start) {
  // Refuse an unanswerable interactive run BEFORE start(). The orchestrator
  // constructor is pure (createPipeline runs inside run()), so nothing exists yet:
  // no pipelines row, no run root, no worktree, no spend. Without this, a
  // `worca --prompt … < /dev/null` reached the first clarify question, printed
  // `Failed to read answer: readline was closed` and exited 0 with the row left
  // `running` — a CI job read success on an abandoned run.
  if (!flags.auto && !stdinCanAnswer()) {
    fail('stdin cannot answer prompts (it is /dev/null or closed) — pass --yes for a non-interactive run.');
  }
  const rl = flags.auto ? null : makeRl();
  let answering = false; // serialize interactive prompts vs. log rendering
  let answerFailure = null; // a question we could not answer -> non-zero exit

  /**
   * Abandon a prompt we cannot answer: stop the run and force a non-zero exit, so
   * the row never stays `running` and no caller reads success off an abandoned run.
   * A pause/stop already in flight owns the outcome — Ctrl+C must still end
   * `paused`, never `stopped`.
   */
  const abandonAnswer = (err) => {
    if (orch.pauseRequested || !orch.state || orch.state.status !== 'running') return;
    answerFailure = err;
    process.stderr.write('worca: cannot continue without an answer — stopping the run. '
      + 'Use --yes for a non-interactive run.\n');
    // Deferred by ONE microtask, for the same reason answers are: _ask emits
    // `question` BEFORE it parks pendingQuestion, so a SYNCHRONOUS throw in the
    // handler below would reach stop() with nothing parked to reject — and the ask
    // parked a moment later would then hang the run forever, which is the very
    // outcome this guard exists to prevent.
    queueMicrotask(() => {
      if (orch.pauseRequested || !orch.state || orch.state.status !== 'running') return;
      orch.stop();
    });
  };

  // stdin reaching EOF *while a question is open* does not throw: readline simply
  // closes and never invokes the question callback, so the awaited answer never
  // settles, the event loop drains and node exits 0 with the run abandoned. Treat
  // it as a failed answer — but ONLY while the run is still running: our own
  // rl.close() in the finally below also fires with `answering` still true when a
  // prompt was interrupted by Ctrl+C (the pause settles start() first, and the
  // parked rl.question never resolves), and that is not a lost answer.
  if (rl) {
    rl.on('close', () => {
      if (!answering) return;
      if (orch.pauseRequested || !orch.state || orch.state.status !== 'running') return;
      process.stderr.write('Failed to read answer: stdin closed\n');
      abandonAnswer(new Error('stdin closed'));
    });
  }

  // ── event wiring ──────────────────────────────────────────────────────────────
  // The run renders its `exec` stream and nothing else: the v1 `phase` event and
  // its renderer died with the v1 engine, and the preflight/done BOOKENDS are
  // exec rows now (x:preflight:1 / x:done:1) that render nothing.
  orch.on('exec', (ev) => {
    // A user STOP surfaces as `exec error 'aborted'` on the in-flight execution
    // while its ledger row is 'stopped'; the harness prints the stop line itself.
    if (ev.status === 'error' && orch.state && orch.state.status === 'stopped') return;
    // The exec payload carries no durationMs (spec §5.7) — the ledger rows do,
    // and they are final by the time a terminal exec arrives. A composite
    // parent has no row of its own: its slices (parentExecutionId) are summed,
    // time and spend alike; a slice's own event keeps its own cost.
    let e = ev;
    if (ev.status !== 'start') {
      const rows = Array.isArray(orch.state && orch.state.steps) ? orch.state.steps : [];
      // By `executionId`, never by `key` — Task 14's rule for step rows: today's
      // bookends are key-only, and a v1 row's key is a phase name.
      const mine = rows.filter((s) => s && (s.executionId === ev.executionId || s.parentExecutionId === ev.executionId));
      if (mine.length) {
        e = { ...ev, durationMs: mine.reduce((a, s) => a + (s.activeMs || 0), 0) };
        if (ev.kind !== 'task') e.costUsd = mine.reduce((a, s) => a + (s.costUsd || 0), 0);
      }
    }
    const line = formatExecLine(e, orch.state && orch.state.stepper, { color: c });
    if (line) out(line);
  });

  orch.on('log', ({ source, level, text }) => {
    if (answering) return; // avoid interleaving with an open question prompt
    const color = LEVEL_COLOR[level] || 'reset';
    out(c('gray', `  [${source}] `) + c(color, text));
  });

  orch.on('artifact', ({ kind, path }) => {
    out(c('gray', `  ↳ ${kind}: ${path}`));
  });

  orch.on('error', ({ message }) => {
    process.stderr.write(c('red', `Error: ${message}`) + '\n');
  });

  // The WHOLE payload is kept: a graph run's gate question carries `wireId`,
  // which the header formatter resolves against the manifest.
  orch.on('question', async (payload) => {
    const { id, kind, questions, issues, recovery, agent } = payload;
    if (flags.auto || !rl) return; // auto mode resolves internally
    answering = true;
    try {
      if (kind === 'clarify') {
        const answer = await askClarify(rl, questions || []);
        orch.answer(id, answer);
      } else if (kind === 'gate') {
        // One engine: every gate question is a graph question, so the header is
        // built unconditionally. (The `graphRun()` gate that used to guard this
        // died with the phase listener — leaving the call was a ReferenceError
        // waiting for the first interactive gate.)
        const answer = await askGate(rl, issues || [],
          formatGateHeader(payload, orch.state && orch.state.stepper));
        orch.answer(id, answer);
      } else if (kind === 'recovery') {
        const payload = await askRecovery(rl, recovery);
        orch.answer(id, payload);
      } else if (kind === 'questions') {
        out(c('yellow', c('bold', `${agent || 'Agent'} has questions:`)));
        const payload = await askClarify(rl, questions || []);
        orch.answer(id, payload);
      }
    } catch (err) {
      process.stderr.write(`Failed to read answer: ${err?.message || err}\n`);
      // Never swallow: orch.answer() was not called, so the ask stays open and the
      // run would hang on it (or be abandoned at EOF with its row left `running`
      // while node exits 0). This is also the arm any THROW inside askClarify /
      // askGate / askRecovery lands in — the shape the P6 graphRun() ReferenceError
      // took — so failing loudly here is what turns that class of bug into a
      // visible failure instead of a silent hang.
      abandonAnswer(err);
    } finally {
      answering = false;
    }
  });

  // Ctrl+C: 1st -> graceful pause (falls back to stop when not pausable);
  // 2nd -> stop; 3rd -> hard exit.
  let sigints = 0;
  const onSigint = () => {
    sigints += 1;
    if (sigints === 1) {
      if (orch.pause()) {
        out(c('yellow', '\nPausing… (Ctrl+C again to stop instead)'));
        return;
      }
      out(c('yellow', '\nStopping…'));
      orch.stop();
      return;
    }
    if (sigints === 2) {
      out(c('yellow', '\nStopping…'));
      orch.stop();
      return;
    }
    process.exit(130);
  };
  process.on('SIGINT', onSigint);

  let result;
  try {
    result = await start();
  } finally {
    if (rl) rl.close();
    process.removeListener('SIGINT', onSigint);
  }

  out('');
  if (result?.status === 'done') {
    out(c('green', c('bold', 'Pipeline complete.')));
    // v2 runs: `Result: <path|value>` (or the amber quiescence line), then
    // `N executions · <active> active · $<cost>`; [] on a v1 run.
    const summary = formatRunSummary(orch.state);
    if (summary.length) {
      out(summary[0].startsWith('Finished at quiescence') ? c('yellow', summary[0]) : summary[0]);
      for (const line of summary.slice(1)) out(line);
    }
  } else if (result?.status === 'paused') {
    out(c('yellow', result?.reason ? `Pipeline paused: ${result.reason}` : 'Pipeline paused.'));
    out(`Resume with: ${c('bold', `worca resume ${orch.state.id}`)}`);
  } else if (result?.status === 'stopped') {
    out(c('yellow', 'Pipeline stopped.'));
  } else {
    out(c('red', `Pipeline ended with status: ${result?.status || 'unknown'}`));
  }
  if (result?.pipelineDir) {
    out(`Pipeline directory: ${c('bold', result.pipelineDir)}`);
  }
  // An unanswered question is a failure even if the run somehow settled `done`.
  if (answerFailure) return 1;
  return result?.status === 'done' || result?.status === 'paused' ? 0 : 1;
}

// ── subcommands ──────────────────────────────────────────────────────────────────

/** Spawn the web UI server and inherit its stdio. Resolves when it exits. */
function launchUi() {
  const server = join(REPO_ROOT, 'ui', 'server.mjs');
  out(c('cyan', `Launching web UI: node ${server}`));
  const child = spawn(process.execPath, [server], { stdio: 'inherit' });
  return new Promise((res) => {
    child.on('exit', (code) => res(code ?? 0));
    child.on('error', (err) => {
      process.stderr.write(`Failed to launch UI: ${err.message}\n`);
      res(1);
    });
  });
}

/** Delegate to scripts/install.mjs, forwarding the target dir and any passthrough args. */
function runInstall(targetDir, passthrough) {
  const script = join(REPO_ROOT, 'scripts', 'install.mjs');
  const args = [script, targetDir, ...passthrough];
  const child = spawn(process.execPath, args, { stdio: 'inherit' });
  return new Promise((res) => {
    child.on('exit', (code) => res(code ?? 0));
    child.on('error', (err) => {
      process.stderr.write(`Failed to run install: ${err.message}\n`);
      res(1);
    });
  });
}

// ── project registry subcommands ──────────────────────────────────────────────

/** Parse a tiny argv slice for the `add` subcommand. Supports --path/--path=<dir>. */
function parseAddArgs(argv) {
  const positionals = [];
  let pathArg = null;
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    let inline;
    const eq = a.indexOf('=');
    if (a.startsWith('--') && eq !== -1) {
      inline = a.slice(eq + 1);
      a = a.slice(0, eq);
    }
    if (a === '--path') {
      const v = inline !== undefined ? inline : argv[++i];
      if (v === undefined) fail('Flag --path requires a value.');
      pathArg = v;
    } else if (a.startsWith('-')) {
      fail(`Unknown flag: ${a}`);
    } else {
      positionals.push(a);
    }
  }
  return { name: positionals[0], path: pathArg };
}

async function cmdAdd(argv) {
  const { name: rawName, path: rawPath } = parseAddArgs(argv);
  // Always route through normalizeProjectPath so display, storage, and
  // basename() all see exactly the same string addProject will persist.
  const target = normalizeProjectPath(rawPath) || resolve(process.cwd());
  const name = (rawName && rawName.trim()) || basename(target);
  try {
    await addProject({ name, path: target });
    out(`Added project "${name}" -> ${target}`);
    return 0;
  } catch (err) {
    process.stderr.write(`worca: ${err?.message || err}\n`);
    return 1;
  }
}

async function cmdList() {
  const items = await listProjects();
  if (items.length === 0) {
    out('No projects registered. Use `worca add` to register one.');
    return 0;
  }
  for (const p of items) {
    const tail = p.exists ? '' : `\t${c('gray', '[missing]')}`;
    out(`${p.name}\t${p.path}${tail}`);
  }
  return 0;
}

async function cmdRemove(argv) {
  const name = (argv[0] || '').trim();
  if (!name) fail('Usage: worca remove <name>');
  const before = await listProjects();
  const after = await removeProject(name);
  if (after.length === before.length) {
    out(`No project named "${name}"`);
    return 1;
  }
  out(`Removed project "${name}"`);
  return 0;
}

/**
 * `worca doctor` — reconcile crashed runs, then sweep `<worcaHome>/runs/*`
 * (§8.12), then sweep the LEGACY `<projectDir>/.worca-cc/worktrees/*` base of every
 * registered project (§6 Phase 7). This is what keeps a CLI-only user (who never
 * boots ui/server.mjs) from accumulating crashed-run roots — and leftovers from the
 * flip to detached run roots — forever. Prints keep/remove/quarantine dispositions
 * and always exits 0 — it is a report, not a gate.
 *
 * Ordering is PINNED (same as the server's bootMaintenance): reconcile FIRST so every
 * stale `running` row is already `interrupted` (a status BOTH sweeps' keep-set
 * protects), then the run-root sweep, then the legacy one.
 */
async function cmdDoctor() {
  const { reconcileStaleRunning, runRootSweepLookups, legacySweepLookups } = await import('../core/artifacts.mjs');
  const { sweepRunRoots, sweepLegacyWorktreesAll } = await import('../core/worktree.mjs');
  const { worcaHome } = await import('../core/projects.mjs');
  const { runRootMode } = await import('../core/settings.mjs');
  try {
    const { reconciled } = reconcileStaleRunning({ liveIds: [] }); // CLI owns no live runs
    out(`reconciled ${reconciled} stale running record(s) -> interrupted`);
  } catch (err) {
    process.stderr.write(`worca doctor: reconcile failed: ${err?.message || err}\n`);
  }
  try {
    const { sweepV1Runs } = await import('../core/db.mjs');
    const swept = sweepV1Runs();
    if (swept.length) out(`retired ${swept.length} run(s) paused on the v1 engine`);
  } catch (err) {
    process.stderr.write(`worca doctor: v1-run sweep failed: ${err?.message || err}\n`);
  }
  try {
    // The injected callbacks THROW on a DB failure instead of reporting "no row"
    // (artifacts.mjs#runRootSweepLookups); the sweep records each throw in `failed`
    // and leaves that run root untouched, so a broken sqlite file can never be read
    // as "every run was deleted, reclaim them all".
    const res = await sweepRunRoots({
      worcaHome: worcaHome(),
      ...runRootSweepLookups(),
      log: (level, msg) => out(level === 'warn' ? c('yellow', msg) : msg),
    });
    out(`run roots: kept ${res.keep.length}, removed ${res.removed.length}, `
      + `quarantined ${res.quarantined.length}, skipped ${res.failed.length}`);
    for (const w of res.warnings) out(c('yellow', `  ! ${w}`));
    if (res.failed.length) {
      out(c('yellow', `${res.failed.length} run root(s) could not be classified and were left untouched.`));
    }
  } catch (err) {
    process.stderr.write(`worca doctor: run-root sweep failed: ${err?.message || err}\n`);
  }
  // P4: BEFORE the legacy return 0 — that block short-circuits the whole function
  // whenever the effective mode is not `detached` (the default), so an ask-worktree
  // sweep appended after it would never run for most users.
  try {
    const { sweepAskWorktrees } = await import('../core/ask/worktrees.mjs');
    const res = await sweepAskWorktrees({ log: (level, msg) => out(level === 'warn' ? c('yellow', msg) : msg) });
    out(`ask worktrees: removed ${res.removedDirs} orphan dir(s), dropped ${res.prunedRows} stale row(s), skipped ${res.failed}`);
  } catch (err) {
    process.stderr.write(`worca doctor: ask-worktree sweep failed: ${err?.message || err}\n`);
  }
  try {
    // A TOTAL no-op while the effective mode is `legacy`: those paths hold every live
    // and every paused run, so sweeping them would make the documented §10 rollback
    // self-destroying. The mode is read ONCE here, so the legacy default costs not
    // even a DB read.
    const mode = runRootMode();
    if (mode !== 'detached') {
      out(`legacy worktrees: skipped (run-root mode is "${mode}" — that base holds every live and paused run)`);
      return 0;
    }
    const projects = await listProjects();
    // legacySweepLookups THROWS on a DB failure instead of reporting "no row", so a
    // broken sqlite file skips the whole sweep (caught below) rather than reading
    // every worktree of every project as row-less.
    const res = await sweepLegacyWorktreesAll(projects.map((p) => p.path), {
      mode,
      ...legacySweepLookups(),
      log: (level, msg) => out(level === 'warn' ? c('yellow', msg) : msg),
    });
    out(`legacy worktrees: kept ${res.keep.length}, removed ${res.removed.length}, `
      + `quarantined ${res.quarantined.length}, skipped ${res.failed.length} `
      + `across ${res.projects} project(s)`);
    for (const w of res.warnings) out(c('yellow', `  ! ${w}`));
    if (res.failed.length) {
      out(c('yellow', `${res.failed.length} legacy worktree(s) could not be classified and were left untouched.`));
    }
  } catch (err) {
    process.stderr.write(`worca doctor: legacy worktree sweep failed: ${err?.message || err}\n`);
  }
  return 0;
}

/** `worca config` — list/get/set/unset the budget settings.
 *  Exit codes: 0 ok, 2 usage/validation (fail()). */
async function cmdConfig(argv) {
  const settings = await import('../core/settings.mjs');
  const { budgetStatus } = await import('../core/cost-budget.mjs');

  const KEYS = {
    pipelineCostLimitUsd: {
      aliases: ['pipeline-cost-limit', 'pipeline-cost-limit-usd'],
      read: settings.pipelineCostLimitUsd, write: settings.setPipelineCostLimitUsd, numeric: true,
    },
    totalCostLimitUsd: {
      aliases: ['total-cost-limit', 'total-cost-limit-usd'],
      read: settings.totalCostLimitUsd, write: settings.setTotalCostLimitUsd, numeric: true,
    },
    costLimitResetPeriod: {
      aliases: ['cost-reset-period'],
      read: settings.costLimitResetPeriod, write: settings.setCostLimitResetPeriod, numeric: false,
    },
  };
  const canonical = (name) => {
    if (!name) return null;
    if (KEYS[name]) return name;
    return Object.keys(KEYS).find((k) => KEYS[k].aliases.includes(name)) || null;
  };
  const allowed = () => Object.keys(KEYS).join(', ');
  const show = (k) => {
    const v = KEYS[k].read();
    return v === null || v === undefined ? '(unset)' : String(v);
  };
  const fmtUsd2 = (n) => `$${n.toFixed(2)}`;
  const fmtLocal = (ms) => {
    const d = new Date(ms);
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const fmtIn = (ms) => {
    const dDays = Math.floor(ms / 86400000);
    const dHours = Math.floor((ms % 86400000) / 3600000);
    return `${dDays}d ${dHours}h`;
  };

  const [verb, keyArg, valueArg] = argv;
  if (!verb) {
    for (const k of Object.keys(KEYS)) out(`${k}\t${show(k)}`);
    const b = budgetStatus();
    if (b.totalLimitUsd != null) {
      const periodWord = b.resetPeriod === 'weekly' ? 'week' : 'month';
      out(`window\t${fmtUsd2(b.windowSpendUsd)} of ${fmtUsd2(b.totalLimitUsd)} spent this ${periodWord}; `
        + `resets ${fmtLocal(b.windowEndMs)} (in ${fmtIn(b.msUntilReset)})`);
    }
    return 0;
  }
  if (!['get', 'set', 'unset'].includes(verb)) {
    fail(`Unknown config verb: ${verb}. Use get | set | unset (or no verb to list).`);
  }
  const key = canonical(keyArg);
  if (!key) fail(`Unknown config key: ${keyArg || '(none)'}. Allowed: ${allowed()}`);
  if (verb === 'get') { out(show(key)); return 0; }
  try {
    if (verb === 'unset') { await KEYS[key].write(''); out(`${key}\t(unset)`); return 0; }
    if (valueArg === undefined) fail(`config set ${key} requires a value.`);
    const input = KEYS[key].numeric ? Number(valueArg) : valueArg;
    if (KEYS[key].numeric && !Number.isFinite(input)) {
      fail(`${key} must be a positive number of USD, got: ${valueArg}`);
    }
    await KEYS[key].write(input);
    out(`${key}\t${show(key)}`);
    return 0;
  } catch (err) {
    fail(err && err.message ? err.message : String(err));
  }
}

/** `worca resume <pipelineId>` — continue a paused pipeline from its resume point. */
async function cmdResume(argv) {
  const id = (argv.find((a) => !a.startsWith('--')) || '').trim();
  if (!id) {
    process.stderr.write('usage: worca resume <pipelineId> [--mock] [--yes] [--ignore-cost-cap]\n');
    return 1;
  }
  const mock = argv.includes('--mock');
  const auto = argv.includes('--yes') || argv.includes('--non-interactive');
  const ignoreCap = argv.includes('--ignore-cost-cap');
  if (mock) process.env.WORCA_MOCK = '1';

  const { readPipelineForResume, reconcileStaleRunning } = await import('../core/artifacts.mjs');
  try {
    const { reconciled } = reconcileStaleRunning({ liveIds: [] }); // CLI owns no live runs
    if (reconciled) process.stdout.write(`reaped ${reconciled} interrupted pipeline(s)\n`);
  } catch { /* best-effort: resume still works if the sweep fails */ }
  const saved = readPipelineForResume(id);
  if (!saved) {
    process.stderr.write(`pipeline ${id} not found\n`);
    return 1;
  }
  if (saved.row.status !== 'paused' && saved.row.status !== 'interrupted') {
    process.stderr.write(`pipeline ${id} is "${saved.row.status}", not resumable (paused/interrupted only)\n`);
    return 1;
  }
  if (!saved.resumePoint) {
    process.stderr.write(`pipeline ${id} has no resume point\n`);
    return 1;
  }
  if (saved.resumePoint.version !== 2) {
    const { V1_RUN_RETIRED } = await import('../core/db.mjs');
    process.stderr.write(`worca resume: ${V1_RUN_RETIRED}\n`);
    return 2;
  }
  // The v1 sweep runs AFTER this run's own guards: sweeping FIRST would NULL the
  // point under test, so the caller would read "has no resume point" instead of
  // the honest retirement message above.
  try {
    const { sweepV1Runs } = await import('../core/db.mjs');
    const swept = sweepV1Runs();
    if (swept.length) out(`retired ${swept.length} run(s) paused on the v1 engine`);
  } catch { /* best-effort: resume still works if the sweep fails */ }
  if (saved.row.archived_at) {
    process.stderr.write('worca resume: pipeline is archived\n');
    return 1;
  }
  const { budgetStatus, setCostCapOverride, readCostCapOverride } =
    await import('../core/cost-budget.mjs');
  const budget = budgetStatus();
  if (budget.blocked) {
    process.stderr.write(`worca: total cost limit reached: ${budgetRefusalDetail(budget)}. `
      + 'Raise it: worca config set totalCostLimitUsd <usd>\n');
    return 1;
  }
  // Override persists only once the never-bypassable total gate passes.
  if (ignoreCap) setCostCapOverride(id);
  const spentSoFar = Number(saved.row.total_cost_usd || 0);
  if (budget.pipelineLimitUsd != null && spentSoFar >= budget.pipelineLimitUsd
      && !readCostCapOverride(id)) {
    process.stderr.write(`worca: pipeline cost limit reached: $${spentSoFar.toFixed(2)} spent `
      + `>= $${budget.pipelineLimitUsd.toFixed(2)} cap. Resume anyway: worca resume ${id} --ignore-cost-cap\n`);
    return 1;
  }

  // Resolve projectDir: workspace runs carry dirs in workspace_meta; single-project
  // runs map project_key back through the registry (mirrors ui/server.mjs /api/resume),
  // falling back to the current directory — the default run flow needs no registration,
  // so the `worca resume <id>` hint it prints must work for bare-cwd runs too.
  let projectDir = null;
  let workspace;
  if (saved.row.target === 'workspace' && saved.row.workspace_meta) {
    const meta = JSON.parse(saved.row.workspace_meta);
    projectDir = meta.projects?.[0]?.projectDir || null;
    workspace = meta.workspaceId
      ? {
          id: meta.workspaceId,
          key: saved.row.workspace_key,
          name: meta.workspaceName,
          description: meta.workspaceDescription || '',
          projects: meta.projects || [],
        }
      : undefined;
  } else {
    for (const p of await listProjects()) {
      if (projectKey(p.path) === saved.row.project_key) {
        projectDir = p.path;
        break;
      }
    }
    if (!projectDir && projectKey(resolve(process.cwd())) === saved.row.project_key) {
      projectDir = process.cwd();
    }
  }
  if (!projectDir) {
    process.stderr.write('project for this pipeline is not onboarded (worca add)\n');
    return 1;
  }

  const orch = await createOrchestratorFor({
    projectDir,
    ...(workspace ? { workspace } : {}),
    claude: { mock },
    auto,
    resume: saved,
  });
  return attachAndDrive(orch, { auto }, () => orch.resume());
}

// ── plugin subcommands ─────────────────────────────────────────────────────────
// Thin wrappers over src/core/plugin-*.mjs. All imports are lazy (mirrors
// cmdResume) so non-plugin invocations never load the plugin machinery.
// Exit codes: 0 ok, 1 failure/abort, 2 usage/validation errors (fail()).

const PLUGIN_HELP = `worca plugin — manage worca-cc plugins (task sources, agents, skills, workflows)

Usage:
  worca plugin add <repo-url>                     Register a plugin marketplace (alias of: worca marketplace add)
  worca plugin install <name> [--repo <url>] [--marketplace <id>] [--ref <sha>] [--yes]
  worca plugin list                               Installed plugins (from plugins.lock.json)
  worca plugin update <name> [--yes] [--diff]     Preview commits, diffstat + manifest delta (--diff: full diff), then update
  worca plugin remove <name> [--purge]            Uninstall (--purge also deletes data/)
  worca plugin purge <name>                       Shorthand for remove --purge
  worca plugin enable <name> | disable <name>     Toggle without removing files
  worca plugin doctor [name] [--fix]              Health checks (--fix re-runs deterministic setup on failure)
  worca plugin link <dir>                         Dev mode: use a local dir as "current"
  worca plugin reimport <name>                    Re-read the plugin's pipeline templates (a linked dir is live-edited)
  worca plugin init <name> [--dir <D>] [--with task-source,agents,skills,workflows]
  worca plugin validate <dir> [--strict]          Lint a plugin dir (--strict: unknown fields error)
  worca plugin exec <name> <sourceId> <op> [--args '<json>'] [--profile <id>] [--inspect]   Debug one connector op
  worca plugin channel <name> <channelId> [--check] [--inspect]            Run a chat channel worker in the
                                                  foreground (typed lines = simulated inbound); --check runs
                                                  the module's validateConfig once and exits

Exit codes: 0 ok, 1 failure, 2 usage/validation errors.
`;

const MARKETPLACE_HELP = `worca marketplace — manage plugin marketplaces (repos whose plugins show up as installable)

Usage:
  worca marketplace add <repo-url|owner/repo|path>   Register + sync a marketplace
  worca marketplace list                             Registered marketplaces + their plugins
  worca marketplace refresh [id]                     Re-sync one marketplace (or all)
  worca marketplace remove <id> [--yes]              Unregister (installed plugins remain)

Removing a marketplace only removes discovery — already-installed plugins keep
working, including updates (install provenance lives in plugins.lock.json).
Exit codes: 0 ok, 1 failure, 2 usage/validation errors.
`;

/** Tiny per-verb arg parser: positionals plus declared --value / --bool flags. */
function pluginArgs(argv, valueFlags = [], boolFlags = []) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    let inline;
    const eq = a.indexOf('=');
    if (a.startsWith('--') && eq !== -1) {
      inline = a.slice(eq + 1);
      a = a.slice(0, eq);
    }
    if (valueFlags.includes(a)) {
      const v = inline !== undefined ? inline : argv[++i];
      if (v === undefined) fail(`Flag ${a} requires a value.`);
      out[a.slice(2)] = v;
    } else if (boolFlags.includes(a)) {
      out[a.slice(2)] = true;
    } else if (a.startsWith('-')) {
      fail(`Unknown flag: ${a}`);
    } else {
      out._.push(a);
    }
  }
  return out;
}

/** y/N confirm via readline; --yes short-circuits to true (scripting contract). */
async function confirmPlugin(msg, yes) {
  if (yes) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on('SIGINT', () => { rl.close(); out(''); process.exit(130); });
  try {
    const a = (await question(rl, c('cyan', `${msg} [y/N] `))).trim();
    return /^y(es)?$/i.test(a);
  } finally {
    rl.close();
  }
}

/** "1 source, 2 agents, 1 skill" from an inventory/contributions bag (defensive:
 *  accepts arrays OR the numeric counts listInstalledPlugins() produces). */
function contribSummary(x) {
  const n = (v) => (Array.isArray(v) ? v.length : Number.isFinite(v) ? v : 0);
  const b = x || {};
  const parts = [
    [n(b.taskSources), 'source', 'sources'],
    [n(b.chatChannels), 'chat channel', 'chat channels'],
    [n(b.agents), 'agent', 'agents'],
    [n(b.skills), 'skill', 'skills'],
    [n(b.workflows), 'workflow', 'workflows'],
  ]
    .filter(([count]) => count > 0)
    .map(([count, one, many]) => `${count} ${count === 1 ? one : many}`);
  return parts.length ? parts.join(', ') : 'no contributions';
}

/** Print the post-export install inventory (spec §6.1 consent items). */
function printInventory(inv) {
  const i = inv || {};
  for (const s of i.taskSources || []) {
    out(`  task source: ${s.id} (${s.displayName})${s.secrets?.length ? ` — secrets: ${s.secrets.join(', ')}` : ''}`);
  }
  for (const ch of i.chatChannels || []) {
    const dirs = [ch.inbound && 'inbound', ch.outbound && 'outbound'].filter(Boolean).join('+');
    out(`  chat channel: ${ch.id} (${ch.platform}, ${dirs}, persistent worker)${ch.secrets?.length ? ` — secrets: ${ch.secrets.join(', ')}` : ''}`);
    if (ch.inbound) out('    WARNING: inbound chat can pause/stop/approve runs — bot token or allowed-chat membership controls worca-cc');
  }
  for (const a of i.agents || []) {
    out(`  agent: ${a.key}${a.tools?.length ? ` (tools: ${a.tools.join(', ')})` : ''}`);
  }
  for (const s of i.skills || []) out(`  skill: ${s}`);
  for (const w of i.workflows || []) out(`  workflow: ${w}`);
  if (i.depCount != null) out(`  npm dependencies: ${i.depCount}`);
  for (const cmd of i.setupCommands || []) out(`  setup: ${cmd}`);
}

/** Contributions worca refused to load (spec §9.3): one yellow line each, so a
 *  receipt or a list never claims an agent/template that exists nowhere. */
function printIgnored(ignored) {
  const list = Array.isArray(ignored) ? ignored : [];
  if (!list.length) return;
  out(c('yellow', `  ${list.length} contribution${list.length > 1 ? 's' : ''} ignored:`));
  for (const i of list) out(c('yellow', `    ${i.file} — ${i.reason}`));
}

/** kebab plugin name -> camelCase stem for the scaffolded example agent key. */
function camelizePluginName(name) {
  return name.replace(/-([a-z0-9])/g, (_, ch) => ch.toUpperCase());
}

const INIT_PARTS = ['task-source', 'agents', 'skills', 'workflows'];

/** `worca plugin init <name>` — scaffold a complete working plugin. */
async function pluginInit(rest) {
  const a = pluginArgs(rest, ['--dir', '--with'], []);
  const name = a._[0];
  if (!name) fail('Usage: worca plugin init <name> [--dir <D>] [--with task-source,agents,skills,workflows]');
  if (!/^[a-z][a-z0-9-]*$/.test(name)) fail(`plugin name must be kebab-case (got "${name}")`);
  const withParts = a.with ? a.with.split(',').map((s) => s.trim()).filter(Boolean) : INIT_PARTS;
  for (const part of withParts) {
    if (!INIT_PARTS.includes(part)) fail(`unknown --with part "${part}" (known: ${INIT_PARTS.join(', ')})`);
  }
  if (withParts.includes('workflows') && !withParts.includes('agents')) {
    fail('--with workflows requires agents (templates may only reference the plugin\'s own agent keys)');
  }
  const target = resolve(process.cwd(), a.dir || name);
  const { mkdir, writeFile, chmod, readdir } = await import('node:fs/promises');
  try {
    if ((await readdir(target)).length) {
      process.stderr.write(`target dir ${target} exists and is not empty\n`);
      return 1;
    }
  } catch { /* missing dir is the normal case */ }

  const agentKey = camelizePluginName(name) + 'Helper';
  const files = new Map();

  const manifestObj = {
    name,
    version: '0.1.0',
    description: 'Scaffolded worca plugin — edit me',
    engines: { 'worca-cc-api': '>=3 <4' },
  };
  if (withParts.includes('task-source')) {
    manifestObj.taskSources = [{
      id: 'main',
      displayName: name,
      module: './connector/index.mjs',
      configSchema: [
        { key: 'token', type: 'text', secret: true, required: false, label: 'API token', help: 'Optional. Use {"$env":"MY_TOKEN"} to read it from the environment.' },
      ],
      inputs: [
        { key: 'filter', type: 'text', label: 'Filter', default: '' },
        { key: 'task', type: 'task-browser', label: 'Task' },
      ],
    }];
    files.set('connector/index.mjs', [
      '// Mock-style task source scaffold. Replace the canned data with real API calls.',
      '// Contract (plugin API v1): validateConfig / listTasks / getTask / reportResult / capabilities.',
      'const TASKS = [',
      "  { id: 'DEMO-1', title: 'First demo task', url: 'https://example.invalid/demo/1', state: 'open', labels: ['demo'], updatedAt: '2026-01-01T00:00:00.000Z' },",
      "  { id: 'DEMO-2', title: 'Second demo task', url: 'https://example.invalid/demo/2', state: 'open', labels: [], updatedAt: '2026-01-02T00:00:00.000Z' },",
      '];',
      '',
      'export default function createTaskSource(ctx) {',
      '  return {',
      '    async validateConfig() {',
      '      return { ok: true };',
      '    },',
      '    async listTasks({ search } = {}) {',
      "      const needle = String(search || '').trim().toLowerCase();",
      '      const tasks = needle ? TASKS.filter((t) => t.title.toLowerCase().includes(needle)) : TASKS;',
      '      return { tasks };',
      '    },',
      '    async getTask(id) {',
      '      const t = TASKS.find((x) => x.id === id);',
      '      if (!t) return null;',
      "      return { ...t, body: ['## Goal', '', 'Replace this connector with real API calls.'].join('\\n'), meta: { source: 'scaffold' } };",
      '    },',
      '    async reportResult(id, r) {',
      "      await ctx.state.set('lastReport', JSON.stringify({ id, status: r.status, summary: r.summary, links: r.links || [] }));",
      '    },',
      '    capabilities() {',
      '      return { writeBack: true, incrementalSync: false };',
      '    },',
      '  };',
      '}',
      '',
    ].join('\n'));
  }
  if (withParts.includes('agents')) {
    files.set(`agents/${agentKey}.meta.json`, JSON.stringify({
      metaVersion: 2,
      key: agentKey,
      displayName: 'Example Helper',
      description: `Example agent installed by the ${name} plugin`,
      color: 'amber',
      agentFile: `${agentKey}.md`,
      runnerType: 'producer',
      inputs: [{ id: 'task', type: 'md', required: true }],
      outputs: [{ id: 'notes', type: 'md', filename: 'notes.md', store: 'run' }],
      ...(withParts.includes('skills') ? { requiresSkills: ['example-skill'] } : {}),
      order: 900,
    }, null, 2) + '\n');
    files.set(`agents/${agentKey}.md`, [
      '---',
      `name: ${agentKey}`,
      'description: Example plugin agent. Replace with real instructions.',
      'tools: Read, Grep, Glob',
      'model: inherit',
      '---',
      '',
      `You are an example agent shipped by the "${name}" worca plugin.`,
      'Acknowledge the task you were given and describe what a real agent would do here.',
      '',
    ].join('\n'));
  }
  if (withParts.includes('skills')) {
    files.set('skills/example-skill/SKILL.md', [
      '---',
      'name: example-skill',
      `description: Example helper skill shipped by the ${name} plugin. Agents run helper.sh via Bash.`,
      '---',
      '',
      '# example-skill',
      '',
      'Run ./helper.sh (relative to this skill directory) to print a deterministic marker line.',
      '',
    ].join('\n'));
    files.set('skills/example-skill/helper.sh', '#!/bin/sh\necho "example-skill helper ok"\n');
  }
  if (withParts.includes('workflows')) {
    // A v2 graph: the Task and End cards are mandatory (V20/V21) and every input
    // takes exactly one wire (V7). Ports come from the sidecar above.
    files.set('workflows/example-flow.json', JSON.stringify({
      name: `${name} example flow`,
      version: 2,
      domain: 'general',
      nodes: [
        { id: 'n_task', kind: 'task', x: 40, y: 200, config: {} },
        { id: 'n_helper', kind: 'agent', key: agentKey, x: 320, y: 200, config: {} },
        { id: 'n_end', kind: 'end', x: 600, y: 200, config: {} },
      ],
      wires: [
        { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_helper', port: 'task' } },
        { id: 'w2', from: { node: 'n_helper', port: 'notes' }, to: { node: 'n_end', port: 'result' } },
      ],
    }, null, 2) + '\n');
  }
  files.set('worca-cc-plugin.json', JSON.stringify(manifestObj, null, 2) + '\n');

  for (const [rel, content] of files) {
    const dest = join(target, rel);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, content, 'utf8');
  }
  if (files.has('skills/example-skill/helper.sh')) {
    await chmod(join(target, 'skills/example-skill/helper.sh'), 0o755);
  }

  // Belt-and-suspenders: the scaffold must lint clean, strictly.
  const { validatePluginDir } = await import('../core/plugin-manifest.mjs');
  const v = validatePluginDir(target, { strict: true });
  if (!v.ok) {
    for (const p of v.problems) process.stderr.write(`${p.level}: ${p.message}\n`);
    return 1;
  }
  out(`scaffolded ${name} at ${target}`);
  out('next steps:');
  out(`  worca plugin link ${target}`);
  if (withParts.includes('task-source')) out(`  WORCA_MOCK=1 worca plugin exec ${name} main listTasks`);
  return 0;
}

/** `worca plugin <verb> …` — dispatch. */
async function cmdPlugin(argv) {
  const verb = argv[0];
  const rest = argv.slice(1);
  if (!verb || verb === 'help') {
    process.stdout.write(PLUGIN_HELP);
    return 0;
  }

  const store = await import('../core/plugin-store.mjs');
  const repoMod = await import('../core/plugin-repo.mjs');
  const manifestMod = await import('../core/plugin-manifest.mjs');

  try {
    switch (verb) {
      case 'add': {
        const a = pluginArgs(rest);
        const url = a._[0];
        if (!url) fail('Usage: worca plugin add <repo-url>  (alias of: worca marketplace add)');
        out('note: `worca plugin add` now registers a marketplace (persisted) — same as `worca marketplace add`');
        return cmdMarketplace(['add', url]);
      }

      case 'install': {
        const a = pluginArgs(rest, ['--repo', '--ref', '--marketplace'], ['--yes']);
        const name = a._[0];
        if (!name) fail('Usage: worca plugin install <name> [--repo <url>] [--marketplace <id>] [--ref <sha>] [--yes]');
        const mkt = await import('../core/marketplaces.mjs');
        try { mkt.seedBuiltinMarketplace(); } catch { /* non-checkout install */ }
        let repoUrl = a.repo;
        let marketplace = a.marketplace || null;
        if (!repoUrl && marketplace) {
          const m = mkt.listMarketplaces().find((x) => x.id === marketplace);
          if (!m) fail(`unknown marketplace "${marketplace}" — see: worca marketplace list`);
          repoUrl = m.url;
        }
        if (!repoUrl) {
          let hit = mkt.resolveInstallSource(name, {});
          if (!hit && mkt.listMarketplaces().some((m) => !m.lastSync)) {
            // builtin was seeded with no snapshot (no-git-ops seed) — sync unsynced ones, retry (C5)
            for (const m of mkt.listMarketplaces()) { if (!m.lastSync) { try { await mkt.syncMarketplace(m.id); } catch { /* tolerate */ } } }
            hit = mkt.resolveInstallSource(name, {});
          }
          if (hit && hit.candidates) {
            process.stderr.write(`plugin "${name}" exists in ${hit.candidates.length} marketplaces — pass --repo <url> or --marketplace <id>:\n`);
            for (const cnd of hit.candidates) process.stderr.write(`  --marketplace ${cnd.marketplace}\t${cnd.repoUrl}\n`);
            return 1;
          }
          if (hit) {
            repoUrl = hit.repoUrl;
            marketplace = marketplace ?? hit.marketplace;
          }
        }
        if (!repoUrl) fail(`plugin "${name}" not found in the lock or any marketplace — pass --repo <url> (or add a marketplace first)`);
        const found = await repoMod.addPluginRepo(repoUrl);
        const entry = found.discovered.find((d) => d.name === name);
        if (!entry) {
          process.stderr.write(`plugin "${name}" not found in ${repoUrl} (discovered: ${found.discovered.map((d) => d.name).join(', ') || 'none'})\n`);
          return 1;
        }
        const sha = a.ref || found.sha;
        // Consent summary: everything knowable from the manifest BEFORE any code
        // is exported or any setup runs (the web UI shows the richer exported
        // inventory via its endpoint; the CLI prints the store's ground-truth
        // inventory right after install).
        const m = entry.manifest;
        out(`will install ${m.name} ${m.version || ''} @ ${sha.slice(0, 7)} from ${repoUrl}`);
        if (m.description) out(`  ${m.description}`);
        for (const s of m.taskSources || []) {
          const secrets = (s.configSchema || []).filter((f) => f.secret).map((f) => f.key);
          out(`  task source: ${s.id} (${s.displayName})${secrets.length ? ` — requests secrets: ${secrets.join(', ')}` : ''}`);
        }
        if (m.setup?.node) out('  setup: npm ci --prefix <versionDir> --ignore-scripts --omit=dev');
        if (m.setup?.python) out('  setup: uv sync --project <versionDir>');
        if (!(await confirmPlugin('Install?', !!a.yes))) {
          out('aborted (nothing installed)');
          return 1;
        }
        const res = await store.installPlugin({ repoUrl, subdir: entry.subdir, name, sha, ...(marketplace ? { marketplace } : {}) });
        out('installed:');
        printInventory(res.inventory);
        printIgnored(res.ignored);
        return 0;
      }

      case 'list': {
        const plugins = store.listInstalledPlugins();
        if (!plugins.length) {
          out('No plugins installed. Browse marketplaces with `worca marketplace list` or add one with `worca marketplace add <repo-url>`.');
          return 0;
        }
        for (const p of plugins) {
          const version = p.linked ? 'linked' : p.version || (p.pinnedSha || '').slice(0, 7);
          const flags = [p.enabled ? 'enabled' : 'disabled', ...(p.linked ? ['linked'] : [])].join(', ');
          out(`${p.name}\t${version}\t${flags}\t${contribSummary(p.contributions)}`);
          if (p.apiMismatch) out(c('yellow', `  ${p.apiMismatch.message}`));
          printIgnored(p.ignored);
        }
        return 0;
      }

      case 'update': {
        const a = pluginArgs(rest, [], ['--yes', '--diff']);
        const name = a._[0];
        if (!name) fail('Usage: worca plugin update <name> [--yes] [--diff]');
        const cand = await repoMod.fetchCandidate(name, { fullDiff: !!a.diff });
        if (cand.candidateSha === cand.pinnedSha) {
          out(`${name} is already up to date (${cand.pinnedSha.slice(0, 7)})`);
          return 0;
        }
        out(`${name}: ${cand.pinnedSha.slice(0, 7)} -> ${cand.candidateSha.slice(0, 7)}`);
        for (const commit of cand.commits) out(`  ${commit.sha.slice(0, 7)} ${commit.subject}`);
        if (cand.diffstat) out(cand.diffstat);
        // §6.2 manifest delta — the red-flag review lines.
        const delta = cand.manifestDelta || {};
        for (const k of delta.newSecrets || []) out(c('red', `  NEW SECRET requested: ${k}`));
        for (const s of delta.newTaskSources || []) out(c('yellow', `  new task source: ${s}`));
        for (const ag of delta.newAgents || []) out(c('yellow', `  new agent: ${ag}`));
        if (delta.setupChanged) out(c('yellow', '  setup commands changed'));
        if (a.diff && cand.diffFull) out(cand.diffFull);
        if (!(await confirmPlugin('Update?', !!a.yes))) {
          out('aborted (still pinned)');
          return 1;
        }
        await store.updatePlugin(name);
        out(`updated ${name} to ${cand.candidateSha.slice(0, 7)}`);
        return 0;
      }

      case 'remove':
      case 'purge': {
        const a = pluginArgs(rest, [], ['--purge']);
        const name = a._[0];
        if (!name) fail(`Usage: worca plugin ${verb} <name>${verb === 'remove' ? ' [--purge]' : ''}`);
        const purge = verb === 'purge' || !!a.purge;
        await store.uninstallPlugin(name, { purge });
        out(`removed ${name}`);
        out(purge ? 'data/ purged (config, secrets, state)' : `data/ kept — remove it with: worca plugin purge ${name}`);
        return 0;
      }

      case 'enable':
      case 'disable': {
        const a = pluginArgs(rest);
        const name = a._[0];
        if (!name) fail(`Usage: worca plugin ${verb} <name>`);
        store.setPluginEnabled(name, verb === 'enable');
        out(`${verb}d ${name}`);
        return 0;
      }

      case 'doctor': {
        const a = pluginArgs(rest, [], ['--fix']);
        const names = a._[0] ? [a._[0]] : store.listInstalledPlugins().map((p) => p.name);
        if (!names.length) {
          out('No plugins installed.');
          return 0;
        }
        let allOk = true;
        for (const name of names) {
          const report = await store.doctorPlugin(name);
          out(`${report.ok ? c('green', 'OK  ') : c('red', 'FAIL')} ${name}`);
          for (const check of report.checks) {
            out(`  ${check.ok ? c('green', '✓') : c('red', '✗')} ${check.id}${check.detail ? c('gray', ` — ${check.detail}`) : ''}`);
          }
          if (!report.ok) allOk = false;
        }
        // §6.4 heal path: --fix re-runs the DETERMINISTIC setup steps (npm ci /
        // uv sync — never plugin-chosen commands) for every unhealthy plugin.
        if (!allOk && a.fix) {
          const { readFileSync } = await import('node:fs');
          const { pluginCurrentDir } = await import('../core/plugins-lock.mjs');
          for (const name of names) {
            try {
              const cur = pluginCurrentDir(name);
              const norm = manifestMod.normalizeManifest(
                JSON.parse(readFileSync(join(cur, 'worca-cc-plugin.json'), 'utf8')), { dir: cur });
              if (norm.ok) {
                await store.runSetup(cur, norm.manifest);
                out(`re-ran setup for ${name}`);
              }
            } catch (err) {
              process.stderr.write(`fix ${name}: ${err?.message || err}\n`);
            }
          }
          return 0;
        }
        return allOk ? 0 : 1;
      }

      case 'link': {
        const a = pluginArgs(rest);
        const dir = a._[0];
        if (!dir) fail('Usage: worca plugin link <dir>');
        const abs = resolve(process.cwd(), dir);
        const v = manifestMod.validatePluginDir(abs);
        // Print EVERY level, pass or fail: a link that SUCCEEDS with warnings is
        // the mid-migration case the author most needs to read (MAJ-12) — an
        // API-1 plugin keeps linking, and now says why its agent is ignored.
        for (const p of v.problems) process.stderr.write(`${p.level}: ${p.message}\n`);
        if (!v.ok) return 2;
        const linked = await store.linkPlugin(v.manifest.name, abs);
        out(`linked ${v.manifest.name} -> ${abs} (dev mode; doctor will warn)`);
        const n = linked.workflows.imported.length;
        if (n) out(`  imported ${n} pipeline template${n === 1 ? '' : 's'} — edits to them need: worca plugin reimport ${v.manifest.name}`);
        printIgnored(store.ignoredContributions(v.manifest.name, abs, { workflowSkips: linked.workflows.skipped }));
        return 0;
      }

      case 'reimport': {
        const a = pluginArgs(rest);
        const name = a._[0];
        if (!name) fail('Usage: worca plugin reimport <name>');
        const r = await store.reimportPlugin(name);
        const n = r.workflows.imported.length;
        out(`reimported ${name}: ${n} pipeline template${n === 1 ? '' : 's'}`);
        printIgnored(r.ignored);
        return 0;
      }

      case 'init':
        return await pluginInit(rest);

      case 'validate': {
        const a = pluginArgs(rest, [], ['--strict']);
        const dir = a._[0];
        if (!dir) fail('Usage: worca plugin validate <dir> [--strict]');
        const v = manifestMod.validatePluginDir(resolve(process.cwd(), dir), { strict: !!a.strict });
        for (const p of v.problems) {
          out(`${p.level === 'error' ? c('red', 'error') : c('yellow', 'warn ')}: ${p.message}`);
        }
        if (!v.ok) return 2;
        const warns = v.problems.length;
        out(`OK: ${v.manifest.name}${warns ? ` (${warns} warning${warns === 1 ? '' : 's'})` : ''}`);
        return 0;
      }

      case 'exec': {
        const a = pluginArgs(rest, ['--args', '--profile'], ['--inspect']);
        const [name, sourceId, op] = a._;
        if (!name || !sourceId || !op) fail("Usage: worca plugin exec <name> <sourceId> <op> [--args '<json>'] [--profile <id>] [--inspect]");
        if (a.inspect) process.env.WORCA_PLUGIN_INSPECT = '1'; // shim spawns the child with --inspect-brk
        let args = {};
        if (a.args) {
          try {
            args = JSON.parse(a.args);
          } catch {
            fail('--args must be valid JSON');
          }
        }
        const { callSource } = await import('../core/plugin-shim.mjs');
        // --profile targets one instance of a multi-profile source; absent, the
        // shim falls back to the implicit default bucket (single-profile case).
        const result = await callSource({ plugin: name, sourceId, op, args, profile: a.profile || undefined });
        process.stdout.write(JSON.stringify(result, null, 2) + '\n'); // stdout = result ONLY
        return 0;
      }

      case 'channel': {
        const a = pluginArgs(rest, [], ['--check', '--inspect']);
        const [name, channelId] = a._;
        if (!name || !channelId) fail('Usage: worca plugin channel <name> <channelId> [--check] [--inspect]');
        if (a.inspect) process.env.WORCA_PLUGIN_INSPECT = '1';
        const { createChannelHost } = await import('../core/chat/channel-host.mjs');
        if (a.check) {
          const host = createChannelHost({ logger: () => {} });
          const result = await host.checkChannel(name, channelId);
          process.stdout.write(JSON.stringify(result, null, 2) + '\n');
          return result && result.ok ? 0 : 1;
        }
        // Foreground worker: redacted frames echo to stderr; typed lines become
        // simulated inbound text so the command loop is testable offline.
        const host = createChannelHost({
          logger: (level, msg) => process.stderr.write(`${level}: ${msg}\n`),
          onInbound: (ev) => process.stderr.write(`inbound: ${JSON.stringify(ev.msg)}\n`),
          onStatus: (ev) => process.stderr.write(`status: ${ev.state}${ev.detail ? ` (${ev.detail})` : ''}\n`),
        });
        host.start({ plugin: name, channelId });
        const row = host.status().find((r) => r.plugin === name && r.channelId === channelId);
        if (!row) { await host.stop(); fail(`no chat channel "${name}/${channelId}" — is the plugin installed and enabled?`); }
        process.stderr.write(`worker for ${name}/${channelId} running — type text to simulate inbound, Ctrl-C to exit\n`);
        const { createInterface } = await import('node:readline');
        const rl = createInterface({ input: process.stdin });
        rl.on('line', (line) => {
          if (!line.trim()) return;
          try { host.injectInboundMessage(name, channelId, { chatId: 'CLI', userId: 'cli', text: line.trim(), meta: {} }); }
          catch (err) { process.stderr.write(`inject failed: ${err?.message || err}\n`); }
        });
        await new Promise((resolve) => {
          process.on('SIGINT', resolve);
          rl.on('close', resolve);
        });
        await host.stop();
        return 0;
      }

      default:
        fail(`Unknown plugin subcommand: ${verb}\n\n${PLUGIN_HELP}`);
    }
  } catch (err) {
    const kind = err?.kind ? `[${err.kind}] ` : '';
    process.stderr.write(`worca plugin ${verb}: ${kind}${err?.message || err}\n`);
    for (const ref of err?.references || []) {
      process.stderr.write(`  referenced by: ${typeof ref === 'string' ? ref : JSON.stringify(ref)}\n`);
    }
    return 1;
  }
}

/** `worca marketplace <verb> …` — dispatch. Seeds the builtin marketplace
 *  lazily (a no-op file write after the first time; never any git work). */
async function cmdMarketplace(argv) {
  const verb = argv[0];
  const rest = argv.slice(1);
  if (!verb || verb === 'help') {
    process.stdout.write(MARKETPLACE_HELP);
    return 0;
  }
  const mkt = await import('../core/marketplaces.mjs');
  try { mkt.seedBuiltinMarketplace(); } catch { /* non-checkout install: skip */ }
  try {
    switch (verb) {
      case 'add': {
        const a = pluginArgs(rest);
        const url = a._[0];
        if (!url) fail('Usage: worca marketplace add <repo-url|owner/repo|path>');
        const entry = await mkt.addMarketplace(url);
        out(`added marketplace ${entry.name}\t${entry.id}\t@ ${entry.lastSync.sha.slice(0, 7)}`);
        for (const p of entry.plugins) out(`  ${p.name}\t${p.version || (entry.lastSync ? entry.lastSync.sha.slice(0, 7) : '')}\t${p.description || ''}`);
        for (const w of entry.warnings) out(c('yellow', `  warning: ${w}`));
        out(`install with: worca plugin install <name>`);
        return 0;
      }
      case 'list': {
        const entries = mkt.listMarketplaces();
        if (!entries.length) {
          out('No marketplaces registered. Add one with `worca marketplace add <repo-url>`.');
          return 0;
        }
        for (const m of entries) {
          const sync = m.lastSync ? `${m.lastSync.sha.slice(0, 7)} (${m.plugins.length} plugins)` : 'never synced';
          out(`${m.name}\t${m.id}\t${m.url}\t${sync}${m.builtin ? '\tbuilt-in' : ''}`);
          for (const w of m.warnings || []) out(c('yellow', `  warning: ${w}`));
        }
        return 0;
      }
      case 'refresh': {
        const a = pluginArgs(rest);
        const entries = a._[0] ? [await mkt.syncMarketplace(a._[0])] : await mkt.refreshAllMarketplaces();
        for (const m of entries) {
          const sync = m.lastSync ? `${m.lastSync.sha.slice(0, 7)} (${m.plugins.length} plugins)` : 'never synced';
          out(`${m.name}\t${sync}`);
          for (const w of m.warnings || []) out(c('yellow', `  warning: ${w}`));
        }
        return 0;
      }
      case 'remove': {
        const a = pluginArgs(rest, [], ['--yes']);
        const id = a._[0];
        if (!id) fail('Usage: worca marketplace remove <id> [--yes]');
        if (!(await confirmPlugin(`Remove marketplace "${id}"? Installed plugins remain.`, !!a.yes))) {
          out('aborted');
          return 1;
        }
        mkt.removeMarketplace(id);
        out(`removed marketplace ${id} — installed plugins remain (managed via worca plugin …)`);
        return 0;
      }
      default:
        fail(`unknown marketplace verb "${verb}" — see: worca marketplace help`);
    }
  } catch (err) {
    const kind = err?.kind ? `[${err.kind}] ` : '';
    process.stderr.write(`worca marketplace ${verb}: ${kind}${err?.message || err}\n`);
    for (const ref of err?.references || []) {
      process.stderr.write(`  referenced by: ${typeof ref === 'string' ? ref : JSON.stringify(ref)}\n`);
    }
    return 1;
  }
}

// ── main ──────────────────────────────────────────────────────────────────────────

const SUBCOMMANDS = new Set(['add', 'list', 'remove', 'resume', 'doctor', 'plugin', 'marketplace', 'config']);

/** Levenshtein distance, two-row. Only ever called on short argv tokens. */
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/**
 * The subcommand a lone positional was probably meant to be, or null.
 *
 * A bare positional is a legal prompt (`worca "do the thing"`), so only a SINGLE
 * whitespace-free token that near-misses a real subcommand counts as a typo: edit
 * distance <= 2, or a strict prefix of at least 3 characters (`plug` -> `plugin`).
 * Refusing costs one retry with --prompt; running `worca reusme run-abc123` cuts a
 * worktree + feature branch and spends real tokens on a task named "reusme".
 */
function nearestSubcommand(token) {
  if (!token || /\s/.test(token)) return null;
  // 'help' and 'version' are spliced into both loops: they are real CLI arms (the
  // head of main() / the module top) but deliberately absent from the dispatch
  // table, so without them a typo of either (`worca hlep`, `worca versoin`) is
  // distance >= 3 from everything and runs as a PROMPT.
  for (const name of [...SUBCOMMANDS, 'help', 'version']) {
    if (token.length >= 3 && name.length > token.length && name.startsWith(token)) return name;
  }
  let best = null;
  let bestD = 3;   // strictly less than 3 == distance <= 2
  for (const name of [...SUBCOMMANDS, 'help', 'version']) {
    const d = editDistance(token, name);
    if (d < bestD) { bestD = d; best = name; }
  }
  return best;
}

async function main() {
  const sub = process.argv[2];
  // `worca help` is what every CLI user types first; it is not a subcommand and
  // not a near-miss of one, so without this line it became a PROMPT and ran a
  // pipeline named "help" (MIN-51).
  if (sub === 'help') { process.stdout.write(HELP); return 0; }
  if (SUBCOMMANDS.has(sub)) {
    const rest = process.argv.slice(3);
    if (sub === 'add') return cmdAdd(rest);
    if (sub === 'list') return cmdList();
    if (sub === 'remove') return cmdRemove(rest);
    if (sub === 'resume') return cmdResume(rest);
    if (sub === 'doctor') return cmdDoctor();
    if (sub === 'plugin') return cmdPlugin(rest);
    if (sub === 'marketplace') return cmdMarketplace(rest);
    if (sub === 'config') return cmdConfig(rest);
  }

  const flags = parseArgs(process.argv.slice(2));

  if (flags.help) {
    process.stdout.write(HELP);
    return 0;
  }

  if (flags.install) {
    // Forward --force (and any other extra tokens) to the installer.
    const passthrough = [];
    if (process.argv.includes('--force')) passthrough.push('--force');
    return runInstall(flags.install, passthrough);
  }

  if (flags.ui) {
    return launchUi();
  }

  if (flags.mock) {
    process.env.WORCA_MOCK = '1';
  }
  // The mock runner routes EVERY dontAsk spawn to the Ask Worca mock (claude-runner.mjs
  // runMock), which writes no pipeline artifact — a mock pipeline under dontAsk dies
  // at its first artifact read with no hint why. Refuse the PAIR, not the mode.
  if (flags.permissionMode === 'dontAsk' && /^(1|true|yes|on)$/i.test(String(process.env.WORCA_MOCK ?? process.env.ORCH_MOCK ?? ''))) {
    fail('--permission-mode dontAsk cannot be combined with --mock: the mock runner reserves it for the Ask Worca assistant.');
  }

  if (!flags.prompt && !flags.file) {
    // Allow a bare positional prompt: `worca "do the thing"`. A lone token that
    // near-misses a subcommand is a typo, not a task — refuse it here, before a
    // pipeline row, a worktree or a feature branch exists.
    if (flags._.length) {
      const meant = nearestSubcommand(flags._[0]);
      if (meant) {
        if (meant === flags._[0]) fail(`"${meant}" is a subcommand and must come first: worca ${meant} [args] (to run a prompt with that word, use --prompt "\u2026")`);
        fail(`unknown subcommand "${flags._[0]}" — did you mean "${meant}"? (to run a prompt, use --prompt "\u2026")`);
      }
      flags.prompt = flags._.join(' ');
    } else {
      fail('Provide a task with --prompt "<text>" or --file <markdown>. See --help.');
    }
  }

  const projectDir = resolve(flags.project);
  // A NAMED --file must be readable BEFORE anything starts. The readers used to
  // swallow the failure and run the whole pipeline on an empty prompt with exit 0
  // — in real mode that spends tokens and cuts a worktree + feature branch for
  // nothing. Relative paths resolve against the PROJECT dir, exactly as the
  // orchestrator's own read does.
  if (flags.file) {
    const { readPromptFile } = await import('../core/artifacts.mjs');
    try {
      await readPromptFile(projectDir, flags.file);
    } catch (err) {
      fail(err && err.message ? err.message : String(err));
    }
  }
  // Resolve extras against the shell cwd so relative paths are unambiguous.
  const extras = (flags.extras || []).map((p) => resolve(process.cwd(), p));

  // Never create a run that the orchestrator would immediately pause on the total
  // budget: refuse up front (mock runs included — WORCA_MOCK is already set above).
  const { budgetStatus } = await import('../core/cost-budget.mjs');
  const budget = budgetStatus();
  if (budget.blocked) {
    process.stderr.write(`worca: total cost limit reached: ${budgetRefusalDetail(budget)}. `
      + 'Raise it: worca config set totalCostLimitUsd <usd>\n');
    return 1;
  }

  // Validate --workflow before spawning anything: an unknown or archived template
  // must fail with one line, not a stack trace half-way through a run. The read row
  // doubles as createOrchestratorFor's routing hint (it skips a second row read).
  let row;
  if (flags.workflow) {
    const { assertRunnableWorkflow } = await import('../core/workflows.mjs');
    try { row = await assertRunnableWorkflow(flags.workflow); }
    catch (err) { fail(`${err && err.message ? err.message : String(err)}`); }
  }

  const orch = await createOrchestratorFor({
    projectDir,
    prompt: flags.prompt || undefined,
    promptFile: flags.file || undefined,
    title: flags.title || undefined,
    extras,
    workflowId: flags.workflow || undefined,
    template: row,
    branch: { source: flags.sourceBranch, feature: flags.featureBranch },
    claude: {
      permissionMode: flags.permissionMode,
      model: flags.model,
      mock: flags.mock,
    },
    auto: flags.auto,
  });

  out(c('bold', `orchestrator — project: ${projectDir}`));
  if (flags.mock) out(c('yellow', 'mock mode: no claude will be spawned'));

  return attachAndDrive(orch, flags, () => orch.run());
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    process.stderr.write(`worca: fatal: ${err?.stack || err?.message || err}\n`);
    process.exit(1);
  });
