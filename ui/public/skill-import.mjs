// ui/public/skill-import.mjs
// Connectors › Skills › Import skill (docs/skills.md; skills registry spec §6.4, §5): pick a source — a folder,
// a git URL, a pasted SKILL.md or one of your Claude Code skills (~/.claude/skills) — then preview the staged copy
// (its name, the file tree with sizes and flagged rows, the limits) and Import it under an explicit consent. The server
// stages and commits (POST /api/skills/import/preview, POST /api/skills/import); a stage left by Back, Cancel or the
// dialog's own Close is discarded (DELETE /api/skills/import/<stage>). A hosted Worca offers only Git URL and Paste.
// `modal` is app.js's #plugin-modal shell (`afterClose`: its header Close runs the step's Cancel).

export const SKILL_CONSENT = 'Worca copies these files into its library. Agents may read them and run the scripts where their guardrails allow.';
// Honest copy for what no guardrail stops (user decision U2; the hooks line, U1, is the library's own `hooks` finding text).
export const SKILL_SHELL_NOTE = 'Its inline shell blocks (!`cmd`) run in pipeline runs without guardrail checks; Ask Worca never runs them.';
export const SKILL_LIMITS_TEXT = 'Limits: 300 files · 1000 links and folders · 1 MB per file · 8 MB total · no .claude-plugin/ inside · the frontmatter name must equal the folder name';

const SOURCES = [['dir', 'Folder'], ['git', 'Git URL'], ['paste', 'Paste'], ['home', 'From your Claude Code skills']];
// Finding kinds (inspect.mjs) → the flag a tree row shows; red ones are why an import is refused or risky.
const FLAGS = {
  executable: ['executable', 'amber'], 'shell-block': ['shell block', 'amber'], token: ['token-shaped text', 'red'],
  expansion: ['${ in text', 'amber'], symlink: ['symlink leaves the folder · not copied', 'red'],
  'plugin-manifest': ['.claude-plugin/ inside', 'red'], 'plugin-root-ref': ['plugin-root ref · ${CLAUDE_PLUGIN_ROOT}', 'amber'],
  hooks: ['declares hooks', 'red'],
};

