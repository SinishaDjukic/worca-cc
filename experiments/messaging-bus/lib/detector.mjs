// experiments/messaging-bus/lib/detector.mjs — layer 2: the hook's publish trigger (plan §3.3, §4.5).
// `detect` turns ONE tool call into facts (pure apart from the injected ctx.readFile / ctx.git and a
// read-only state snapshot). `planPublishes` / `flushPending` turn facts and state into drafts and
// state writes (pure). `runDetect` / `runFlush` are the thin glue the hook and the runners share: one
// bus transaction holding detect → plan → publish → state writes.
import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';
import { classify, surfaceOf, diffSurface } from './surface.mjs';
import { normPath } from './task-files.mjs';
import { redactText, isSecretPath } from './redact.mjs';

export const DEBOUNCE_MS = 30000;
export const DEBOUNCE_CALLS = 5;
export const MAX_AUTO = 10;
export const AUTO_MAX_HOP = 2;
export const TEXT_MAX = 600;
export const DATA_MAX = 1024;
export const SIG_MAX = 120;
export const SYMBOLS_MAX = 5;

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const REASON = { js: 'export', sql: 'sql', 'json-schema': 'json-schema', config: 'config' };

// ---------------------------------------------------------------------------------------------
// detect

const count = (s, sub) => {
  if (!sub) return 0;
  let n = 0;
  let i = s.indexOf(sub);
  while (i >= 0) { n++; i = s.indexOf(sub, i + sub.length); }
  return n;
};

/** Undo one edit on `after`; null when its new_string is not found exactly once (and not replace_all). */
function reverseEdit(after, e) {
  const neu = String(e.new_string ?? '');
  const old = String(e.old_string ?? '');
  if (e.replace_all) return neu && after.includes(neu) ? after.split(neu).join(old) : null;
  if (count(after, neu) !== 1) return null;
  return after.replace(neu, () => old);
}

const emptySurface = (kind) => (kind === 'js' ? { exports: {}, sql: {} } : {});

/** Snippet surfaces laid onto a known surface: the names the old snippet had are replaced by the new snippet's. */
function overlay(kind, known, snipBefore, snipAfter) {
  const lay = (k, b, a) => {
    const out = { ...(k ?? {}) };
    for (const n of Object.keys(b ?? {})) delete out[n];
    return Object.assign(out, a ?? {});
  };
  if (kind === 'js') {
    return { exports: lay(known?.exports, snipBefore?.exports, snipAfter?.exports), sql: lay(known?.sql, snipBefore?.sql, snipAfter?.sql) };
  }
  return lay(known, snipBefore, snipAfter);
}

const hashText = (t) => (t === null ? 'deleted' : createHash('sha1').update(t).digest('hex'));

/** `{ path → blob hash }` of every changed or untracked path (the Bash fallback's view of the tree). */
function treeSnapshot(ctx) {
  // --no-renames: a staged `git mv` must list the old path (deleted) too, not only the new one
  const changed = ctx.git(['diff', '--name-only', '--no-renames', 'HEAD']);
  const untracked = ctx.git(['ls-files', '-o', '--exclude-standard']);
  if (changed === null || untracked === null) return null;
  const out = {};
  for (const line of `${changed}\n${untracked}`.split('\n')) {
    const p = normPath(line.trim());
    if (p && !Object.hasOwn(out, p)) out[p] = hashText(ctx.readFile(p));
  }
  return out;
}

/** Repo-relative POSIX path of a tool's file_path; null when outside the worktree. */
function relPath(call, ctx, filePath) {
  if (typeof filePath !== 'string' || !filePath) return null;
  const abs = isAbsolute(filePath) ? filePath : resolve(call.cwd ?? ctx.root, filePath);
  return normPath(relative(ctx.root, abs).split('\\').join('/'));
}

/**
 * One tool call → `{ facts, skipped }` (PreToolUse:Bash → `{ facts:[], skipped, snapshot }`).
 * `before` is `{ text }`, `{ surface }` or null (created); `after` is the file text now (null = deleted).
 */
