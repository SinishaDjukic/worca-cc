// tools/readiness/report.mjs — #919 slice 3: one report object → report.json, report.md and the #919 comment.
export const SCHEMA = 'worca-readiness/1';
export const SECTIONS = Object.freeze([
  { id: 'verdict', title: 'Verdict' }, { id: 'dev-commit', title: 'Dev commit' }, { id: 'migration', title: 'Migration checks' },
  { id: 'suite', title: 'Test suite' }, { id: 'parity', title: 'Parity' }, { id: 'rollback', title: 'Rollback rehearsal' },
  { id: 'open-prs', title: 'Open PRs and dependabot branches' }, { id: 'baseline', title: 'Baseline comparison' },
  { id: 'moved', title: 'Files and lines moved per feature' }, { id: 'risks', title: 'Risks and surprises' },
  { id: 'inputs', title: 'Inputs and next steps' },
]);
/** Check id → section id. Every id must be present in a report. */
export const CHECKS = Object.freeze({
  'split-check': 'migration', 'dry-run-repeatable': 'migration', equivalence: 'migration', 'docs-and-package': 'migration',
  'suite-migrated': 'suite', parity: 'parity', rollback: 'rollback', 'open-prs': 'open-prs', baseline: 'baseline', 'gh-auth': 'inputs',
});
export const ROLLBACK_NOTE = 'Mechanics rehearsal of procedure A on a clone with no later dev commits. Procedure B is not rehearsed.';
export const GATE_NOTE = 'mechanics only; the split fails the spike gate';
export const SPLITTER_MISSING = 'splitter missing: tools/split-by-feature.mjs is not in the dev commit';
export const SPLITTER_NOTE = 'Cause: the dev commit has no `tools/split-by-feature.mjs`. The #919 tooling is not merged into dev, so no '
  + 'migrated tree was built, and every row after split-check fails for that reason, not because of the split.';
const CATCH_UP = ['works', 'needs hand fix', 'not run'];
const NO_RISKS = { note: 'not measured: no migrated tree', evidence: [{ label: 'summary', href: 'evidence/summary.txt' }] };
const COMMIT_URL = (repo, sha) => `https://github.com/${repo}/commit/${sha}`;

