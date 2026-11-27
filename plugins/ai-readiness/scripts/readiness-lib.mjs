// plugins/ai-readiness/scripts/readiness-lib.mjs — rubric arithmetic, shared by the probe and
// the report scripts. Pure: no I/O. The agents judge the dimensions; everything that is a rule
// (weights, tool surfaces, the overall, severities, the pass gate) lives here so it is tested.

export const CORE_WEIGHTS = Object.freeze({ commands: 25, architecture: 15, conventions: 15, gotchas: 15, tests: 15, recurringTasks: 15 });
/** How much of the core a tool sees, by what the probe found on its instruction surface. */
export const SURFACES = Object.freeze({ missing: 0, 'skills-only': 30, partial: 50, 'self-sufficient': 100 });
export const PASS_MARK = 80;
/** The skills folder each engine reads (the rubric's "Files per tool"; the probe's SKILLS_OF agrees). */
export const SKILLS_FOLDER = Object.freeze({
  claude: '.claude/skills/', qwen: '.qwen/skills/',
  codex: '.agents/skills/', copilot: '.agents/skills/', cursor: '.agents/skills/', gemini: '.agents/skills/', opencode: '.agents/skills/', goose: '.agents/skills/',
});
const FOLDER_ORDER = ['.claude/skills/', '.agents/skills/', '.qwen/skills/'];
/** The engine's own file, which setup writes as exactly `@AGENTS.md`. */
const IMPORT_FILE = Object.freeze({ claude: 'CLAUDE.md', gemini: 'GEMINI.md' });
/** Never created by setup; an existing one is only added to, improved or left alone. */
const COPILOT_INSTRUCTIONS = '.github/copilot-instructions.md';
const SEVERITY_ORDER = ['critical', 'major', 'minor', 'suggestion'];
/** The probe's cap marker at the end of a long side-effect list ("+12 more"); not a path. */
const MORE = /^\+\d+ more$/;

const isScore = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
const str = (v) => (typeof v === 'string' ? v : '');
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** The engines to score: the view's `engines` when given (worca's run engines), else any id the caller names. */
const knownEngine = (engines) => (Array.isArray(engines) ? (t) => engines.includes(t) : (t) => typeof t === 'string' && t !== '');
/** A tool's display name: the view's label for it, else its id capitalised. */
const labelOf = (labels, t) => (isObj(labels) && typeof labels[t] === 'string' && labels[t] ? labels[t] : `${String(t).charAt(0).toUpperCase()}${String(t).slice(1)}`);

export function coreScore(dimensions = {}) {
  let num = 0;
  let den = 0;
  for (const [k, w] of Object.entries(CORE_WEIGHTS)) {
    if (!isScore(dimensions?.[k])) continue;
    num += w * clamp(dimensions[k]);
    den += w;
  }
  return den ? Math.round(num / den) : null;
}

export function toolScores(core, surfaces = {}, selected = [], engines = null) {
  const out = {};
  const known = knownEngine(engines);
  for (const t of selected) {
    if (!known(t)) continue;
    const factor = SURFACES[surfaces[t]] ?? 0;
    out[t] = core === null ? null : Math.round((core * factor) / 100);
  }
  return out;
}

/** "Ready" means ready in every tool you use: the lowest selected tool. */
export function overallScore(core, tools = {}) {
  const vals = Object.values(tools).filter(isScore);
  return vals.length ? Math.min(...vals) : core;
}

/** Severity from the points a dimension loses: weight × shortfall. */
export function dimensionSeverity(key, score) {
  if (!Object.hasOwn(CORE_WEIGHTS, key) || !isScore(score)) return null;
  const w = CORE_WEIGHTS[key];
  const loss = (w * (100 - clamp(score))) / 100;
  if (loss >= 10) return 'critical';
  if (loss >= 5) return 'major';
  if (loss >= 2) return 'minor';
  return 'suggestion';
}

/** A selected tool's surface gap. The hard-failure rule (critical) applies to Re-score only. */
export function toolSeverity(surface, { final = false } = {}) {
  if (surface === 'self-sufficient') return null;
  return final ? 'critical' : 'major';
}

