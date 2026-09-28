// ui/public/artifact-picker.mjs
// "Run…" on a bench input: pick an md/json artifact of a PAST run and drop its
// text into the port (W2). Client-only by design (C6): it reads the three
// existing routes — /api/history, /api/runs/:id/artifacts and
// /api/runs/:id/artifact?rel= — whose indexed-artifact resolver already owns
// path safety, so the bench API never learns a second input shape.
//
// The picked text is TEXT from then on (W9): a case that referenced a run would
// break when the run is pruned, and could not travel in a plugin.
import { h } from './script-forms.mjs';

export const PICKER_EXTENSIONS = { md: ['md'], json: ['json'] };
export const MAX_INPUT_BYTES = 262144;
/** BYTES, like the store's own case cap (script-cases.mjs), not characters. */
const byteLength = (s) => new TextEncoder().encode(String(s)).length;

/** The file's extension against the requested types. Pure. */
export function artifactMatches(relPath, types) {
  const base = String(relPath || '').split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return false;
  const ext = base.slice(dot + 1).toLowerCase();
  return (types || []).some((t) => (PICKER_EXTENSIONS[t] || [t]).includes(ext));
}

/** `YYYY-MM-DD HH:MM` in LOCAL time, like every other date in the app. */
function whenOf(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function runRowLabel(run) {
  return [run.title || run.id, run.id, whenOf(run.startedAt)].filter(Boolean).join(' · ');
}

function bytesOf(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

/** Runs grouped by project, in the order /api/history returned them (newest
 *  first). A workspace row prefers the workspace's own name, as History does. */
export function renderRunList(pipelines, { doc = globalThis.document } = {}) {
  const wrap = h(doc, 'div', 'apick');
  const list = Array.isArray(pipelines) ? pipelines : [];
  if (!list.length) { wrap.appendChild(h(doc, 'div', 'apick-empty', 'No runs yet.')); return wrap; }
  const groups = new Map();
  for (const p of list) {
    if (!p || !p.id) continue;
    const key = p.projectKey || '';
    if (!groups.has(key)) {
      const name = p.target === 'workspace' ? (p.workspaceName || p.projectName || key) : (p.projectName || key);
      groups.set(key, { name, runs: [] });
    }
    groups.get(key).runs.push(p);
  }
  for (const g of groups.values()) {
    const box = h(doc, 'div', 'apick-project');
    box.appendChild(h(doc, 'div', 'apick-project-name', g.name));
    for (const run of g.runs) {
      const row = h(doc, 'button', 'apick-run');
      row.type = 'button';
      row.dataset.runId = run.id;
      row.append(h(doc, 'span', 'apick-run-title', run.title || run.id),
        h(doc, 'span', 'apick-run-meta', [run.id, whenOf(run.startedAt)].filter(Boolean).join(' · ')));   // the title is already beside it
      box.appendChild(row);
    }
    wrap.appendChild(box);
  }
  return wrap;
}

export function renderArtifactList(artifacts, { doc = globalThis.document, types = ['md'] } = {}) {
  const wrap = h(doc, 'div', 'apick');
  const back = h(doc, 'button', 'btn btn-ghost btn-mini apick-back', 'Runs');
  back.type = 'button';
  wrap.appendChild(back);
  const hits = (Array.isArray(artifacts) ? artifacts : []).filter((a) => a && artifactMatches(a.relPath, types));
  if (!hits.length) {
    wrap.appendChild(h(doc, 'div', 'apick-empty', `This run has no ${types.join('/')} artifacts.`));
    return wrap;
  }
  for (const a of hits) {
    const row = h(doc, 'button', 'apick-art');
    row.type = 'button';
    row.dataset.rel = a.relPath;
    row.append(h(doc, 'span', 'apick-art-name', String(a.relPath).split('/').pop() || a.relPath),
      h(doc, 'span', 'chip apick-art-kind', a.kind || ''),
      h(doc, 'span', 'apick-art-bytes', bytesOf(a.bytes)));
    wrap.appendChild(row);
  }
  return wrap;
}

/**
 * Open the app's modal shell on the picker. Resolves `{ text, label }` on a pick
 * and `null` on Cancel — exactly once, whatever order the clicks arrive in.
 * `modal` is app.js's `{ open: pluginModal, close: closePluginModal }`.
 */
export function openArtifactPicker({ doc = globalThis.document, api, types = ['md'], modal } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const body = h(doc, 'div', 'apick-body');
    let unhook = null;
    const done = (value) => {
      if (settled) return;
      settled = true;
      if (unhook) unhook();
      modal.close();
      resolve(value);
    };
    // The error sits ABOVE whatever is on screen, never in place of it: replacing
    // the body would take the Runs button with it and strand the picker on a run
    // whose indexed file has been pruned.
    const fail = (message) => {
      const old = body.querySelector('.apick-err');
      if (old) old.remove();
      body.prepend(h(doc, 'div', 'apick-err', message));
    };
    const failed = (r) => fail((r && r.data && r.data.error) || `HTTP ${r && r.status}`);
    let runs = [];

    async function showRuns() {
      const r = await api.history();
      if (settled) return;
      if (!r.ok) return failed(r);
      runs = Array.isArray(r.data.pipelines) ? r.data.pipelines : [];
      body.replaceChildren(renderRunList(runs, { doc }));
    }

    async function showArtifacts(runId) {
      const r = await api.runArtifacts(runId);
      if (settled) return;
      if (!r.ok) return failed(r);
      body.replaceChildren(renderArtifactList(r.data.artifacts, { doc, types }));
      body.dataset.runId = runId;
    }

    async function pick(runId, rel) {
      const r = await api.runArtifact(runId, rel);
      if (settled) return;
      if (!r.ok) return failed(r);
      const text = String(r.data.text ?? '');
      // The SAME 256 KiB-per-port cap File… enforces (W9). Without it the run would
      // go out fine and `Save as case` would come back with the store's refusal —
      // the two ways into one port have to agree.
      if (byteLength(text) > MAX_INPUT_BYTES) return fail(`"${rel}" is larger than 256 KiB.`);
      const run = runs.find((p) => p && p.id === runId);
      done({ text, label: `${(run && run.title) || runId} · ${rel}` });
    }

    body.addEventListener('click', (e) => {
      const t = e.target;
      const run = t.closest ? t.closest('.apick-run') : null;
      if (run) { void showArtifacts(run.dataset.runId); return; }
      if (t.closest && t.closest('.apick-back')) { void showRuns(); return; }
      const art = t.closest ? t.closest('.apick-art') : null;
      if (art) void pick(body.dataset.runId, art.dataset.rel);
    });

    // EVERY way out settles the promise once — the shell's own header Close and Escape
    // included, or the caller awaits for ever and the next open stacks a second body.
    if (typeof modal.onClose === 'function') unhook = modal.onClose(() => done(null));
    modal.open('Pick an artifact', body, [['Cancel', 'btn btn-ghost btn-mini', () => done(null)]]);
    void showRuns();
  });
}

/**
 * "File…": read a local file as text, capped at 256 KiB per port (W9). The cap is
 * checked on `file.size` BEFORE the read, so a 2 GB file is never pulled into
 * memory to be rejected.
 */
export function readInputFile(file, { maxBytes = MAX_INPUT_BYTES, FileReaderImpl = globalThis.FileReader } = {}) {
  const name = (file && file.name) || 'file';
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error(`"${name}" could not be read.`)); return; }
    if (Number(file.size) > maxBytes) { reject(new Error(`"${name}" is larger than 256 KiB.`)); return; }
    const reader = new FileReaderImpl();
    reader.onload = () => resolve({ text: String(reader.result ?? ''), label: name });
    reader.onerror = () => reject(new Error(`"${name}" could not be read.`));
    try { reader.readAsText(file); } catch { reject(new Error(`"${name}" could not be read.`)); }
  });
}
