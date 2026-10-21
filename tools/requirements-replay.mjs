#!/usr/bin/env node
// tools/requirements-replay.mjs
// Measures what the requirements interview costs (A1.1): replays a fixed interview against the real
// model, call by call, and reports tokens, cost (prompt side vs output side), latency and what Claude
// Code loaded around the prompt. The calls are built through the same `interviewCallOptions` the
// interview uses, so what is measured is what the interview sends.
//
//   node tools/requirements-replay.mjs [--fixture <file>] [--rounds N] [--look <dir>] [--model <id>]
//                                      [--effort <level>] [--max-usd <n>] [--no-cache] [--label <text>]
//                                      [--variant system-stable] [--out <file.json>] [--yes]
//   node tools/requirements-replay.mjs --compare <a.json> <b.json>
//
// Without --yes it is a dry run: it prints the calls it would make (prompt sizes) and sends nothing.
// With --yes it calls the model, one call after another, and THIS COSTS MONEY; it stops before a call
// once the cost so far reaches --max-usd (default 1.50). It refuses to run with WORCA_MOCK / ORCH_MOCK
// set: a mock measures nothing.
// --rounds   rounds to replay, 1 to 6 (default 4)         --look <dir>  also replay the code look in <dir>
// --model    model id (default: the interview's model)    --effort      effort level (default: the interview's)
// --no-cache set DISABLE_PROMPT_CACHING for each call     --out         write the report as JSON
// --variant system-stable  the measured variant of design D7, not shipped: each round's stable blocks go
//            at the end of the system prompt and only the changing part is the prompt (the look is unchanged)
// --compare  offline: per-call and total differences between two reports; spawns nothing.
// Like the interview, the calls keep the user's Claude settings when they carry sign-in (userClaudeSignIn);
// the report records it as keptUserSettings.
// Exit: 0 done; 1 a call failed or the budget stopped the replay; 2 usage or input error.

import { realpathSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';

import { runClaudeAdapter, DEFAULT_BIN } from '../src/core/engines/claude.mjs';
import { normalizingOnEvent } from '../src/core/engines/claude-events.mjs';
import { resolveModelCost } from '../src/core/config.mjs';
import { safeParseJson } from '../src/core/protocol.mjs';
import { REPO_LOOK_TIMEOUT_MS } from '../src/core/auto/classify.mjs';
import { MAX_ROUNDS, emptySpec } from '../src/core/requirements/spec.mjs';
import { buildRoundPrompt, roundPromptParts, buildOrientationPrompt, applyRound, ROUND_SYSTEM_PROMPT } from '../src/core/requirements/round.mjs';
import { interviewCallOptions, interviewModel, DEFAULT_INTERVIEW_EFFORT, userClaudeSignIn, ROUND_TIMEOUT_MS } from '../src/core/requirements/interview.mjs';

export const USAGE = 'usage: node tools/requirements-replay.mjs [--fixture <file>] [--rounds N] [--look <dir>] [--model <id>] '
  + '[--effort <level>] [--max-usd <n>] [--no-cache] [--label <text>] [--variant system-stable] [--out <file.json>] [--yes]\n'
  + '       node tools/requirements-replay.mjs --compare <a.json> <b.json>';
const DEFAULT_FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'requirements-replay.fixture.json');
const DEFAULT_ROUNDS = 4;
const DEFAULT_MAX_USD = 1.5;
const DRY_NOTE = 'Dry run: nothing was sent. Add --yes to call the model (this costs money).';
const VARIANTS = new Set(['system-stable']);

class InputError extends Error {}

const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== undefined && v !== '' ? Number(v) : 0);
const round6 = (n) => (Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : n);

/** Reads and checks a replay fixture (tools/requirements-replay.fixture.json shape). */
export function loadFixture(path) {
  let fx;
  try { fx = JSON.parse(readFileSync(path, 'utf8')); } catch (err) { throw new InputError(`cannot read fixture ${path}: ${err.message}`); }
  if (!fx || fx.version !== 1) throw new InputError('the fixture must be a version 1 document');
  if (!fx.feature || typeof fx.feature.title !== 'string') throw new InputError('the fixture needs a feature with a title');
  if (!Array.isArray(fx.rounds) || !fx.rounds.length) throw new InputError('the fixture needs at least one round');
  return fx;
}

