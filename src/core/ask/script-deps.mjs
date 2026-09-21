// src/core/ask/script-deps.mjs
// The WRITE-CAPABLE dep bundle of the chat's script tools (scripts-workbench-design.md §9.1,
// W7/W19/W20). Deliberately separate from tool-deps.mjs, whose source is scanned as read-only:
// every script file the chat writes and every bench child it starts is reachable ONLY through
// here, and test/ask-script-tools.test.mjs pins this module's import surface. One namespaced
// sub-object, exactly like worktree-deps.mjs / comment-deps.mjs / memory-deps.mjs.
//
// Everything writes through src/core/script-store.mjs (meta validation, layer rules, atomic
// writes, createdBy/updatedBy stamps) and runs through src/core/script-bench.mjs#runBenchOnce —
// the ONE bench engine the Scripts page and the CLI use — so "the chat saved it" and "the page
// saved it" cannot drift. W19: the user layer only, no delete, an existing key needs
// overwrite: true. Refusals are RETURNED, never thrown, so the model corrects itself.
import { join } from 'node:path';
import {
  listScripts, readScript, createScript, updateScript, writeCases, userScriptsDir,
} from '../script-store.mjs';
import { runBenchOnce } from '../script-bench.mjs';
import { normalizeCases } from '../../shared/graph/script-cases.mjs';
import { DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS } from '../../shared/graph/script-meta.mjs';
import { probePython } from '../graph/python-probe.mjs';
import { chatPrefs } from '../settings.mjs';
import { ASK_LIMITS } from './limits.mjs';

/** Every sentence the model can act on. Unprefixed: they ride inside an `errors` array
 *  (the PROPOSAL_ERRORS shape), never as a thrown tool error. */
export const SCRIPT_ERRORS = Object.freeze({
  keyRequired: 'key is required',
  metaRequired: 'meta is required: a script meta v2 object with displayName, description, runtime and ports',
  sourceRequired: 'source is required: the program text',
  casesType: 'cases must be an array of case objects',
  turnEnded: 'the chat turn ended before the script ran',
  exists: (key) => `script "${key}" exists — pass overwrite: true to replace it`,
  builtin: (key) => `script "${key}" is a built-in — save your version under a new key instead`,
  plugin: (key, plugin) => `script "${key}" is shipped by plugin "${plugin}" — save your version under a new key instead`,
  notFound: (key) => `no script "${key}" — use list_scripts`,
  caseNotFound: (key, caseId) => `no case "${caseId}" on script "${key}" — get_script lists its saved cases`,
  caseProject: (caseId, projectKey) => `case "${caseId}" runs in project "${projectKey}", which is not the project pinned for this chat — pin it, or run the case's inputs without caseId`,
  caseTimeout: (caseId, sec, max) => `case "${caseId}" would run for up to ${sec} s (its own or the script's timeoutMs) — test_script allows ${max}; lower that timeoutMs or run the case's inputs without caseId`,
  inputShape: (port) => `bench input "${port}" must be { text } (an md or json port) or { fired: true } (a void port)`,
});

/** W20: absent means on — only an explicit false switches the write tools off. An unreadable
 *  settings file is "on", like every other pref reader here. */
export function scriptToolsEnabled() {
  try { return chatPrefs().scriptTools !== false; } catch { return true; }
}

export const SCRIPT_RUNTIMES_BASE = Object.freeze(['node', 'shell']);

/**
 * The runtimes the prompt may name. python joins only when P2's probe finds an interpreter
 * (spec §7). The probe is called BARE on purpose: probePython() caches its bare call for
 * 60 s per process, while any option at all bypasses the cache and would spawn python on
 * every chat turn. A probe that throws or answers { ok: false } means node + shell.
 */
export async function scriptHostRuntimes({ probe = probePython } = {}) {
  try {
    const r = await probe();
    return r && r.ok ? [...SCRIPT_RUNTIMES_BASE, 'python'] : [...SCRIPT_RUNTIMES_BASE];
  } catch { return [...SCRIPT_RUNTIMES_BASE]; }
}

/** What prompt.mjs needs for its "Scripts you can create" section, or null when W20 is off. */
export async function askScriptPromptInput({ enabled = scriptToolsEnabled(), runtimes = null } = {}) {
  if (!enabled) return null;
  return { runtimes: runtimes ?? await scriptHostRuntimes() };
}

