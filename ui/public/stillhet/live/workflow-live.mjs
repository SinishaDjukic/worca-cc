// ui/public/stillhet/live/workflow-live.mjs — Stillhet's Workflows in the live kind (slice 7 D2): the one module that reads
// and writes dev's workflow, agent, script and pin routes. Every request is built from WORKFLOW_ACTIONS; every answer is
// { ok, status, data, error }. It keeps the place's records (workflow-map.mjs) and their drafts in memory (D8): a draft
// reaches the server only on Save, after dev's own validator passed it here (D6) and its base is still current (D9).
import { workflowOf, agentOf, scriptOf, modelIdOf, DEFAULT_MODEL, DEFAULT_EFFORT } from './workflow-map.mjs';
import { templateOfDraft, sameBase, withFrontmatter, newStepId } from './workflow-draft.mjs';

const enc = encodeURIComponent;
// id → [the words a refusal starts with, args → [method, url, body?]]
export const WORKFLOW_ACTIONS = Object.freeze({
  'list-workflows': ['read the workflows', () => ['GET', '/api/workflows']],
  'list-agents': ['read the agents', () => ['GET', '/api/agents']],
  'list-scripts': ['read the scripts', () => ['GET', '/api/scripts']],
  usage: ['read what the workflows did', () => ['GET', '/api/workflow-usage']],
  'list-pins': ['read the pins', () => ['GET', '/api/chat-home/pins']],
  'save-workflow': ['save', ({ tpl }) => ['POST', '/api/workflows', tpl]],
  'copy-workflow': ['copy', ({ tpl, name }) => { const { id, origin, createdAt, updatedAt, archivedAt, needsRepo, ...rest } = tpl; return ['POST', '/api/workflows', { ...rest, name }]; }],
  'delete-workflow': ['delete', ({ id }) => ['DELETE', `/api/workflows/${enc(id)}`]],
  'delete-agent': ['delete', ({ id }) => ['DELETE', `/api/agents/${enc(id)}`]],
  'delete-script': ['delete', ({ id }) => ['DELETE', `/api/scripts/${enc(id)}`]],
  'export-json': ['export', ({ id }) => ['GET', `/api/workflows/${enc(id)}/json`]],
  'export-skill-plan': ['export', ({ id }) => ['POST', `/api/workflows/${enc(id)}/export`, { destination: 'global', dryRun: true }]],
  'export-skill': ['export', ({ id }) => ['POST', `/api/workflows/${enc(id)}/export`, { destination: 'global' }]],
  'export-plugin': ['export', ({ id, pluginDir }) => ['POST', `/api/workflows/${enc(id)}/export`, { destination: 'plugin', pluginDir }]],
  'import-check': ['import', ({ workflow }) => ['POST', '/api/workflows/import-json', { workflow, dryRun: true }]],
  import: ['import', ({ workflow, acceptScripts }) => ['POST', '/api/workflows/import-json', { workflow, ...(acceptScripts ? { acceptScripts: true } : {}) }]],
  'get-workflow': ['read', ({ id }) => ['GET', `/api/workflows/${enc(id)}`]],
  'get-agent': ['read', ({ key }) => ['GET', `/api/agents/${enc(key)}`]],
  'save-agent': ['save', ({ key, meta, markdown }) => ['PUT', `/api/agents/${enc(key)}`, { meta, markdown }]],
  pin: ['pin', ({ pins }) => ['PUT', '/api/chat-home/pins', { pins }]],
  'run-cases': ['run the saved cases of', ({ key }) => ['POST', '/api/scripts/bench', { key, caseId: null, all: true, draft: null, params: {}, ports: null, inputs: {}, cwd: { kind: 'scratch' }, timeoutMs: null }]],
});
const LISTS = { workflows: 'list-workflows', agents: 'list-agents', scripts: 'list-scripts', usage: 'usage', pins: 'list-pins' };
export const NOT_ANSWERING = 'Worca is not answering';
export const STALE = 'it changed since you started; discard the draft or save a copy';
const KINDS = { workflow: 'workflow', agent: 'agent', script: 'script' };
export const NO_ANSWER = 'no answer from Worca';
const BENCH_MARGIN_MS = 30000, EARLY_MAX = 20;   // a bench's deadline past its cases' own timeouts; the frames kept for a POST still in flight