/**
 * The calls of a replay, in order: the look first (when `lookDir` is given), then rounds 1..N. Each call:
 * { kind, round, options, timeoutMs, check } where `check` is what a reply is judged against.
 * `variant` 'system-stable' moves each round's stable blocks into the system prompt (the look is unchanged);
 * `keepUserSettings` is the interview's sign-in exception (userClaudeSignIn).
 */
export function replayPlan(fixture, { rounds = DEFAULT_ROUNDS, lookDir = null, roundCwd, model, effort = DEFAULT_INTERVIEW_EFFORT, variant = null, keepUserSettings = false } = {}) {
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > MAX_ROUNDS) throw new InputError(`--rounds must be 1 to ${MAX_ROUNDS}`);
  if (variant !== null && !VARIANTS.has(variant)) throw new InputError(`unknown --variant ${variant}; known: ${[...VARIANTS].join(', ')}`);
  const how = { keepUserSettings };
  // Round k reads the answers of fixture rounds 1..k-1, so N rounds need N-1 fixture rounds.
  if (rounds > fixture.rounds.length + 1) throw new InputError(`the fixture supports at most ${fixture.rounds.length + 1} rounds, not ${rounds}`);
  const calls = [];
  const context = fixture.context || '';
  if (lookDir) {
    const prompt = buildOrientationPrompt({ feature: fixture.feature, context, cwd: lookDir });
    calls.push({ kind: 'look', round: null, timeoutMs: REPO_LOOK_TIMEOUT_MS, check: { kind: 'look' },
      options: interviewCallOptions('look', { cwd: lookDir, prompt, model, effort }, how) });
  }
  for (let k = 1; k <= rounds; k += 1) {
    const prev = k === 1 ? null : fixture.rounds[k - 2];
    const spec = prev ? prev.specAfter : emptySpec();
    const feature = { ...fixture.feature, orientation: { summary: fixture.orientation }, spec, rounds: k - 1 };
    const turns = [];
    for (let j = 0; j < k - 1; j += 1) {
      turns.push({ id: 2 * j, kind: 'round', payload: { questions: fixture.rounds[j].questions } });
      turns.push({ id: 2 * j + 1, kind: 'answers', payload: { roundTurnId: 2 * j, answers: fixture.rounds[j].answers } });
    }
    const final = k >= MAX_ROUNDS;
    const args = { feature, context, turns, final, round: k };
    let callArgs = { cwd: roundCwd, prompt: buildRoundPrompt(args), model, effort };
    if (variant === 'system-stable') {
      const parts = roundPromptParts(args);
      callArgs = { ...callArgs, prompt: parts.changing, systemPrompt: `${ROUND_SYSTEM_PROMPT}\n\n${parts.stable}` };
    }
    calls.push({ kind: 'round', round: k, timeoutMs: ROUND_TIMEOUT_MS,
      check: { kind: 'round', spec, criteriaSeq: prev ? prev.criteriaSeq : 0, assumptionSeq: prev ? prev.assumptionSeq : 0, final },
      options: interviewCallOptions('round', callArgs, how) });
  }
  return calls;
}

/**
 * Splits a call's cost into the prompt side and the output side, weighting tokens by Claude's price ratios:
 * input 1, 5-minute cache writes 1.25, 1-hour cache writes 2, cache reads 0.1, output 5 (src/core/ask/events.mjs).
 */
export function splitCost(costUsd, usage) {
  const u = usage && typeof usage === 'object' ? usage : {};
  const cc = u.cache_creation && typeof u.cache_creation === 'object' ? u.cache_creation : null;
  const w1h = num(cc?.ephemeral_1h_input_tokens);
  const w5m = cc && cc.ephemeral_5m_input_tokens != null ? num(cc.ephemeral_5m_input_tokens) : Math.max(0, num(u.cache_creation_input_tokens) - w1h);
  const P = num(u.input_tokens) + 1.25 * w5m + 2 * w1h + 0.1 * num(u.cache_read_input_tokens);
  const O = 5 * num(u.output_tokens);
  if (!Number.isFinite(costUsd)) return { promptCostUsd: null, outputCostUsd: null };
  if (P + O === 0) return { promptCostUsd: 0, outputCostUsd: 0 };
  const promptCostUsd = costUsd * P / (P + O);
  return { promptCostUsd, outputCostUsd: costUsd - promptCostUsd };
}