// The store speaks agent-store's coded vocabulary and the bench answers NOT_FOUND / BAD_REQUEST /
// BUSY (its 2-global, 1-per-key cap). BAD_REQUEST carries the validator's sentences joined with
// '; ', which is exactly the list the model needs to fix its meta. Anything uncoded is a real
// failure (an unwritable home, a broken disk) and is re-thrown: the MCP child logs it and answers
// isError, rather than asking the model to fix a filesystem.
const REFUSAL_CODES = new Set(['BAD_REQUEST', 'BUILTIN', 'PLUGIN', 'DUPLICATE', 'NOT_FOUND', 'REFERENCED', 'BUSY']);
function refusal(err) {
  const code = err && typeof err.code === 'string' ? err.code : '';
  if (!REFUSAL_CODES.has(code)) throw err;
  const parts = String(err.message ?? '').split('; ').map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : ['the script store refused the write'];
}

// Host paths are this machine's business (the readRunMemory rule), and the registry's computed
// fields (portSummary, caseCount, the resolved command) are not part of a sidecar: the model
// gets the meta it could write back, plus `origin`, and the #scripts/<key> link from the tool.
const COMPUTED_META = new Set(['scriptPath', 'scriptsDir', 'commandResolved', 'caseCount', 'sourcePath', 'portSummary', 'frontmatter']);
const publicMeta = (m) => Object.fromEntries(Object.entries(m).filter(([k]) => !COMPUTED_META.has(k)));

/** The first `maxBytes` bytes, never cut inside a UTF-8 sequence. */
function clipHead(text, maxBytes) {
  const s = String(text ?? '');
  const buf = Buffer.from(s, 'utf8');
  if (buf.length <= maxBytes) return { text: s, truncated: false };
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1;
  return { text: buf.subarray(0, end).toString('utf8'), truncated: true };
}

/** The last N lines, then the last maxBytes of those: a test log fails at its END. */
function tailLines(lines, L) {
  const all = (Array.isArray(lines) ? lines : []).map((x) => String(x ?? ''));
  const kept = all.slice(-L.scriptLogMaxLines);
  let text = kept.join('\n');
  let truncated = kept.length < all.length;
  const buf = Buffer.from(text, 'utf8');
  if (buf.length > L.scriptLogMaxBytes) {
    let start = buf.length - L.scriptLogMaxBytes;
    while (start < buf.length && (buf[start] & 0xc0) === 0x80) start += 1;
    text = buf.subarray(start).toString('utf8');
    truncated = true;
  }
  return { text, lines: kept.length, truncated };
}

/** Sentences, not text bodies: a character clip, with a visible mark. */
function clipChars(s, L) {
  const t = String(s ?? '');
  return t.length > L.scriptResultFieldMaxChars ? `${t.slice(0, L.scriptResultFieldMaxChars)}…` : t;
}

/**
 * The verdict a model reads. The runner's normalizeReview caps NOTHING (a program returning
 * 3 000 issues of 1 KB came back as a 3.2 MB tool result): at most N issues, each of the four
 * fields clipped, the real count on `issueCount`, `truncated` when anything was dropped.
 */
function trimVerdict(v, L) {
  const all = Array.isArray(v.issues) ? v.issues : [];
  let cut = all.length > L.scriptVerdictMaxIssues;
  const clip = (s) => { const t = clipChars(s, L); if (t !== String(s ?? '')) cut = true; return t; };
  const issues = all.slice(0, L.scriptVerdictMaxIssues).map((i) => (i && typeof i === 'object'
    ? { severity: i.severity == null ? null : String(i.severity), title: clip(i.title), detail: clip(i.detail), location: clip(i.location) }
    : { severity: null, title: clip(i), detail: '', location: '' }));
  const out = { summary: v.summary == null ? null : clip(v.summary), issues, issueCount: all.length };
  if (cut) out.truncated = true;
  return out;
}

