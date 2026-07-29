// src/core/overview-agent.mjs
// Layer 2 (on-demand) overview agent: reads the persisted Layer-1 artifacts
// (diff patch + results + review issues) and runs a single-shot Claude agent that
// returns a narrative + a fresh diff read. Idempotent — caches overview.json and
// returns it without re-running unless force. Recorded in sub_agents for cost parity.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runClaude } from './claude-runner.mjs';
import { safeParseJson } from './protocol.mjs';
import {
  lookupPipelineRow, runDirForRow, upsertSubAgent, readPipelineExtras,
} from './artifacts.mjs';
import { RESULTS_FILE, DIFF_PATCH_FILE, OVERVIEW_FILE } from './results.mjs';

const PATCH_CAP = 60_000; // chars; above this, send hunk headers only

export const OVERVIEW_SYSTEM_PROMPT =
  'You summarize a finished code-change pipeline for a busy engineer. ' +
  'Be precise and terse. Only report diff findings that are NOT already in the ' +
  'provided review issues. Output ONLY the requested JSON object, nothing else.';

export function buildOverviewPrompt({ patch, results, reviews }) {
  const known = (reviews || []).flatMap((r) => (r.issues || []).map(
    (i) => `- [${i.severity}] ${i.title} (${i.location})`)).join('\n') || '(none)';
  let body = patch || '';
  let truncated = false;
  if (body.length > PATCH_CAP) {
    body = body.split('\n').filter((l) =>
      l.startsWith('diff --git') || l.startsWith('@@') ||
      l.startsWith('+++') || l.startsWith('---')).join('\n');
    truncated = true;
  }
  return [
    'Summarize this pipeline run.',
    '',
    `## File summary\n${JSON.stringify(results?.summary || {}, null, 2)}`,
    '',
    `## Already-flagged review issues (do NOT repeat these)\n${known}`,
    '',
    `## Diff ${truncated ? '(TRUNCATED to hunk headers — set diffCheckTruncated:true)' : ''}\n\`\`\`diff\n${body}\n\`\`\``,
    '',
    '## Output contract',
    'Return ONLY this JSON object:',
    '{',
    '  "narrative": "2-4 sentences: what this run did and why it matters",',
    '  "diffFindings": [ { "severity": "warn|note", "file": "path", "line": 0, "title": "...", "detail": "...", "newVsReview": true } ],',
    `  "diffCheckTruncated": ${truncated}`,
    '}',
  ].join('\n');
}

const FINDING_SEV = new Set(['warn', 'note']);

export function normalizeOverview(parsed) {
  if (!parsed || typeof parsed !== 'object') return { narrative: '', diffFindings: [], diffCheckTruncated: false };
  const list = Array.isArray(parsed.diffFindings) ? parsed.diffFindings : [];
  const diffFindings = [];
  for (const f of list) {
    if (!f || typeof f !== 'object' || !f.title) continue;
    diffFindings.push({
      severity: FINDING_SEV.has(f.severity) ? f.severity : 'note',
      file: typeof f.file === 'string' ? f.file : '',
      line: Number.isFinite(Number(f.line)) ? Number(f.line) : null,
      title: String(f.title).trim(),
      detail: typeof f.detail === 'string' ? f.detail.trim() : '',
      newVsReview: f.newVsReview === true,
    });
  }
  return {
    narrative: typeof parsed.narrative === 'string' ? parsed.narrative.trim() : '',
    diffFindings,
    diffCheckTruncated: parsed.diffCheckTruncated === true,
  };
}

/**
 * On-demand: read persisted artifacts, run a one-shot agent, persist + return
 * the overview. Idempotent — returns the cached overview.json unless force.
 * `runClaudeImpl` is injectable for tests.
 */
export async function generateOverview(key, id, { model, signal, force = false, runClaudeImpl = runClaude } = {}) {
  const row = lookupPipelineRow(key, id);
  if (!row) throw new Error('pipeline not found');
  const dir = await runDirForRow(row);

  if (!force) {
    try { return JSON.parse(await readFile(join(dir, OVERVIEW_FILE), 'utf8')); } catch { /* none cached */ }
  }

  const patch = await readFile(join(dir, DIFF_PATCH_FILE), 'utf8').catch(() => '');
  const results = await readFile(join(dir, RESULTS_FILE), 'utf8').then(JSON.parse).catch(() => null);
  const reviews = readPipelineExtras(row.id).reviews || [];

  const prompt = buildOverviewPrompt({ patch, results, reviews });
  let costUsd = null;
  const startedAt = new Date().toISOString();
  const { text } = await runClaudeImpl({
    cwd: dir,
    systemPrompt: OVERVIEW_SYSTEM_PROMPT,
    prompt,
    allowedTools: [],                 // pure reasoning over the prompt; no tools needed
    model,
    signal,
    onEvent: (e) => { if (e.costUsd != null) costUsd = e.costUsd; },
  });

  const overview = normalizeOverview(safeParseJson(text));
  await writeFile(join(dir, OVERVIEW_FILE), JSON.stringify(overview, null, 2));

  // Record as a sub-agent for cost telemetry parity with pipeline nodes.
  upsertSubAgent(row.id, {
    id: `overview-${id}`,
    label: 'overview',
    status: 'finished',
    startedAt,
    finishedAt: new Date().toISOString(),
    costUsd,
    subagentType: 'overview',
  });

  return overview;
}
