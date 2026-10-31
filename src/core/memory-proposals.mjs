// Proposed memory notes (#943): what a pipeline agent writes into a run's writable memory copy no longer reaches the
// store. After each execution worca collects the changes against the run's frozen set as PROPOSALS, puts the writable
// copy back as it was, and a person approves or rejects each proposal (Settings › Memory, `worca memory proposals`).
// A Memory defragment run is the exception: its writes are the store's new content (memory-sync.mjs syncBack).
//
// Layout: `<store>/.proposals/<runId>.json` = { runId, items: [Proposal] }. One item per note per run: a later step's
// change to the same note replaces the earlier one. Pure over injected paths (the store root and the run's dirs).
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { GLOBAL_SCOPE, listMemoryDir, projectScope, readMemory, removeMemory, scopeKey, writeMemory, isValidMemoryName } from './memory-store.mjs';
import { baselineKey, syncHash, withStoreLock } from './memory-sync.mjs';

const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ID_RE = /^[0-9a-f]{16}$/;
export const proposalsDir = (root) => join(root, '.proposals');
const runFile = (root, runId) => join(proposalsDir(root), `${runId}.json`);
const proposalId = (runId, scope, name) => createHash('sha1').update(`${runId}\0${scope}\0${name}`).digest('hex').slice(0, 16);