export function detect(call, ctx) {
  const facts = [];
  const skipped = [];
  const state = ctx.state ?? { files: {}, outside: [], counters: {}, snap: {} };
  const task = ctx.taskMap?.tasks?.[ctx.taskId];
  const listOn = !!task?.parsed;
  const ownerOf = (rel) => {
    for (const [id, t] of Object.entries(ctx.taskMap?.tasks ?? {})) if (t.parsed && t.files.includes(rel)) return id;
    return null;
  };
  const base = { tool: call.tool, toolUseId: call.toolUseId ?? null };

  const fileFacts = (rel, before, afterText, { surfaces = true, snippets = null } = {}) => {
    if (isSecretPath(rel)) { skipped.push('secret'); return; }
    const outsideTask = listOn && !task.files.includes(rel);
    if (!listOn && ctx.taskMap) skipped.push('no-file-list');
    const owner = outsideTask ? ownerOf(rel) : ctx.taskId ?? null;
    if (outsideTask) facts.push({ ...base, file: rel, kind: null, reason: 'outside-task', owner, outsideTask: true, outside: true });
    if (!surfaces) return;
    const beforeText = before?.text ?? null;
    const kind = classify(rel, afterText ?? beforeText ?? undefined);
    if (kind === 'none') return;
    let afterSurface;
    let beforeSurface = null;
    if (snippets) {
      const sb = surfaceOf(kind, rel, snippets.before);
      const sa = surfaceOf(kind, rel, snippets.after);
      if (!sb.ok || !sa.ok) { skipped.push(`parse:${rel}`); return; }
      const known = state.files?.[rel]?.current ?? null;
      beforeSurface = known ?? sb.surface;
      afterSurface = known ? overlay(kind, known, sb.surface, sa.surface) : sa.surface;
    } else {
      if (afterText === null) afterSurface = emptySurface(kind);
      else {
        const a = surfaceOf(kind, rel, afterText);
        if (!a.ok) { skipped.push(`parse:${rel}`); return; }
        afterSurface = a.surface;
      }
      if (before?.surface) beforeSurface = before.surface;
      else if (typeof beforeText === 'string') {
        const b = surfaceOf(kind, rel, beforeText);
        beforeSurface = b.ok ? b.surface : null;
      }
    }
    facts.push({ ...base, file: rel, kind, reason: REASON[kind], owner, outsideTask, beforeSurface, afterSurface, outside: false });
  };

  /** Before of a whole-file change: the surface cache, else `git show HEAD:<path>`, else created. */
  const cachedOrHead = (rel) => {
    const cached = state.files?.[rel]?.current;
    if (cached) return { surface: cached };
    const head = ctx.git(['show', `HEAD:${rel}`]);
    return typeof head === 'string' ? { text: head } : null;
  };

  if (call.tool === 'Bash') {
    if (call.event === 'PreToolUse') {
      // a failed git call stores no snapshot: this call's Post then skips instead of reading "empty tree"
      const snapshot = treeSnapshot(ctx);
      if (snapshot === null) skipped.push('git');
      return { facts, skipped, snapshot };
    }
    // no Pre snapshot for this call (Pre failed, was busy, or never ran): every dirty path would look new
    const pre = state.snap;
    if (!pre) { skipped.push('no-snapshot'); return { facts, skipped }; }
    const now = treeSnapshot(ctx);
    if (now === null) { skipped.push('git'); return { facts, skipped }; }
    const paths = new Set([...Object.keys(pre), ...Object.keys(now)]);
    for (const p of [...paths].sort()) {
      const was = Object.hasOwn(pre, p) ? pre[p] : null;
      const is = Object.hasOwn(now, p) ? now[p] : null;
      if (was === is) continue;
      // in a shared working tree a sibling's own hook reports the sibling's files
      if (ctx.siblingsFiles?.has(p)) continue;
      fileFacts(p, cachedOrHead(p), ctx.readFile(p));
    }
    return { facts, skipped };
  }
  if (call.event === 'PreToolUse' || !EDIT_TOOLS.has(call.tool)) return { facts, skipped };

  const input = call.input ?? {};
  const rel = relPath(call, ctx, input.file_path ?? input.notebook_path);
  if (!rel) return { facts, skipped };
  if (call.tool === 'NotebookEdit') { fileFacts(rel, null, null, { surfaces: false }); return { facts, skipped }; }
  if (call.tool === 'Write') {
    const after = typeof input.content === 'string' ? input.content : ctx.readFile(rel);
    const orig = call.response?.originalFile;
    fileFacts(rel, typeof orig === 'string' ? { text: orig } : cachedOrHead(rel), after);
    return { facts, skipped };
  }
  // Edit / MultiEdit: after = the file on disk now; before = after with each edit reversed
  const after = ctx.readFile(rel);
  if (after === null) { skipped.push(`read:${rel}`); return { facts, skipped }; }
  const edits = call.tool === 'MultiEdit' ? (Array.isArray(input.edits) ? input.edits : []) : [input];
  let before = after;
  for (const e of [...edits].reverse()) {
    before = before === null ? null : reverseEdit(before, e);
  }
  if (before !== null) fileFacts(rel, { text: before }, after);
  else {
    const snippets = { before: edits.map((e) => String(e.old_string ?? '')).join('\n'), after: edits.map((e) => String(e.new_string ?? '')).join('\n') };
    fileFacts(rel, null, after, { snippets });
  }
  return { facts, skipped };
}