/** A documented command that fails or times out after setup is a hard failure only when setup is to
    blame: Seed tests wrote it (`seeded`), or it passed in the baseline probe (`baselineStatus`). A
    suite that was red or slow before setup never dead-ends it. */
function hardFailuresOf(probe, selected = [], labels = null) {
  const out = [];
  for (const c of Array.isArray(probe.commands) ? probe.commands : []) {
    if (c && c.documented && (c.status === 'fail' || c.status === 'timeout') && (c.seeded === true || c.baselineStatus === 'pass')) {
      out.push({ severity: 'critical', title: `Documented command fails: ${str(c.command)}`,
        detail: `exit ${c.exitCode ?? 'none'} (${c.status})`, location: str(c.documentedIn) });
    }
  }
  const inUse = skillFolders(selected);
  for (const f of Array.isArray(probe.frontmatter) ? probe.frontmatter : []) {
    const path = str(f.path);
    const folder = FOLDER_ORDER.find((d) => path.startsWith(d.split('/')[0] + '/'));
    if (!folder || inUse.includes(folder)) {
      out.push({ severity: 'critical', title: `Skill frontmatter does not parse: ${path}`, detail: str(f.error), location: path });
    }
  }
  // The chip's size limits (the view's `limits`), measured by the probe: a file a selected engine reads
  // that is over the per-file limit, and a selected engine whose files together pass the total.
  const kib = (n) => Math.round(Number(n) / 1024);
  const filesOf = (t) => (Array.isArray(probe.tools?.[t]?.files) ? probe.tools[t].files : []);
  const over = isObj(probe.overCap) ? probe.overCap : {};
  for (const f of Array.isArray(over.files) ? over.files : []) {
    if (!selected.some((t) => filesOf(t).includes(f))) continue;
    out.push({ severity: 'critical', title: `${f} is over the ${kib(probe.limits?.perFile)} KiB per-file limit`,
      detail: isScore(probe.sizes?.[f]) ? `${probe.sizes[f]} bytes` : '', location: str(f) });
  }
  for (const t of Array.isArray(over.engines) ? over.engines : []) {
    if (!selected.includes(t)) continue;
    out.push({ severity: 'critical', title: `${labelOf(labels, t)}'s instruction files are over the ${kib(probe.limits?.total)} KiB total limit`,
      detail: filesOf(t).join(', '), location: str(probe.tools?.[t]?.expected) });
  }
  return out;
}

/** The skills folders in use for the selected engines, in card B's row order. */
export function skillFolders(selected = []) {
  const sel = Array.isArray(selected) ? selected : [];
  return FOLDER_ORDER.filter((d) => sel.some((t) => SKILLS_FOLDER[t] === d));
}

/** The rubric's "Files per tool" for the selected engines: the instruction-file rows and one row per
    skills folder in use (`skills: false` when no task becomes a skill), each with the engines it serves,
    and `existing`, the planned files already in the repository (`present`). Path rules (Claude,
    Cursor, Copilot) are per rule, so they are not here. `.github/copilot-instructions.md` is planned
    only when it exists, Copilot is selected and it needs a change (`copilotNeedsChange`, as the Plan
    prompt decides): it is never created.
    This mirrors the rubric's planning rule so the tests can pin it; no script calls it at runtime. */
export function plannedFiles(selected = [], { present = [], skills = true, copilotNeedsChange = false } = {}) {
  const sel = [...new Set(Array.isArray(selected) ? selected : [])].filter((t) => Object.hasOwn(SKILLS_FOLDER, t));
  if (!sel.length) return { files: [], existing: [] };
  const has = (p) => Array.isArray(present) && present.includes(p);
  const files = [{ id: 'AGENTS.md', tools: sel }];
  for (const [t, f] of Object.entries(IMPORT_FILE)) if (sel.includes(t)) files.push({ id: f, tools: [t] });
  if (sel.includes('copilot') && copilotNeedsChange && has(COPILOT_INSTRUCTIONS)) files.push({ id: COPILOT_INSTRUCTIONS, tools: ['copilot'] });
  if (skills) for (const d of skillFolders(sel)) files.push({ id: d, tools: sel.filter((t) => SKILLS_FOLDER[t] === d) });
  return { files, existing: files.filter((r) => !r.id.endsWith('/') && has(r.id)).map((r) => r.id) };
}

