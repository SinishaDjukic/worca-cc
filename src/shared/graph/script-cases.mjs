// src/shared/graph/script-cases.mjs
// Saved test cases for a script (workbench spec §3.2). ONE normalizer behind the
// store's hard 400, the plugin validator and the bench UI, so a case that saves
// in the app is a case a plugin can ship and `worca script test` can run.
// Cases live in `<key>.tests.json` beside the script — or, for a built-in or
// plugin key, in the user layer with no meta beside it (W18: a tests file
// without a meta is an OVERLAY, never a broken script).
// Pure: no fs, no node: builtins, no DOM — the Scripts page imports it straight
// from /src/shared (test/shared-graph-purity.test.mjs).
import { readConfigPorts, paramValueError, MIN_TIMEOUT_MS } from './script-meta.mjs';

export const CASES_VERSION = 1;
export const MAX_CASES = 32;
export const MAX_CASE_NAME = 80;
export const MAX_CASE_INPUT_BYTES = 262144;        // W9: a case input is inline text
/** Case ids are key-shaped (dashes and underscores allowed), not port-shaped. */
export const CASE_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
export const EXPECT_VERDICTS = Object.freeze(['clean', 'blocking', 'error']);

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** BYTES, not characters: the cap is a file-size cap (TextEncoder works in both hosts). */
const byteLength = (s) => new TextEncoder().encode(String(s)).length;

/**
 * The port set a case runs against: the sidecar's own ports, or — for a
 * `ports: "config"` script (D14) — the set the case carries, falling back to the
 * sidecar's `defaultPorts`. The verdict is always the sidecar's.
 * @param {object} meta a normalized script meta
 * @param {{ports?: object}} [kase]
 * @returns {{inputs: Array, outputs: Array, verdict: object|null}|{errors: string[]}}
 */
export function casePortSet(meta, kase) {
  const verdict = meta && meta.verdict ? meta.verdict : null;
  if (!meta || meta.ports !== 'config') {
    return {
      inputs: Array.isArray(meta && meta.inputs) ? meta.inputs : [],
      outputs: Array.isArray(meta && meta.outputs) ? meta.outputs : [],
      verdict,
    };
  }
  const raw = kase && kase.ports !== undefined && kase.ports !== null ? kase.ports : meta.defaultPorts;
  const { ports, errors } = readConfigPorts(raw, { hasVerdict: !!verdict });
  if (!ports) return { errors };
  return { inputs: ports.inputs, outputs: ports.outputs, verdict };
}

/**
 * Normalize a `<key>.tests.json` document against its script.
 * @param {object|undefined} raw the parsed file, or undefined (no cases)
 * @param {object} meta a normalized script meta
 * @param {{shipped?: boolean, lenient?: boolean}} [opts] shipped: a built-in or plugin
 *   file — a project cwd cannot travel to another machine, so it is refused there.
 *   lenient: the READ path. A case outlives an edit to its script's sidecar: a param,
 *   an input port or an expected output the script NO LONGER declares — or no longer
 *   declares the same WAY (an enum option dropped, a port retyped) — is skipped
 *   instead of failing the case — a strict read would drop the whole case, and the
 *   next write (the page sends the full list it was given) would delete it for good.
 *   Every other rule still applies; the WRITE path is always strict.
 * @returns {{cases: Array, errors: string[]}} a case that produced an error is
 *   NOT returned: the store refuses the whole write, the UI lists the reasons.
 */