// ---------------------------------------------------------------------------------------------
// planPublishes / flushPending

const clip = (s, n) => {
  const t = String(s ?? '');
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
};

// redact first, clip second: a secret cut below its pattern's minimum length would no longer be matched
const safe = (v, n) => clip(redactText(v), n);
const FILE_MAX = 180;
const TOOL_ID_MAX = 64;

function changeLine(c) {
  const b = safe(c.before, SIG_MAX);
  const a = safe(c.after, SIG_MAX);
  if (c.change === 'required') return `${c.name} [required]`;
  if (c.change === 'outside') return `${c.name} [outside]`;
  // a JS signature carries its name; an SQL / schema / config type does not, so the name leads
  const lead = String(c.before ?? c.after ?? '').includes(c.name) ? '' : `${c.name}: `;
  if (c.change === 'removed') return `${lead}${b} [removed]`;
  if (c.change === 'added') return `+${lead}${a} [added]`;
  return `${lead}${b} → ${a} [${c.change}]`;
}

/** An emission (`{ file, reason, owner, outsideTask, changes, tool, toolUseId }`) → an envelope draft with the §3.3 caps. */
export function toDraft(e, { topic, replyTo = null, hop = 1, coalesced = false, reverted = false } = {}) {
  const changes = e.changes ?? [];
  // at most SYMBOLS_MAX items, and only as many as fit in TEXT_MAX with the `+N more` tail
  const file = safe(e.file, FILE_MAX);
  const head = `${file}: `;
  const items = [];
  for (const c of changes.slice(0, SYMBOLS_MAX)) {
    const item = redactText(changeLine(c));
    const more = changes.length - items.length - 1;
    const tail = more > 0 ? ` +${more} more` : '';
    if (items.length > 0 && head.length + [...items, item].join('; ').length + tail.length > TEXT_MAX) break;
    items.push(item);
  }
  let text = head + items.join('; ');
  const rest = changes.length - items.length;
  const tail = rest > 0 ? ` +${rest} more` : '';
  text = clip(text, TEXT_MAX - tail.length) + tail;
  const red = (v) => (v === undefined ? undefined : safe(v, SIG_MAX));
  const data = {
    v: 1, source: 'hook', reason: e.reason, file, owner: e.owner ?? null, outsideTask: !!e.outsideTask,
    coalesced: !!coalesced, reverted: !!reverted,
    changes: changes.map((c) => {
      const o = { name: red(c.name), change: c.change };
      if (c.before !== undefined) o.before = red(c.before);
      if (c.after !== undefined) o.after = red(c.after);
      return o;
    }),
    tool: e.tool ?? null, toolUseId: e.toolUseId == null ? null : clip(e.toolUseId, TOOL_ID_MAX),
  };
  const size = () => Buffer.byteLength(JSON.stringify(data), 'utf8');
  // over the cap: drop before/after first, then trailing changes
  if (size() > DATA_MAX) data.changes = data.changes.map(({ name, change }) => ({ name, change }));
  while (size() > DATA_MAX && data.changes.length > 0) data.changes.pop();
  const draft = { topic, kind: 'contract.changed', corr: `cc:${file}`, hop, body: { text, data } };
  if (replyTo) draft.replyTo = replyTo;
  return draft;
}

const capDraft = (topic, maxAuto) => ({
  topic, kind: 'status',
  body: { text: `auto-publish cap reached (${maxAuto} per step attempt); later changes are not announced`, data: { v: 1, source: 'hook', event: 'auto-cap' } },
});

function valueIn(kind, surface, name) {
  if (!surface) return undefined;
  if (kind === 'js') return surface.exports?.[name] ?? surface.sql?.[name];
  if (kind === 'json-schema') return surface[`p:${name}`] ?? surface[`r:${name}`];
  return surface[name];
}

const breakingNet = (kind, from, to) => diffSurface(kind, from, to).filter((c) => c.breaking);