const countOf = (v) => (Array.isArray(v) ? v.length : 0);

const emptyRecord = (call) => ({
  kind: call.kind, round: call.round ?? null, ok: false, error: null, skipped: null,
  costUsd: null, promptCostUsd: null, outputCostUsd: null,
  inputTokens: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0,
  durationMs: null, wallMs: null, numTurns: null, models: [], loaded: null, systemPromptFlag: null, replyReadable: false,
});

/** Runs one call through `spawn` and returns its record. A failed call is a record with ok: false, never a throw. */
export async function measureCall(spawn, call, { timeoutMs = call.timeoutMs, noCache = false } = {}) {
  const { options, check } = call;
  const rec = emptyRecord(call);
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  let result = null;
  let init = null;
  let argv = null;
  const normalized = normalizingOnEvent((e) => { if (e.type === 'result') result = e; });
  const onEvent = (e) => {
    try {
      if (e && e.type === 'stderr' && typeof e.text === 'string' && e.text.includes('spawn-debug:')) {
        const m = /argv=(\[.*?\]) promptViaStdin=/s.exec(e.text);
        if (m) { try { argv = JSON.parse(m[1]); } catch { /* keep null */ } }
      }
      const raw = e && e.raw;
      if (raw && typeof raw === 'object' && raw.type === 'system' && raw.subtype === 'init') init = raw;
      normalized(e);
    } catch { /* a malformed frame must not fail the call */ }
  };
  const t0 = Date.now();
  let text = '';
  try {
    const res = await spawn({
      ...options, bin: DEFAULT_BIN, signal: ctrl.signal, onEvent,
      ...(noCache ? { spawnEnv: { DISABLE_PROMPT_CACHING: '1' } } : {}),
    });
    text = res?.text || result?.text || '';
    rec.ok = !!result && !result.isError;
    if (!result) rec.error = 'no result';
    else if (!rec.ok) rec.error = text || 'the model returned an error';
  } catch (err) {
    rec.error = timedOut ? `no reply within ${Math.round(timeoutMs / 1000)} seconds` : (err && err.message ? err.message : String(err));
  } finally { clearTimeout(timer); }
  rec.wallMs = Date.now() - t0;

  if (result) {
    const usage = result.usage || null;
    const cli = Number(result.costUsd);
    const priced = resolveModelCost(options.model, cli, usage);
    rec.costUsd = Number.isFinite(priced) ? priced : (Number.isFinite(cli) ? cli : null);
    const u = usage || {};
    const cc = u.cache_creation && typeof u.cache_creation === 'object' ? u.cache_creation : {};
    rec.inputTokens = num(u.input_tokens);
    rec.cacheWrite5m = num(cc.ephemeral_5m_input_tokens);
    rec.cacheWrite1h = num(cc.ephemeral_1h_input_tokens);
    rec.cacheWriteTokens = u.cache_creation_input_tokens != null ? num(u.cache_creation_input_tokens) : rec.cacheWrite5m + rec.cacheWrite1h;
    rec.cacheReadTokens = num(u.cache_read_input_tokens);
    rec.outputTokens = num(u.output_tokens);
    rec.durationMs = result.durationMs ?? null;
    rec.numTurns = result.numTurns ?? null;
    rec.models = result.modelUsage && typeof result.modelUsage === 'object' ? Object.keys(result.modelUsage) : [];
    if (rec.costUsd != null) {
      const s = splitCost(rec.costUsd, usage);
      rec.promptCostUsd = s.promptCostUsd;
      rec.outputCostUsd = s.outputCostUsd;
    }
  }
  if (init) {
    rec.loaded = {
      apiKeySource: typeof init.apiKeySource === 'string' ? init.apiKeySource : null,
      tools: countOf(init.tools), plugins: countOf(init.plugins), skills: countOf(init.skills),
      slashCommands: countOf(init.slash_commands), mcpServers: countOf(init.mcp_servers),
    };
  }
  if (Array.isArray(argv)) {
    if (argv.some((a) => a === '--system-prompt' || a === '--system-prompt-file')) rec.systemPromptFlag = 'replace';
    else if (argv.some((a) => typeof a === 'string' && a.startsWith('--append-system-prompt'))) rec.systemPromptFlag = 'append';
  }
  if (rec.ok) {
    try {
      if (check.kind === 'look') {
        const parsed = safeParseJson(text);
        rec.replyReadable = !!parsed && typeof parsed.summary === 'string';
      } else {
        applyRound(check.spec, safeParseJson(text), { criteriaSeq: check.criteriaSeq, assumptionSeq: check.assumptionSeq, final: check.final });
        rec.replyReadable = true;
      }
    } catch { rec.replyReadable = false; }
  }
  return rec;
}