const enc = encodeURIComponent;
function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function button(doc, cls, label, data = {}) {
  const b = h(doc, 'button', cls, label);
  b.type = 'button';
  Object.assign(b.dataset, data);
  return b;
}
const kB = (n) => `${(n / 1024).toFixed(1)} kB`;
const count = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`;
// A link that stays inside the folder is imported as a copy of its target (P1 lists it among the files); only a link
// that leaves the folder is dropped (and is a problem).
const copiedLink = (ins, f) => f.kind === 'symlink' && (ins.files || []).some((x) => x.path === f.path);

/** "8 files · 25.0 kB · 2 scripts · 1 shell block · 1 token-shaped string …": the finding kinds present, counted. P1 lists
 *  at most 50 findings of a kind, then one "… and N more" finding that stands for the other N. */
const MORE_RE = /^… and (\d+) more$/;
const findingCount = (f) => { const m = MORE_RE.exec(f.text || ''); return m ? Number(m[1]) : 1; };
export function inspectionSummary(ins) {
  const findings = ins.findings || [];
  const parts = [count((ins.files || []).length, 'file'), kB(ins.bytes || 0), count((ins.scripts || []).length, 'script'),
    count(ins.shellBlocks || 0, 'shell block')];
  for (const [kind, one] of [['token', 'token-shaped string'], ['expansion', '${…} reference'], ['plugin-root-ref', 'plugin-root ref'],
    ['symlink', 'symlink'], ['plugin-manifest', '.claude-plugin/ folder']]) {
    const n = findings.filter((f) => f.kind === kind && !copiedLink(ins, f)).reduce((sum, f) => sum + findingCount(f), 0);
    if (n) parts.push(count(n, one));
  }
  return parts.join(' · ');
}

/** The library's `hooks` finding (its text is P1's SKILL_HOOKS_TEXT), or null. */
const hooksFinding = (ins) => (ins.findings || []).find((f) => f.kind === 'hooks') || null;

/** The consent block of an Import or an Update: what Worca does, then what no guardrail stops in this skill. */
export function consentNode(doc, ins) {
  const box = h(doc, 'div', 'sk-consent');
  box.appendChild(h(doc, 'b', '', SKILL_CONSENT));
  if ((ins.shellBlocks || 0) > 0) box.appendChild(h(doc, 'p', 'sk-consent-note', SKILL_SHELL_NOTE));
  const hooks = hooksFinding(ins);
  if (hooks) box.appendChild(h(doc, 'p', 'sk-consent-note err', `This skill ${hooks.text}.`));
  return box;
}

/** The staged files, flagged (one badge per finding kind) — plus any flagged path that was not copied (a symlink). */
export function fileTree(doc, ins) {
  const tree = h(doc, 'div', 'sk-tree');
  const flags = new Map();
  for (const f of ins.findings || []) {
    const list = flags.get(f.path) || [];
    if (!list.some((x) => x.kind === f.kind)) list.push(f);
    flags.set(f.path, list);
  }
  const rows = (ins.files || []).map((f) => ({ path: f.path, bytes: f.bytes }));
  for (const p of flags.keys()) if (!rows.some((r) => r.path === p)) rows.push({ path: p, bytes: null });
  rows.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));   // code-unit order: SKILL.md first, as on every OS
  for (const r of rows) {
    const row = h(doc, 'div', 'sk-tree-row');
    row.appendChild(h(doc, 'span', 'mono', r.path));
    for (const f of flags.get(r.path) || []) {
      const [label, tone] = copiedLink(ins, f) ? ['symlink · imported as a copy', 'amber'] : FLAGS[f.kind] || [f.kind, 'amber'];
      const b = h(doc, 'span', `badge ${tone} sk-flag`, label);
      b.title = f.text || label;
      row.appendChild(b);
    }
    row.appendChild(h(doc, 'span', 'sz', r.bytes == null ? '' : kB(r.bytes)));
    tree.appendChild(row);
  }
  return tree;
}

/** The step-1 inputs → the preview's `source`, or what is missing (a string). A pasted SKILL.md that names itself
 *  wins over the optional Name. */
export function sourceOf(form) {
  if (form.src === 'dir') return form.path.trim() ? { kind: 'dir', path: form.path.trim() } : 'type or browse to the folder that holds SKILL.md';
  if (form.src === 'git') {
    if (!form.url.trim()) return 'type the repository URL';
    return { kind: 'git', url: form.url.trim(), ...(form.ref.trim() ? { ref: form.ref.trim() } : {}),
      ...(form.subdir.trim() ? { subdir: form.subdir.trim() } : {}) };
  }
  if (form.src === 'paste') {
    if (!form.content.trim()) return 'paste the SKILL.md';
    return { kind: 'paste', content: form.content, ...(form.pname.trim() ? { name: form.pname.trim() } : {}) };
  }
  return form.home ? { kind: 'home', name: form.home } : 'pick one of your Claude Code skills';
}

/** Open the Import skill modal. `onDone({ id, name })` runs after a successful Import (the modal is closed).
 *  `folderImports: false` (a hosted Worca, GET /api/skills) offers only Git URL and Paste. `modal.shows(node)`, when the
 *  shell has it (app.js), says whether `node` is still on screen: the modal's own Close or a tab switch closed it. */
export function openSkillImport({ api, modal, onDone = () => {}, doc = globalThis.document, folderImports = true }) {
  const sources = folderImports ? SOURCES : SOURCES.filter(([k]) => k === 'git' || k === 'paste');
  const form = { src: sources[0][0], path: '', url: '', ref: '', subdir: '', pname: '', content: '', home: '' };
  let homeList = null;   // GET /api/skills/home, read when that source is first shown
  let candidates = null; // a git repository's skill folders, when it holds several (the preview's 400 names them)
  let staged = null;     // { stage, name, inspection, src } while the preview shows
  let previewing = null; // the message line of the step whose preview is in flight (a second click waits for it)
  let busy = false;      // an Import in flight
  // #plugin-modal is one shared dialog: an answer that lands after Cancel, the modal's own Close or another step was
  // shown must open nothing (it would reopen a cancelled dialog, or replace another one) and drop what it staged.
  let closed = false;
  let shownMsg = null;   // the message line of the step on screen
  const close = () => { closed = true; modal.close(); };
  const onScreen = (node) => !closed && node === shownMsg && (typeof modal.shows !== 'function' || modal.shows(node));

  const msgLine = () => {
    const m = h(doc, 'p', 'form-msg');
    m.setAttribute('aria-live', 'polite');
    return m;
  };
  const tell = (msg, text, kind = 'err') => { msg.textContent = text; msg.className = `form-msg${kind ? ` ${kind}` : ''}`; };
  const discard = async () => {
    if (!staged) return;
    const { stage } = staged;
    staged = null;
    await api('DELETE', `/api/skills/import/${enc(stage)}`);
  };
  function input(key, label, attrs = {}) {
    const i = h(doc, attrs.rows ? 'textarea' : 'input', `${attrs.rows ? 'textarea' : 'input'} mono`);
    if (!attrs.rows) i.type = 'text';
    Object.assign(i, { autocomplete: 'off', spellcheck: false, ...attrs });
    i.value = form[key];
    i.dataset.imp = key;
    i.setAttribute('aria-label', label);
    i.addEventListener('input', () => {
      form[key] = i.value;
      if (key === 'url' || key === 'ref') candidates = null;   // another repository or commit: its folders are unknown
    });
    return i;
  }
  function field(label, ...nodes) {
    const f = h(doc, 'div', 'field');
    f.append(h(doc, 'label', '', label), ...nodes);
    return f;
  }

  function sourcePane(msg) {
    const pane = h(doc, 'div', 'sk-src');
    if (form.src === 'dir') {
      const row = h(doc, 'div', 'sk-row-input');
      const path = input('path', 'Folder', { placeholder: 'the folder that holds SKILL.md' });
      const browse = button(doc, 'btn btn-ghost btn-mini', 'Browse…', { impBrowse: '' });
      browse.addEventListener('click', async () => {
        const r = await api('POST', '/api/fs/pick-folder', {});
        const d = r.ok ? r.data : null;
        if (d && d.status === 'picked' && d.path) { form.path = d.path; path.value = d.path; tell(msg, '', ''); }
        else if (!d || d.status === 'unsupported') tell(msg, 'No folder dialog here: type the path.', '');
      });
      row.append(path, browse);
      pane.appendChild(field('Folder', row));
    } else if (form.src === 'git') {
      const subdir = input('subdir', 'Folder in the repository', { placeholder: 'skills/release-notes' });
      pane.append(field('Repository URL', input('url', 'Repository URL', { placeholder: 'https://github.com/acme/skills' })),
        field('Ref (optional)', input('ref', 'Ref', { placeholder: 'a branch, tag or commit; empty = the default branch' })),
        field('Folder in the repository (optional)', subdir));
      if (candidates && candidates.length) {
        // The repository holds several skills: pick one instead of retyping its path (the pick previews again).
        const sel = h(doc, 'select', 'select');
        sel.dataset.impCandidate = '';
        sel.setAttribute('aria-label', 'Skill folder');
        sel.appendChild(Object.assign(h(doc, 'option', '', 'Pick the skill’s folder…'), { value: '' }));
        // '' is the repository's root (a SKILL.md at the top): offered as "/" so it can be picked, sent as no folder.
        for (const c of candidates) sel.appendChild(Object.assign(h(doc, 'option', '', c || 'the repository root'), { value: c || '/' }));
        sel.addEventListener('change', () => {
          if (!sel.value) return;
          form.subdir = sel.value === '/' ? '' : sel.value;
          subdir.value = form.subdir;
          void preview(msg);
        });
        pane.appendChild(field('Skill folder', sel));
      }
      pane.appendChild(h(doc, 'small', 'hint', 'Worca fetches a shallow copy the way it fetches plugins, and pins the commit.'));
    } else if (form.src === 'paste') {
      pane.append(field('Name (optional)', input('pname', 'Name', { placeholder: 'used when the SKILL.md has no name', maxLength: 64 })),
        field('SKILL.md', input('content', 'SKILL.md', { rows: 12, placeholder: '---\nname: release-notes\ndescription: …\n---\n' })));
    } else {
      const list = h(doc, 'div', 'sk-pick');
      list.setAttribute('role', 'radiogroup');
      list.setAttribute('aria-label', 'Your Claude Code skills');
      if (!homeList) list.appendChild(h(doc, 'small', 'hint', 'loading…'));
      else if (!homeList.length) list.appendChild(h(doc, 'p', 'hint', 'No skills in ~/.claude/skills.'));
      for (const s of homeList || []) {
        const row = h(doc, 'label', 'sk-pick-row');
        const radio = h(doc, 'input');
        Object.assign(radio, { type: 'radio', name: 'sk-home', value: s.name, checked: form.home === s.name });
        radio.addEventListener('change', () => { form.home = s.name; });
        row.append(radio, h(doc, 'span', 'mono', s.name), h(doc, 'span', 'hint', s.description || ''));
        list.appendChild(row);
      }
      pane.appendChild(list);
    }
    return pane;
  }

  /** `note`: a message to show at once (a refused preview that re-rendered this step). */
  function step1(note = '') {
    const body = h(doc, 'div', 'sk-import-form');
    const seg = h(doc, 'div', 'seg seg-sm');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Source');
    for (const [k, label] of sources) {
      const b = button(doc, form.src === k ? 'on' : '', label, { impSrc: k });
      b.setAttribute('aria-pressed', String(form.src === k));
      b.addEventListener('click', () => {
        form.src = k;
        step1();
        if (k === 'home' && !homeList) void loadHome();
      });
      seg.appendChild(b);
    }
    const msg = msgLine();
    if (note) tell(msg, note);
    body.append(seg, sourcePane(msg));
    if (!folderImports) body.appendChild(h(doc, 'small', 'hint', 'Folder and Claude Code imports need a local Worca.'));
    body.appendChild(msg);
    shownMsg = msg;
    modal.open('Import skill', body, [
      ['Cancel', 'btn btn-ghost btn-mini', close],
      ['Preview', 'btn btn-primary btn-mini', () => preview(msg)],
    ]);
  }
  async function loadHome() {
    const r = await api('GET', '/api/skills/home');
    homeList = r.ok && Array.isArray(r.data?.skills) ? r.data.skills : [];
    if (form.src === 'home' && !staged && onScreen(shownMsg)) step1();
  }

  async function preview(msg) {
    const source = sourceOf(form);
    if (typeof source === 'string') return tell(msg, source);
    if (previewing === msg) return;
    previewing = msg;
    const { src } = form;
    tell(msg, src === 'git' ? 'Fetching…' : 'Reading…', '');
    const r = await api('POST', '/api/skills/import/preview', { source });
    if (previewing === msg) previewing = null;
    if (!onScreen(msg)) {   // cancelled, closed, or another source or step shown while it read
      if (r.ok && r.data && r.data.stage) await api('DELETE', `/api/skills/import/${enc(r.data.stage)}`);
      return;
    }
    const error = (r.data && r.data.error) || `HTTP ${r.status}`;
    if (!r.ok && src === 'git' && Array.isArray(r.data?.candidates) && r.data.candidates.length) {
      candidates = r.data.candidates;
      return step1(error);
    }
    if (!r.ok) return tell(msg, error);
    candidates = null;
    staged = { stage: r.data.stage, name: r.data.name || '', inspection: r.data.inspection || {}, src };
    step2();
  }

  function step2() {
    const ins = staged.inspection;
    const body = h(doc, 'div', 'sk-import-form');
    // The name is SKILL.md's (or the folder's, when SKILL.md names none): the library refuses any other, so it is shown,
    // not edited.
    const name = h(doc, 'input', 'input mono');
    Object.assign(name, { type: 'text', value: staged.name, readOnly: true });
    name.dataset.imp = 'name';
    name.setAttribute('aria-label', 'Name');
    body.appendChild(field('Name', name, h(doc, 'small', 'hint sk-name-note',
      'From SKILL.md’s name (or the folder’s, when SKILL.md has none). To change it, edit the name: line and preview again.')));
    if (staged.src === 'home') {
      body.appendChild(h(doc, 'small', 'hint sk-home-note', `Your personal /${staged.name} keeps loading in pipelines; agents call this copy`
        + ` /<set>:${staged.name}, and it changes only when you Check for updates.`));
    }
    const box = h(doc, 'div', 'sk-preview');
    box.setAttribute('aria-label', 'Preview of the staged folder');
    const head = h(doc, 'div', 'pl-head');
    head.append(h(doc, 'b', 'mono', ins.name || staged.name), h(doc, 'span', 'hint', ins.description || ''));
    if (hooksFinding(ins)) head.appendChild(h(doc, 'span', 'badge red', 'declares hooks'));
    box.append(head, h(doc, 'small', 'hint sk-summary', inspectionSummary(ins)), fileTree(doc, ins), h(doc, 'small', 'hint', SKILL_LIMITS_TEXT));
    body.appendChild(box);
    for (const p of ins.problems || []) body.appendChild(h(doc, 'p', 'hint err sk-problem', p));
    const msg = msgLine();
    body.append(consentNode(doc, ins), msg);
    shownMsg = msg;
    const cancel = async () => { if (busy) return; close(); await discard(); };
    modal.open(`Import skill · ${staged.name || 'preview'}`, body, [
      // Step 1 first, so this step's buttons are gone before the stage is (an Import after Back has nothing to commit).
      ['Back', 'btn btn-ghost btn-mini', async () => { if (busy) return; const gone = discard(); step1(); await gone; }],
      ['Cancel', 'btn btn-ghost btn-mini', cancel],
      ['Import', 'btn btn-primary btn-mini', () => commit(msg)],
    ]);
    if (modal.afterClose) modal.afterClose(cancel);   // the dialog's own Close is this step's Cancel
  }

  async function commit(msg) {
    if (!staged || !onScreen(msg)) return;
    if ((staged.inspection.problems || []).length) return tell(msg, 'This folder cannot be imported: see the problems above.');
    if (busy) return;
    busy = true;
    const { name } = staged;
    // A template literal: test/shared-graph-purity.test.mjs reads a quoted string ending in `import` as a module specifier.
    const r = await api('POST', `/api/skills/import`, { stage: staged.stage, name });
    busy = false;
    // The name advice only for a taken name: a 409 also means a library.json that is damaged or from a newer Worca.
    if (r.status === 409 && /already in the library/.test((r.data && r.data.error) || '')) {
      return tell(msg, `${r.data.error} — remove the existing one in Connectors › Skills first, or change the name in its SKILL.md.`);
    }
    if (!r.ok) return tell(msg, (r.data && r.data.error) || `HTTP ${r.status}`);
    staged = null;   // committed: nothing left to discard
    const mine = onScreen(msg);   // closed meanwhile: another dialog may be on screen now
    closed = true;
    if (mine) modal.close();
    await onDone({ id: r.data.id, name });
  }

  step1();
}