export function normalizeCases(raw, meta, { shipped = false, lenient = false } = {}) {
  const errors = [];
  const cases = [];
  if (raw === undefined || raw === null) return { cases, errors };
  if (!isObject(raw)) {
    errors.push('cases file must be an object { version: 1, cases: [...] }');
    return { cases, errors };
  }
  if (raw.version !== CASES_VERSION) errors.push(`cases file requires version ${CASES_VERSION}`);
  if (!Array.isArray(raw.cases)) {
    errors.push('cases must be an array');
    return { cases, errors };
  }
  if (raw.cases.length > MAX_CASES) errors.push(`at most ${MAX_CASES} cases (got ${raw.cases.length})`);
  const key = typeof (meta && meta.key) === 'string' ? meta.key : '';
  const declared = new Map((Array.isArray(meta && meta.params) ? meta.params : []).filter(Boolean).map((p) => [p.id, p]));
  const seen = new Set();

  for (let i = 0; i < raw.cases.length && cases.length < MAX_CASES; i += 1) {
    const kase = raw.cases[i];
    if (!isObject(kase)) { errors.push(`cases[${i}]: each case must be an object`); continue; }
    const id = typeof kase.id === 'string' ? kase.id.trim() : '';
    if (!CASE_ID_RE.test(id)) { errors.push(`cases[${i}]: bad case id "${id}"`); continue; }
    if (seen.has(id)) { errors.push(`cases[${i}]: duplicate case id "${id}"`); continue; }
    seen.add(id);
    const before = errors.length;
    const bad = (msg) => errors.push(`case "${id}": ${msg}`);

    let name = id;
    if (kase.name !== undefined && kase.name !== null) {
      if (typeof kase.name !== 'string') bad('name must be a string');
      else if (kase.name.trim().length > MAX_CASE_NAME) bad(`name must be ${MAX_CASE_NAME} characters or fewer`);
      else name = kase.name.trim() || id;
    }

    // Ports: a config-ported script carries its own set per case (W5); a
    // sidecar-ported one must not carry one at all.
    let ownPorts = null;
    if (meta && meta.ports === 'config') {
      if (kase.ports !== undefined && kase.ports !== null && !isObject(kase.ports)) {
        bad('ports must be an object { inputs: [...], outputs: [...] }');
      } else if (isObject(kase.ports)) ownPorts = kase.ports;
    } else if (kase.ports !== undefined && kase.ports !== null && !lenient) {
      // lenient: the script dropped `ports: "config"` after the case was saved.
      // The stale set is ignored and the sidecar's own ports stand — dropping the
      // case here would blank the list, and the page's next write deletes it.
      bad('ports is only legal for a script that declares ports: "config"');
    }
    let set = casePortSet(meta, { ports: ownPorts });
    // Same rule for a set that no longer validates (a cleared verdict makes a
    // conditional output illegal): fall back to the script's default port set.
    if (set.errors && lenient && ownPorts) set = casePortSet(meta, {});
    if (set.errors) for (const e of set.errors) bad(e);
    const inPorts = new Map((set.inputs || [])
      .filter((p) => p && !p.synthetic && p.id !== 'await').map((p) => [p.id, p]));
    const outIds = new Set((set.outputs || []).map((p) => p && p.id).filter(Boolean));

    const params = {};
    if (kase.params !== undefined && kase.params !== null) {
      if (!isObject(kase.params)) bad('params must be an object');
      else {
        for (const [pid, value] of Object.entries(kase.params)) {
          const d = declared.get(pid);
          if (!d) {
            if (lenient) continue;
            bad(`unknown param "${pid}" — script "${key}" declares ${declared.size ? [...declared.keys()].join(', ') : 'no params'}`);
            continue;
          }
          const why = paramValueError(d, value);
          // lenient: the param is still declared but its SHAPE changed (an enum
          // option dropped, a type swapped). Skipped like an undeclared one —
          // dropping the case blanks the list just the same.
          if (why) { if (!lenient) bad(`param "${pid}" ${why}`); }
          else params[pid] = value;
        }
      }
    }

    const inputs = {};
    if (kase.inputs !== undefined && kase.inputs !== null) {
      if (!isObject(kase.inputs)) bad('inputs must be an object keyed by input port id');
      else {
        for (const [pid, spec] of Object.entries(kase.inputs)) {
          const port = inPorts.get(pid);
          if (!port) { if (!lenient) bad(`"${pid}" is not an input port of script "${key}"`); continue; }
          if (!isObject(spec)) { bad(`input "${pid}" must be { text } or { fired: true }`); continue; }
          // lenient: the port was RETYPED under the stored spec — skipped like a
          // removed one, because a dropped case is a deleted case one save later.
          if (port.type === 'void') {
            if (spec.fired !== true) { if (!lenient) bad(`input "${pid}" is a void port — use { fired: true }`); }
            else inputs[pid] = { fired: true };
            continue;
          }
          if (typeof spec.text !== 'string') { if (!lenient) bad(`input "${pid}" must be { text }`); continue; }
          if (byteLength(spec.text) > MAX_CASE_INPUT_BYTES) { bad(`input "${pid}" is over ${MAX_CASE_INPUT_BYTES} bytes`); continue; }
          if (port.type === 'json') {
            try { JSON.parse(spec.text); } catch { if (!lenient) bad(`input "${pid}" is not valid JSON`); continue; }
          }
          inputs[pid] = { text: spec.text };
        }
      }
    }

    // W1: the scratch folder or a REGISTERED project, never an absolute path —
    // a case travels between machines inside a plugin.
    let cwd = { kind: 'scratch' };
    if (kase.cwd !== undefined && kase.cwd !== null) {
      if (!isObject(kase.cwd) || (kase.cwd.kind !== 'scratch' && kase.cwd.kind !== 'project')) {
        bad('cwd must be { kind: "scratch" } or { kind: "project", projectKey }');
      } else if (kase.cwd.kind === 'project') {
        const pk = typeof kase.cwd.projectKey === 'string' ? kase.cwd.projectKey.trim() : '';
        if (!pk) bad('cwd: a project folder needs a projectKey');
        else if (shipped) bad('a shipped case must run in the scratch folder');
        else cwd = { kind: 'project', projectKey: pk };
      }
    }

    let timeoutMs = null;
    if (kase.timeoutMs !== undefined && kase.timeoutMs !== null) {
      if (!Number.isInteger(kase.timeoutMs) || kase.timeoutMs < MIN_TIMEOUT_MS) {
        bad(`timeoutMs must be an integer >= ${MIN_TIMEOUT_MS}`);
      } else timeoutMs = kase.timeoutMs;
    }

    let expect = null;
    if (kase.expect !== undefined && kase.expect !== null) {
      if (!isObject(kase.expect)) bad('expect must be an object { verdict?, fired?, summaryIncludes? }');
      else {
        const e = {};
        if (kase.expect.verdict !== undefined) {
          if (!EXPECT_VERDICTS.includes(kase.expect.verdict)) bad(`expect.verdict must be one of ${EXPECT_VERDICTS.join(', ')}`);
          else e.verdict = kase.expect.verdict;
        }
        if (kase.expect.fired !== undefined) {
          const list = Array.isArray(kase.expect.fired) && kase.expect.fired.every((x) => typeof x === 'string')
            ? kase.expect.fired : null;
          if (!list) bad('expect.fired must be a list of output port ids');
          else {
            // lenient: an output the script no longer declares drops out of the expectation.
            const kept = lenient ? list.filter((x) => outIds.has(x)) : list;
            const unknown = kept.filter((x) => !outIds.has(x));
            if (unknown.length) bad(`expect.fired names ${unknown.join(', ')}, which is not an output port`);
            // An expectation filtered down to NOTHING is dropped, not kept as []: an empty
            // list is a positive claim ("nothing may fire") the author never made.
            else if (kept.length || kept.length === list.length) e.fired = [...kept];
          }
        }
        if (kase.expect.summaryIncludes !== undefined) {
          if (typeof kase.expect.summaryIncludes !== 'string' || !kase.expect.summaryIncludes) {
            bad('expect.summaryIncludes must be a non-empty string');
          } else e.summaryIncludes = kase.expect.summaryIncludes;
        }
        if (Object.keys(e).length) expect = e;
      }
    }

    if (errors.length !== before) continue;
    cases.push({
      id,
      name,
      params,
      ports: meta && meta.ports === 'config' ? { inputs: set.inputs, outputs: set.outputs } : null,
      inputs,
      cwd,
      timeoutMs,
      expect,
    });
  }
  return { cases, errors };
}