const bySeverity = (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);

export function scoreCard(judgement, probe, { final = false, engines, labels } = {}) {
  const p = isObj(probe) ? probe : {};
  const j = isObj(judgement) && !judgement.mock ? judgement : {};
  const dimensions = {};
  for (const k of Object.keys(CORE_WEIGHTS)) dimensions[k] = isScore(j.dimensions?.[k]) ? clamp(j.dimensions[k]) : null;
  const core = isObj(j.dimensions) ? coreScore(dimensions) : null;
  const valid = isObj(judgement) && isObj(judgement.dimensions) && !judgement.mock && core !== null;

  const rawSelected = Array.isArray(p.selectedTools) ? p.selectedTools : [];
  const known = knownEngine(engines ?? p.engines);
  const names = labels ?? p.labels;
  const selected = [...new Set(rawSelected)].filter(known);
  const surfaces = Object.fromEntries(selected.map((t) => {
    const s = p.tools?.[t]?.surface;
    return [t, Object.hasOwn(SURFACES, s) ? s : 'missing'];
  }));
  const scores = toolScores(core, surfaces, selected, engines ?? p.engines);
  const tools = Object.fromEntries(selected.map((t) => [t, {
    surface: surfaces[t], score: scores[t] ?? null, label: labelOf(names, t), file: Array.isArray(p.tools?.[t]?.files) ? p.tools[t].files.map(str).filter(Boolean).join(', ') : str(p.tools?.[t]?.file), why: str(p.tools?.[t]?.why),
  }]));
  const overall = valid ? overallScore(core, scores) : null;
  const gaps = [];
  for (const g of Array.isArray(j.gaps) ? j.gaps : []) {
    if (!isObj(g) || !Object.hasOwn(CORE_WEIGHTS, g.dimension)) continue;
    gaps.push({ id: str(g.id) || `g${gaps.length + 1}`, dimension: g.dimension,
      severity: dimensionSeverity(g.dimension, dimensions[g.dimension]) || 'suggestion',
      title: str(g.title), detail: str(g.detail), fix: str(g.fix), location: str(g.location) });
  }
  for (const t of selected) {
    const severity = toolSeverity(surfaces[t], { final });
    if (!severity) continue;
    gaps.push({ id: `tool-${t}`, dimension: 'tool', tool: t, severity,
      title: `${labelOf(names, t)}: instructions ${surfaces[t].replace('-', ' ')}`,
      detail: str(p.tools?.[t]?.why), fix: `Write or complete ${str(p.tools?.[t]?.expected) || 'its instruction file'}`,
      location: str(p.tools?.[t]?.expected) });
  }
  gaps.sort(bySeverity);
  const hardFailures = final ? hardFailuresOf(p, selected, names) : [];
  return {
    valid, core, dimensions, reasons: isObj(j.reasons) ? j.reasons : {}, tools, overall,
    pass: valid && isScore(overall) && overall >= PASS_MARK && hardFailures.length === 0,
    gaps, hardFailures,
    codeHealth: str(j.codeHealth), whatExists: str(j.whatExists), summary: str(j.summary),
    sideEffects: Array.isArray(p.sideEffects) ? p.sideEffects : [],
    restoreFailed: Array.isArray(p.restoreFailed) ? p.restoreFailed.filter((s) => typeof s === 'string') : [],
  };
}

/** The card's gap rows, derived at render time; the card JSON keeps every item. Core-dimension gaps
    collapse into one headline per dimension (`kind: 'dimension'`, its items in their order), at the
    dimension's severity. Other gaps (a selected tool's surface) stay rows of their own
    (`kind: 'gap'`). Sorted by severity, then by points lost (weight × shortfall); a separate row
    comes after the headlines of its severity, as it did before. */