const sum = (rs, k) => round6(rs.reduce((n, r) => n + (Number.isFinite(r[k]) ? r[k] : 0), 0));

/** Totals over the records of a replay. */
export function summarize(records) {
  return {
    costUsd: sum(records, 'costUsd'),
    promptCostUsd: sum(records, 'promptCostUsd'),
    outputCostUsd: sum(records, 'outputCostUsd'),
    promptCostRounds2toN: sum(records.filter((r) => r.kind === 'round' && r.round >= 2), 'promptCostUsd'),
    inputTokens: sum(records, 'inputTokens'),
    cacheWriteTokens: sum(records, 'cacheWriteTokens'),
    cacheReadTokens: sum(records, 'cacheReadTokens'),
    outputTokens: sum(records, 'outputTokens'),
    wallMs: sum(records, 'wallMs'),
  };
}

/** The median wall time of the rounds that ran (null when none). */
export function medianRoundMs(records) {
  const t = records.filter((r) => r.kind === 'round' && !r.skipped && Number.isFinite(r.wallMs)).map((r) => r.wallMs).sort((a, b) => a - b);
  if (!t.length) return null;
  const m = t.length >> 1;
  return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2;
}

const CALL_METRICS = ['costUsd', 'promptCostUsd', 'outputCostUsd', 'cacheWriteTokens', 'cacheReadTokens', 'outputTokens', 'wallMs'];
const delta = (a, b) => {
  const x = Number.isFinite(a) ? a : null;
  const y = Number.isFinite(b) ? b : null;
  if (x === null || y === null) return { a: x, b: y, delta: null, pct: null };
  return { a: x, b: y, delta: round6(y - x), pct: x === 0 ? null : round6(((y - x) / x) * 100) };
};

/** Per call (matched by kind + round) and total differences between two reports: b - a, and the percent of a. */
export function compareReports(a, b) {
  const key = (r) => `${r.kind}:${r.round ?? ''}`;
  const bBy = new Map((b.calls || []).map((r) => [key(r), r]));
  const calls = [];
  for (const ra of a.calls || []) {
    const rb = bBy.get(key(ra));
    if (!rb) continue;
    calls.push({ kind: ra.kind, round: ra.round ?? null,
      metrics: Object.fromEntries(CALL_METRICS.map((m) => [m, delta(ra[m], rb[m])])) });
  }
  const ta = a.totals || {};
  const tb = b.totals || {};
  const totals = Object.fromEntries(Object.keys({ ...ta, ...tb }).map((m) => [m, delta(ta[m], tb[m])]));
  return { calls, totals };
}

const fmt = (v, d = 4) => (v === null || v === undefined ? '-' : (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(d)) : String(v)));
const pad = (s, n) => String(s).padEnd(n);

