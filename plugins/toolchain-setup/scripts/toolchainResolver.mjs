// Toolchain setup, step 4: one plan from Detect's facts and the agent's proposals.
// A deterministic exact fact beats an agent guess; conflicts stay as separate, flagged rows.
// Blocking verdict = "something needs the user's approval" (routes to Approve); clean = nothing changed.
import { readFile, mkdtemp, mkdir, rm, statfs, access, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join, dirname, basename, delimiter, sep } from 'node:path';
import { createHash } from 'node:crypto';

export const ALIAS = { nodejs: 'node', golang: 'go', jdk: 'java', openjdk: 'java', rustc: 'rust', cargo: 'rust',
  'dotnet-core': 'dotnet', 'dotnet-sdk': 'dotnet', python3: 'python', mvn: 'maven' };
export const TOOL_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const SDK_RE = /^sdkmanager:(platforms;android-\d+|build-tools;\d+\.\d+\.\d+|ndk;\d+(?:\.\d+)+|platform-tools)$/;
// mise backends a proposal may name, each with a strict name shape. Left out on purpose: http: (any URL), ubi: (overlaps
// github:), asdf:/vfox: (plugins are shell scripts from yet another repo).
const OWNER_REPO = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9_.-]{1,100}$/;
export const BACKEND = { github: OWNER_REPO, aqua: OWNER_REPO, npm: /^(@[a-z0-9][a-z0-9._-]{0,100}\/)?[a-z0-9][a-z0-9._-]{0,100}$/,
  pipx: /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/, cargo: /^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/,
  go: /^[a-z0-9][a-z0-9.-]{0,100}\.[a-z]{2,}(\/[A-Za-z0-9._~-]{1,100}){1,10}$/, gem: /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/ };
// What a backend needs to install and to run its tools; Resolve adds it as its own row when the project has none.
export const RUNTIME = { npm: 'node', pipx: 'uv', cargo: 'rust', go: 'go', gem: 'ruby' };
/** {backend, name} for a "backend:name" tool that passes its backend's shape, else null. */
export function backendOf(tool) {
  const i = String(tool).indexOf(':');
  if (i < 0) return null;
  const backend = tool.slice(0, i), name = tool.slice(i + 1);
  return BACKEND[backend]?.test(name) && !name.split('/').includes('..') ? { backend, name } : null;
}
// System packages for what mise cannot install (C libraries, build tools). One package manager per prefix; the name shape
// keeps out taps, flags and shell syntax. They install system-wide, outside the toolchain root, so they get their own rows.
export const SYSTEM = { brew: /^[a-z0-9][a-z0-9@+._-]{0,63}$/, apt: /^[a-z0-9][a-z0-9+.-]{1,63}$/, dnf: /^[A-Za-z0-9][A-Za-z0-9+._-]{0,63}$/,
  winget: /^[A-Za-z0-9][A-Za-z0-9+_-]{0,63}(\.[A-Za-z0-9+_-]{1,63}){1,5}$/, scoop: /^[a-z0-9][a-z0-9._-]{0,63}$/ };
/** {manager, pkg} for a "manager:package" tool that passes its manager's shape, else null. */
export function systemOf(tool) {
  const i = String(tool).indexOf(':');
  const manager = i > 0 ? tool.slice(0, i) : '', pkg = tool.slice(i + 1);
  return SYSTEM[manager]?.test(pkg) ? { manager, pkg } : null;
}
// What the user runs themselves when this run lacks the rights.
const BY_HAND = { brew: (p) => `brew install ${p}`, apt: (p) => `sudo apt-get install -y ${p}`, dnf: (p) => `sudo dnf install -y ${p}`,
  winget: (p) => `winget install --id ${p} --exact`, scoop: (p) => `scoop install ${p}` };