export function gapRows(gaps = [], dimensions = {}) {
  const rows = [];
  const byDim = new Map();
  for (const g of Array.isArray(gaps) ? gaps : []) {
    if (!isObj(g)) continue;
    if (!Object.hasOwn(CORE_WEIGHTS, g.dimension)) { rows.push({ kind: 'gap', ...g, lost: -1 }); continue; }
    let row = byDim.get(g.dimension);
    if (!row) {
      const score = dimensions?.[g.dimension];
      const lost = isScore(score) ? (CORE_WEIGHTS[g.dimension] * (100 - clamp(score))) / 100 : 0;
      row = { kind: 'dimension', dimension: g.dimension, label: g.dimension, severity: g.severity, lost, items: [] };
      byDim.set(g.dimension, row);
      rows.push(row);
    }
    row.items.push(g);
  }
  const rank = (s) => { const i = SEVERITY_ORDER.indexOf(s); return i === -1 ? SEVERITY_ORDER.length : i; };
  return rows.map((r, i) => [r, i])
    .sort(([a, i], [b, k]) => rank(a.severity) - rank(b.severity) || b.lost - a.lost || i - k)
    .map(([r]) => r);
}

export function mergeMembers(cardsByKey) {
  const keys = Object.keys(cardsByKey).sort();
  const cards = keys.map((k) => cardsByKey[k]);
  const scored = cards.map((c) => c.overall).filter(isScore);
  // A workspace is ready only when every member is: the overall is the lowest member's score,
  // and one member that does not pass blocks the run.
  const overall = scored.length ? Math.min(...scored) : null;
  const valid = cards.length > 0 && cards.every((c) => c.valid);
  const blocked = keys.filter((k) => !cardsByKey[k].pass);
  const pass = valid && blocked.length === 0 && isScore(overall);
  const prefix = (k, x) => ({ ...x, id: `${k}:${x.id ?? ''}`, title: `${k}: ${x.title}`, location: x.location ? `${k}/${x.location}` : '' });
  return {
    valid, core: null, dimensions: {}, reasons: {}, tools: {},
    overall, pass, blocked,
    gaps: keys.flatMap((k) => cardsByKey[k].gaps.map((g) => prefix(k, g))).sort(bySeverity),
    hardFailures: keys.flatMap((k) => cardsByKey[k].hardFailures.map((h) => prefix(k, h))),
    codeHealth: '', whatExists: '', summary: '', sideEffects: keys.flatMap((k) => cardsByKey[k].sideEffects.map((s) => (typeof s !== 'string' ? '' : MORE.test(s) ? `${k}: ${s}` : `${k}/${s}`))).filter(Boolean),
    restoreFailed: keys.flatMap((k) => (cardsByKey[k].restoreFailed || []).map((s) => `${k}/${s}`)),
    members: Object.fromEntries(keys.map((k) => [k, cardsByKey[k]])),
  };
}

const CHIP_OUTSIDE = ['git.repo', 'deps.lockfile', 'secrets.tracked-names'];
const CHIP_REPO_BLOCKING = ['ignore.heavy-dirs', 'commands.test'];
const failText = (r) => [str(r.detail), str(r.fix) ? `Fix: ${str(r.fix)}` : ''].filter(Boolean).join(' ');

/** The chip's rule over one project's fresh `api.readiness`, `{ engines, labels, judged, report }`.
    `blocking`: a blocker/warn tool check that fails for any engine in union(judged, tools), and a
    failing ignore.heavy-dirs or commands.test. `outside`: failing git.repo, deps.lockfile and
    secrets.tracked-names, which setup cannot fix, so they never block. A skip, error or ignored row
    never fails (a Folder project's git-only checks are skips). */
export function chipGate(view, tools = []) {
  const rows = Array.isArray(view?.report?.checks) ? view.report.checks.filter((r) => isObj(r) && r.status === 'fail') : [];
  const engines = new Set([...(Array.isArray(view?.judged) ? view.judged : []), ...(Array.isArray(tools) ? tools : [])]);
  const blocking = [];
  const outside = [];
  for (const r of rows) {
    if (CHIP_OUTSIDE.includes(r.id)) outside.push({ id: r.id, title: str(r.title) || r.id, detail: str(r.detail), fix: str(r.fix) });
    else if (CHIP_REPO_BLOCKING.includes(r.id)) blocking.push({ severity: 'critical', title: str(r.title) || r.id, detail: failText(r), location: '' });
    else if (r.scope === 'tool' && engines.has(r.engine) && (r.severity === 'blocker' || r.severity === 'warn')) {
      blocking.push({ severity: 'critical', title: `${labelOf(view.labels, r.engine)}: ${str(r.title) || r.id}`, detail: failText(r), location: '' });
    }
  }
  return { blocking, outside };
}