/**
 * The engine's evaluateExpect is satisfied by `{ fired: [] }` on a run that never FINISHED (probed:
 * a 1 s case on a 5 s sleeper answers status 'timeout' AND expect.pass true). The CLI (P3) makes a
 * stopped case fail; the chat says the same, with the reason first in `diffs`, so the model never
 * reads "pass" beside a timeout, a stop or an execution error.
 */
function trimExpect(r, L) {
  if (!r.expect || typeof r.expect !== 'object') return null;
  const diffs = (Array.isArray(r.expect.diffs) ? r.expect.diffs : []).slice(0, L.scriptVerdictMaxIssues).map((d) => clipChars(d, L));
  if (r.status === 'clean' || r.status === 'blocking') return { pass: r.expect.pass === true, diffs };
  return { pass: false, diffs: [`the run ended ${typeof r.status === 'string' ? r.status : 'unfinished'} — a case passes only when its run finishes`, ...diffs] };
}

/**
 * The §4.1 bench result → what a model should read (§9.1): the log tail, capped outputs, a
 * capped verdict, and not one host path. Pure; the caller supplies the lines it collected
 * through `onLine`.
 */
export function trimBenchResult(result, logLines = [], L = ASK_LIMITS) {
  const r = result && typeof result === 'object' ? result : {};
  const outputs = {};
  for (const [port, o] of Object.entries(r.outputs && typeof r.outputs === 'object' ? r.outputs : {})) {
    if (!o || typeof o !== 'object') continue;
    if (o.type === 'void') { outputs[port] = { type: 'void' }; continue; }
    const cut = clipHead(o.text, L.scriptOutputMaxBytes);
    outputs[port] = {
      type: o.type ?? null,
      bytes: Number.isFinite(o.bytes) ? o.bytes : Buffer.byteLength(String(o.text ?? ''), 'utf8'),
      text: cut.text,
      truncated: cut.truncated || o.truncated === true,
    };
  }
  return {
    status: typeof r.status === 'string' ? r.status : null,
    exitCode: Number.isFinite(r.exitCode) ? r.exitCode : null,
    runtime: r.runtime ?? null,
    durationMs: Number.isFinite(r.durationMs) ? r.durationMs : null,
    summary: r.summary == null ? null : String(r.summary),
    warnings: (Array.isArray(r.warnings) ? r.warnings : []).slice(0, L.scriptVerdictMaxIssues).map((w) => clipChars(w, L)),
    fired: Array.isArray(r.fired) ? [...r.fired] : [],
    outputs,
    verdict: r.verdict && typeof r.verdict === 'object' ? trimVerdict(r.verdict, L) : null,
    expect: trimExpect(r, L),
    error: r.error && typeof r.error === 'object'
      ? { message: clipChars(r.error.message, L), tail: (Array.isArray(r.error.tail) ? r.error.tail : []).slice(-L.scriptVerdictMaxIssues).map((t) => clipChars(t, L)) }
      : null,
    draft: r.draft === true,
    log: tailLines(logLines, L),
  };
}

/** The file the model can open: the program file when the meta names one, else the sidecar. */
function savedPath(io, key, saved) {
  const f = saved && saved.meta ? saved.meta.file : null;
  const base = typeof f === 'string' ? f : (f && typeof f === 'object' ? f.default : null);
  const dir = io.userScriptsDir();
  const name = base || `${key}.meta.json`;
  return dir ? join(dir, name) : name;
}

// The real readers/writers, in ONE object so a test can swap them whole (the createCatalog seam).
const REAL_IO = Object.freeze({
  listScripts, readScript, createScript, updateScript, writeCases, userScriptsDir,
  runBenchOnce, normalizeCases, enabled: scriptToolsEnabled,
});

/**
 * @param {{threadId: string, signal?: AbortSignal|null, io?: object}} opts
 *   every write is stamped `ask:<threadId>` (W19); `signal` is the MCP child's life signal —
 *   when the turn ends or is stopped, the live bench is stopped with it.
 */