function reasonOf(row, net) {
  if (row.kind !== 'js') return REASON[row.kind];
  const isSql = (c) => valueIn('js', { sql: row.current?.sql }, c.name) !== undefined
    || valueIn('js', { sql: row.announced?.sql }, c.name) !== undefined;
  return net.length > 0 && net.every(isSql) ? 'sql' : 'export';
}

/**
 * Facts + a state snapshot → `{ publish, writes, dropped }`, in the §4.5 order: window-end flush of
 * pending rows, the outside-task once-rule, net-diff coalescing with the leading edge, the cap, the hop rule.
 */
export function planPublishes(facts, stateSnapshot, opts) {
  const o = {
    debounceMs: DEBOUNCE_MS, debounceCalls: DEBOUNCE_CALLS, maxAuto: MAX_AUTO, maxHop: AUTO_MAX_HOP, shown: null, force: false, ...opts,
  };
  const files = structuredClone(stateSnapshot?.files ?? {});
  const outside = new Set(stateSnapshot?.outside ?? []);
  const counters = { autos: 0, capped: false, ...(stateSnapshot?.counters ?? {}) };
  const touched = new Set();
  const newOutside = [];
  const candidates = []; // { draftInput, flags, onSent(), onDropped() }

  const windowOpen = (r) => r.windowCall !== null && r.windowCall !== undefined
    && o.callNo - r.windowCall < o.debounceCalls && o.now - (r.windowTs ?? 0) < o.debounceMs;

  // 1. flush pending rows whose window has ended (all of them when forced: the step-end flush). A file
  // this call changes is left to step 3: its pending state is already out of date.
  const changedNow = new Set(facts.filter((f) => !f.outside).map((f) => f.file));
  const revertedTo = (r, net) => net.every((c) => valueIn(r.kind, r.current, c.name) === valueIn(r.kind, r.first, c.name));
  for (const [file, r] of Object.entries(files)) {
    if (!r.pending || changedNow.has(file) || (!o.force && windowOpen(r))) continue;
    touched.add(file);
    r.pending = false;
    const net = breakingNet(r.kind, r.announced, r.current);
    if (!net.length) continue;
    const reverted = revertedTo(r, net);
    const snapshot = r.current;
    candidates.push({
      e: { file, reason: reasonOf(r, net), owner: r.owner ?? null, outsideTask: !!r.outsideTask, changes: net, tool: r.tool ?? null, toolUseId: r.toolUseId ?? null },
      flags: { coalesced: true, reverted },
      sent: () => { r.announced = snapshot; r.windowCall = o.callNo; r.windowTs = o.now; },
    });
  }

  for (const f of facts) {
    // 2. the outside-task once-rule
    if (f.outside) {
      if (outside.has(f.file)) continue;
      outside.add(f.file);
      newOutside.push(f.file);
      candidates.push({
        e: { file: f.file, reason: 'outside-task', owner: f.owner, outsideTask: true, changes: [{ name: f.file, change: 'outside' }], tool: f.tool, toolUseId: f.toolUseId },
        flags: { coalesced: false, reverted: false },
        sent: () => {},
      });
      continue;
    }
    // 3. net-diff coalescing and the leading edge
    let r = files[f.file];
    if (!r) {
      r = { kind: f.kind, announced: f.beforeSurface ?? null, current: f.beforeSurface ?? null, first: f.beforeSurface ?? null, windowCall: null, windowTs: null, pending: false };
      files[f.file] = r;
    }
    touched.add(f.file);
    r.kind = f.kind;
    r.current = f.afterSurface;
    r.owner = f.owner;
    r.outsideTask = !!f.outsideTask;
    r.tool = f.tool;
    r.toolUseId = f.toolUseId;
    const net = breakingNet(r.kind, r.announced, r.current);
    if (!net.length) { r.pending = false; continue; } // nothing new vs what siblings were told
    if (windowOpen(r)) { r.pending = true; continue; }
    // a pending row whose window ended in this very call: its flush carries the state of NOW
    const coalesced = !!r.pending;
    const snapshot = r.current;
    candidates.push({
      e: { file: f.file, reason: reasonOf(r, net), owner: f.owner, outsideTask: !!f.outsideTask, changes: net, tool: f.tool, toolUseId: f.toolUseId },
      flags: { coalesced, reverted: coalesced && revertedTo(r, net) },
      sent: () => { r.announced = snapshot; r.windowCall = o.callNo; r.windowTs = o.now; r.pending = false; },
    });
  }

  // 4. the cap, 5. the hop rule
  const publish = [];
  const dropped = [];
  const shown = o.shown && o.shown.id && o.callNo - (o.shown.callNo ?? 0) <= o.debounceCalls ? o.shown : null;
  for (const c of candidates) {
    if (counters.autos >= o.maxAuto) {
      if (!counters.capped) { counters.capped = true; publish.push(capDraft(o.topic, o.maxAuto)); }
      dropped.push({ file: c.e.file, code: 'BUS_AUTO_CAP' });
      if (files[c.e.file]) files[c.e.file].pending = false;
      continue;
    }
    const hop = shown ? (shown.hop ?? 1) + 1 : 1;
    if (hop > o.maxHop) {
      dropped.push({ file: c.e.file, code: 'BUS_AUTO_HOP' });
      c.sent(); // announced still advances, so the change does not come back at the next flush
      continue;
    }
    publish.push(toDraft(c.e, { topic: o.topic, replyTo: shown ? shown.id : null, hop, ...c.flags }));
    counters.autos += 1;
    c.sent();
  }

  const writes = [];
  for (const file of touched) {
    const r = files[file];
    writes.push({ op: 'file', file, row: {
      kind: r.kind, announced: r.announced, current: r.current, first: r.first, windowCall: r.windowCall, windowTs: r.windowTs, pending: !!r.pending,
      owner: r.owner ?? null, outsideTask: !!r.outsideTask, tool: r.tool ?? null, toolUseId: r.toolUseId ?? null,
    } });
  }
  for (const file of newOutside) writes.push({ op: 'outside', file });
  writes.push({ op: 'counters', row: { autos: counters.autos, capped: counters.capped } });
  return { publish, writes, dropped };
}