/** Setup never creates .github/copilot-instructions.md: a hard failure when the baseline probe had
    none and the final probe has one. Null when either probe is unreadable or nothing was created. */
export function copilotCreated(baselineProbe, finalProbe) {
  const at = (p) => p?.files?.[COPILOT_INSTRUCTIONS]?.exists;
  if (at(baselineProbe) !== false || at(finalProbe) !== true) return null;
  return { severity: 'critical', title: `Setup never creates ${COPILOT_INSTRUCTIONS}`, detail: `${COPILOT_INSTRUCTIONS} did not exist before setup and does now. Delete it; an existing one may only be changed.`, location: COPILOT_INSTRUCTIONS };
}

/** The Re-score gate: blocking below the pass mark or on any hard failure. A pass has no issues.
    `chip` adds the chip's blocking findings: `{ blocking }`, or `{ members: { key: { blocking } } }`;
    a member with one is blocked too. The result's `blocked` is the members to fix. */
export function verdictFor(card, chip = null) {
  if (isObj(card.members)) {
    const issues = [];
    // A judged member with chip findings, or with no card at all (no judgement to pass), is blocked too.
    const withChip = Object.keys(chip?.members || {}).filter((k) => !card.members[k] || chip.members[k]?.blocking?.length);
    const blocked = [...new Set([...(card.blocked || []), ...withChip])].sort();
    for (const k of blocked) {
      const m = card.members[k];
      for (const c of chip?.members?.[k]?.blocking || []) issues.push({ ...c, title: `${k}: ${c.title}`, location: c.location ? `${k}/${c.location}` : '' });
      if (!m) { issues.push({ severity: 'critical', title: `No judgement for ${k}`, detail: `The re-score judged no member ${k}; the chip judges it, so it must be scored too.`, location: '' }); continue; }
      if (!m.valid) { issues.push({ severity: 'critical', title: `${k}: the re-score judgement is missing or unreadable`, detail: `No readable judgement for ${k}.`, location: '' }); continue; }
      for (const h of m.hardFailures) issues.push({ ...h, title: `${k}: ${h.title}`, location: h.location ? `${k}/${h.location}` : '' });
      if (isScore(m.overall) && m.overall < PASS_MARK) {
        issues.push({ severity: 'critical', title: `${k}: score ${m.overall}/100 is below the pass mark ${PASS_MARK}`, detail: `${k} must reach ${PASS_MARK} on its own; the workspace is ready only when every member is.`, location: '' });
        for (const g of m.gaps.filter((x) => ['critical', 'major', 'minor'].includes(x.severity))) {
          issues.push({ severity: 'major', title: `${k}: ${g.title}`, detail: [g.detail, g.fix].filter(Boolean).join(' Fix: '), location: g.location ? `${k}/${g.location}` : '' });
        }
      }
    }
    return { issues, blocked, summary: issues.length ? `Blocked: ${blocked.join(', ')}; ${issues.length} finding(s); lowest member ${card.overall ?? '—'}/100.` : `Passed: every member at ${card.overall}/100 or above.` };
  }
  const issues = [...(card.hardFailures || []), ...(chip?.blocking || [])];
  if (!card.valid) {
    issues.unshift({ severity: 'critical', title: 'The re-score judgement is missing or unreadable', detail: 'Re-score wrote no judgement JSON this worca run could read.', location: '' });
  } else if (!isScore(card.overall) || card.overall < PASS_MARK) {
    issues.unshift({ severity: 'critical', title: `Score ${card.overall ?? '—'}/100 is below the pass mark ${PASS_MARK}`, detail: 'Fix the gaps below.', location: '' });
    for (const g of card.gaps || []) {
      if (g.severity === 'critical' || g.severity === 'major' || g.severity === 'minor') issues.push({ severity: 'major', title: g.title, detail: [g.detail, g.fix].filter(Boolean).join(' Fix: '), location: g.location });
    }
    if (isObj(card.dimensions)) {
      for (const key of Object.keys(CORE_WEIGHTS)) {
        const dimSeverity = dimensionSeverity(key, card.dimensions[key]);
        if (!dimSeverity || dimSeverity === 'suggestion') continue;
        if (!(card.gaps || []).some((g) => g.dimension === key)) {
          issues.push({ severity: 'major', title: `${key} scored ${card.dimensions[key]}/100`, detail: 'The judgement listed no gap for it.', location: '' });
        }
      }
    }
  }
  const summary = issues.length ? `Blocked: ${issues.length} finding(s); score ${card.overall ?? '—'}/100.` : `Passed at ${card.overall}/100.`;
  return { issues, summary };
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const kept = (items, ok) => (Array.isArray(items) ? items.filter((i) => isObj(i) && ok(i.verdict)) : []);
const confirmed = (v) => v === undefined || v === 'confirm';
const correct = (v) => v === undefined || v === 'correct' || v === 'slow';

/** What one workspace member should know about the others: who it uses, who uses it, how to run them together. */
function relationText(map, key) {
  const isMember = (k) => isObj(map?.members) && Object.hasOwn(map.members, k);
  const rel = Array.isArray(map?.relations) ? map.relations.filter((r) => isObj(r) && typeof r.how === 'string' && isMember(r.from) && isMember(r.to)) : [];
  const parts = [
    ...rel.filter((r) => r.from === key && r.to !== key).map((r) => `${r.to} (${r.how})`),
    ...rel.filter((r) => r.to === key && r.from !== key).map((r) => `${r.from} (uses it: ${r.how})`),
  ];
  const lines = [];
  if (parts.length) lines.push(`Related repositories: ${parts.join('; ')}.`.slice(0, 800));
  if (parts.length && typeof map.runTogether === 'string' && map.runTogether.trim()) lines.push(`Run together: ${map.runTogether.trim()}`.slice(0, 300));
  return lines.join('\n');
}

/** The project profile worca stores after the run (src/core/project-profile.mjs sanitises it). */
export function profileOf(map, card, { phase }) {
  const one = (m, c) => ({
    version: 1, source: 'ai-readiness', phase,
    summary: str(m?.summary), architecture: str(m?.architecture), stack: isObj(m?.stack) ? m.stack : {},
    conventions: Array.isArray(m?.conventions) ? m.conventions.filter((s) => typeof s === 'string') : [],
    entryPoints: Array.isArray(m?.entryPoints) ? m.entryPoints.filter((s) => typeof s === 'string') : [],
    commands: kept(m?.commands, correct).map((x) => ({ kind: str(x.kind), command: str(x.command) })),
    gotchas: kept(m?.gotchas, confirmed).map((x) => str(x.text)),
    recurringTasks: kept(m?.recurringTasks, confirmed).map((x) => ({ id: str(x.id), name: str(x.name) })),
    tools: Array.isArray(m?.tools) ? m.tools : [],
    score: { overall: c?.overall ?? null, core: c?.core ?? null,
      tools: Object.fromEntries(Object.entries(c?.tools || {}).map(([t, v]) => [t, v?.score ?? null])) },
  });
  if (isObj(map?.members)) {
    // Card A confirms one tool list for the whole workspace, at the map's top level (the probe reads it the same way).
    const tools = Array.isArray(map.tools) ? map.tools : null;
    return { version: 1, members: Object.fromEntries(Object.keys(map.members).sort()
      .map((k) => {
        let m = tools ? { ...map.members[k], tools } : map.members[k];
        const extra = relationText(map, k);
        if (extra) m = { ...m, architecture: str(m?.architecture) ? `${str(m.architecture)}\n${extra}` : extra };
        return [k, one(m, card?.members?.[k])];
      })) };
  }
  return one(map, card);
}