async function readRun(root, runId) {
  try {
    const j = JSON.parse(await readFile(runFile(root, runId), 'utf8'));
    return j && Array.isArray(j.items) ? j : { runId, items: [] };
  } catch { return { runId, items: [] }; }
}
async function writeRun(root, doc) {
  const file = runFile(root, doc.runId);
  if (!doc.items.length) { await unlink(file).catch(() => {}); return; }
  await mkdir(proposalsDir(root), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  await rename(tmp, file);
}

/**
 * Collect what one execution changed in the writable copy `mount` against `baseline` (writeFrozenCopies), store it as
 * proposals of run `runId`, and put the copy back from the frozen `entries` (a changed note gets its frozen text, a new
 * file goes, an emptied or deleted note comes back). An EMPTIED or deleted note is a deletion proposal (the memory tool
 * set has no unlink, so emptying is how an agent removes one); a new empty file is ignored. `dirs`: the run's mount dirs
 * ({ scope, rel }). Never throws for one file's sake.
 * @returns {Promise<{ proposed: Array<{scope:string, name:string, kind:'write'|'delete'}>, rejected: Array<{scope:string, name:string, reason:string}> }>}
 */
export async function captureProposals({ root, runId, mount, dirs, baseline, entries, executionId = null, agentKey = null, now = new Date().toISOString(), onWarn }) {
  const frozen = new Map((entries || []).map((e) => [baselineKey(e.rel, e.name), e]));
  const proposed = [], rejected = [], found = [];
  for (const d of dirs || []) {
    const dir = join(mount, ...d.rel.split('/'));
    const junk = [];
    const current = await listMemoryDir(dir, { hashOf: syncHash, onError: (p, err) => { if (err?.code === 'ENAME') junk.push(p); else onWarn?.(`memory: cannot read ${p}: ${err?.code || err?.message || err}`); } });
    for (const p of junk) {
      rejected.push({ scope: d.rel, name: p.split(/[\\/]/).pop().replace(/\.md$/i, ''), reason: 'invalid name (letters, digits, ".", "_", "-" only)' });
      await unlink(p).catch(() => {});
    }
    const seen = new Set();
    for (const e of current) {
      const key = baselineKey(d.rel, e.name);
      seen.add(key);
      if (baseline[key] === e.hash) continue;
      const text = await readFile(join(dir, `${e.name}.md`), 'utf8').catch(() => null);
      if (text === null) continue;
      const was = frozen.get(key);
      if (!text.trim() && !was) { await unlink(join(dir, `${e.name}.md`)).catch(() => {}); continue; }   // a new empty file
      found.push({ d, name: e.name, kind: text.trim() ? 'write' : 'delete', text: text.trim() ? text : null, baseHash: was ? syncHash(was.text) : null });
      // Back to the frozen set: the next execution of this run sees the notes it started with.
      if (was) await writeFile(join(dir, `${e.name}.md`), was.text, 'utf8');
      else await unlink(join(dir, `${e.name}.md`)).catch(() => {});
    }
    for (const key of Object.keys(baseline)) {
      if (!key.startsWith(`${d.rel}/`) || seen.has(key)) continue;
      const was = frozen.get(key);
      if (!was) continue;
      const name = key.slice(d.rel.length + 1).replace(/\.md$/, '');
      found.push({ d, name, kind: 'delete', text: null, baseHash: syncHash(was.text) });
      await writeFile(join(dir, `${name}.md`), was.text, 'utf8');
    }
  }
  if (found.length) {
    await withStoreLock(root, async () => {
      const doc = await readRun(root, runId);
      for (const f of found) {
        const scope = scopeKey(f.d.scope);
        const id = proposalId(runId, scope, f.name);
        const item = { id, runId, scope, rel: f.d.rel, name: f.name, kind: f.kind, text: f.text, baseHash: f.baseHash, executionId, agentKey, at: now };
        doc.items = [...doc.items.filter((x) => x.id !== id), item];
        proposed.push({ scope: f.d.rel, name: f.name, kind: f.kind });
      }
      await writeRun(root, doc);
    });
  }
  return { proposed, rejected };
}

/** Every pending proposal, oldest first, with `stale` (the store copy changed since the run started). */
export async function listProposals(root, { runId = null } = {}) {
  const files = runId ? [`${runId}.json`] : (await readdir(proposalsDir(root)).catch(() => [])).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const f of files) {
    const id = f.slice(0, -5);
    if (!RUN_ID_RE.test(id)) continue;
    for (const item of (await readRun(root, id)).items) {
      const cur = await readMemory(root, scopeOf(item.scope), item.name).catch(() => null);
      out.push({ ...item, stale: (cur ? syncHash(cur.text) : null) !== item.baseHash, current: cur ? cur.text : null });
    }
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
}

/** 'global' | 'projects/<key>' (scopeKey) back to a scope object. */
function scopeOf(key) {
  return key === 'global' ? GLOBAL_SCOPE : projectScope(String(key).slice('projects/'.length));
}

async function takeProposal(root, id) {
  if (!ID_RE.test(String(id || ''))) return null;
  for (const f of (await readdir(proposalsDir(root)).catch(() => [])).filter((x) => x.endsWith('.json'))) {
    const runId = f.slice(0, -5);
    if (!RUN_ID_RE.test(runId)) continue;
    const doc = await readRun(root, runId);
    const item = doc.items.find((x) => x.id === id);
    if (item) return { doc, item };
  }
  return null;
}

/**
 * Approve one proposal: its text is written to the store (a deletion removes the note), with a snapshot first as every
 * store write, and the proposal is dropped. A note that changed in the store since the run started is overwritten all the
 * same — the person decided; the earlier text stays in the scope's history.
 * @returns {Promise<null|{ item:object, scope:object, applied:boolean }>} null when there is no such proposal
 */
export async function approveProposal(root, id, { caps, now = new Date().toISOString(), prepare = null } = {}) {
  return withStoreLock(root, async () => {
    const hit = await takeProposal(root, id);
    if (!hit) return null;
    const { doc, item } = hit;
    const scope = scopeOf(item.scope);
    if (!isValidMemoryName(item.name)) throw new Error(`memory: invalid proposal name ${JSON.stringify(item.name)}`);
    const source = `run:${item.runId}`;
    let applied = true;
    if (item.kind === 'delete') applied = await removeMemory(root, scope, item.name, { source, now });
    else await writeMemory(root, scope, item.name, prepare ? await prepare(scope, item.name, item.text) : item.text, { source, now, caps });
    doc.items = doc.items.filter((x) => x.id !== id);
    await writeRun(root, doc);
    return { item, scope, applied };
  });
}

/** Reject (drop) one proposal. @returns {Promise<object|null>} the dropped item, or null */
export async function rejectProposal(root, id) {
  return withStoreLock(root, async () => {
    const hit = await takeProposal(root, id);
    if (!hit) return null;
    hit.doc.items = hit.doc.items.filter((x) => x.id !== id);
    await writeRun(root, hit.doc);
    return hit.item;
  });
}

