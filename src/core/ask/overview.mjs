// src/core/ask/overview.mjs — what the tool panel's Overview shows for a chat that the browser has no source for (issue
// 1064, GET /api/ask/threads/:id/overview): the runs the chat STARTED (a run link with a card, plus the runs its
// recurring schedules fired) with their saved facts and the PR watch's fix runs nested under the run whose PR they fix,
// the runs it only MENTIONED (followed, tracked, named in a reply), the started runs' PRs and the chat's applied PR
// cards (then the mentioned runs' PRs, marked), its designs (its own, the ones it asked for, the ones it named), the files it showed (show_files copies) and saved (its output folder), and the followed run's branch. Every
// reader is injected; the route passes the real ones. Only the chat's own data: its links, messages, attachments and folder.
import { lstat, readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { membersOfRow } from '../checkout.mjs';
import { runCostKnown } from '../../shared/engine-switch.mjs';
import { runEnginesOfRow } from '../artifacts.mjs';
import { refFromHref, refsInText } from '../../shared/chip-refs.mjs';
import { shownKindOf } from './show-files.mjs';

export const OVERVIEW_LIMIT = 50;
const PID_RE = /^[0-9a-f]{8}$/;

function parse(v) {
  if (v == null || typeof v !== 'string') return v && typeof v === 'object' ? v : null;
  try { return JSON.parse(v); } catch { return null; }
}
/** The run's engine as History reads it (artifacts.mjs RUN_ENGINE_SQL): the outcome's, else the resume point's. */
function runEngineOf(row) {
  return parse(row.outcome)?.runEngine || parse(row.resume_point)?.claude?.engine || 'claude';
}
function firstBranch(row) {
  try { return membersOfRow(row).map((m) => m.br?.feature).find((f) => typeof f === 'string' && f) || null; } catch { return null; }
}
function hrefOf(row) {
  const ws = row.target === 'workspace' ? parse(row.workspace_meta)?.workspaceId : null;
  const key = ws ? `workspaces/${ws}` : row.project_key;
  return key ? `#history/${key}/${row.id}` : null;
}
const time = (s) => { const t = Date.parse(s || ''); return Number.isFinite(t) ? t : 0; };
const prState = (state, draft) => (draft === true && String(state || 'open').toLowerCase() === 'open' ? 'draft' : String(state || 'open').toLowerCase());

/**
 * The folder's files (POSIX relative paths), newest-first order not implied. Every entry is lstat'ed and a link is never
 * followed (the folder itself included), dot-folders are skipped, the walk stops after `max` files and `depth` folders
 * down. A missing folder is [].
 */
export async function listOutFiles(dir, { max = 500, depth = 4 } = {}) {
  const out = [];
  try { const st = await lstat(dir); if (!st.isDirectory()) return []; } catch { return []; }
  async function walk(abs, rel, level) {
    let names;
    try { names = await readdir(abs); } catch { return; }
    names.sort();
    for (const name of names) {
      if (out.length >= max) return;
      const p = join(abs, name);
      let st;
      try { st = await lstat(p); } catch { continue; }   // lstat: a link is neither a folder nor a file here (never followed)
      const r = rel ? `${rel}/${name}` : name;
      if (st.isDirectory()) {
        if (name.startsWith('.') || level >= depth) continue;
        await walk(p, r, level + 1);
      } else if (st.isFile()) {
        out.push({ path: r, name, bytes: st.size, at: new Date(st.mtimeMs).toISOString() });
      }
    }
  }
  await walk(dir, '', 0);
  return out;
}

/** A PR watch fix round's parent (the marker names round 1, `branch.roundOf.pipelineId`, with `by: 'watch'`), or null. */
function watchParentOf(row) {
  const m = parse(row?.branch)?.roundOf;
  return m && m.by === 'watch' && typeof m.pipelineId === 'string' && PID_RE.test(m.pipelineId) && m.pipelineId !== row.id ? m.pipelineId : null;
}
/** A round's number from its own marker (Infinity for a legacy fix run with none: it sorts by its start). */
function roundNo(row) { const n = parse(row?.branch)?.roundOf?.round; return Number.isInteger(n) ? n : Infinity; }
const usable = (row) => !!row && !row.deleted_at;
/** The run's cost figure, unless no harness it used reports one (a mixed run's figure is the known part). */
const costOf = (row, runEngine, runEngines = null) => (runCostKnown(runEngine, runEngines) !== 'none' && Number.isFinite(row.total_cost_usd) ? row.total_cost_usd : null);

const CODE_RE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;
const LINK_RE = /\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const HISTORY_TEXT_RE = /#history\/[^\s)\]>"'`]+/g;
/**
 * The runs the chat's replies NAMED, in reply order: a run link (`[x](#history/…)`), a bare `#history/…` and an 8-hex
 * History id, outside code (the browser chips none there). Only candidates: the caller confirms each against the store.
 */
export function namedRunIds(messages) {
  const out = [];
  const add = (id) => { if (typeof id === 'string' && PID_RE.test(id) && !out.includes(id)) out.push(id); };
  for (const m of messages || []) {
    if (!m || m.role !== 'assistant' || typeof m.text !== 'string' || !m.text) continue;
    // A whole link goes: its href may name a run, its label never does (the browser chips no text inside a link).
    const text = m.text.replace(CODE_RE, ' ').replace(LINK_RE, (_, href) => { const ref = refFromHref(href); if (ref?.kind === 'run') add(ref.id); return ' '; });
    for (const h of text.matchAll(HISTORY_TEXT_RE)) { const ref = refFromHref(h[0].replace(/[.,;:!?]+$/, '')); if (ref?.kind === 'run') add(ref.id); }
    for (const { ref } of refsInText(text.replace(HISTORY_TEXT_RE, ' '))) if (ref.kind === 'run') add(ref.id);
  }
  return out;
}

const DESIGN_ID_TEXT_RE = /\bd_[0-9a-f]{12}\b/g;
/**
 * The designs the chat's own side named, in message order: a design id (`d_` and 12 hex, as `#design/<id>` carries it) in
 * an assistant reply outside code, or in the blocks of any message the chat wrote (the start_design hand-off's result).
 * A person's own text never counts. Only candidates: the caller confirms each against the store.
 */
export function namedDesignIds(messages) {
  const out = [];
  const add = (id) => { if (!out.includes(id)) out.push(id); };
  for (const m of messages || []) {
    if (!m || m.role === 'user') continue;
    if (m.role === 'assistant' && typeof m.text === 'string') for (const x of m.text.replace(CODE_RE, ' ').matchAll(DESIGN_ID_TEXT_RE)) add(x[0]);
    if (Array.isArray(m.blocks) && m.blocks.length) for (const x of JSON.stringify(m.blocks).matchAll(DESIGN_ID_TEXT_RE)) add(x[0]);
  }
  return out;
}

/**
 * deps: { listRunLinks(tid), isPrFix(link), findPipelineRowById(pid), scheduleRunIds(tid, limit), readPrState(pid),
 *         listMessages(tid), listAttachments(tid), outDir(tid), followedRunOf(tid) → 'run:<pid>' | null,
 *         sourcePathOf?(tid, attId) → string | null (a show_files copy's server-only source path; absent = no dedupe),
 *         prFixOf?(link) → the fix card's `card.fix` ({ originPipelineId, prUrl, … }) | null,
 *         roundsOf?(pids) → Map<origin, [{ pipelineId, round, by? }]> (shape/rounds.mjs; absent = no watch rounds) }
 */
export async function buildThreadOverview(threadId, deps) {
  const rowCache = new Map();
  const rowOf = (pid) => { if (!rowCache.has(pid)) rowCache.set(pid, deps.findPipelineRowById(pid) || null); return rowCache.get(pid); };
  const links = (deps.listRunLinks(threadId) || []).filter((l) => l && typeof l.pipelineId === 'string' && PID_RE.test(l.pipelineId));

  // Auto-fix runs (PR watch fix runs) are never a row of their own: each goes under the run whose PR it fixes. The parent
  // is the one the watch recorded: the round marker on the fix run's row, else the fix card's origin pipeline, else the
  // started run holding the card's PR. Never matched by title.
  const fixes = new Map();      // fix pipelineId → { runId, parent: pid | null, prUrl: string | null }
  const noteFix = (pid, runId, fix) => {
    if (fixes.has(pid)) return;
    const origin = typeof fix?.originPipelineId === 'string' && PID_RE.test(fix.originPipelineId) ? fix.originPipelineId : null;
    fixes.set(pid, { runId: runId || pid, parent: watchParentOf(rowOf(pid)) || origin, prUrl: typeof fix?.prUrl === 'string' ? fix.prUrl : null });
  };

  // Started runs (D8): a link with a card (track_run leaves card_id NULL), minus the PR watch's fix runs, plus the
  // occurrences of the chat's recurring schedules (never linked to the chat).
  const started = new Map();   // pipelineId → runId
  for (const l of links) {
    if (!l.cardId) continue;
    if (deps.isPrFix(l)) { noteFix(l.pipelineId, l.runId, deps.prFixOf?.(l) || null); continue; }
    if (!started.has(l.pipelineId)) started.set(l.pipelineId, l.runId || l.pipelineId);
  }
  for (const pid of deps.scheduleRunIds(threadId, OVERVIEW_LIMIT * 2) || []) {
    if (typeof pid === 'string' && PID_RE.test(pid) && !started.has(pid)) started.set(pid, pid);
  }
  const rows = [];
  for (const [pid, runId] of started) {
    const row = rowOf(pid);
    if (!usable(row)) continue;
    if (watchParentOf(row)) { noteFix(pid, runId, null); continue; }
    rows.push({ row, runId });
  }
  rows.sort((a, z) => time(z.row.started_at) - time(a.row.started_at));
  const runs = rows.slice(0, OVERVIEW_LIMIT).map(({ row, runId }) => {
    const runEngine = runEngineOf(row);
    const runEngines = runEnginesOfRow(row);
    return { runId, pipelineId: row.id, title: row.title || row.id, status: row.status || 'unknown', phase: row.phase || null,
      costUsd: costOf(row, runEngine, runEngines), runEngine, ...(runEngines ? { runEngines } : {}), startedAt: row.started_at || null, href: hrefOf(row), branch: firstBranch(row), fixes: [] };
  });
  const shownRuns = new Set(runs.map((r) => r.pipelineId));
  // A started run past the cap is still "started here": it never moves to Mentioned.
  const startedIds = new Set(rows.map(({ row }) => row.id));

  // Pull requests: the started runs' (exactly the section's runs), then the chat's applied PR cards; one per url.
  const prs = [];
  const seen = new Set();
  const addPr = (url, { state, draft, title, runId, source }) => {
    if (typeof url !== 'string' || !url || seen.has(url) || prs.length >= OVERVIEW_LIMIT) return;
    seen.add(url);
    const ref = refFromHref(url);
    prs.push({ url, label: ref?.label || url, refKey: ref?.key || null, title: title || null, state: prState(state, draft), runId: runId || null, source });
  };
  const prOwner = new Map();   // PR url → the started run (shown) that opened it
  for (const r of runs) {
    const pr = deps.readPrState(r.pipelineId);
    if (pr && pr.url) {
      addPr(pr.url, { state: pr.state, draft: pr.draft, title: r.title, runId: r.runId, source: 'run' });
      if (!prOwner.has(pr.url)) prOwner.set(pr.url, r.pipelineId);
    }
  }
  const messages = deps.listMessages(threadId) || [];
  for (const m of messages) {
    for (const b of Array.isArray(m?.blocks) ? m.blocks : []) {
      const c = b && b.kind === 'card' && b.state === 'applied' ? b.card : null;
      if (!c || c.type !== 'pull-request' || !c.result) continue;
      const results = Array.isArray(c.result.members) && c.result.members.length ? c.result.members : [c.result];
      const runId = runs.find((r) => r.pipelineId === c.pipelineId)?.runId || null;
      for (const res of results) addPr(res?.url, { state: 'open', draft: res?.draft === true, title: c.title, runId, source: 'card' });
    }
  }

  // Artifacts: the files it showed (show_files copies: no message, a source) and the files in its output folder. A shown
  // row carries the card kind (what the files card got), never the storage kind (text|image|binary).
  const shown = (deps.listAttachments(threadId) || []).filter((a) => a && a.messageId == null && a.hasSource)
    .map((a) => ({ source: 'shown', attId: a.id, name: a.name, bytes: a.bytes, kind: shownKindOf({ kind: a.kind, mime: a.mime, name: a.name }), mime: a.mime ?? null, at: a.createdAt }));
  let out = [];
  try { out = (await listOutFiles(deps.outDir(threadId))).map((f) => ({ source: 'out', ...f })); } catch { out = []; }
  // One row per file: an out file the chat showed is listed as its stored copy (what the card opens). Matched by real
  // path, never by name; the source path is only compared here and no row carries it.
  const sources = new Set(shown.map((s) => deps.sourcePathOf?.(threadId, s.attId)).filter((p) => typeof p === 'string' && p));
  if (sources.size && out.length) {
    let real = null;
    try { real = await realpath(deps.outDir(threadId)); } catch { real = null; }
    if (real) out = out.filter((f) => !sources.has(join(real, ...f.path.split('/'))));
  }
  // Designs: the design chat's own design, the ones this chat asked for (stored: designs.origin_thread_id), then the ones
  // the chat's side named (the fallback for designs made before the stored link). getDesign answers only what the viewer
  // may see. Each opens its design chat.
  const designIds = [...new Set([deps.designOfThread?.(threadId), ...(deps.originDesignIds?.(threadId) || []),
    ...namedDesignIds(messages)].filter(Boolean))];
  const designs = typeof deps.getDesign === 'function' ? designIds.map((id) => deps.getDesign(id)).filter((d) => d && d.id)
    .map((d) => ({ source: 'design', designId: d.id, name: d.title || 'Untitled design', kind: d.kind || null, at: d.updatedAt || d.createdAt || null })) : [];
  const all = [...designs, ...shown, ...out].sort((a, z) => time(z.at) - time(a.at));

  // Environment: the followed run (the chat's default Files root) and its branch.
  let followedRun = null;
  const root = deps.followedRunOf(threadId);
  const pid = typeof root === 'string' ? /^run:([0-9a-f]{8})$/.exec(root)?.[1] : null;
  const frow = pid ? deps.findPipelineRowById(pid) : null;
  if (frow && !frow.deleted_at) followedRun = { pipelineId: frow.id, title: frow.title || frow.id, branch: firstBranch(frow) };

  // Mentioned: the runs the chat only followed or tracked (a link without a card), the followed run, and the runs its
  // replies named (each confirmed by its History row). A started run never repeats here; their PRs join Pull requests
  // last, marked `mentioned`.
  const mentioned = new Map();   // pipelineId → { runId, source }
  const mention = (p, runId, source) => {
    if (startedIds.has(p) || mentioned.has(p) || fixes.has(p)) return;   // every source hands an 8-hex id
    const row = rowOf(p);
    if (!usable(row)) return;
    if (watchParentOf(row)) { noteFix(p, runId, null); return; }
    mentioned.set(p, { runId: runId || p, source });
  };
  for (const l of links) if (!l.cardId) mention(l.pipelineId, l.runId, 'link');
  if (pid) mention(pid, pid, 'followed');
  for (const p of namedRunIds(messages)) mention(p, p, 'reply');

  // A fix whose parent the watch did not record on the card or the row: the started run holding its PR.
  for (const f of fixes.values()) if (!f.parent && f.prUrl && prOwner.has(f.prUrl)) f.parent = prOwner.get(f.prUrl);
  // A fix whose parent was not started here brings that parent to Mentioned.
  for (const f of fixes.values()) if (f.parent && !startedIds.has(f.parent)) mention(f.parent, f.parent, 'fix');
  // The watch's fix rounds of every run shown (never linked to the chat).
  const parents = [...shownRuns, ...mentioned.keys()];
  const rounds = parents.length && typeof deps.roundsOf === 'function' ? deps.roundsOf(parents) : null;
  for (const [origin, list] of rounds instanceof Map ? rounds : []) {
    for (const r of Array.isArray(list) ? list : []) {
      if (!r || r.by !== 'watch' || typeof r.pipelineId !== 'string' || !PID_RE.test(r.pipelineId)) continue;
      noteFix(r.pipelineId, r.pipelineId, null);
      if (!fixes.get(r.pipelineId).parent) fixes.get(r.pipelineId).parent = origin;
    }
  }
  const fixesOf = new Map();     // parent pipelineId → [row]
  for (const [fp, f] of fixes) {
    const row = rowOf(fp);
    if (!f.parent || !usable(row)) continue;   // a parent past the runs cap is never drawn
    if (!fixesOf.has(f.parent)) fixesOf.set(f.parent, []);
    fixesOf.get(f.parent).push({ row, runId: f.runId });
  }
  const fixRows = (parent, withCost) => (fixesOf.get(parent) || [])
    .sort((a, z) => (roundNo(a.row) - roundNo(z.row)) || (time(a.row.started_at) - time(z.row.started_at)))
    .map(({ row, runId }, i) => {
      const runEngine = runEngineOf(row);
      const runEngines = runEnginesOfRow(row);
      return { runId, pipelineId: row.id, n: i + 1, status: row.status || 'unknown', phase: row.phase || null,
        ...(withCost ? { costUsd: costOf(row, runEngine, runEngines), runEngine, ...(runEngines ? { runEngines } : {}) } : {}), startedAt: row.started_at || null, href: hrefOf(row) };
    });
  for (const r of runs) r.fixes = fixRows(r.pipelineId, true);
  const mentionedRows = [...mentioned].map(([p, m]) => ({ row: rowOf(p), ...m }))
    .sort((a, z) => time(z.row.started_at) - time(a.row.started_at)).slice(0, OVERVIEW_LIMIT)
    .map(({ row, runId, source }) => ({ runId, pipelineId: row.id, title: row.title || row.id, status: row.status || 'unknown', phase: row.phase || null,
      href: hrefOf(row), source, fixes: fixRows(row.id, false) }));

  // Then the mentioned runs' PRs, after the chat's own and marked `mentioned` (the panel tells them apart).
  for (const m of mentionedRows) {
    const pr = deps.readPrState(m.pipelineId);
    if (pr && pr.url) addPr(pr.url, { state: pr.state, draft: pr.draft, title: m.title, runId: m.runId, source: 'mentioned' });
  }

  return { environment: { followedRun }, runs, mentioned: mentionedRows, prs, artifacts: all.slice(0, OVERVIEW_LIMIT), artifactsTotal: all.length };
}