/**
 * Compare a bench result with a case's expectation (spec §3.2). Absent
 * expectation -> null: the case reports its result and is never red.
 * @param {object|null|undefined} expect
 * @param {{status: string, fired: string[], summary: string}} result
 * @returns {{pass: boolean, diffs: string[]}|null}
 */
export function evaluateExpect(expect, result) {
  if (!isObject(expect)) return null;
  const diffs = [];
  const status = result && typeof result.status === 'string' ? result.status : 'nothing';
  if (expect.verdict !== undefined && expect.verdict !== status) diffs.push(`expected ${expect.verdict}, got ${status}`);
  if (Array.isArray(expect.fired)) {
    const want = [...new Set(expect.fired)].sort();
    const got = [...new Set(Array.isArray(result && result.fired) ? result.fired : [])].sort();
    if (want.length !== got.length || want.some((x, n) => x !== got[n])) {
      diffs.push(`expected fired ${want.join(', ') || '(none)'}, got ${got.join(', ') || '(none)'}`);
    }
  }
  if (typeof expect.summaryIncludes === 'string' && expect.summaryIncludes) {
    const summary = String((result && result.summary) || '');
    if (!summary.includes(expect.summaryIncludes)) diffs.push(`expected the summary to contain "${expect.summaryIncludes}"`);
  }
  return { pass: diffs.length === 0, diffs };
}
