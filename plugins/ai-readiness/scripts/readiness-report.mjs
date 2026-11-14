// plugins/ai-readiness/scripts/readiness-report.mjs — turns the agents' judgement and the probe
// into the scorecard (md, json, html) and, as the Gate card, into the Re-score verdict. The
// agents never compute a score or write HTML.
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { profileOf, scoreCard, mergeMembers, verdictFor, chipGate, copilotCreated, escapeHtml, gapRows, PASS_MARK, CORE_WEIGHTS } from './readiness-lib.mjs';

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The view's engines and labels for one project (a workspace view holds one per member). */
const viewOf = (view, key) => {
  const v = key !== undefined && isObj(view?.members) ? view.members[key] : view;
  return isObj(v) && Array.isArray(v.engines) ? { engines: v.engines, labels: isObj(v.labels) ? v.labels : {} } : {};
};

export function buildCard(judgement, probe, { final, view = null }) {
  const jm = isObj(judgement) && isObj(judgement.members) ? judgement.members : null;
  const pm = isObj(probe) && isObj(probe.members) ? probe.members : null;
  if (jm || pm) {
    // Every member the probe measured gets a card. A member with no judgement is scored from
    // null, which is invalid, so it blocks the gate instead of dropping out of the mean.
    const cards = {};
    for (const key of [...new Set([...Object.keys(jm || {}), ...Object.keys(pm || {})])].sort()) {
      cards[key] = scoreCard(jm?.[key] ?? null, pm?.[key], { final, ...viewOf(view, key) });
    }
    return mergeMembers(cards);
  }
  return scoreCard(judgement, probe, { final, ...viewOf(view) });
}

const fmt = (v) => (typeof v === 'number' ? `${v}` : '—');
const invalidMembers = (card) => (card.members ? Object.keys(card.members).filter((k) => !card.members[k].valid) : []);
/** Why a card has no score; a workspace card names the members whose judgement is missing. */
const invalidNote = (card) => {
  const bad = invalidMembers(card);
  return bad.length
    ? `no readable judgement for ${bad.join(', ')}. The other members' scores are below.`
    : 'the judgement JSON was missing or unreadable.';
};
const items = (n) => `${n} item${n === 1 ? '' : 's'}`;
/** The gap rows to render, one list per scope: the card itself, or each workspace member under its
    own heading (its locations carry the member prefix, as the card JSON's merged gaps do). */
const gapScopes = (card) => (card.members
  ? Object.entries(card.members).map(([k, m]) => ({ heading: k, rows: gapRows(m.gaps, m.dimensions), loc: (l) => (l ? `${k}/${l}` : '') }))
  : [{ heading: null, rows: gapRows(card.gaps, card.dimensions), loc: (l) => l || '' }]);
const deltaLine = (card, baseline) => {
  const b = baseline && typeof baseline.overall === 'number' ? baseline.overall : null;
  if (b === null || typeof card.overall !== 'number') return '';
  const d = card.overall - b;
  return `Started at ${b}/100, now ${card.overall}/100 (${d >= 0 ? '+' : ''}${d}).`;
};

function cardMarkdown(card) {
  const lines = [];
  if (Object.keys(card.tools).length) {
    lines.push('| Tool | Instructions | Score |', '|---|---|---:|');
    for (const [t, v] of Object.entries(card.tools)) lines.push(`| ${v.label ?? t} | ${v.surface} | ${fmt(v.score)} |`);
    lines.push('');
  }
  lines.push(`Core: ${fmt(card.core)}/100`, '', '| Dimension | Score | Why |', '|---|---:|---|');
  for (const k of Object.keys(CORE_WEIGHTS)) lines.push(`| ${k} | ${card.dimensions[k] ?? 'n/a'} | ${String(card.reasons[k] || '').replace(/\|/g, '\\|')} |`);
  return lines.join('\n');
}