/** Tool-written text in a table cell. */
export const cell = (s) => String(s ?? '').replace(/\r?\n/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/\|/g, '\\|');
/** Untrusted text (PR titles, branch and file names) as a code span: no mention, link, Markdown or HTML runs inside it. */
export const code = (s) => {
  const t = String(s ?? '').replace(/\r?\n/g, ' ').replace(/`/g, "'").replace(/\|/g, '\\|').trim();
  return t ? `\`${t}\`` : '—';
};

/** Why split-check failed, from its detail: 'splitter-missing', 'spike-gate' or null. */
export function verdictCause(checks) {
  const sc = checks.find((c) => c.id === 'split-check');
  if (sc?.status !== 'fail') return null;
  if (String(sc.detail).startsWith(SPLITTER_MISSING)) return 'splitter-missing';
  return /^spike gate FAILED/.test(String(sc.detail)) ? 'spike-gate' : null;
}

export function buildReport({ repo, sha, ref = 'origin/dev', generatedAt, toolCommit, checks, openPrs = [], baseline = {}, moved = { features: [], largest: {} }, risks = NO_RISKS, inputs = {}, notLocal }) {
  const failing = checks.filter((c) => c.status !== 'pass').map((c) => c.id);
  return {
    schema: SCHEMA, generatedAt, toolCommit, repo,
    verdict: { value: failing.length ? 'no-go' : 'go', failing, cause: verdictCause(checks), evidence: [{ label: 'summary', href: 'evidence/summary.txt' }] },
    devCommit: { sha, ref, url: COMMIT_URL(repo, sha), evidence: [{ label: sha.slice(0, 9), href: COMMIT_URL(repo, sha) }, { label: 'fetch.log', href: 'evidence/fetch.log' }] },
    sections: SECTIONS.map((s, i) => ({ n: i + 1, ...s })),
    checks: checks.map((c) => ({ ...c, section: CHECKS[c.id] })), openPrs, baseline, moved, risks, inputs,
    ...(notLocal?.length ? { notLocal } : {}),
  };
}

export function validateReport(r) {
  const p = [];
  if (r.schema !== SCHEMA) p.push(`schema must be ${SCHEMA}`);
  if (!['go', 'no-go'].includes(r.verdict?.value)) p.push('verdict must be go or no-go');
  if (!r.verdict?.evidence?.length) p.push('verdict has no evidence');
  if (!/^[0-9a-f]{40}$/.test(r.devCommit?.sha ?? '')) p.push('dev commit must be a 40-character SHA');
  if (!r.devCommit?.evidence?.length) p.push('dev commit has no evidence');
  if (!r.risks?.evidence?.length) p.push('risks has no evidence');
  for (const id of Object.keys(CHECKS)) if (!r.checks.some((c) => c.id === id)) p.push(`missing check ${id}`);
  for (const c of r.checks) {
    if (!(c.id in CHECKS)) p.push(`unknown check ${c.id}`);
    if (!['pass', 'fail'].includes(c.status)) p.push(`${c.id}: status must be pass or fail, not ${c.status}`);
    if (!c.evidence?.length || c.evidence.some((e) => !e.href)) p.push(`${c.id}: no evidence link`);
  }
  for (const t of r.openPrs) if (typeof t.dev?.conflict !== 'boolean' || typeof t.split?.conflict !== 'boolean' || !t.action) p.push(`open PR ${t.number != null ? `#${t.number}` : 'branch'}: needs both conflict flags and one action`);
  for (const t of r.openPrs) if (t.catchUp && !CATCH_UP.includes(t.catchUp.verdict)) p.push(`open PR ${t.number != null ? `#${t.number}` : 'branch'}: catch-up verdict must be ${CATCH_UP.join(', ')}`);
  for (const x of r.risks?.ceilingRaises ?? []) {
    if (typeof x.file !== 'string' || typeof x.from !== 'number' || typeof x.to !== 'number' || !(x.from < x.to) || typeof x.why !== 'string' || !x.why) p.push(`ceiling raise ${x.file ?? '?'}: needs a file, numbers from < to and a why`);
  }
  if (r.notLocal !== undefined && (!Array.isArray(r.notLocal) || r.notLocal.some((x) => typeof x?.name !== 'string' || typeof x?.ci !== 'string'))) p.push('notLocal must be an array of { name, ci } strings');
  return p;
}

/** Every relative evidence href (verdict, dev commit, rows) must name a file under OUT. `exists(href)` checks one. */
export function missingEvidence(r, exists) {
  const hrefs = [...r.verdict.evidence, ...r.devCommit.evidence, ...(r.risks?.evidence ?? []), ...r.checks.flatMap((c) => c.evidence ?? [])].map((e) => e.href);
  return [...new Set(hrefs.filter((h) => !/^https:\/\//.test(h) && !exists(h)))].map((h) => `evidence file missing: ${h}`);
}

const links = (ev) => ev.map((e) => `[${cell(e.label)}](${e.href})`).join(' · ');
/** A row detail; a thrown step's `error: …` carries git/gh stderr, so that part is a code span (no live mention or link). */
const detailCell = (d) => (/^error: /.test(d ?? '') ? `error: ${code(d.slice(7))}` : cell(d));
const rowLine = (c) => `| ${c.id} | ${c.status === 'pass' ? '✔ pass' : '✖ fail'} | ${detailCell(c.detail)} | ${links(c.evidence)} |`;
const yesNo = (b) => (b ? 'yes' : 'no');
const n = (x) => Number(x).toLocaleString('en-US');
const cu = (t) => (!t.catchUp || t.catchUp.verdict === 'not run' ? 'not run' : t.catchUp.verdict === 'works' ? 'works'
  : `needs hand fix ${code(t.catchUp.reasons.join('; '))}`);
const deltaLine = (d) => (d.note ? cell(d.note)
  : `${code(d.probe)}: ${d.before.status}${d.before.csp ? '' : ' without CSP'} → ${d.after.status}${d.after.csp ? ' with the rendered shell CSP' : ''}`);

export function renderMarkdown(r) {
  const out = [`# #919 readiness dry run — ${r.verdict.value}`, '', `Generated ${r.generatedAt} by \`tools/readiness.mjs\` at ${r.toolCommit.slice(0, 9)}.`, ''];
  const rows = (sec) => { const cs = r.checks.filter((c) => c.section === sec); return cs.length ? ['| Check | Result | Detail | Evidence |', '|---|---|---|---|', ...cs.map(rowLine), ''] : []; };
  for (const s of r.sections) {
    out.push(`## ${s.n}. ${s.title}`, '');
    if (s.id === 'verdict') {
      out.push(`**${r.verdict.value}**${r.verdict.failing.length ? '' : ' — every check passes'} · ${links(r.verdict.evidence)}`, '');
      for (const id of r.verdict.failing) out.push(`- ${id}: ${detailCell(r.checks.find((c) => c.id === id)?.detail)}`);
      if (r.verdict.failing.length) out.push('');
      if (r.verdict.cause === 'splitter-missing') out.push(SPLITTER_NOTE, '');
      else if (r.verdict.cause === 'spike-gate') out.push(`The rollback rehearsal proves the revert ${GATE_NOTE}.`, '');
    }
    if (s.id === 'dev-commit') out.push(`\`${r.devCommit.sha}\` (${cell(r.devCommit.ref ?? 'origin/dev')}) · ${links(r.devCommit.evidence)}`, '');
    out.push(...rows(s.id));
    if (s.id === 'rollback') out.push(...(r.notLocal ?? []).map((x) => `Not run locally: ${code(x.name)} → CI job ${code(x.ci)}`), ...(r.notLocal?.length ? [''] : []), ROLLBACK_NOTE, '');
    if (s.id === 'open-prs') out.push(...(r.openPrs.length ? ['| # | Branch | Title | Conflicts with dev | Conflicts after the split | Action | Catch-up |', '|---|---|---|---|---|---|---|',
      ...r.openPrs.map((t) => `| ${t.number ? `[#${t.number}](${t.url})` : `[branch](${t.url})`} | ${code(t.branch)} | ${code(t.title)} | ${yesNo(t.dev.conflict)} | ${yesNo(t.split.conflict)}${t.split.files?.length ? ` ${code(t.split.files.join(', '))}` : ''} | ${t.action} | ${cu(t)} |`)]
      : ['No open PRs or dependabot branches.']), '');
    if (s.id === 'baseline' && r.baseline.rows) out.push('| Measure | dev | migrated |', '|---|---|---|', ...r.baseline.rows.map((b) => `| ${b.measure} | ${b.dev} | ${b.migrated} |`), '');
    if (s.id === 'moved') out.push('| Feature | Files | Lines |', '|---|---|---|', ...r.moved.features.map((f) => `| ${f.feature} | ${f.files.length} | ${f.lines} |`), '',
      '| Largest files on dev | Lines | Largest files after the split | Lines |', '|---|---|---|---|',
      ...(r.moved.largest.dev ?? []).map((d, i) => `| ${code(d.path)} | ${d.lines} | ${code(r.moved.largest.migrated?.[i]?.path)} | ${r.moved.largest.migrated?.[i]?.lines ?? ''} |`), '');
    // No sizes (no migrated tree): the note alone. Sizes present: the full section, the note standing in for the deltas.
    if (s.id === 'risks') out.push(...(r.risks.serverLines == null ? [`${cell(r.risks.note)} · ${links(r.risks.evidence)}`] : [
      `The owner signs these off on #919; a go without that sign-off is not a go. · ${links(r.risks.evidence)}`, '',
      ...(r.risks.note ? [`- Accepted served deltas: ${cell(r.risks.note)}`]
        : [`- Accepted served deltas: ${r.risks.acceptedDeltas.length}`, ...r.risks.acceptedDeltas.map((d) => `  - ${deltaLine(d)}`)]),
      `- Residual \`ui/server.mjs\`: ${r.risks.serverLines} lines, capped at ${r.risks.ceiling ?? 'no ceiling'} (\`tools/split-by-feature/size-caps.json\`), not under 1,000`,
      ...(r.risks.ceilingRaises ?? []).map((x) => `- Ceiling raised: \`${cell(x.file)}\` ${n(x.from)} → ${n(x.to)} lines (${cell(x.why)}): needs the owner's sign-off`),
      `- Routes pinned in \`ui/server.mjs\`: ${r.risks.pins} (\`tools/split-by-feature/pinned.json\`)`]), '');
    if (s.id === 'inputs') out.push(`- Go/no-go owner: ${cell(r.inputs.owner ?? 'not recorded yet')}`, `- Freeze window: ${cell(r.inputs.freezeWindow ?? 'not recorded yet')}`,
      `- Known flaky failures seen: ${r.inputs.flaky?.length ?? 0}`, '');
  }
  return out.join('\n');
}

export const MAX_BODY = 60000;
export const anchor = (href) => `ev-${href.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
/** A relative evidence link in report.md: evidence/…, crawl/…, parity/…, parity-reverted/… (no `..`, no spaces). */
export const EVIDENCE_LINK = /\]\(((?:evidence|crawl|parity(?:-[a-z]+)?)\/(?:[\w-][\w.-]*\/)*[\w-][\w.-]*)\)/g;
/** The #919 comment: the marker line, report.md with relative links turned into #ev- anchors, then one Evidence
 *  entry per distinct linked href, in link order, so every anchor has exactly one `<a id>` target.
 *  `read(href)` returns the file's text or null; `clean(s)` rewrites paths; `flag(s)` returns scan findings for one
 *  tail ([] = keep it). An omitted or missing tail keeps its anchor and says why.
 *  Returns { marker, text, omitted: [{ href, reason }] }. */
export function commentBody(r, md, read, { clean = (s) => s, flag = () => [] } = {}) {
  const marker = `**Readiness dry run** · dev ${r.devCommit.sha.slice(0, 9)} · ${r.generatedAt}`;
  const hrefs = [...new Set([...md.matchAll(EVIDENCE_LINK)].map((m) => m[1]))];
  const body = clean(md.replace(EVIDENCE_LINK, (_, h) => `](#${anchor(h)})`));
  const omitted = [];
  const kept = hrefs.map((href) => {
    const raw = read(href);
    if (raw == null) { omitted.push({ href, reason: 'no such file' }); return { href, text: '', note: `tail not attached: no such file; see $OUT/${href}` }; }
    const text = clean(raw.split('\n').slice(-40).join('\n'));
    const hits = flag(text);
    if (!hits.length) return { href, text, note: null };
    const reason = `the secret scan flagged line ${hits[0].line} (${hits[0].label})`;
    omitted.push({ href, reason });
    return { href, text: '', note: `tail omitted: ${reason}; see $OUT/${href}` };
  });
  const render = () => [marker, '', body, '', '## Evidence', '', ...kept.flatMap((t) => [`<a id="${anchor(t.href)}"></a>`,
    `<details><summary>${cell(t.href)}</summary>`, '',
    ...(t.note ? [t.note] : ['```text', t.text.replaceAll('```', "'''"), '```']), '</details>', ''])].join('\n');
  let text = render();
  while (text.length > MAX_BODY && kept.some((t) => t.text)) {
    const big = kept.reduce((a, b) => (b.text.length > a.text.length ? b : a));
    big.text = ''; big.note = `tail omitted: too long; see $OUT/${big.href}`;
    omitted.push({ href: big.href, reason: 'too long' }); text = render();
  }
  return { marker, text, omitted };
}