export function defaultScriptDeps({ threadId, signal = null, io = REAL_IO } = {}) {
  const by = `ask:${threadId || 'unknown'}`;
  return {
    scripts: {
      // Read once per bundle = once per MCP child = once per turn: a Settings change lands on
      // the next turn, which is what every other Ask pref does.
      enabled: io.enabled() === true,

      async list() {
        const rows = await io.listScripts();
        return (Array.isArray(rows) ? rows : []).slice(0, ASK_LIMITS.scriptListMaxRows).map((m) => ({
          key: m.key,
          displayName: m.displayName ?? m.key,
          description: m.description ?? '',
          origin: m.origin ?? null,
          runtime: m.runtime ?? null,
          portLine: m.ports === 'config' ? 'ports per card' : String(m.portSummary ?? ''),
          caseCount: Number.isFinite(m.caseCount) ? m.caseCount : 0,
          writable: m.origin === 'user',
        }));
      },

      async read(key) {
        if (typeof key !== 'string' || !key.trim()) return null;
        const r = await io.readScript(key);
        if (!r || !r.meta) return null;
        const m = r.meta;
        return {
          key: m.key ?? key,
          origin: m.origin ?? null,
          runtime: m.runtime ?? null,
          writable: m.origin === 'user',
          meta: publicMeta(m),
          source: typeof r.source === 'string' ? r.source : '',
          // The store answers '' for "no Windows variant"; the model reads null.
          sourceWin32: typeof r.sourceWin32 === 'string' && r.sourceWin32 ? r.sourceWin32 : null,
          sourceTruncated: r.sourceTruncated === true,
          cases: Array.isArray(r.cases) ? r.cases : [],
          userCases: Array.isArray(r.userCases) ? r.userCases : [],
        };
      },

      /** Create or replace a USER-layer script (W19). Every refusal is a return value. */
      async save({ key, meta, source, sourceWin32 = null, cases = null, overwrite = false } = {}) {
        const errors = [];
        if (typeof key !== 'string' || !key.trim()) errors.push(SCRIPT_ERRORS.keyRequired);
        if (!meta || typeof meta !== 'object' || Array.isArray(meta)) errors.push(SCRIPT_ERRORS.metaRequired);
        if (typeof source !== 'string') errors.push(SCRIPT_ERRORS.sourceRequired);
        if (cases !== null && cases !== undefined && !Array.isArray(cases)) errors.push(SCRIPT_ERRORS.casesType);
        if (errors.length) return { ok: false, errors };

        // The model reads a meta with get_script and saves it back: every computed or
        // store-owned field is dropped here, so an echoed origin/scriptPath can never ride
        // into a write. `file` is the store's (recomputed from key + runtime, §3.3).
        const { file: _f, origin: _o, scriptPath: _sp, scriptsDir: _sd, commandResolved: _cr,
          createdBy: _cb, updatedBy: _ub, caseCount: _cc, sourcePath: _spath, portSummary: _ps,
          frontmatter: _fm, ...rest } = meta;
        const full = { ...rest, key, metaVersion: 2 };

        const existing = await io.readScript(key);
        if (existing) {
          const origin = String(existing.meta?.origin ?? '');
          if (origin === 'builtin') return { ok: false, errors: [SCRIPT_ERRORS.builtin(key)] };
          if (origin.startsWith('plugin:')) return { ok: false, errors: [SCRIPT_ERRORS.plugin(key, origin.slice('plugin:'.length))] };
          if (overwrite !== true) return { ok: false, errors: [SCRIPT_ERRORS.exists(key)] };
        }
        // Cases are normalized BEFORE anything is written: a bad case must not leave a saved
        // script beside the cases it was rejected for.
        let normalized = null;
        if (Array.isArray(cases)) {
          const n = io.normalizeCases({ version: 1, cases }, full);
          if (n.errors.length) return { ok: false, errors: n.errors };
          normalized = n.cases;
        }
        let saved;
        try {
          saved = existing
            ? await io.updateScript(key, { meta: full, source, sourceWin32, by })
            : await io.createScript({ meta: full, source, sourceWin32, by });
        } catch (err) { return { ok: false, errors: refusal(err) }; }

        const out = { ok: true, key, created: !existing, path: savedPath(io, key, saved), link: `#scripts/${key}` };
        if (Array.isArray(saved?.warnings) && saved.warnings.length) out.warnings = saved.warnings.map(String);
        if (normalized) {
          // The shape was validated above, so a failure here is a filesystem failure. The
          // script IS saved; saying otherwise would send the model round the loop again.
          try { await io.writeCases(key, normalized); out.cases = normalized.length; }
          catch (err) { out.caseErrors = refusal(err); }
        }
        return out;
      },

      /** One bench run, in-process in the MCP child (§9.1): no WS family, no runs-Map entry.
       *  An EXECUTION failure is a RESULT ('error' | 'timeout' | 'stopped') — that is what the
       *  model must read; only a refused request (unknown key, bad input, the bench cap) comes
       *  back as errors. */
      async test({ key, caseId = null, params = null, ports = null, inputs = null, cwd = { kind: 'scratch' }, timeoutMs = null, pinnedProjectKey = null } = {}) {
        if (typeof key !== 'string' || !key.trim()) return { ok: false, errors: [SCRIPT_ERRORS.keyRequired] };
        if (signal && signal.aborted) return { ok: false, errors: [SCRIPT_ERRORS.turnEnded] };
        // The bench refuses `{ text: 123 }` but leaves a bare string UNBOUND (probed: the program then
        // throws on inputs.<port>.path, which reads as a bug in the program, not in the call): every
        // input value is an object before the request goes out.
        if (inputs && typeof inputs === 'object') {
          const bad = Object.entries(inputs).filter(([, v]) => !v || typeof v !== 'object' || Array.isArray(v)).map(([p]) => SCRIPT_ERRORS.inputShape(p));
          if (bad.length) return { ok: false, errors: bad };
        }
        // Bench §4.2: a saved case supplies EVERYTHING — with caseId set the engine ignores the
        // request's cwd and timeoutMs (probed: a case naming a project ran there with the request
        // saying scratch). So the case is read first: its folder must be the scratch folder or the
        // project the USER pinned — never a project the case (which the chat may have saved) names —
        // and its effective timeout must fit the tool's ceiling, or a 24 h timeoutMs holds the turn.
        if (typeof caseId === 'string' && caseId) {
          const stored = await io.readScript(key);
          if (!stored || !stored.meta) return { ok: false, errors: [SCRIPT_ERRORS.notFound(key)] };
          const kase = [...(Array.isArray(stored.cases) ? stored.cases : []), ...(Array.isArray(stored.userCases) ? stored.userCases : [])]
            .find((c) => c && c.id === caseId) || null;
          if (!kase) return { ok: false, errors: [SCRIPT_ERRORS.caseNotFound(key, caseId)] };
          const kc = kase.cwd && typeof kase.cwd === 'object' ? kase.cwd : { kind: 'scratch' };
          if (kc.kind === 'project' && (!pinnedProjectKey || kc.projectKey !== pinnedProjectKey)) {
            return { ok: false, errors: [SCRIPT_ERRORS.caseProject(caseId, String(kc.projectKey ?? ''))] };
          }
          // The bench's own arithmetic (_prepare): the case's timeoutMs, else the script's, else the default.
          const effective = Number.isInteger(kase.timeoutMs) && kase.timeoutMs >= MIN_TIMEOUT_MS
            ? Math.min(kase.timeoutMs, MAX_TIMEOUT_MS)
            : (Number.isInteger(stored.meta.timeoutMs) ? stored.meta.timeoutMs : DEFAULT_TIMEOUT_MS);
          const maxMs = ASK_LIMITS.scriptTestMaxTimeoutSec * 1000;
          if (effective > maxMs) return { ok: false, errors: [SCRIPT_ERRORS.caseTimeout(caseId, Math.round(effective / 1000), ASK_LIMITS.scriptTestMaxTimeoutSec)] };
        }
        const lines = [];
        let live = null;
        // A stopped turn must not leave a test suite running: P1c hands the live bench over
        // through onBench, and stop() aborts it into the runner's tree kill (spec §4.1 step 6).
        const onAbort = () => { try { live?.stop(); } catch { /* the run is already over */ } };
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
        let result;
        try {
          result = await io.runBenchOnce({ key, caseId, params, ports, inputs, cwd, timeoutMs }, {
            onLine: (l) => { lines.push(l.text); },
            onBench: (b) => { live = b; },
          });
        } catch (err) {
          return { ok: false, errors: refusal(err) };
        } finally {
          if (signal) signal.removeEventListener('abort', onAbort);
        }
        return { ok: true, result: trimBenchResult(result, lines) };
      },
    },
  };
}
