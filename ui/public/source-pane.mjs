// ui/public/source-pane.mjs
// Declarative New-Pipeline pane for plugin task sources (spec §7.4). Pure DOM
// construction: `call(op, args)` — injected by app.js, wrapping
// POST /api/sources/call — is the ONLY I/O. Testable under jsdom with a fake
// `call` and injected timers; app.js owns mounting + submit.

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// debounce(fn, ms, timers?) — trailing-edge. `timers` lets tests inject a
// manual clock ({ setTimeout, clearTimeout }); defaults wrap the globals.
export function debounce(fn, ms, timers = {}) {
  const set = timers.setTimeout || ((f, t) => setTimeout(f, t));
  const clear = timers.clearTimeout || ((id) => clearTimeout(id));
  let pending = null;
  return (...args) => {
    if (pending != null) clear(pending);
    pending = set(() => { pending = null; fn(...args); }, ms);
  };
}

// Values of every non-task-browser input in the pane, keyed by input key —
// these travel as `inputs` to connector ops and into body.source at submit.
function collectInputs(pane) {
  const inputs = {};
  for (const node of pane.querySelectorAll('[data-input-key]')) {
    if (node.classList.contains('sp-task-browser')) continue;
    inputs[node.dataset.inputKey] = node.value;
  }
  return inputs;
}

function taskRow(doc, t) {
  const row = h(doc, 'div', 'sp-row');
  row.dataset.taskId = t.id;
  row.appendChild(h(doc, 'span', 'sp-row-title', t.title));
  const meta = h(doc, 'span', 'sp-row-meta');
  for (const l of t.labels || []) meta.appendChild(h(doc, 'span', 'sp-label', l));
  if (t.updatedAt) meta.appendChild(h(doc, 'span', 'sp-updated mono', t.updatedAt));
  row.appendChild(meta);
  return row;
}

// renderSourcePane(source, { call, doc, timers }) -> detached pane element.
// source = /api/sources entry { type:'plugin', plugin, sourceId, displayName, inputs }.
// Per input type: text -> input; select -> static dropdown; remote-select ->
// dropdown populated ONCE on first focus via call(optionsFrom) (promise kept on
// ._load for deterministic tests); task-browser -> debounced (300ms) search +
// result list + preview (call getTask on pick) + hidden selected taskId.
export function renderSourcePane(source, { call, doc = globalThis.document, timers } = {}) {
  const pane = h(doc, 'div', 'sp-pane');
  pane.dataset.plugin = source.plugin;
  pane.dataset.sourceId = source.sourceId;
  for (const input of source.inputs || []) {
    const field = h(doc, 'div', 'field');
    field.appendChild(h(doc, 'label', '', input.label || input.key));
    if (input.type === 'text') {
      const t = h(doc, 'input', 'input');
      t.type = 'text';
      t.value = input.default != null ? String(input.default) : '';
      t.dataset.inputKey = input.key;
      field.appendChild(t);
    } else if (input.type === 'select') {
      const s = h(doc, 'select', 'select');
      for (const o of input.options || []) {
        const opt = h(doc, 'option', '', typeof o === 'object' ? (o.label ?? o.value) : String(o));
        opt.value = typeof o === 'object' ? String(o.value) : String(o);
        s.appendChild(opt);
      }
      if (input.default != null) s.value = String(input.default);
      s.dataset.inputKey = input.key;
      field.appendChild(s);
    } else if (input.type === 'remote-select') {
      const s = h(doc, 'select', 'select sp-remote');
      const ph = h(doc, 'option', '', 'Click to load…');
      ph.value = '';
      s.appendChild(ph);
      s.dataset.inputKey = input.key;
      s.dataset.optionsFrom = input.optionsFrom || '';
      s.addEventListener('focus', () => {
        if (s._load) return;                       // fetch once
        s._load = (async () => {
          const options = await call(input.optionsFrom, {});
          s.replaceChildren();
          for (const o of options || []) {
            const opt = h(doc, 'option', '', o.label != null ? o.label : String(o.value));
            opt.value = String(o.value);
            s.appendChild(opt);
          }
        })().catch(() => {
          s.replaceChildren(h(doc, 'option', '', 'failed to load — refocus to retry'));
          s._load = null;                          // allow retry
        });
      });
      field.appendChild(s);
    } else if (input.type === 'task-browser') {
      const tb = h(doc, 'div', 'sp-task-browser');
      tb.dataset.inputKey = input.key;
      const search = h(doc, 'input', 'input sp-search');
      search.type = 'text';
      search.placeholder = `Search ${source.displayName || 'tasks'}…`;
      const results = h(doc, 'div', 'sp-results');
      const preview = h(doc, 'div', 'sp-preview viewer');
      preview.hidden = true;
      const hidden = h(doc, 'input', 'sp-task-id');
      hidden.type = 'hidden';
      const runSearch = async (text) => {
        results.replaceChildren(h(doc, 'div', 'hint', 'Searching…'));
        try {
          const r = await call('listTasks', { inputs: collectInputs(pane), search: text });
          results.replaceChildren();
          const tasks = (r && r.tasks) || [];
          for (const t of tasks) results.appendChild(taskRow(doc, t));
          if (!tasks.length) results.appendChild(h(doc, 'div', 'hint', 'No tasks matched.'));
        } catch (e) {
          results.replaceChildren(h(doc, 'div', 'hint err', `search failed: ${e.message}`));
        }
      };
      const debounced = debounce(runSearch, 300, timers);
      search.addEventListener('input', () => debounced(search.value.trim()));
      results.addEventListener('click', (e) => {
        const row = e.target.closest('.sp-row');
        if (!row) return;
        for (const r of results.querySelectorAll('.sp-row.sel')) r.classList.remove('sel');
        row.classList.add('sel');
        hidden.value = row.dataset.taskId;
        preview.hidden = false;
        preview.textContent = 'Loading task…';
        preview._load = (async () => {           // kept for deterministic awaiting
          const task = await call('getTask', { id: row.dataset.taskId });
          preview.replaceChildren(
            h(doc, 'b', 'sp-prev-title', (task && task.title) || row.dataset.taskId),
            h(doc, 'pre', 'sp-prev-body', (task && task.body) || ''),
          );
        })().catch((e) => { preview.textContent = `preview failed: ${e.message}`; });
      });
      tb.append(search, results, preview, hidden);
      field.appendChild(tb);
    }
    pane.appendChild(field);
  }
  return pane;
}

// collectSourcePane(paneEl) -> { inputs, taskId } | { error } when nothing picked.
export function collectSourcePane(paneEl) {
  const inputs = collectInputs(paneEl);
  const hidden = paneEl.querySelector('.sp-task-id');
  const taskId = hidden ? hidden.value : '';
  if (!taskId) return { error: 'Pick a task from the list first.' };
  return { inputs, taskId };
}