export function startWorkflowLive({ fetch, toast = () => {}, go = () => {}, on = () => {}, download = () => {}, setTimeout: later = globalThis.setTimeout, clearTimeout: cancel = globalThis.clearTimeout }) {
  let lists = {}, state = 'loading', started = null, records = { workflow: [], agent: [], script: [] };
  const busy = new Set(), benches = new Map(), early = new Map(), drafts = new Map(), pending = new Map(), saving = new Set();
  let pinChain = Promise.resolve();

  async function send(id, args = {}) {
    const [, build] = WORKFLOW_ACTIONS[id], [method, url, body] = build(args);
    let r;
    try { r = await fetch(url, { method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
    catch { return { ok: false, status: 0, data: {}, error: NOT_ANSWERING }; }
    const data = await r.json().catch(() => ({}));
    const why = !r.ok ? (Array.isArray(data?.errors) && data.errors[0]?.message) || data?.error || data?.message || `HTTP ${r.status}` : '';
    return { ok: r.ok, status: r.status, data: data || {}, error: why };
  }
  /** One action at a time per action and target: a second press while it runs answers busy and sends nothing. */
  async function act(id, args = {}) {
    const k = `${id}|${args.id || args.key || ''}`;
    if (busy.has(k)) return { ok: false, status: 0, data: {}, error: 'busy' };
    busy.add(k);
    try { return await send(id, args); } finally { busy.delete(k); }
  }
  const keyOf = (kind, id) => `${kind}:${id}`;
  const find = (kind, id) => records[kind]?.find((x) => x.id === id);
  // the records again from the lists; a draft (and the template it started from, draft.base) stays with its thing (D8);
  // a thing whose delete waits for its undo window stays hidden (D14)
  function rebuild() {
    for (const kind of Object.keys(records)) for (const x of records[kind]) {
      const k = keyOf(kind, x.id);
      if (x.draft) { if (!x.draft.base && x.tpl) x.draft.base = x.tpl; drafts.set(k, x.draft); } else drafts.delete(k);
    }
    const agentsByKey = Object.fromEntries((lists.agents?.agents || []).map((a) => [a.key, a]));
    const scriptsByKey = Object.fromEntries((lists.scripts?.scripts || []).map((s) => [s.key, s]));
    const fresh = records.workflow.filter((x) => x.fresh);
    const opts = { usage: lists.usage?.usage || {}, agentsByKey, scriptsByKey, pins: lists.pins?.pins || [] };
    records = {
      workflow: [...(lists.workflows?.workflows || []).map((t) => workflowOf(t, opts)), ...fresh],
      agent: (lists.agents?.agents || []).map(agentOf),
      script: (lists.scripts?.scripts || []).map(scriptOf),
    };
    for (const kind of Object.keys(records)) records[kind] = records[kind].filter((x) => !pending.has(keyOf(kind, x.id)));
    for (const kind of Object.keys(records)) for (const x of records[kind]) { const d = drafts.get(keyOf(kind, x.id)); if (d && !x.fresh) x.draft = d; }
  }
  async function refresh(...names) {
    const answers = await Promise.all(names.map((n) => send(LISTS[n])));
    if (answers.some((a) => !a.ok)) { if (state !== 'ready') state = 'failed'; on(); return false; }
    names.forEach((n, i) => { lists[n] = answers[i].data; });
    state = 'ready'; rebuild(); on();
    return true;
  }
  let inflight = null;
  function load() { inflight ||= refresh(...Object.keys(LISTS)).finally(() => { inflight = null; }); started = inflight; return inflight; }
  const begin = () => { if (!started) load(); };

  const titleOf = (kind, id) => find(kind, id)?.title || id;
  const refused = (words, title, why) => ({ ok: false, text: `Could not ${words} ${title}: ${why}` });

  const registries = () => ({ agentsByKey: Object.fromEntries((lists.agents?.agents || []).map((a) => [a.key, a])), scriptsByKey: Object.fromEntries((lists.scripts?.scripts || []).map((s) => [s.key, s])) });
  // a workflow built by hand starts as the task wired to the end (Build it by hand…, D16)
  const baseOf = (x) => (x.tpl ? x : { ...x, ...registries(), nodeIds: [], steps: [], loops: [], chain: true,
    tpl: { name: x.title, version: 2, domain: 'coding', nodes: [{ id: 'n_task', kind: 'task', x: 60, y: 60, config: {} }, { id: 'n_end', kind: 'end', x: 360, y: 60, config: {} }], wires: [{ id: 'w_in', from: { node: 'n_task', port: 'task' }, to: { node: 'n_end', port: 'result' } }] } });
  /** The template a draft would save as, to draw it (the saved one when the draft cannot be one). */
  function preview(id, draft) {
    const x = find('workflow', id); if (!x) return null;
    const b = baseOf(x);
    if (!draft) return b.tpl;
    const r = templateOfDraft(b, draft);
    return r.ok ? r.tpl : b.tpl;
  }
  /** Pin or unpin a workflow on Chat's home, keeping every other pin. One pin at a time: each starts from the list the
   *  one before it wrote, so two quick pins keep both. */
  function pin(id, on) {
    const run = pinChain.then(async () => {
      const now = lists.pins?.pins || [], pins = on ? [...now.filter((p) => p !== id), id] : now.filter((p) => p !== id);
      const a = await act('pin', { pins, id });
      if (a.ok) { lists.pins = { ...lists.pins, pins }; rebuild(); await refresh('pins'); }
      return a;
    });
    pinChain = run.catch(() => {});
    return run;
  }
  // a saved draft leaves its thing: by key, and on whichever record holds it now (a refresh during the save made a new one)
  const dropDraft = (kind, id, ...xs) => { drafts.delete(keyOf(kind, id)); for (const y of [...xs, find(kind, id)]) if (y) delete y.draft; };

  /** Save a draft (D6, D9). A second press while one saves answers with no words. */
  async function save(kind, id) {
    const k = keyOf(kind, id);
    if (saving.has(k)) return { ok: false, text: '' };
    saving.add(k);
    try { return await saveNow(kind, id); } finally { saving.delete(k); }
  }
  async function saveNow(kind, id) {
    const x = find(kind, id);
    if (!x?.draft) return { ok: true, text: '' };
    if (kind === 'workflow') {
      const base = baseOf(x), from = x.draft.base || x.tpl;
      if (!x.fresh && !sameBase(from, x.tpl)) return refused('save', x.title, STALE);
      const r = templateOfDraft(base, x.draft);
      if (!r.ok) return refused('save', x.draft.title || x.title, r.reason);
      if (!x.fresh) {   // the server's own copy: another tab or a chat may have changed it since the list was read
        const now = await act('get-workflow', { id: x.id });
        if (!now.ok) return refused('save', x.title, now.error);
        if (!sameBase(from, now.data)) return refused('save', x.title, STALE);
      }
      const tpl = x.fresh ? (({ id: _, ...t }) => t)(r.tpl) : { ...r.tpl, id: x.id };
      const a = await act('save-workflow', { tpl, id: x.id });
      if (!a.ok) return refused('save', x.title, a.error);
      dropDraft(kind, id, x);
      if (x.fresh) records.workflow = records.workflow.filter((y) => y !== x);
      await refresh('workflows');
      const saved = a.data?.workflow;
      if (x.fresh && saved?.id) go(`workflows/workflow:${saved.id}`);
      return { ok: true, text: `Saved ${saved?.name || x.title}: tasks run it from now`, id: saved?.id || x.id };
    }
    if (kind === 'agent') {
      const g = await act('get-agent', { key: id });
      if (!g.ok) return refused('save', x.title, g.error);
      const d = x.draft, meta = { ...g.data.meta, asksQuestions: !!d.asks, fanOut: !!d.fan };
      for (const k of ['origin', 'agentPath', 'frontmatter', 'descriptionDerived']) delete meta[k];
      const markdown = withFrontmatter(g.data.markdown || '', { model: d.model && d.model !== DEFAULT_MODEL ? modelIdOf(d.model) : undefined, effort: d.effort && d.effort !== DEFAULT_EFFORT ? d.effort : undefined });
      const a = await act('save-agent', { key: id, meta, markdown });
      if (!a.ok) return refused('save', x.title, a.error);
      dropDraft(kind, id, x);
      await refresh('agents');
      return { ok: true, text: `Saved ${x.title}: tasks run it from now` };
    }
    return { ok: true, text: '' };
  }
  function discard(kind, id) { dropDraft(kind, id); on(); }

  /** Delete waits for the undo window (D14): the thing leaves the lists at once and stays out of every refresh; the real
   *  DELETE goes only when the window closes; undo sends nothing and brings it back (true), or answers false once the
   *  DELETE has started. A second delete of it while it waits answers the same handle and sends nothing more. */
  function deferDelete(kind, id, ms) {
    const k = keyOf(kind, id);
    if (pending.has(k)) return pending.get(k).handle;
    const title = titleOf(kind, id), list = kind === 'workflow' ? 'workflows' : kind === 'agent' ? 'agents' : 'scripts';
    const t = later(async () => {
      if (pending.get(k)?.handle === handle) pending.get(k).fired = true;   // too late to undo from here on
      const a = await act(`delete-${KINDS[kind] || 'workflow'}`, { id });
      if (!a.ok) toast(`Could not delete ${title}: ${a.error}`);
      pending.delete(k);
      if (a.ok) drafts.delete(k);
      if (!(await refresh(list))) { rebuild(); on(); }
    }, ms);
    const handle = { undo: () => { const p = pending.get(k); if (p?.handle !== handle || p.fired) return false; cancel(t); pending.delete(k); rebuild(); on(); return true; } };
    pending.set(k, { handle });
    rebuild(); on();
    return handle;
  }

  async function exportAs(id, as, { pluginDir } = {}) {
    const title = titleOf('workflow', id);
    if (as === 'a Claude Code skill') {
      const plan = await act('export-skill-plan', { id });
      if (!plan.ok) return refused('export', title, plan.error);
      const c = plan.data?.conflicts || [];
      if (c.length) return refused('export', title, `${c.length === 1 ? 'a skill file' : `${c.length} skill files`} would be overwritten (${c.map((x) => x.path).join(', ')})`);
      const a = await act('export-skill', { id });
      return a.ok ? { ok: true, text: `Exported ${title} as a Claude Code skill` } : refused('export', title, a.error);
    }
    if (as === 'a Worca plugin') {
      const a = await act('export-plugin', { id, pluginDir: pluginDir || '' });
      return a.ok ? { ok: true, text: `Exported ${title} as a Worca plugin in ${a.data?.dir || pluginDir}` } : refused('export', title, a.error);
    }
    const [, url] = WORKFLOW_ACTIONS['export-json'][1]({ id });
    download(url, `${String(id).replace(/^wf_/, '')}.json`);
    return { ok: true, text: `Exported ${title} as a JSON file` };
  }

  /** A file to import (D10): parsed here first, a dry run, a confirm when it runs scripts, then the import. */
  async function importFile(file, { confirm = async () => false } = {}) {
    const name = file?.name || 'the file';
    let workflow;
    try { workflow = JSON.parse(await file.text()); } catch { return refused('import', name, 'it is not a JSON file'); }
    if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) return refused('import', name, 'it is not an exported workflow');
    const check = await act('import-check', { workflow });
    if (!check.ok) return refused('import', name, check.error);
    const n = (check.data?.scriptNodes || []).length;
    if (n && !(await confirm(n, check.data.scriptNodes))) return { ok: false, text: '' };
    const a = await act('import', { workflow, acceptScripts: n > 0 });
    if (!a.ok) return refused('import', name, a.error);
    const w = a.data?.workflow || {};
    await refresh('workflows');
    if (w.id) go(`workflows/workflow:${w.id}`);
    return { ok: true, text: a.data?.renamed ? `Imported as ${w.name}` : `Imported ${w.name || name}`, id: w.id };
  }

  /** Run all of a script's saved cases (D12); the answer is its bench's terminal frame. */
  async function runCases(key) {
    const title = titleOf('script', key);
    if ([...benches.values()].some((b) => b.key === key) || busy.has(`run-cases|${key}`)) return { ok: false, text: 'busy' };
    const a = await act('run-cases', { key });
    if (!a.ok) return refused('run the saved cases of', title, a.error);
    const benchId = a.data?.benchId;
    if (!benchId) return refused('run the saved cases of', title, 'no bench id');
    // its deadline: every case's own timeout and a margin; a lost terminal frame then answers instead of waiting forever
    const s = (lists.scripts?.scripts || []).find((y) => y.key === key) || {};
    const ms = (Number(s.timeoutMs) || 600000) * Math.max(1, Number(s.caseCount) || 1) + BENCH_MARGIN_MS;
    return new Promise((resolve) => {
      let t = null;
      const b = { key, done: (f) => {
        benches.delete(benchId); if (t !== null) cancel(t);
        if (f.type === 'scriptbench-error') { resolve(refused('run the saved cases of', title, f.message || 'it stopped')); return; }
        const r = f.result || {}, total = (r.passed || 0) + (r.failed || 0) + (r.unchecked || 0);
        resolve({ ok: true, text: `${title}: ${r.passed || 0} of ${total} ${total === 1 ? 'case' : 'cases'} passed` });
      } };
      if (early.has(benchId)) { const f = early.get(benchId); early.delete(benchId); b.done(f); return; }
      benches.set(benchId, b);
      t = later(() => { t = null; b.done({ type: 'scriptbench-error', message: NO_ANSWER }); }, ms);
    });
  }
  /** The socket came back: frames sent while it was gone are lost, so every bench still waiting answers now. */
  function reconnect() {
    for (const b of [...benches.values()]) b.done({ type: 'scriptbench-error', message: NO_ANSWER });
    early.clear();
  }

  function frame(f) {
    if (!f || typeof f !== 'object') return;
    if (f.type === 'scriptbench-done' || f.type === 'scriptbench-error') {
      const b = benches.get(f.benchId);
      // the frame can beat the POST's answer: kept only while a Run all POST is in flight, a few at most; only the first counts
      if (b) b.done(f);
      else if (!early.has(f.benchId) && [...busy].some((k) => k.startsWith('run-cases|'))) { early.set(f.benchId, f); if (early.size > EARLY_MAX) early.delete(early.keys().next().value); }
      return;
    }
    if (!started) return;
    if (f.type === 'workflows-changed') refresh('workflows');
    if (f.type === 'scripts-changed') refresh('scripts');
  }

  return {
    stepId: (id, steps) => newStepId(find('workflow', id), steps),
    load, refresh: (...n) => (started ? refresh(...(n.length ? n : Object.keys(LISTS))) : Promise.resolve(false)), act, pin, preview, save, discard, deferDelete, exportAs, importFile, runCases, reconnect, frame, drafts,
    data: () => { begin(); return records; },
    status: () => { begin(); return state; },
  };
}