function formatReport(records, totals, medianMs) {
  const head = ['call', 'ok', 'cost$', 'prompt$', 'output$', 'in', 'cacheW', 'cacheR', 'out', 'wall s', 'turns', 'sys', 'readable'];
  const rows = records.map((r) => [
    r.kind === 'look' ? 'look' : `round ${r.round}`, r.skipped ? `skip:${r.skipped}` : (r.ok ? 'yes' : 'NO'),
    fmt(r.costUsd), fmt(r.promptCostUsd), fmt(r.outputCostUsd), r.inputTokens, r.cacheWriteTokens, r.cacheReadTokens, r.outputTokens,
    r.wallMs == null ? '-' : (r.wallMs / 1000).toFixed(1), fmt(r.numTurns), r.systemPromptFlag || '-', r.replyReadable ? 'yes' : 'no',
  ].map(String));
  rows.push(['TOTAL', '', fmt(totals.costUsd), fmt(totals.promptCostUsd), fmt(totals.outputCostUsd), totals.inputTokens,
    totals.cacheWriteTokens, totals.cacheReadTokens, totals.outputTokens, (totals.wallMs / 1000).toFixed(1), '', '', ''].map(String));
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r) => r.map((c, i) => pad(c, w[i])).join('  ').trimEnd();
  return [line(head), ...rows.map(line),
    `Prompt-side cost of rounds 2..N: $${fmt(totals.promptCostRounds2toN)}`,
    `Median round latency: ${medianMs == null ? '-' : `${(medianMs / 1000).toFixed(1)} s`}`].join('\n');
}

function formatCompare(cmp) {
  const cell = (d, digits) => `${fmt(d.a, digits)} -> ${fmt(d.b, digits)} (${d.delta == null ? '-' : (d.delta >= 0 ? '+' : '') + fmt(d.delta, digits)}, ${d.pct == null ? '-' : `${d.pct >= 0 ? '+' : ''}${d.pct.toFixed(1)}%`})`;
  const out = [];
  for (const c of cmp.calls) {
    out.push(`${c.kind === 'look' ? 'look' : `round ${c.round}`}`);
    for (const m of CALL_METRICS) out.push(`  ${pad(m, 18)}${cell(c.metrics[m], 4)}`);
  }
  out.push('TOTALS');
  for (const [m, d] of Object.entries(cmp.totals)) out.push(`  ${pad(m, 22)}${cell(d, 4)}`);
  return out.join('\n');
}

function best(cmd, args) {
  try {
    const win = process.platform === 'win32';   // claude is a .cmd shim there; a bare git is fine either way
    const r = win ? spawnSync([cmd, ...args].join(' '), { encoding: 'utf8', timeout: 10_000, windowsHide: true, shell: true })
      : spawnSync(cmd, args, { encoding: 'utf8', timeout: 10_000 });
    return r.status === 0 ? String(r.stdout).trim() || null : null;
  } catch { return null; }
}