export function renderMarkdown(card, baseline, claude = null) {
  const out = [`# AI-readiness: ${card.valid ? `${fmt(card.overall)}/100` : 'No score'}`, ''];
  if (!card.valid) out.push(`No score: ${invalidNote(card)}`, '');
  const delta = deltaLine(card, baseline);
  if (delta) out.push(delta, '');
  out.push(card.members
    ? `Pass mark ${PASS_MARK}. The overall score is the lowest member's score; every member must reach the pass mark.`
    : `Pass mark ${PASS_MARK}. The overall score is the lowest selected tool's score.`, '');
  if (card.members) {
    for (const [k, m] of Object.entries(card.members)) out.push(`## ${k}: ${m.valid ? `${fmt(m.overall)}/100` : 'No score'}`, '', cardMarkdown(m), '');
  } else out.push(cardMarkdown(card), '');
  out.push('## Gaps', '');
  const line = (g, loc) => `${g.title}${g.fix ? ` — ${g.fix}` : ''}${loc(g.location) ? ` (\`${loc(g.location)}\`)` : ''}`;
  for (const [i, { heading, rows, loc }] of gapScopes(card).entries()) {
    if (heading !== null) out.push(...(i ? [''] : []), `### ${heading}`, '');
    if (!rows.length) out.push('None.');
    for (const r of rows) {
      if (r.kind === 'dimension') out.push(`- **${r.severity}** ${r.label}: ${items(r.items.length)}`, ...r.items.map((g) => `  - ${line(g, loc)}`));
      else out.push(`- **${r.severity}** ${line(r, loc)}`);
    }
  }
  if (claude) out.push(...claudeMarkdown(claude));
  if (card.hardFailures.length) {
    out.push('', '## Hard failures', '');
    for (const h of card.hardFailures) out.push(`- ${h.title}${h.detail ? ` — ${h.detail}` : ''}`);
  }
  if (card.outsideSetup?.length) {
    out.push('', '## Outside setup', '', 'Not something setup can fix, so it did not block the run:', '');
    for (const o of card.outsideSetup) out.push(`- ${o.member ? `${o.member}: ` : ''}${o.title}${o.detail ? ` — ${o.detail}` : ''}${o.fix ? ` Fix: ${o.fix}` : ''}`);
  }
  if (card.sideEffects.length) out.push('', '## Files a probed command wrote (restored)', '', ...card.sideEffects.map((s) => `- \`${s}\``));
  if ((card.restoreFailed || []).length) out.push('', '## Files a probed command wrote and the probe could not restore', '', ...card.restoreFailed.map((s) => `- \`${s}\``));
  if (card.codeHealth) out.push('', '## Code health', '', card.codeHealth);
  if (card.whatExists) out.push('', '## What exists', '', card.whatExists);
  return `${out.join('\n')}\n`;
}

