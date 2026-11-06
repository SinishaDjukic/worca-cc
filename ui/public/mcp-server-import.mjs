// ui/public/mcp-server-import.mjs
// Connectors › MCP servers › Import from other tools (docs/mcp-servers.md "From the Servers view"): list what the other
// tools' config files hold (GET /api/mcp/discover: this machine's home configs where allowed, plus one optional
// registered project), pick up to 10 servers and give each a worca name, review the import card the server builds
// (POST /api/mcp/import, nothing written), then Import (the same body with apply and the review's digest). Every value
// arrives masked; secrets become empty secret fields. The imported servers join no set.
// `modal` is the Connectors page's #plugin-modal shell (`afterClose`: its header Close runs the step's Cancel; the shell
// clears that hook on every open). Text goes in with textContent only.

export const IMPORT_MAX = 10;
export const IMPORT_HINT = 'Imported servers join no set: turn them on in a set on Connectors › MCP servers.';
export const HOME_NOTE = 'This worca does not read the home-folder configs of the machine it runs on. Pick a project to scan its files.';
const INTRO = 'Worca reads these files and changes nothing in them. Values are never shown; secrets become empty secret fields you fill in.';
// A template literal: test/shared-graph-purity.test.mjs reads a quoted string ending in that word as a module specifier.
const IMPORT_PATH = `/api/mcp/import`;

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
const count = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`;

/** A row can be ticked iff discoveryView marked it importable: not in worca already, and nothing blocks it. */
export const pickable = (row) => !!row && row.importable === true;

/** What the server runs: the command and its arguments (masked ones stay ••••), or the URL. */
export function targetText(row) {
  if (row.transport === 'stdio') return [row.command || '', ...(row.args || [])].join(' ');
  return row.url || '';
}

/** Open the Import from other tools modal. `onDone({ detail, names })` runs after a successful Import (the modal is
 *  closed); `onChanged()` after an Import that may have written part of the list (status ≥ 500, or "Added …"). */
export function openMcpImport({ api, modal, doc = globalThis.document, onDone = () => {}, onChanged = () => {} }) {
  const st = { projects: [], key: '', data: null, picks: new Set(), names: new Map(), body: null, review: null, digest: '' };
  let busy = false;      // a review or an Import in flight: one request at a time
  let scanSeq = 0;       // only the latest project's scan paints
  // #plugin-modal is one shared dialog: an answer that lands after Cancel, Close, Back or a project change paints nothing.
  let closed = false;
  let shownMsg = null;   // the message line of the step on screen
  const close = () => { closed = true; modal.close(); };
  const cancel = () => close();
  const onScreen = (node) => !closed && node === shownMsg && (typeof modal.shows !== 'function' || modal.shows(node));
  const open = (title, body, actions) => {
    modal.open(title, body, actions);
    if (modal.afterClose) modal.afterClose(cancel);   // after EVERY open: the shell clears the hook on each one
  };
  const msgLine = () => {
    const m = h(doc, 'p', 'form-msg');
    m.setAttribute('aria-live', 'polite');
    return m;
  };
  const tell = (msg, text, kind = 'err') => { msg.textContent = text; msg.className = `form-msg${kind ? ` ${kind}` : ''}`; };
  const errorOf = (r) => (r.data && r.data.error) || `HTTP ${r.status}`;

  // ── list step ──
  let rowEls = [];       // [{ row, cb, name }] of the rows on screen
  let capEl = null;
  function syncPicks() {
    const full = st.picks.size >= IMPORT_MAX;
    for (const { row, cb, name } of rowEls) {
      cb.checked = st.picks.has(row.id);
      cb.disabled = !pickable(row) || (!cb.checked && full);
      name.disabled = !cb.checked;
    }
    if (capEl) capEl.hidden = !full;
  }

  function valuesList(row) {
    const dl = h(doc, 'dl', 'mcp-imp-values');
    for (const m of [row.env, row.headers]) {
      for (const [k, v] of Object.entries(m || {})) {
        const dd = h(doc, 'dd', '', (v && v.value) || '••••');
        if (v && v.secret) dd.appendChild(h(doc, 'span', 'badge', 'secret'));
        if (v && v.ref) dd.appendChild(h(doc, 'span', 'hint', `from $${v.ref}`));
        dl.append(h(doc, 'dt', 'mono', k), dd);
      }
    }
    return dl.children.length ? dl : null;
  }
  function serverRow(row) {
    const el = h(doc, 'div', 'mcp-imp-row');
    el.dataset.id = row.id;
    const cb = h(doc, 'input', 'mcp-imp-pick');
    cb.type = 'checkbox';
    cb.setAttribute('aria-label', `Import ${row.name}`);
    const name = h(doc, 'input', 'input mono mcp-imp-name');
    Object.assign(name, { type: 'text', maxLength: 20, autocomplete: 'off', spellcheck: false });
    name.value = st.names.has(row.id) ? st.names.get(row.id) : (row.suggestedName || '');
    name.setAttribute('aria-label', `Worca name for ${row.name}`);
    name.addEventListener('input', () => { st.names.set(row.id, name.value); });
    cb.addEventListener('change', () => {
      if (cb.checked && st.picks.size >= IMPORT_MAX) cb.checked = false;
      else if (cb.checked) st.picks.add(row.id);
      else st.picks.delete(row.id);
      syncPicks();
    });
    const head = h(doc, 'div', 'mcp-imp-head');
    head.append(cb, h(doc, 'b', 'mono', row.name),
      h(doc, 'span', 'hint', `${row.tool} · ${row.source}${row.scope === 'local' ? ` (local to ${row.project})` : ''}`),
      h(doc, 'span', 'badge', row.transport));
    if (row.inWorca) head.appendChild(h(doc, 'span', 'badge', `Already in worca as ${row.worcaName}`));
    if (row.hasSecrets) head.appendChild(h(doc, 'span', 'badge amber', 'has secrets'));
    if (row.nameTaken) head.appendChild(h(doc, 'span', 'badge amber', 'name taken'));
    el.append(head, h(doc, 'code', 'mono mcp-imp-target', targetText(row)));
    const values = valuesList(row);
    if (values) el.appendChild(values);
    for (const [list, cls] of [[row.problems, 'hint err'], [row.notes, 'hint']]) {
      if (!(list || []).length) continue;
      const ul = h(doc, 'ul', cls);
      for (const t of list) ul.appendChild(h(doc, 'li', '', t));
      el.appendChild(ul);
    }
    const nameField = h(doc, 'label', 'mcp-imp-name-field');
    nameField.append(h(doc, 'span', 'hint', 'Worca name'), name);
    el.appendChild(nameField);
    rowEls.push({ row, cb, name });
    return el;
  }
  function results() {
    const box = h(doc, 'div', 'mcp-imp-results');
    rowEls = []; capEl = null;
    const d = st.data;
    if (!d) { box.appendChild(h(doc, 'p', 'hint', 'Reading the other tools’ files…')); return box; }
    if (d.homeConfigs === false) box.appendChild(h(doc, 'p', 'hint mcp-imp-home-note', HOME_NOTE));
    const files = d.files || [];
    const missing = files.filter((f) => f.status === 'missing').length;
    const ul = h(doc, 'ul', 'mcp-imp-files');
    for (const f of files) {
      if (f.status === 'ok') ul.appendChild(h(doc, 'li', '', `${f.tool} · ${f.source} · ${count(f.servers || 0, 'server')}${f.truncated ? ' · truncated' : ''}`));
      else if (f.status === 'error') ul.appendChild(h(doc, 'li', 'err', `${f.tool} · ${f.source} · ${f.error || 'cannot read it'}`));
    }
    if (missing) ul.appendChild(h(doc, 'li', 'hint', `${missing} other ${missing === 1 ? 'file' : 'files'} not found`));
    if (ul.children.length) box.appendChild(ul);
    const servers = d.servers || [];
    if (!servers.length) box.appendChild(h(doc, 'p', 'hint mcp-imp-empty', 'No MCP servers found in other tools\' files.'));
    for (const row of servers) box.appendChild(serverRow(row));
    if (d.moreServers) box.appendChild(h(doc, 'p', 'hint', `${d.moreServers} more servers not listed`));
    capEl = h(doc, 'p', 'hint mcp-imp-cap', `At most ${IMPORT_MAX} servers per import: untick one to pick another.`);
    box.appendChild(capEl);
    syncPicks();
    return box;
  }

  let resultsBox = null;
  async function scan(msg) {
    const my = ++scanSeq;
    const q = st.key ? `?project=${encodeURIComponent(st.key)}` : '';
    const r = await api('GET', `/api/mcp/discover${q}`);
    if (my !== scanSeq || !onScreen(msg)) return;
    st.data = r.ok && r.data ? r.data : { servers: [], files: [] };
    resultsBox.replaceChildren(results());
    if (r.ok) tell(msg, '', '');
    else tell(msg, errorOf(r));
  }
  function projectSelect(msg) {
    const sel = h(doc, 'select', 'select mcp-imp-project');
    sel.setAttribute('aria-label', 'Also scan a project');
    const fill = () => {
      sel.replaceChildren(Object.assign(h(doc, 'option', '', 'No project'), { value: '' }),
        ...st.projects.map((p) => Object.assign(h(doc, 'option', '', p.name || p.key), { value: p.key })));
      sel.value = st.key;
    };
    fill();
    sel.addEventListener('change', () => {
      st.key = sel.value;
      st.picks.clear(); st.names.clear();   // ids are per scan
      st.data = null;
      resultsBox.replaceChildren(results());
      tell(msg, '', '');
      void scan(msg);
    });
    return { sel, fill };
  }

  /** `note`: a message to show at once (a refused review that came back here). */
  function listStep(note = '') {
    const body = h(doc, 'div', 'mcp-imp');
    const msg = msgLine();
    if (note) tell(msg, note);
    const { sel, fill } = projectSelect(msg);
    const field = h(doc, 'label', 'mcp-imp-project-field');
    field.append(h(doc, 'span', 'hint', 'Also scan a project'), sel);
    resultsBox = h(doc, 'div');
    resultsBox.appendChild(results());
    body.append(h(doc, 'p', 'hint', INTRO), field, resultsBox, msg);
    shownMsg = msg;
    open('Import from other tools', body, [
      ['Cancel', 'btn btn-sm', cancel],
      ['Review', 'btn btn-primary btn-sm', () => review(msg)],
    ]);
    return { msg, fill };
  }

  function picked() {
    return (st.data?.servers || []).filter((s) => st.picks.has(s.id))
      .map((s) => ({ id: s.id, as: (st.names.has(s.id) ? st.names.get(s.id) : (s.suggestedName || '')).trim() }));
  }
  async function review(msg) {
    if (busy || !onScreen(msg)) return;
    const servers = picked();
    if (!servers.length) return tell(msg, 'Pick at least one server');
    st.body = { projectKey: st.key || null, servers };
    busy = true;
    tell(msg, 'Building the review…', '');
    const r = await api('POST', IMPORT_PATH, st.body);
    busy = false;
    if (!onScreen(msg)) return;
    if (!r.ok) {
      const present = r.data?.code === 'NOTHING_TO_IMPORT' ? (r.data.alreadyPresent || []).map((p) => p.name) : [];
      return tell(msg, `${errorOf(r)}${present.length ? ` — already in worca: ${present.join(', ')}` : ''}`);
    }
    st.review = r.data.review || {};
    st.digest = r.data.digest;
    reviewStep();
  }

  // ── review step ──
  /** `changed`: the files or the registry moved since this review (409): Import becomes Review again. */
  function reviewStep(note = '', changed = false) {
    const rv = st.review;
    const body = h(doc, 'div', 'mcp-imp');
    body.appendChild(h(doc, 'p', '', rv.summary || ''));
    const table = h(doc, 'table', 'table mcp-imp-changes');
    const tb = h(doc, 'tbody');
    for (const c of rv.changes || []) {
      const tr = h(doc, 'tr');
      tr.append(h(doc, 'th', '', c.label), h(doc, 'td', 'mono', c.after));
      tb.appendChild(tr);
    }
    table.appendChild(tb);
    const wrap = h(doc, 'div', 'table-wrap');
    wrap.appendChild(table);
    body.appendChild(wrap);
    for (const [list, cls] of [[rv.warnings, 'mcp-imp-warn'], [rv.effects, 'hint mcp-imp-effects']]) {
      if (!(list || []).length) continue;
      const ul = h(doc, 'ul', cls);
      for (const t of list) ul.appendChild(h(doc, 'li', '', t));
      body.appendChild(ul);
    }
    if ((rv.alreadyPresent || []).length) {
      const present = h(doc, 'div', 'mcp-imp-present');
      for (const p of rv.alreadyPresent) present.appendChild(h(doc, 'p', 'hint', `Already in worca, not added again: ${p.name} (${p.from})`));
      body.appendChild(present);
    }
    const msg = msgLine();
    if (note) tell(msg, note);
    body.append(h(doc, 'p', 'hint', IMPORT_HINT), msg);
    shownMsg = msg;
    open('Import · review', body, [
      ['Back', 'btn btn-sm', () => { if (busy) return; listStep(); }],
      ['Cancel', 'btn btn-sm', cancel],
      changed ? ['Review again', 'btn btn-primary btn-sm', () => reviewAgain(msg)] : ['Import', 'btn btn-primary btn-sm', () => commit(msg)],
    ]);
  }

  async function reviewAgain(msg) {
    if (busy || !onScreen(msg)) return;
    busy = true;
    tell(msg, 'Building the review…', '');
    const r = await api('POST', IMPORT_PATH, st.body);
    busy = false;
    if (!onScreen(msg)) return;
    if (!r.ok) return listStep(errorOf(r));
    st.review = r.data.review || {};
    st.digest = r.data.digest;
    reviewStep();
  }

  async function commit(msg) {
    if (busy || !onScreen(msg)) return;
    busy = true;
    tell(msg, 'Importing…', '');
    const r = await api('POST', IMPORT_PATH, { ...st.body, apply: true, digest: st.digest });
    busy = false;
    const error = r.ok ? '' : errorOf(r);
    const partial = !r.ok && (r.status >= 500 || /^Added /.test(error));
    if (!onScreen(msg)) {
      // Closed while it wrote: nothing paints, but the page reads the registry again if it may have changed.
      if (r.ok || partial) await onChanged();
      return;
    }
    if (r.ok) {
      close();
      await onDone({ detail: r.data.detail, names: r.data.names || [] });
      return;
    }
    if (r.status === 409 && r.data?.code === 'IMPORT_CHANGED') return reviewStep(error, true);
    tell(msg, error);
    if (partial) await onChanged();
  }

  const first = listStep();
  void (async () => {
    const [p] = await Promise.all([api('GET', '/api/projects'), scan(first.msg)]);
    st.projects = p && p.ok && Array.isArray(p.data?.projects) ? p.data.projects.filter((x) => x && typeof x.key === 'string') : [];
    if (onScreen(first.msg)) first.fill();
  })();
}