export async function main(argv, {
  spawn = runClaudeAdapter, log = console.log, env = process.env, resolveModel = interviewModel,
  userSignIn = () => userClaudeSignIn({ env }),
} = {}) {
  // First of all: a mock measures nothing, and nothing may run (not even the dry run) under one.
  if (env.WORCA_MOCK || env.ORCH_MOCK) {
    log('the replay measures the real model; unset WORCA_MOCK');
    return 2;
  }
  let args;
  try {
    args = parseArgs({ args: argv, allowPositionals: true, options: {
      fixture: { type: 'string' }, rounds: { type: 'string' }, look: { type: 'string' }, model: { type: 'string' },
      effort: { type: 'string' }, 'max-usd': { type: 'string' }, 'no-cache': { type: 'boolean' }, label: { type: 'string' },
      out: { type: 'string' }, yes: { type: 'boolean' }, compare: { type: 'boolean' }, help: { type: 'boolean' },
      variant: { type: 'string' },
    } });
  } catch (err) { log(`${err.message}\n${USAGE}`); return 2; }
  const { values: v, positionals } = args;
  try {
    if (v.help) { log(USAGE); return 0; }
    if (v.compare) {
      if (positionals.length !== 2) throw new InputError('--compare needs two report files');
      const read = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch (err) { throw new InputError(`cannot read report ${p}: ${err.message}`); } };
      log(formatCompare(compareReports(read(positionals[0]), read(positionals[1]))));
      return 0;
    }
    if (positionals.length) throw new InputError(`unexpected argument ${positionals[0]}`);
    const rounds = v.rounds === undefined ? DEFAULT_ROUNDS : Number(v.rounds);
    if (!Number.isInteger(rounds) || rounds < 1 || rounds > MAX_ROUNDS) throw new InputError(`--rounds must be a whole number from 1 to ${MAX_ROUNDS}`);
    const maxUsd = v['max-usd'] === undefined ? DEFAULT_MAX_USD : Number(v['max-usd']);
    if (!(maxUsd > 0)) throw new InputError('--max-usd must be a positive number');
    const fixturePath = v.fixture || DEFAULT_FIXTURE;
    const fixture = loadFixture(fixturePath);
    const resolved = v.model ? null : await resolveModel();
    const model = v.model || (resolved && resolved.model) || undefined;
    // With --model alone the effort is the default, not production's model-only rule (no effort): deliberately, so before/after runs compare like for like.
    const effort = v.effort || (v.model ? DEFAULT_INTERVIEW_EFFORT : (resolved && resolved.effort) || null);   // null: the interview sends no effort
    if (v.yes && !model) throw new InputError('no model could be resolved; pass --model <id> so before and after runs measure the same model');
    const roundCwd = join(tmpdir(), 'worca-req-replay');
    mkdirSync(roundCwd, { recursive: true });
    const variant = v.variant === undefined ? null : v.variant;
    const keepUserSettings = !!userSignIn();
    const plan = replayPlan(fixture, { rounds, lookDir: v.look || null, roundCwd, model, effort, variant, keepUserSettings });

    if (!v.yes) {
      for (const c of plan) {
        const sys = String(c.options.systemPrompt || '').length;
        const pr = c.options.prompt.length;
        log(`${pad(c.kind === 'look' ? 'look' : `round ${c.round}`, 8)} system prompt ${sys} chars, prompt ${pr} chars, ~${Math.round((sys + pr) / 4)} tokens`);
      }
      log(DRY_NOTE);
      return 0;
    }

    const prevDebug = process.env.WORCA_DEBUG_SPAWN;
    process.env.WORCA_DEBUG_SPAWN = '1';
    const records = [];
    let spent = 0;
    let stopped = false;
    try {
      for (const c of plan) {
        if (stopped || spent >= maxUsd) {
          stopped = true;
          records.push({ ...emptyRecord(c), skipped: 'max-usd' });
          continue;
        }
        const rec = await measureCall(spawn, c, { timeoutMs: c.timeoutMs, noCache: !!v['no-cache'] });
        records.push(rec);
        // An unknown cost (a failed call, no result frame) counts as 0, so the cap can undercount; the
        // per-call timeout and the cap's check before every call bound what one unknown can add.
        if (Number.isFinite(rec.costUsd)) spent += rec.costUsd;
      }
    } finally {
      if (prevDebug === undefined) delete process.env.WORCA_DEBUG_SPAWN; else process.env.WORCA_DEBUG_SPAWN = prevDebug;
    }
    const totals = summarize(records);
    log(formatReport(records, totals, medianRoundMs(records)));
    if (stopped) log(`Stopped: the cost so far reached --max-usd ${maxUsd}; the remaining calls were skipped.`);
    if (v.out) {
      const report = {
        version: 1, label: v.label || null, at: new Date().toISOString(),
        commit: best('git', ['rev-parse', '--short', 'HEAD']), cli: best(DEFAULT_BIN, ['--version']),
        model: model || null, effort, variant, keptUserSettings: keepUserSettings, noCache: !!v['no-cache'], fixture: basename(fixturePath), rounds,
        calls: records, totals,
      };
      writeFileSync(v.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      log(`Report written to ${v.out}`);
    }
    return records.some((r) => !r.ok) ? 1 : 0;
  } catch (err) {
    if (err instanceof InputError) { log(`${err.message}\n${USAGE}`); return 2; }
    throw err;
  }
}

const isMain = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => { console.error(err); process.exitCode = 2; });
