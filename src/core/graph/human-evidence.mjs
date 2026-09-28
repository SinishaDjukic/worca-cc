// src/core/graph/human-evidence.mjs
// Per-execution EVIDENCE for the human-hours estimate (money-saved design §3). Agent-agnostic
// by construction: it reads node.kind, the meta's runnerType/sideEffect/humanEffort, the port
// TYPES and filename templates, the allocated output paths, the bound input paths and the
// worktree — never an agent key. All file reads are best-effort: a missing or unreadable file
// contributes nothing.
import { readFile } from 'node:fs/promises';
import { proseWords, jsonItems } from '../../shared/human-estimate.mjs';

const REVISION_RE = /-v\d+\.md$/i;   // `{vsuffix}` renders as `-vN` for N > 1 (executor.mjs resolveTemplate)

/**
 * A promise chain: `run(fn)` runs fn after every earlier fn has settled and returns fn's own
 * promise. A rejection reaches that caller only; the chain itself never rejects. The
 * orchestrator puts every cursor measurement of a run through one queue, so two fan-out
 * slices ending together cannot both read the same cursor and credit one delta twice.
 */
export function serialQueue() {
  let tail = Promise.resolve();
  return (fn) => {
    const next = tail.then(fn);
    tail = next.catch(() => {});
    return next;
  };
}

/**
 * Cumulative numstat over every member work dir against its checkpoint ref. `null` when no
 * member has a checkpoint. `stage` (optional) runs ONCE before measuring: `git diff
 * <checkpoint>` never lists an untracked file, so the caller passes the harness's intent-to-add
 * staging (`_stageWorkingTree`) — the same staging the reviewer's diff relies on. The exclude
 * pathspecs are the set `_buildResults` / `_commitWork` use, so the cursor and results.json agree.
 * @param {{workDirs: Map<string,string>, checkpointRefs: Record<string,string>, excludeFor:(key:string)=>string[], numstat:Function, stage?:Function}} o
 * @returns {Promise<{files:number, insertions:number, deletions:number}|null>}
 */
export async function measureCodeCursor({ workDirs, checkpointRefs, excludeFor, numstat, stage = null }) {
  if (typeof stage === 'function') { try { await stage(); } catch { /* best-effort: measure what is visible */ } }
  let seen = false;
  const out = { files: 0, insertions: 0, deletions: 0 };
  for (const [key, dir] of workDirs?.entries?.() || []) {
    const base = checkpointRefs?.[key];
    if (!base) continue;
    seen = true;
    let m;
    try { m = await numstat(dir, base, undefined, excludeFor(key) || []); } catch { continue; }
    for (const row of m.values()) {
      if (row.binary) continue;
      out.files += 1;
      out.insertions += row.added | 0;
      out.deletions += row.removed | 0;
    }
  }
  return seen ? out : null;
}

/** now − prev, each component clamped at 0. `prev` null means "from zero". `now` null → null. */
export function codeDelta(now, prev) {
  if (!now) return null;
  const p = prev || { files: 0, insertions: 0, deletions: 0 };
  return {
    files: Math.max(0, (now.files | 0) - (p.files | 0)),
    insertions: Math.max(0, (now.insertions | 0) - (p.insertions | 0)),
    deletions: Math.max(0, (now.deletions | 0) - (p.deletions | 0)),
  };
}

async function readText(read, path) {
  if (!path) return null;
  try { return await read(path, 'utf8'); } catch { return null; }
}

function jsonItemsOf(text) {
  try { return jsonItems(JSON.parse(text)); } catch { return 0; }
}

/**
 * @param {{ctx: object, cursorPrev: object|null, cursorNow: object|null, read?: Function}} o
 *   ctx is the orchestrator's execution ctx (_execCtx): node, ordinal, meta, ports, outputs,
 *   bindings, verdict. cursorPrev = the cumulative cursor at the previous terminal (this step's
 *   start), cursorNow = the cursor measured at this step's terminal.
 */
export async function collectStepEvidence({ ctx, cursorPrev = null, cursorNow = null, read = readFile }) {
  const nodeKind = ctx?.node?.kind || 'agent';
  const isAgent = nodeKind === 'agent';
  const meta = ctx?.meta || {};
  const cycle = Number.isInteger(ctx?.ordinal) && ctx.ordinal > 0 ? ctx.ordinal : 1;
  const agent = isAgent ? { runnerType: meta.runnerType, sideEffect: meta.sideEffect, humanEffort: meta.humanEffort } : null;

  // Outputs: one entry per DISTINCT allocated path (a refiner's plan/revise pair is one file).
  const outputs = [];
  const seen = new Set();
  for (const port of ctx?.ports?.outputs || []) {
    if (!port || (port.type !== 'md' && port.type !== 'json')) continue;
    const path = ctx?.outputs?.[port.id]?.path;
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const text = await readText(read, path);
    if (text == null) continue;                          // not produced (a `when`-gated port, or the step died early)
    if (port.type === 'md') {
      // A revision: this port versions its file ({vsuffix}) AND the allocated name carries -vN,
      // or the execution itself is a re-run (cycle > 1). The template check keeps a base name
      // that merely ends in "-v2" from reading as a revision.
      const versioned = String(port.filename || '').includes('{vsuffix}') && REVISION_RE.test(path);
      outputs.push({ type: 'md', words: proseWords(text), revision: versioned || cycle > 1 });
    } else {
      outputs.push({ type: 'json', items: jsonItemsOf(text) });
    }
  }
  const verdictPath = ctx?.verdict?.path;
  if (verdictPath && !seen.has(verdictPath)) {
    const text = await readText(read, verdictPath);
    if (text != null) outputs.push({ type: 'json', items: jsonItemsOf(text) });
  }

  // Reads: verifiers only — the diff as it stood when the step STARTED plus every md input.
  let reads = null;
  if (isAgent && meta.runnerType === 'verifier') {
    const inputs = ctx?.ports?.inputs || [];
    const readsWorktree = inputs.some((p) => p && p.as === 'worktree');
    const diffLines = readsWorktree && cursorPrev ? (cursorPrev.insertions | 0) + (cursorPrev.deletions | 0) : 0;
    let words = 0;
    for (const port of inputs) {
      if (!port || port.type !== 'md') continue;
      const text = await readText(read, ctx?.bindings?.[port.id]?.path);
      if (text != null) words += proseWords(text);
    }
    reads = { diffLines, words };
  }

  return { nodeKind, agent, cycle, code: isAgent ? codeDelta(cursorNow, cursorPrev) : null, outputs, reads };
}