export function renderHtml(card, baseline, claude = null) {
  const e = escapeHtml;
  const json = JSON.stringify(card).replace(/</g, '\\u003c');
  const gapBody = (g, loc) => `<b>${e(g.title)}</b>${g.fix ? `<div>${e(g.fix)}</div>` : ''}${loc(g.location) ? `<code>${e(loc(g.location))}</code>` : ''}`;
  const gapRow = (r, loc) => `<li class="gap ${e(r.severity)}"><span class="chip">${e(r.severity)}</span> ${r.kind === 'dimension'
    ? `<b>${e(`${r.label}: ${items(r.items.length)}`)}</b><ul>${r.items.map((g) => `<li>${gapBody(g, loc)}</li>`).join('')}</ul>`
    : gapBody(r, loc)}</li>`;
  const gaps = gapScopes(card).map(({ heading, rows, loc }) => `${heading === null ? '' : `<h3>${e(heading)}</h3>`}<ul>${rows.map((r) => gapRow(r, loc)).join('') || '<li class="gap">None.</li>'}</ul>`).join('\n');
  const section = (c) => {
    const tools = Object.entries(c.tools).map(([t, v]) => `<div class="card"><h3>${e(v.label ?? t)}</h3><div class="big">${e(fmt(v.score))}</div><div>${e(v.surface)}</div></div>`).join('');
    const dims = Object.keys(CORE_WEIGHTS).map((k) => {
      const v = c.dimensions[k];
      return `<div class="card"><h3>${e(k)}</h3><div class="bar"><span style="width:${typeof v === 'number' ? v : 0}%"></span></div><div>${v === null || v === undefined ? 'n/a' : e(v)}</div><p>${e(c.reasons[k] || '')}</p></div>`;
    }).join('');
    return `<h3>Tools</h3><div class="grid">${tools || '<p>No tool selected.</p>'}</div>
<h3>Core ${e(fmt(c.core))}/100</h3><div class="grid">${dims}</div>`;
  };
  // A workspace card has empty top-level tools and dimensions: one section per member instead.
  const body = card.members
    ? Object.entries(card.members).map(([k, m]) => `<section><h2>${e(k)}: ${m.valid ? `${e(fmt(m.overall))}/100` : 'No score'}</h2>${section(m)}</section>`).join('\n')
    : section(card);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI-readiness</title>
<style>
:root{--bg:#fff;--fg:#1b1b1f;--muted:#6b6b76;--line:#e3e3e8;--accent:#3d63dd;--crit:#c62828;--maj:#d97706;--min:#2563eb;--sug:#6b7280}
@media (prefers-color-scheme: dark){:root{--bg:#141418;--fg:#ececf1;--muted:#a0a0ab;--line:#2c2c34;--accent:#7c9cff}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
.card{border:1px solid var(--line);border-radius:8px;padding:12px}.big{font-size:28px;font-weight:600}
.bar{height:6px;background:var(--line);border-radius:3px}.bar span{display:block;height:6px;background:var(--accent);border-radius:3px}
.gap{list-style:none;margin:8px 0}.chip{font-size:12px;padding:1px 6px;border-radius:4px;color:#fff;background:var(--sug)}
.critical .chip{background:var(--crit)}.major .chip{background:var(--maj)}.minor .chip{background:var(--min)}
code{color:var(--muted)}h1{margin:0 0 4px}p{color:var(--muted);margin:4px 0 0}
</style></head><body>
<h1>AI-readiness: ${card.valid ? `${e(fmt(card.overall))}/100` : 'No score'}</h1>
${card.valid ? '' : `<p>No score: ${e(invalidNote(card))}</p>`}
<p>${e(deltaLine(card, baseline))} Pass mark ${PASS_MARK}.</p>
${body}
<h2>Gaps</h2>${gaps}
${claude ? claudeHtml(claude, e) : ''}
${card.hardFailures.length ? `<h2>Hard failures</h2><ul>${card.hardFailures.map((h) => `<li class="gap critical"><span class="chip">critical</span> <b>${e(h.title)}</b>${h.detail ? `<div>${e(h.detail)}</div>` : ''}${h.location ? `<code>${e(h.location)}</code>` : ''}</li>`).join('')}</ul>` : ''}
${card.outsideSetup?.length ? `<h2>Outside setup</h2><p>Not something setup can fix, so it did not block the run.</p><ul>${card.outsideSetup.map((o) => `<li class="gap"><b>${e(`${o.member ? `${o.member}: ` : ''}${o.title}`)}</b>${o.detail ? `<div>${e(o.detail)}</div>` : ''}${o.fix ? `<div>${e(`Fix: ${o.fix}`)}</div>` : ''}</li>`).join('')}</ul>` : ''}
${card.sideEffects.length ? `<h2>Files a probed command wrote (restored)</h2><ul>${card.sideEffects.map((x) => `<li class="gap"><code>${e(x)}</code></li>`).join('')}</ul>` : ''}
${(card.restoreFailed || []).length ? `<h2>Files a probed command wrote and the probe could not restore</h2><ul>${card.restoreFailed.map((x) => `<li class="gap"><code>${e(x)}</code></li>`).join('')}</ul>` : ''}
${card.codeHealth ? `<h2>Code health</h2><p>${e(card.codeHealth)}</p>` : ''}
<script type="application/json" id="readiness">${json}</script>
</body></html>
`;
}

const strs = (v) => (Array.isArray(v) ? v : []).filter((x) => typeof x === 'string');
const stagedIn = (gen) => (Array.isArray(gen?.files) ? gen.files : []).filter((f) => f && f.action === 'staged').length;
const claudeOne = (staged, placedEntry) => {
  const e = isObj(placedEntry) ? placedEntry : null;
  const placed = e ? (Array.isArray(e.placed) ? e.placed : []).filter((x) => x && typeof x.path === 'string') : [];
  return {
    staged,
    placed: placed.map((x) => x.path),
    ignored: placed.filter((x) => x.ignored).map((x) => x.path),
    skipped: (e && Array.isArray(e.skipped) ? e.skipped : []).filter((x) => x && typeof x.path === 'string').map((x) => ({ path: x.path, reason: String(x.reason || '') })),
    missingStep: staged > 0 && !e,
  };
};
/** The newest readiness-generated*.json in the pipeline dir, parsed (null when there is none). */
function newestGenerated(dir) {
  let best = null;
  try {
    for (const f of readdirSync(dir)) {
      if (!/^readiness-generated.*\.json$/.test(f)) continue;
      const m = statSync(join(dir, f)).mtimeMs;
      if (!best || m > best.m) best = { f, m };
    }
  } catch { return null; }
  return best ? readJson(join(dir, best.f)) : null;
}
/** What happened to the Claude files Generate staged: `{ staged, placed, ignored, skipped, missingStep }`,
    or `{ members: { key: {...} } }` on a workspace run. null when nothing was staged and no Place
    step ran, so the card has no section. */
export function claudeFilesOf(pipelineDir) {
  const gen = newestGenerated(pipelineDir);
  const placed = readJson(join(pipelineDir, 'readiness-claude-placed.json'));
  const gm = isObj(gen) && isObj(gen.members) ? gen.members : null;
  const pm = isObj(placed) && isObj(placed.members) ? placed.members : null;
  let out;
  if (gm || pm) {
    const members = {};
    for (const k of [...new Set([...Object.keys(gm || {}), ...Object.keys(pm || {})])].sort()) {
      members[k] = claudeOne(stagedIn(gm?.[k]), placed ? pm?.[k] : null);
    }
    out = { members };
    out.missingStep = Object.values(members).some((m) => m.missingStep);
    out.any = Object.values(members).some((m) => m.staged || m.placed.length || m.skipped.length);
  } else {
    out = claudeOne(stagedIn(gen), placed);
    out.any = !!(out.staged || out.placed.length || out.skipped.length);
  }
  return out.any || placed ? out : null;
}
const MISSING_LINE = (n) => `Generate staged ${n} Claude file${n === 1 ? '' : 's'}, but this run has no Place Claude files step, so none were placed.`;
const claudeLines = (c) => {
  const out = [];
  if (c.missingStep) { out.push(MISSING_LINE(c.staged)); return out; }
  out.push(`Placed ${c.placed.length}${c.staged ? ` of ${c.staged} staged` : ''}.`);
  if (c.ignored.length) out.push(`Ignored by .gitignore, so not committed: ${c.ignored.map((x) => `\`${x}\``).join(', ')}.`);
  for (const k of c.skipped) out.push(`Skipped \`${k.path}\`: ${k.reason || 'no reason given'}`);
  return out;
};
const claudeScopes = (c) => (c.members ? Object.entries(c.members).map(([heading, m]) => ({ heading, c: m })) : [{ heading: null, c }]);
function claudeMarkdown(c) {
  const out = ['', '## Claude files', ''];
  for (const { heading, c: m } of claudeScopes(c)) {
    if (heading !== null) out.push(`### ${heading}`, '');
    out.push(...claudeLines(m).map((l) => `- ${l}`));
  }
  return out;
}
function claudeHtml(c, e) {
  const body = claudeScopes(c).map(({ heading, c: m }) => `${heading === null ? '' : `<h3>${e(heading)}</h3>`}<ul>${claudeLines(m).map((l) => `<li class="gap">${e(l)}</li>`).join('')}</ul>`).join('\n');
  return `<h2>Claude files</h2>${body}`;
}

function findingsMarkdown(verdict, card) {
  const blocked = verdict.blocked || card?.blocked || [];
  const fix = card?.members && blocked.length ? [`Members to fix: ${blocked.join(', ')}`, ''] : [];
  return ['# Re-score findings', '', ...fix, ...verdict.issues.flatMap((i) => [
    `## ${i.severity}: ${i.title}`, '', `- severity: ${i.severity}`, `- location: ${i.location || '(none)'}`, `- detail: ${i.detail || ''}`, '']),
  ].join('\n');
}

/** The chip's rule at Gate time, from the fresh `api.readiness` (not the first step's snapshot):
    `{ blocking, outside }`, or `{ members: { key: { blocking, outside } } }` on a workspace run. A run
    without a readiness view gets none (an older worca). */
export function chipRuleOf(readiness, { map, probe, baselineProbe, memberKeys = [] }) {
  if (!isObj(readiness)) return null;
  const toolsOf = (m, p) => (Array.isArray(map?.tools) ? map.tools : Array.isArray(m?.tools) ? m.tools : Array.isArray(p?.selectedTools) ? p.selectedTools : []);
  const one = (view, m, p, b) => {
    if (!isObj(view) || !isObj(view.report) || view.error) {
      const why = isObj(view) ? (view.error ? String(view.error) : 'no report') : 'no view for this member';
      return { blocking: [{ severity: 'critical', title: `Readiness view unavailable: ${why}`, detail: 'The chip\'s rule could not be evaluated, so the gate cannot pass.', location: '' }], outside: [] };
    }
    const g = chipGate(view, toolsOf(m, p));
    const made = copilotCreated(b, p);
    return made ? { ...g, blocking: [...g.blocking, made] } : g;
  };
  if (isObj(readiness.members)) {
    return { members: Object.fromEntries([...new Set([...Object.keys(readiness.members), ...memberKeys])].sort().map((k) => [k, one(readiness.members[k], map?.members?.[k], probe?.members?.[k], baselineProbe?.members?.[k])])) };
  }
  return one(readiness, map, probe, baselineProbe);
}

export default async function ({ inputs, outputs, ctx, log, readiness }) {
  const gate = !!outputs.findings;
  const judgement = readJson(inputs.judgement?.path);
  const probe = readJson(inputs.probe?.path);
  const map = readJson(inputs.map?.path);
  // The Gate judges the fresh readiness; the `view` input is only the fallback for engines and labels.
  const chip = gate ? chipRuleOf(readiness, { map, probe, baselineProbe: readJson(join(ctx.pipelineDir || '', 'readiness-probe.json')),
    memberKeys: [...new Set([...Object.keys(judgement?.members || {}), ...Object.keys(probe?.members || {})])] }) : null;
  const card = buildCard(judgement, probe, { final: gate, view: isObj(readiness) ? readiness : readJson(inputs.view?.path) });
  if (chip?.members) {
    for (const [k, c] of Object.entries(chip.members)) if (card.members?.[k]) card.members[k].outsideSetup = c.outside;
    card.outsideSetup = Object.entries(chip.members).flatMap(([k, c]) => c.outside.map((o) => ({ member: k, ...o })));
  } else if (chip) card.outsideSetup = chip.outside;
  const cardPath = outputs.card.path;
  const stem = basename(cardPath, '.md').replace(/^.*?readiness-/, '');
  const dir = join(dirname(cardPath), 'readiness');
  mkdirSync(dir, { recursive: true });
  const baseline = gate ? readJson(join(ctx.pipelineDir, 'readiness', 'baseline.json')) : null;
  const claude = gate ? claudeFilesOf(ctx.pipelineDir) : null;
  writeFileSync(cardPath, renderMarkdown(card, baseline, claude));
  writeFileSync(join(dir, `${stem}.json`), JSON.stringify(card, null, 2));
  writeFileSync(join(dir, `${stem}.html`), renderHtml(card, baseline, claude));
  if (map && outputs.profile?.path) writeFileSync(outputs.profile.path, JSON.stringify(profileOf(map, card, { phase: gate ? 'final' : 'baseline' }), null, 2));
  log('info', `scorecard ${stem}: ${card.valid ? card.overall : 'no score'}`);
  if (!gate) return { summary: card.valid ? `Baseline ${card.overall}/100.` : 'No score.' };
  const verdict = ctx.mock && !card.valid ? { issues: [], summary: 'mock run: no judgement to gate' } : verdictFor(card, chip);
  if (claude?.missingStep) {
    const n = claude.members ? Object.values(claude.members).reduce((a, m) => a + (m.missingStep ? m.staged : 0), 0) : claude.staged;
    verdict.issues.push({ severity: 'critical', title: 'Staged Claude files were not placed', detail: MISSING_LINE(n), location: 'readiness-claude/' });
    verdict.summary = `Blocked: ${verdict.issues.length} finding(s); score ${card.overall ?? '—'}/100.`;
  }
  writeFileSync(outputs.findings.path, verdict.issues.length ? findingsMarkdown(verdict, card) : '# Re-score findings\n\nNone.\n');
  return { summary: verdict.summary, verdict };
}