// The oldest mise this pipeline is tested with. Older ones silently ignore settings it relies on (rustup/cargo homes,
// rust[profile=…] options, the aube/uv cache variables, MISE_EXEC_AUTO_INSTALL), so installs would leak out of the root.
export const MIN_MISE = '2026.10.7';
/** True unless `line` ("2026.10.8 macos-arm64 (…)") starts with a version at or above MIN_MISE; unreadable counts as too old. */
export function miseTooOld(line) {
  const m = String(line ?? '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!m) return true;
  const want = MIN_MISE.split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = Number(m[i + 1]) - want[i]; if (d) return d < 0; }
  return false;
}
const UPGRADE = 'Upgrade it the way it was installed (brew upgrade mise, mise self-update, winget upgrade jdx.mise or scoop update mise)';
export const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const RANGE_RE = /^[A-Za-z0-9 <>=^~*.|_/-]{1,64}$/;
const EVIDENCE_RE = /^[\w.@+/-][\w.@+/ -]{0,250}:\d{1,7}$/;
const COMMANDISH = /:\/\/|`|\$\(|\$\{|\|\s*(sh|bash)\b|\b(curl|wget|sudo|powershell|iwr|iex)\b|\b(apt|apt-get|brew|yum|dnf|apk|choco|winget|pip3?|pipx|npm|pnpm|yarn|gem|cargo|go|mise|asdf|sdk)\s+(install|add|use|get)\b|\bnpx\s|\bchmod\s|\bsdkmanager\s+["'-]/i;
const KEYWORD = /^(lts(\/.*)?|latest|stable|node|\*)$/i;
const SIZE_MB = { java: [190, 330], node: [30, 120], go: [70, 230], rust: [300, 1300], python: [35, 140], dotnet: [210, 650],
  gradle: [130, 150], maven: [10, 12], flutter: [1100, 2600], dart: [200, 550], terraform: [30, 90], protoc: [3, 10],
  'rust-minimal': [110, 520], kotlin: [80, 90], pnpm: [10, 30], yarn: [5, 15], bun: [40, 100], deno: [40, 120], ruby: [30, 120], 'android-sdk': [150, 170],
  platforms: [70, 180], 'build-tools': [60, 150], ndk: [900, 2800], 'platform-tools': [10, 30] };
const DEFAULT_SIZE = [50, 200];
const CAP_LABEL = { docker: 'Docker (Testcontainers / compose)', macos: 'macOS + Xcode', emulator: 'Android emulator (hardware acceleration)', cuda: 'CUDA GPU' };

// ── versions ────────────────────────────────────────────────────────────────
export const prefixOf = (v) => (String(v).match(/^([a-z][a-z-]*?)-?(?=\d)/i) || [])[1]?.toLowerCase() || null;
export const stripPrefix = (v) => String(v).replace(/^[a-z][a-z-]*?-?(?=\d)/i, '');
const nums = (v) => stripPrefix(v).split(/[^\d]+/).filter(Boolean).map(Number);
const isPrefix = (a, b) => a.length > 0 && a.length <= b.length && a.every((n, i) => n === b[i]);
const isStable = (v) => !/(alpha|beta|rc|ea|preview|nightly|dev|snapshot|canary)/i.test(v);
export function cmp(a, b) {
  const x = nums(a), y = nums(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return Math.sign(d); }
  return 0;
}
function comp(v, c) {
  const m = c.match(/^(\^|~|>=|<=|>|<|=)?v?(\d+(?:\.\d+)*)(?:\.[x*])?$/);
  if (!m) return false;
  const nb = nums(m[2]), nv = nums(v), d = cmp(v, m[2]);
  switch (m[1]) {
    case '^': return d >= 0 && nv[0] === nb[0] && (nb[0] !== 0 || nv[1] === nb[1]);
    case '~': return d >= 0 && nv[0] === nb[0] && (nb.length < 2 || nv[1] === nb[1]);
    case '>=': return d >= 0;
    case '>': return d > 0;
    case '<=': return d <= 0;
    case '<': return d < 0;
    default: return isPrefix(nb, nv);
  }
}
function matchRange(v, r) {
  if (/^[a-z-]*\d+(\.\d+)*(\.[x*])?$/i.test(r)) return isPrefix(nums(r.replace(/\.[x*]$/i, '')), nums(v));
  return r.split('||').some((alt) => { const cs = alt.trim().split(/\s+/).filter(Boolean); return cs.length > 0 && cs.every((c) => comp(v, c)); });
}
/** Does concrete version `v` meet the spec {version, constraint}? */
export function satisfies(v, s) {
  const want = String(s.version);
  if (KEYWORD.test(want)) return true;
  const p = prefixOf(want);
  if (p && prefixOf(v) !== p) return false;
  if (s.constraint === 'exact') return isPrefix(nums(want), nums(v));
  if (s.constraint === 'minimum') return cmp(v, want) >= 0;
  return matchRange(v, want);
}
const canon = (tool, v) => `${prefixOf(v) || (tool === 'java' ? 'temurin' : '')}:${nums(v).join('.')}`;
const fmt = (s) => (s.constraint === 'minimum' ? `>=${s.version}` : s.version);

const offlineReason = (tool) => `network unavailable: could not look up ${tool} versions`;
/** Pick one concrete version meeting every spec in `must` (the env answers the mise questions). */
export async function pickVersion(env, tool, must) {
  const real = must.filter((s) => !KEYWORD.test(String(s.version)));
  const prefix = must.map((s) => prefixOf(s.version)).find(Boolean) || (tool === 'java' ? 'temurin' : null);
  if (!real.length) {
    const kw = String(must[0]?.version || '');
    const q = /^lts/i.test(kw) ? 'lts' : prefix;
    const v = await env.latest(tool, q);
    return v ? { version: v } : { error: env.offline ? offlineReason(tool) : `mise found no ${q ? `${tool}@${q}` : tool} version` };
  }
  const list = await env.remote(tool);
  if (!list) return { error: env.offline ? offlineReason(tool) : `mise could not list ${tool} versions` };
  const wantPre = real.some((s) => s.constraint === 'exact' && !isStable(s.version));
  const cands = list.filter((v) => (prefix ? prefixOf(v) === prefix : /^\d/.test(v)) && (wantPre || isStable(v)) && real.every((s) => satisfies(v, s)));
  if (!cands.length) return { error: `no ${tool} version satisfies ${real.map(fmt).join(' and ')}` };
  const ex = real.find((s) => s.constraint === 'exact');
  if (ex) { const same = cands.find((v) => v === ex.version || stripPrefix(v) === stripPrefix(ex.version)); if (same) return { version: same }; }
  return { version: [...cands].sort(cmp).at(-1) };
}

// ── the agent's output: a strict schema, anything command- or URL-like is rejected ──
export function checkProposal(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { ok: false, reason: 'not an object' };
  const extra = Object.keys(p).filter((k) => !['tool', 'version', 'constraint', 'evidence', 'confidence', 'why'].includes(k));
  if (extra.length) return { ok: false, reason: `unexpected field(s): ${extra.join(', ').slice(0, 80)}` };
  const strings = [p.tool, p.version, p.why, ...(Array.isArray(p.evidence) ? p.evidence : [])].filter((s) => typeof s === 'string');
  if (strings.some((s) => COMMANDISH.test(s))) return { ok: false, reason: 'contains a command or URL' };
  let tool = typeof p.tool === 'string' ? p.tool.trim() : '';
  const colon = tool.indexOf(':');
  // A backend spec keeps its name's case (Go modules and GitHub repos are case-sensitive); only the backend is lower-cased.
  tool = colon > 0 && !/^sdkmanager:/i.test(tool) ? `${tool.slice(0, colon).toLowerCase()}${tool.slice(colon)}` : tool.toLowerCase();
  tool = ALIAS[tool] || tool;
  if (!(TOOL_RE.test(tool) || SDK_RE.test(tool) || backendOf(tool) || systemOf(tool))) return { ok: false, reason: 'tool is not a mise registry name, an allowed backend spec or a system package' };
  const version = p.version == null ? null : String(p.version).trim();
  if (systemOf(tool) && version != null) return { ok: false, reason: 'system packages take no version: the package manager decides it' };
  if (version != null && !(VERSION_RE.test(version) || RANGE_RE.test(version))) return { ok: false, reason: 'version is not a version' };
  if (version != null && !['exact', 'minimum', 'range'].includes(p.constraint)) return { ok: false, reason: 'constraint must be exact, minimum or range' };
  if (!Array.isArray(p.evidence) || !p.evidence.length || p.evidence.length > 10 || !p.evidence.every((e) => typeof e === 'string' && EVIDENCE_RE.test(e))) {
    return { ok: false, reason: 'evidence must be 1–10 "file:line" strings' };
  }
  if (!['high', 'medium', 'low'].includes(p.confidence)) return { ok: false, reason: 'confidence must be high, medium or low' };
  const why = typeof p.why === 'string' ? p.why.trim() : '';
  if (!why || why.length > 500 || /[\r\n]/.test(why)) return { ok: false, reason: 'why must be one line, 1–500 chars' };
  return { ok: true, proposal: { tool, version, constraint: version == null ? 'range' : p.constraint, evidence: p.evidence, confidence: p.confidence, why } };
}

const groupBy = (xs, key) => { const m = new Map(); for (const x of xs) { const k = key(x); m.set(k, [...(m.get(k) || []), x]); } return m; };
const uniq = (xs) => [...new Set(xs.filter(Boolean))];
const RANK = { high: 3, medium: 2, low: 1 };

/** One tool's candidates. Detect exact facts win; agent versions that disagree with them are kept as `overridden`. */
function candidates(tool, facts, props) {
  const spec = (x) => ({ version: x.version, constraint: x.constraint });
  const exact = facts.filter((f) => f.constraint === 'exact');
  const soft = facts.filter((f) => f.constraint !== 'exact');
  const out = [], overridden = [];
  if (exact.length) {
    for (const fs of groupBy(exact, (f) => canon(tool, f.version)).values()) out.push({ must: [spec(fs[0]), ...soft.map(spec)], facts: [...fs, ...soft], props: [], origin: 'detect' });
    for (const p of props) {
      const home = p.version == null ? out[0]
        : out.find((c) => satisfies(c.facts[0].version, { version: p.version, constraint: p.constraint }) || satisfies(p.version, { version: c.facts[0].version, constraint: 'exact' }));
      if (home) home.props.push(p); else overridden.push({ version: p.version, evidence: p.evidence, why: p.why });
    }
  } else if (soft.length) {
    const concrete = props.filter((p) => p.version != null && p.constraint === 'exact');
    const fit = concrete.filter((p) => soft.every((f) => satisfies(p.version, f)));
    const misfit = concrete.filter((p) => !fit.includes(p));
    const loose = props.filter((p) => !concrete.includes(p));
    if (fit.length) for (const ps of groupBy(fit, (p) => canon(tool, p.version)).values()) out.push({ must: [spec(ps[0]), ...soft.map(spec)], facts: soft, props: [...ps, ...loose], origin: 'detect+investigate' });
    else out.push({ must: soft.map(spec), facts: soft, props: loose, origin: 'detect' });
    for (const ps of groupBy(misfit, (p) => canon(tool, p.version)).values()) out.push({ must: [spec(ps[0])], facts: [], props: ps, origin: 'investigate' });
  } else {
    const concrete = props.filter((p) => p.version != null);
    const loose = props.filter((p) => p.version == null);
    if (!concrete.length) out.push({ must: [], facts: [], props: loose, origin: 'investigate' });
    for (const [i, ps] of [...groupBy(concrete, (p) => `${p.constraint}|${canon(tool, p.version)}`).values()].entries()) {
      out.push({ must: [spec(ps[0])], facts: [], props: i === 0 ? [...ps, ...loose] : ps, origin: 'investigate' });
    }
  }
  return { out, overridden };
}

const runtimeVersion = (grp) => (grp.forTools.some((t) => backendOf(t).backend === 'npm') ? 'lts' : null);   // node: the LTS line

/** The plan, minus the paths. `env` answers every question about mise, the disk and the box. */
export async function buildPlan({ facts = [], capabilities = [], proposals = [], lock = null, env, reserveMb = 2048 }) {
  const locked = Array.isArray(lock?.tools) ? lock.tools : [];
  const rejected = [];
  const groups = new Map();
  const g = (tool) => groups.get(tool) || groups.set(tool, { facts: [], props: [] }).get(tool);
  for (const f of facts) { const tool = ALIAS[String(f.tool).toLowerCase()] || String(f.tool); g(tool).facts.push({ ...f, tool }); }
  for (const p of proposals) {
    const c = checkProposal(p);
    if (c.ok) g(c.proposal.tool).props.push(c.proposal);
    else rejected.push({ tool: String(p?.tool ?? '').replace(/[^\w.:;@+-]/g, '').slice(0, 60), reason: c.reason });
  }

  // A backend tool's runtime (npm needs node, ...) joins the plan as its own row unless the project already names it.
  for (const tool of [...groups.keys()]) {
    const need = RUNTIME[backendOf(tool)?.backend];
    if (!need) continue;
    const dep = groups.get(need) || groups.set(need, { facts: [], props: [], forTools: [] }).get(need);
    if (dep.forTools) dep.forTools.push(tool);
  }
  for (const grp of groups.values()) {
    if (grp.forTools) grp.props.push({ version: runtimeVersion(grp), constraint: 'range', evidence: [], confidence: 'high', why: `Needed to install and run ${grp.forTools.join(', ')}.` });
  }

  const rows = [], otherBoxes = [];
  let sdkWanted = false;
  for (const [tool, grp] of groups) {
    const sources = (c) => uniq(c.facts.map((f) => f.source));
    const evidence = (c) => uniq(c.props.flatMap((p) => p.evidence));
    const why = (c) => (c.facts.length ? `${c.facts.map((f) => `${fmt(f)} in ${f.source}`).join('; ')}` : '')
      + (c.props.length ? `${c.facts.length ? '. ' : ''}${c.props.map((p) => p.why).join(' ')}` : '');
    const confidence = (c) => (c.facts.length ? 'high' : c.props.map((p) => p.confidence).sort((a, b) => RANK[b] - RANK[a])[0] || 'low');
    const sys = systemOf(tool);
    if (sys) {
      // The agent may name a package for every OS; only this box's package managers count, the rest are listed.
      const m = await env.system(sys.manager);
      if (!m.ok) { otherBoxes.push(tool); continue; }
      const c = { facts: grp.facts, props: grp.props };
      rows.push({ tool, kind: 'system', manager: sys.manager, package: sys.pkg, requested: 'system package', version: null, spec: tool, constraint: 'range',
        sources: sources(c), evidence: evidence(c), why: why(c), confidence: confidence(c), origin: c.facts.length ? 'detect' : 'investigate',
        ...(m.admin ? { status: 'installable' } : { status: 'not-possible-here', reason: `needs administrator rights this run does not have: run "${BY_HAND[sys.manager](sys.pkg)}" yourself` }) });
      continue;
    }
    if (SDK_RE.test(tool)) {
      sdkWanted = true;
      const c = { facts: grp.facts, props: grp.props };
      rows.push({ tool, kind: 'sdkmanager', requested: tool.slice(11), version: tool.slice(11), spec: tool, constraint: 'exact',
        sources: sources(c), evidence: evidence(c), why: why(c), confidence: confidence(c), origin: c.facts.length ? 'detect' : 'investigate', status: 'installable' });
      continue;
    }
    const { out, overridden } = candidates(tool, grp.facts, grp.props);
    const toolRows = [];
    const queue = [...out];
    while (queue.length) {
      const c = queue.shift();
      const options = c.facts.find((f) => f.options)?.options;   // e.g. rust's profile/components from rust-toolchain.toml
      const base = { tool, kind: 'mise', requested: c.must.map(fmt).join(', ') || 'latest', sources: sources(c), evidence: evidence(c),
        why: why(c), confidence: confidence(c), origin: grp.forTools ? 'resolve' : c.origin, overridden: c === out[0] ? overridden : [],
        ...(options ? { options } : {}), ...(RUNTIME[backendOf(tool)?.backend] ? { needs: RUNTIME[backendOf(tool).backend] } : {}) };
      if (!env.mise) {
        // No versions can be resolved, so disagreeing candidates collapse into one row per tool.
        const all = { facts: grp.facts, props: grp.props };
        const reason = env.miseTooOld ? `mise ${String(env.miseVersion).split(/\s/)[0]} is too old: ${MIN_MISE} or newer is needed. ${UPGRADE}, then start a new run.`
          : 'mise is not installed on this box';
        toolRows.push({ ...base, sources: sources(all), evidence: evidence(all), version: null, spec: null, status: 'not-possible-here', reason });
        break;
      }
      if (!backendOf(tool) && (!TOOL_RE.test(tool) || (env.registry && !env.registry.has(tool)))) {
        toolRows.push({ ...base, version: null, spec: null, status: 'unknown-tool', reason: `"${tool}" is not in the mise registry` }); continue;
      }
      // A locked version that still meets every constraint stays: no silent drift to the newest release on each run.
      const held = locked.find((l) => l.tool === tool && l.kind === 'mise' && l.version && c.must.every((s) => KEYWORD.test(String(s.version)) || satisfies(l.version, s)));
      const r = held ? { version: held.version } : await pickVersion(env, tool, c.must);
      if (r.error && c.facts.length > 1 && c.must.length > 1) {
        // The sources disagree with each other: keep each side, flagged, instead of choosing.
        for (const f of c.facts) queue.push({ must: [{ version: f.version, constraint: f.constraint }], facts: [f], props: [], origin: 'detect' });
        continue;
      }
      if (r.error) toolRows.push({ ...base, version: null, spec: null, status: 'not-possible-here', reason: r.error });
      else toolRows.push({ ...base, version: r.version, spec: `${tool}@${r.version}`, status: 'installable' });
    }
    // Candidates that land on the same spec (or, unresolved, the same status) are one row, not a conflict with itself.
    for (let i = toolRows.length - 1; i > 0; i -= 1) {
      const r = toolRows[i];
      const twin = toolRows.slice(0, i).find((t) => (r.spec ? t.spec === r.spec : !t.spec && t.status === r.status));
      if (!twin) continue;
      Object.assign(twin, { sources: uniq([...twin.sources, ...r.sources]), evidence: uniq([...twin.evidence, ...r.evidence]) });
      toolRows.splice(i, 1);
    }
    if (toolRows.length > 1) {
      const alts = toolRows.map((r) => `${r.version || r.requested} (${r.sources[0] || r.evidence[0] || r.origin})`);
      for (const r of toolRows) { r.conflict = true; r.alternatives = alts; }
    }
    rows.push(...toolRows);
  }

  // Android components need sdkmanager; mise's android-sdk provides it when the box has none.
  if (sdkWanted && !env.sdkmanager) {
    if (env.mise && env.registry?.has('android-sdk') && !rows.some((r) => r.tool === 'android-sdk')) {
      const v = await env.latest('android-sdk', null);
      rows.push({ tool: 'android-sdk', kind: 'mise', requested: 'latest', version: v, spec: v ? `android-sdk@${v}` : null, sources: [], evidence: [],
        why: 'Provides sdkmanager for the Android SDK components below.', confidence: 'high', origin: 'resolve',
        status: v ? 'installable' : 'not-possible-here', reason: v ? undefined : env.offline ? offlineReason('android-sdk') : 'mise found no android-sdk version' });
    }
    if (!rows.some((r) => r.tool === 'android-sdk' && r.status === 'installable')) {
      for (const r of rows) if (r.kind === 'sdkmanager') Object.assign(r, { status: 'not-possible-here', reason: 'no sdkmanager on this box and mise cannot provide one' });
    }
  }

  // Capabilities no toolchain can provide.
  for (const [need, cs] of groupBy(capabilities, (c) => c.need)) {
    const have = await env.capability(need);
    if (have.ok) continue;
    rows.push({ tool: need, kind: 'capability', requested: CAP_LABEL[need] || need, version: null, spec: null, sources: uniq(cs.map((c) => c.source)), evidence: [],
      why: uniq(cs.map((c) => c.why)).join('; '), confidence: 'high', origin: 'detect', status: 'not-possible-here', reason: have.reason, change: 'info' });
  }

  // Diff against the saved lock.
  for (const r of rows) {
    if (r.kind === 'capability') continue;
    r.present = r.status === 'installable' ? await env.present(r) : false;
    const same = locked.find((l) => l.tool === r.tool && l.version === r.version);
    const other = locked.find((l) => l.tool === r.tool);
    if (same) r.change = r.present ? 'unchanged' : 'missing';
    else if (other) { r.change = 'changed'; r.was = other.version; }
    else r.change = r.present ? 'unchanged' : 'added';   // already in the shared root: nothing to install
  }
  // Drop a locked tool only when Detect found it and nothing names it any more. The agent's output varies run to run
  // (and a malformed proposal is rejected), so its absence alone never removes an installed tool.
  const named = (t) => { const k = String(t ?? '').trim().toLowerCase(); return ALIAS[k] || k; };
  const mentioned = new Set([...facts.map((f) => named(f.tool)), ...proposals.map((p) => named(p?.tool))]);
  const removed = locked.filter((l) => l.kind !== 'license' && !rows.some((r) => r.tool === l.tool)
    && String(l.origin || '').startsWith('detect') && !mentioned.has(l.tool));

  // One license row covers every Android component being installed.
  const sdkToInstall = rows.some((r) => r.kind === 'sdkmanager' && r.status === 'installable' && r.change !== 'unchanged');
  if (sdkToInstall && !locked.some((l) => l.kind === 'license')) {
    rows.push({ tool: 'android-sdk-licenses', kind: 'license', requested: 'accept', version: 'accepted', spec: 'android-sdk-licenses', sources: [], evidence: [],
      why: 'sdkmanager will not install Android components until the Android SDK licenses are accepted.', confidence: 'high', origin: 'resolve',
      status: 'installable', change: 'added', present: false });
  }

  // Sizes and the disk budget: exact facts first, then everything else in order.
  const KORDER = { mise: 0, sdkmanager: 1, license: 2, capability: 3 };
  rows.sort((a, b) => KORDER[a.kind] - KORDER[b.kind] || (a.origin === 'detect' ? 0 : 1) - (b.origin === 'detect' ? 0 : 1) || a.tool.localeCompare(b.tool));
  const freeMb = await env.freeMb();
  const budgetMb = Math.max(0, freeMb - reserveMb);
  let neededMb = 0;
  for (const r of rows) {
    if (['capability', 'license', 'system'].includes(r.kind)) { r.sizeMb = null; continue; }   // system packages land outside the root
    const key = r.kind === 'sdkmanager' ? r.version.split(';')[0] : r.tool === 'rust' && r.options?.profile === 'minimal' ? 'rust-minimal' : r.tool;
    const [download, disk] = SIZE_MB[key] || DEFAULT_SIZE;
    r.sizeMb = r.present ? { download: 0, disk: 0, estimated: false } : { download, disk, estimated: true };
    if (r.status !== 'installable' || r.change === 'unchanged' || r.present) continue;
    if (neededMb + disk > budgetMb) Object.assign(r, { status: 'over-disk-budget', reason: `needs ~${disk} MB; ${Math.max(0, budgetMb - neededMb)} MB left after the rows above` });
    else neededMb += disk;
  }
  // The license row only matters while an Android component is still going to be installed.
  if (!rows.some((r) => r.kind === 'sdkmanager' && r.status === 'installable' && r.change !== 'unchanged')) {
    const i = rows.findIndex((r) => r.kind === 'license');
    if (i >= 0) rows.splice(i, 1);
  }
  rows.forEach((r, i) => { r.id = `r${i + 1}`; });

  const toApprove = rows.filter((r) => r.status === 'installable' && ['added', 'changed', 'missing'].includes(r.change));
  return { version: 1, rows, removed, rejected, otherBoxes, disk: { freeMb, reserveMb, budgetMb, neededMb }, needsApproval: toApprove.length > 0, toApprove: toApprove.map((r) => r.id) };
}

// ── the real box ──────────────────────────────────────────────────────────────
function run(cmd, args, { cwd, env, timeoutMs = 60000 } = {}) {
  return new Promise((resolve) => {
    let out = '', err = '', done = false, child;
    const finish = (code, extra = '') => { if (!done) { done = true; clearTimeout(timer); resolve({ code, stdout: out, stderr: err + extra }); } };
    try { child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return resolve({ code: -1, stdout: '', stderr: e.message }); }
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(-1, '\n(timed out)'); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; if (out.length > 8e6) out = out.slice(-8e6); });
    child.stderr.on('data', (d) => { err += d; if (err.length > 2e5) err = err.slice(-2e5); });
    child.on('error', (e) => finish(-1, e.message));
    child.on('close', (code) => finish(code ?? -1));
  });
}
const exists = async (p, mode = constants.F_OK) => { try { await access(p, mode); return true; } catch { return false; } };
async function nearestDir(p) { let d = p; while (!(await exists(d)) && dirname(d) !== d) d = dirname(d); return d; }
export const projectSlug = (dir) => `${basename(dir).replace(/[^\w.-]/g, '_')}-${createHash('sha1').update(dir).digest('hex').slice(0, 10)}`;

/** The toolchain root, created and proven writable BEFORE any work: every later step writes under it.
 *  Empty param = /data/toolchains when /data exists (the Railway volume), else ~/.worca-cc/toolchains. */
export async function pickRoot(param) {
  const wanted = String(param ?? '').trim();
  const home = (process.env.WORCA_HOME || '').trim() || homedir();
  const cands = wanted ? [wanted] : [...((await exists('/data')) ? ['/data/toolchains'] : []), join(home, '.worca-cc', 'toolchains')];
  const tried = [];
  for (const c of cands) {
    try { await mkdir(c, { recursive: true }); await access(c, constants.W_OK); return c; } catch (e) { tried.push(`${c} (${e.code || e.message})`); }
  }
  throw new Error(`No writable toolchain root: ${tried.join('; ')}. Set "Toolchain root" on the Toolchain: resolve card to a folder this user can write, then start a new run.`);
}
// Tool homes mise does not move with MISE_DATA_DIR (its state, rustup, cargo, terraform's checkpoint, the
// ~/.default-*-packages lists): pin them to the root or switch them off, so an install writes nothing into $HOME.
const isolated = (root, scratch) => ({ MISE_STATE_DIR: join(root, 'state'), MISE_RUSTUP_HOME: join(root, 'rustup'), MISE_CARGO_HOME: join(root, 'cargo'),
  CHECKPOINT_DISABLE: '1', ...Object.fromEntries(['NODE', 'PYTHON', 'RUBY', 'GO'].map((t) => [`MISE_${t}_DEFAULT_PACKAGES_FILE`, join(scratch, 'no-default-packages')])),
  // The backends' own installers: npm: goes through mise's aube, pipx: through uv (with its own python, never a system one), go: through go.
  AUBE_HOME: join(root, 'aube'), AUBE_CACHE_DIR: join(root, 'cache', 'aube'), AUBE_STORE_DIR: join(root, 'aube', 'store'), AUBE_NO_UPDATE_CHECK: '1',
  UV_CACHE_DIR: join(root, 'cache', 'uv'), UV_PYTHON_INSTALL_DIR: join(root, 'uv-python'), UV_PYTHON_PREFERENCE: 'only-managed',
  GOPATH: join(root, 'gopath'), GOMODCACHE: join(root, 'cache', 'go-mod'), GOCACHE: join(root, 'cache', 'go-build') });
/** True when `p` exists and really lives inside `root`: a link out of the root (rustup's ~/.cargo/bin) is not an install there. */
async function inRoot(p, root) {
  try { const [rp, rr] = await Promise.all([realpath(p), realpath(root)]); return rp === rr || rp.startsWith(rr + sep); } catch { return false; }
}
export function miseEnv(root, scratch) {
  return { ...process.env, MISE_DATA_DIR: root, MISE_CACHE_DIR: join(root, 'cache'), MISE_YES: '1', MISE_CEILING_PATHS: dirname(scratch),
    MISE_GLOBAL_CONFIG_FILE: join(scratch, 'none.toml'), MISE_TRUSTED_CONFIG_PATHS: '', MISE_NOT_FOUND_AUTO_INSTALL: 'false', ...isolated(root, scratch) };
}
async function findSdkmanager(root) {
  const exe = process.platform === 'win32' ? 'sdkmanager.bat' : 'sdkmanager';
  const bases = [join(root, 'android-sdk'), process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT].filter(Boolean);
  const cands = [...bases.map((b) => join(b, 'cmdline-tools', 'latest', 'bin', exe)), ...(process.env.PATH || '').split(delimiter).filter(Boolean).map((d) => join(d, exe))];
  for (const c of cands) if (await exists(c, constants.X_OK)) return c;
  return null;
}
/** mise on PATH, else where its installers put it: mise.run's ~/.local/bin and Homebrew on macOS/Linux; winget's links,
 *  scoop's shims and Chocolatey on Windows (mise.exe there). Those folders count even off PATH: a mise installed after the
 *  worca server started is not on its PATH yet. null when none. */
export async function findMise() {
  const win = process.platform === 'win32', home = homedir();
  const extra = win
    ? [join(process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'Microsoft', 'WinGet', 'Links'), join(process.env.SCOOP || join(home, 'scoop'), 'shims'),
      join(process.env.ChocolateyInstall || join(process.env.ProgramData || 'C:\\ProgramData', 'chocolatey'), 'bin')]
    : [join(home, '.local', 'bin'), '/usr/local/bin', process.platform === 'darwin' ? '/opt/homebrew/bin' : '/home/linuxbrew/.linuxbrew/bin'];
  for (const d of [...(process.env.PATH || '').split(delimiter).filter(Boolean), ...extra]) {
    const p = join(d, win ? 'mise.exe' : 'mise');
    try { await access(p, win ? constants.F_OK : constants.X_OK); return p; } catch { /* next */ }
  }
  return null;
}
const NET_ERR = /error sending request|dns error|failed to lookup address|could not resolve host|network is unreachable|connection refused/i;
// Is a system package installed? One fixed, read-only query per package manager.
const PS = ['powershell', '-NoProfile', '-NonInteractive', '-Command'];
async function systemInstalled(manager, pkg, run) {
  const q = { brew: ['brew', 'list', '--versions', pkg], apt: ['dpkg-query', '-W', '-f=${Status}', pkg], dnf: ['rpm', '-q', pkg],
    winget: ['winget', 'list', '--id', pkg, '--exact', '--accept-source-agreements'], scoop: [...PS, 'scoop', 'prefix', pkg] }[manager];
  if (!q) return false;
  const r = await run(q[0], q.slice(1), { timeoutMs: 60000 });
  const out = String(r.stdout ?? r.out ?? '');
  return r.code === 0 && (manager !== 'apt' || out.includes('install ok installed'));
}
async function realEnv(root) {
  const scratch = await mkdtemp(join(tmpdir(), 'worca-mise-'));
  const env = miseEnv(root, scratch);
  const bin = (await findMise()) || 'mise';
  // A network error on stderr (even with exit 0: `mise latest` only warns) means mise is offline, not that the version is missing.
  const mise = async (args, timeoutMs) => {
    const r = await run(bin, args, { cwd: scratch, env, timeoutMs });
    if (NET_ERR.test(r.stderr)) out.offline = true;
    return r;
  };
  const ver = await mise(['--version'], 20000);
  const tooOld = ver.code === 0 && miseTooOld(ver.stdout);   // below the floor counts as no mise: nothing resolves or installs
  let registry = null;
  if (ver.code === 0 && !tooOld) {
    const r = await mise(['registry'], 120000);
    if (r.code === 0) registry = new Set(r.stdout.split('\n').map((l) => l.trim().split(/\s+/)[0]).filter(Boolean));
  }
  const cache = new Map();
  const out = {
    offline: false, scratch, mise: ver.code === 0 && !tooOld, miseTooOld: tooOld, miseVersion: ver.code === 0 ? ver.stdout.trim() : null, registry, sdkmanager: await findSdkmanager(root),
    async remote(tool) {
      if (!cache.has(tool)) { const r = await mise(['ls-remote', tool], 180000); cache.set(tool, r.code === 0 ? r.stdout.split('\n').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean) : null); }
      return cache.get(tool);
    },
    async latest(tool, q) { const r = await mise(['latest', q ? `${tool}@${q}` : tool], 120000); const v = r.stdout.trim().split('\n').pop()?.trim(); return r.code === 0 && v ? v : null; },
    async system(manager) {
      const ok = async (cmd, args) => (await run(cmd, args, { timeoutMs: 20000 })).code === 0;
      const win = process.platform === 'win32', linux = process.platform === 'linux';
      if (manager === 'brew') return { ok: !win && (await ok('brew', ['--version'])), admin: true };
      if (manager === 'apt' || manager === 'dnf') {
        if (!linux || !(await ok(manager === 'apt' ? 'apt-get' : 'dnf', ['--version']))) return { ok: false };
        return { ok: true, admin: process.getuid?.() === 0 || (await ok('sudo', ['-n', 'true'])) };   // never asks for a password
      }
      if (manager === 'winget') return { ok: win && (await ok('winget', ['--version'])), admin: true };
      if (manager === 'scoop') return { ok: win && (await ok(PS[0], [...PS.slice(1), 'scoop', '--version'])), admin: true };
      return { ok: false };
    },
    async present(r) {
      if (r.kind === 'system') return systemInstalled(r.manager, r.package, run);
      if (r.kind === 'mise') {
        if (backendOf(r.tool)) {   // mise names a backend's folder itself (npm:cowsay -> npm-cowsay): ask it where
          const w = await mise(['where', r.spec], 60000);
          const dir = w.code === 0 ? w.stdout.split('\n').map((l) => l.trim()).filter(Boolean).pop() : null;
          return !!dir && inRoot(dir, root);
        }
        if (!(await inRoot(join(root, 'installs', r.tool, r.version), root))) return false;
        // One rust per version is shared by every project: it counts only when it has this project's components too.
        const want = r.tool === 'rust' ? r.options?.components || [] : [];
        if (!want.length) return true;
        const l = await run(join(root, 'cargo', 'bin', process.platform === 'win32' ? 'rustup.exe' : 'rustup'), ['component', 'list', '--installed', '--toolchain', r.version],
          { env: { ...process.env, RUSTUP_HOME: join(root, 'rustup'), CARGO_HOME: join(root, 'cargo') }, timeoutMs: 30000 });
        const have = l.code === 0 ? l.stdout.split('\n').map((s) => s.trim()).filter(Boolean) : [];
        return want.every((c) => have.some((h) => h === c || h.startsWith(`${c}-`)));
      }
      if (r.kind === 'sdkmanager') return exists(join(root, 'android-sdk', ...r.version.split(';')));
      return false;
    },
    async capability(need) {
      if (need === 'docker') return (await run('docker', ['info'], { timeoutMs: 15000 })).code === 0 ? { ok: true } : { ok: false, reason: 'no working Docker daemon on this box' };
      if (need === 'macos') {
        if (process.platform !== 'darwin') return { ok: false, reason: `needs macOS with Xcode; this box is ${process.platform}` };
        return (await run('xcodebuild', ['-version'], { timeoutMs: 15000 })).code === 0 ? { ok: true } : { ok: false, reason: 'Xcode is not installed (mise cannot install it)' };
      }
      if (need === 'cuda') return (await run('nvidia-smi', [], { timeoutMs: 15000 })).code === 0 ? { ok: true } : { ok: false, reason: 'no NVIDIA GPU / driver on this box' };
      if (need === 'emulator') {
        if (process.platform === 'linux' && !(await exists('/dev/kvm'))) return { ok: false, reason: 'no /dev/kvm: the Android emulator cannot run here' };
        return { ok: false, reason: 'emulator system images are not part of toolchain setup; instrumented tests need a device or emulator' };
      }
      return { ok: false, reason: 'unknown capability' };
    },
    async freeMb() { const s = await statfs(await nearestDir(root)); return Math.floor((Number(s.bavail) * Number(s.bsize)) / 1048576); },
  };
  return out;
}

function renderSummary(plan) {
  const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 300);
  const size = (r) => (r.sizeMb ? `${r.sizeMb.estimated ? '~' : ''}${r.sizeMb.disk} MB` : '');
  const lines = [
    '# Toolchain plan', '',
    `Disk: ${plan.disk.neededMb} MB needed, ${plan.disk.freeMb} MB free at ${plan.toolchainRoot} (keeping ${plan.disk.reserveMb} MB free).`,
    ...(plan.miseTooOld ? [`**mise ${String(plan.mise).split(/\s/)[0]} is too old: ${MIN_MISE} or newer is needed. ${UPGRADE}.**`]
      : plan.mise ? [] : ['**mise is not installed on this box: nothing can be installed until it is.**']),
    plan.needsApproval ? `**${plan.toApprove.length} row(s) wait for approval.**` : '**Nothing to install.**', '',
    '| # | Tool | Version | Status | Change | Size | Why |', '|---|---|---|---|---|---|---|',
    ...plan.rows.map((r) => `| ${r.id} | ${cell(r.tool)} | ${cell(r.version || r.requested)}${r.conflict ? ' ⚠ conflict' : ''} | ${cell(r.status)}${r.reason ? `: ${cell(r.reason)}` : ''} | ${cell(r.change)}${r.was ? ` (was ${cell(r.was)})` : ''} | ${size(r)} | ${cell(r.why)} |`),
  ];
  if (plan.removed.length) lines.push('', `No longer needed (dropped from the lock): ${plan.removed.map((l) => `${l.tool}@${l.version}`).join(', ')}`);
  if (plan.rejected.length) lines.push('', '## Rejected agent proposals', ...plan.rejected.map((r) => `- ${cell(r.tool) || '(unnamed)'}: ${cell(r.reason)}`));
  return lines.join('\n') + '\n';
}

export default async function ({ inputs, params, ctx, log }) {
  // First: a root we can write. Failing here is cheap; failing in Record after the installs is not.
  const root = await pickRoot(params.toolchainRoot);
  log('info', `toolchain root: ${root}`);
  const factsDoc = JSON.parse(await readFile(inputs.facts.path, 'utf8'));
  let proposals = [], bad = null;
  try {
    const p = JSON.parse(await readFile(inputs.proposals.path, 'utf8'));
    proposals = Array.isArray(p) ? p : Array.isArray(p?.proposals) ? p.proposals : null;
    if (!proposals) { bad = 'proposals.json is not an array'; proposals = []; }
  } catch (e) { bad = `proposals.json unreadable: ${e.message}`; }
  const reserveMb = Number(params.reserveMb ?? 2048);
  const projectDir = ctx.projectDir || ctx.cwd;
  const stateDir = join(root, 'projects', projectSlug(projectDir));
  await mkdir(stateDir, { recursive: true });
  let lock = null;
  try { lock = JSON.parse(await readFile(join(stateDir, 'toolchain.lock.json'), 'utf8')); } catch { /* first run */ }

  const env = await realEnv(root);
  try {
    if (env.miseTooOld) log('warn', `mise ${env.miseVersion} is below ${MIN_MISE}: every toolchain row will be not-possible-here`);
    else if (!env.mise) log('warn', 'mise is not on PATH: every toolchain row will be not-possible-here');
    const plan = await buildPlan({ facts: factsDoc.facts || [], capabilities: factsDoc.capabilities || [], proposals, lock, env, reserveMb });
    if (bad) plan.rejected.unshift({ tool: '', reason: bad });
    Object.assign(plan, { toolchainRoot: root, stateDir, projectDir, mise: env.miseVersion, miseTooOld: env.miseTooOld, generatedAt: new Date().toISOString(), firstRun: !lock });
    const count = (s) => plan.rows.filter((r) => r.status === s).length;
    const summary = `${plan.rows.length} rows: ${count('installable')} installable, ${count('not-possible-here')} not possible here, ${count('unknown-tool')} unknown, ${count('over-disk-budget')} over budget; ${plan.toApprove.length} to approve`;
    log('info', summary);
    return {
      summary,
      outputs: { plan: { value: plan }, summary: { value: renderSummary(plan) } },
      verdict: { summary, issues: plan.needsApproval
        ? [{ severity: 'major', title: `${plan.toApprove.length} toolchain change(s) wait for your approval`, detail: 'Routed to Approve; nothing is installed without it.' }]
        : [] },
    };
  } finally {
    await rm(env.scratch, { recursive: true, force: true });
  }
}
