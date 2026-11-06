// src/core/ask/overview.mjs — what the tool panel's Overview shows for a chat that the browser has no source for (issue
// 1064, GET /api/ask/threads/:id/overview): the runs the chat STARTED (a run link with a card, minus the PR watch's fix
// runs, plus the runs its recurring schedules fired) with their saved facts, their PRs and the chat's applied PR cards,
// the files it showed (show_files copies) and saved (its output folder), and the followed run's branch. Every reader is
// injected; the route passes the real ones. Only the chat's own data: its links, messages, attachments and folder.
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { membersOfRow } from '../checkout.mjs';
import { engineReportsCost } from '../../shared/engine-switch.mjs';
import { refFromHref } from '../../shared/chip-refs.mjs';

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

/**
 * deps: { listRunLinks(tid), isPrFix(link), findPipelineRowById(pid), scheduleRunIds(tid, limit), readPrState(pid),
 *         listMessages(tid), listAttachments(tid), outDir(tid), followedRunOf(tid) → 'run:<pid>' | null }
 */
export async function buildThreadOverview(threadId, deps) {
  // Started runs (D8): a link with a card (track_run leaves card_id NULL), minus the PR watch's fix runs, plus the
  // occurrences of the chat's recurring schedules (never linked to the chat).
  const started = new Map();   // pipelineId → runId
  for (const l of deps.listRunLinks(threadId) || []) {
    if (!l || !l.cardId || typeof l.pipelineId !== 'string' || !PID_RE.test(l.pipelineId) || deps.isPrFix(l)) continue;
    if (!started.has(l.pipelineId)) started.set(l.pipelineId, l.runId || l.pipelineId);
  }
  for (const pid of deps.scheduleRunIds(threadId, OVERVIEW_LIMIT * 2) || []) {
    if (typeof pid === 'string' && PID_RE.test(pid) && !started.has(pid)) started.set(pid, pid);
  }
  const rows = [];
  for (const [pid, runId] of started) {
    const row = deps.findPipelineRowById(pid);
    if (row && !row.deleted_at) rows.push({ row, runId });
  }
  rows.sort((a, z) => time(z.row.started_at) - time(a.row.started_at));
  const runs = rows.slice(0, OVERVIEW_LIMIT).map(({ row, runId }) => {
    const runEngine = runEngineOf(row);
    return { runId, pipelineId: row.id, title: row.title || row.id, status: row.status || 'unknown', phase: row.phase || null,
      costUsd: engineReportsCost(runEngine) && Number.isFinite(row.total_cost_usd) ? row.total_cost_usd : null, runEngine,
      startedAt: row.started_at || null, href: hrefOf(row), branch: firstBranch(row) };
  });

  // Pull requests: the started runs' (exactly the section's runs), then the chat's applied PR cards; one per url.
  const prs = [];
  const seen = new Set();
  const addPr = (url, { state, draft, title, runId, source }) => {
    if (typeof url !== 'string' || !url || seen.has(url) || prs.length >= OVERVIEW_LIMIT) return;
    seen.add(url);
    const ref = refFromHref(url);
    prs.push({ url, label: ref?.label || url, refKey: ref?.key || null, title: title || null, state: prState(state, draft), runId: runId || null, source });
  };
  for (const r of runs) {
    const pr = deps.readPrState(r.pipelineId);
    if (pr && pr.url) addPr(pr.url, { state: pr.state, draft: pr.draft, title: r.title, runId: r.runId, source: 'run' });
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

  // Artifacts: the files it showed (show_files copies: no message, a source) and the files in its output folder.
  const shown = (deps.listAttachments(threadId) || []).filter((a) => a && a.messageId == null && a.hasSource)
    .map((a) => ({ source: 'shown', attId: a.id, name: a.name, bytes: a.bytes, kind: a.kind, mime: a.mime ?? null, at: a.createdAt }));
  let out = [];
  try { out = (await listOutFiles(deps.outDir(threadId))).map((f) => ({ source: 'out', ...f })); } catch { out = []; }
  const all = [...shown, ...out].sort((a, z) => time(z.at) - time(a.at));

  // Environment: the followed run (the chat's default Files root) and its branch.
  let followedRun = null;
  const root = deps.followedRunOf(threadId);
  const pid = typeof root === 'string' ? /^run:([0-9a-f]{8})$/.exec(root)?.[1] : null;
  const frow = pid ? deps.findPipelineRowById(pid) : null;
  if (frow && !frow.deleted_at) followedRun = { pipelineId: frow.id, title: frow.title || frow.id, branch: firstBranch(frow) };

  return { environment: { followedRun }, runs, prs, artifacts: all.slice(0, OVERVIEW_LIMIT), artifactsTotal: all.length };
}