/** The step-end flush: every pending row is flushed regardless of its window. */
export function flushPending(stateSnapshot, { topic, now, callNo, force = true, ...rest }) {
  const { publish, writes, dropped } = planPublishes([], stateSnapshot, { topic, now, callNo, force, shown: stateSnapshot?.counters?.lastShown ?? null, ...rest });
  return { publish, writes, dropped };
}

// ---------------------------------------------------------------------------------------------
// glue shared by the hook and the runners

/**
 * One hook call's detect pass in ONE bus transaction: detect → plan → publish → state writes → calls + 1.
 * Returns `{ published: envelope[], lines: stderr lines, callNo }`; any throw rolls everything back.
 */
export function runDetect({ bus, state, scope, call, ctx, opts, from, faultAfterPublish = false }) {
  return bus.transaction(() => {
    const snap = state.snapshot(scope, call.toolUseId);
    const lines = [];
    const det = detect(call, { ...ctx, state: snap });
    if (det.skipped.includes('no-file-list')) lines.push(`BUS_NO_FILE_LIST task ${ctx.taskId ?? '(none)'} has no parsed file list; the outside-task rule is off`);
    if (call.event === 'PreToolUse') {
      if (call.tool === 'Bash' && det.snapshot) state.putSnap(scope, call.toolUseId, det.snapshot);
      return { published: [], lines, callNo: null };
    }
    const callNo = (snap.counters.calls ?? 0) + 1;
    if (call.tool === 'Bash') state.clearSnap(scope, call.toolUseId);
    const plan = planPublishes(det.facts, snap, { ...opts, callNo, shown: snap.counters.lastShown });
    const published = plan.publish.map((d) => {
      const r = bus.publish(d, { from });
      return { ...d, id: r.id, hop: d.hop ?? 1 };
    });
    state.apply(scope, plan.writes);
    state.apply(scope, [{ op: 'counters', row: { calls: callNo } }]);
    for (const d of plan.dropped) lines.push(`${d.code} ${d.file}`);
    // a test seam (delivery row e): a fault after the publishes and writes must roll all of them back
    if (faultAfterPublish) throw new Error('injected fault after publish');
    return { published, lines, callNo };
  });
}

/** The step-end flush in one transaction (the experiment runners call it in-process at case end). */
export function runFlush({ bus, state, scope, opts, from }) {
  return bus.transaction(() => {
    const snap = state.snapshot(scope);
    const callNo = (snap.counters.calls ?? 0) + 1;
    const plan = flushPending(snap, { ...opts, callNo, force: true });
    const published = plan.publish.map((d) => ({ ...d, id: bus.publish(d, { from }).id, hop: d.hop ?? 1 }));
    state.apply(scope, plan.writes);
    return { published, lines: plan.dropped.map((d) => `${d.code} ${d.file}`) };
  });
}
