// ui/public/actions-config-view.mjs
// Pure DOM editors for Actions config (issue #529): the project editor (Setup, Actions,
// Built in cards) and the workspace stack editor. Like team-policy-view.mjs: no fetch, no
// network — app.js loads the config, saves what onSave hands back and shows server errors.
// The listeners here are purely local (add/remove rows, inline port checks, refills).

import { appendWithPageLinks, projectActionsHref } from './actions-view.mjs';

const BASE_PLACEHOLDERS = ['{branch}', '{worktree}', '{runId}', '{member}'];
const BUILTINS = [
  { key: 'editor', label: 'Editor', detect: true },
  { key: 'terminal', label: 'Terminal', detect: true },
  { key: 'fileManager', label: 'File manager', detect: true },
  { key: 'copyCommand', label: 'Copy command', detect: false },
];
const READY_OPTIONS = [['immediate', 'Right away'], ['port', 'Port answers'], ['output', 'Output contains']];
const KIND_OPTIONS = [['service', 'Service'], ['task', 'Task']];
const DEFAULT_TIMEOUT_MS = 60_000;


function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function btn(doc, cls, text, primary = false) { const b = h(doc, 'button', `${primary ? 'btn btn-primary btn-sm' : 'btn btn-sm'} ${cls}`, text); b.type = 'button'; return b; }
function input(doc, cls, value, placeholder = '') {
  const i = h(doc, 'input', `input ${cls}`);
  i.type = 'text';
  i.value = value == null ? '' : String(value);
  if (placeholder) i.placeholder = placeholder;
  return i;
}
function select(doc, cls, options, value) {
  const s = h(doc, 'select', `input ${cls}`);
  for (const [v, label] of options) { const o = h(doc, 'option', null, label); o.value = v; s.append(o); }
  s.value = value;
  return s;
}
function field(doc, label, control, hint) {
  const wrap = h(doc, 'label', 'ac-field');
  wrap.append(h(doc, 'span', 'ac-field-label', label), control);
  if (hint) wrap.append(h(doc, 'span', 'ac-field-hint', hint));
  return wrap;
}
function card(doc, cls, title, sub) {
  const c = h(doc, 'section', `card ac-card ${cls}`);
  c.append(h(doc, 'h3', 'ac-card-title', title));
  if (sub) c.append(h(doc, 'p', 'ac-card-sub', sub));
  return c;
}
const val = (root, sel) => root.querySelector(sel)?.value ?? '';
const orNull = (s) => (s.trim() ? s.trim() : null);

/**
 * Inline copy of src/core/actions/model.mjs validatePortValue: ui/public must not import
 * src/core, and src/shared holds only purity-safe modules. Returns the error text or null.
 */
export function portError(v) {
  const s = String(v ?? '').trim();
  if (s === '' || s === 'auto') return null;
  if (!/^\d+$/.test(s)) return 'a port must be "auto" or a whole number';
  const n = Number(s);
  if (n < 1024 || n > 65535) return 'a port must be between 1024 and 65535';
  return null;
}
function portValue(raw) {
  const s = String(raw ?? '').trim();
  if (s === '' || s === 'auto') return 'auto';
  return /^\d+$/.test(s) ? Number(s) : s;
}

// ---- Project editor ------------------------------------------------------------------------
function envRow(doc, row, onChange) {
  const r = h(doc, 'div', 'ac-env-row');
  const name = input(doc, 'mono ac-env-name', row?.name, 'e.g. PORT');
  const kind = select(doc, 'ac-env-type', [['text', 'Text'], ['port', 'Port']], row?.type === 'port' ? 'port' : 'text');
  const value = input(doc, 'mono ac-env-value', row?.value ?? (row?.type === 'port' ? 'auto' : ''), 'value or auto');
  const err = h(doc, 'span', 'field-err');
  err.hidden = true;
  const remove = btn(doc, 'ac-remove-env', 'Remove');
  const check = () => {
    const msg = kind.value === 'port' ? portError(value.value) : null;
    err.textContent = msg || '';
    err.hidden = !msg;
  };
  value.addEventListener('input', check);
  kind.addEventListener('change', () => { check(); onChange(); });
  name.addEventListener('input', onChange);
  remove.addEventListener('click', () => { r.remove(); onChange(); });
  r.append(name, kind, value, remove, err);
  check();
  return r;
}

function placeholderText(actionEl) {
  const ports = [...actionEl.querySelectorAll('.ac-env-row')]
    .filter((r) => r.querySelector('.ac-env-type').value === 'port')
    .map((r) => r.querySelector('.ac-env-name').value.trim())
    .filter(Boolean);
  return `Placeholders: ${[...BASE_PLACEHOLDERS, ...(ports.length ? ports.map((p) => `{${p}}`) : ['{NAME}'])].join(' ')}`;
}

function actionRow(doc, a, { onTry } = {}) {
  const row = h(doc, 'div', 'ac-action');
  const head = h(doc, 'div', 'ac-action-head');
  const id = input(doc, 'mono ac-f-id', a?.id, 'e.g. run');
  const label = input(doc, 'ac-f-label', a?.label, 'e.g. Run');
  const kind = select(doc, 'ac-f-kind', KIND_OPTIONS, a?.kind === 'task' ? 'task' : 'service');
  head.append(field(doc, 'Id', id), field(doc, 'Label', label), field(doc, 'Kind', kind));
  if (onTry) {
    const tryBtn = btn(doc, 'ac-try', 'Try it');
    tryBtn.addEventListener('click', () => onTry(id.value.trim(), tryBtn));
    head.append(tryBtn);
  }
  const remove = btn(doc, 'ac-remove-action', 'Remove');
  remove.addEventListener('click', () => row.remove());
  head.append(remove);

  const hint = h(doc, 'p', 'ac-placeholders mono');
  const refresh = () => { hint.textContent = placeholderText(row); };

  const cmd = input(doc, 'mono ac-f-cmd', a?.cmd, 'e.g. npm start');
  const cmdWin32 = input(doc, 'mono ac-f-cmdwin32', a?.cmdWin32, 'same as above');
  const cwd = input(doc, 'mono ac-f-cwd', a?.cwd ?? '.', '.');
  const openUrl = input(doc, 'mono ac-f-openurl', a?.openUrl, 'e.g. http://localhost:{PORT}');

  const envList = h(doc, 'div', 'ac-env-list');
  for (const e of a?.env || []) envList.append(envRow(doc, e, refresh));
  const addEnv = btn(doc, 'ac-add-env', 'Add variable');
  addEnv.addEventListener('click', () => { envList.append(envRow(doc, { name: '', type: 'text', value: '' }, refresh)); refresh(); });

  const ready = a?.ready || { kind: 'immediate' };
  const readyBox = h(doc, 'div', 'ac-ready');
  const readyKind = select(doc, 'ac-ready-kind', READY_OPTIONS, ready.kind || 'immediate');
  const readyPort = input(doc, 'mono ac-ready-port', ready.port, 'e.g. PORT');
  const readyText = input(doc, 'mono ac-ready-text', ready.text, 'e.g. ready in');
  const timeout = input(doc, 'ac-ready-timeout', Math.round((ready.timeoutMs || DEFAULT_TIMEOUT_MS) / 1000), '60');
  const portField = field(doc, 'Port variable', readyPort);
  const textField = field(doc, 'Text', readyText);
  const timeoutField = field(doc, 'Timeout (s)', timeout);
  readyBox.append(field(doc, 'Ready when', readyKind), portField, textField, timeoutField);
  const syncReady = () => {
    readyBox.hidden = kind.value === 'task';
    portField.hidden = readyKind.value !== 'port';
    textField.hidden = readyKind.value !== 'output';
    timeoutField.hidden = readyKind.value === 'immediate';
  };
  readyKind.addEventListener('change', syncReady);
  kind.addEventListener('change', syncReady);
  syncReady();

  row.append(head,
    field(doc, 'Command', cmd), field(doc, 'Windows command', cmdWin32, 'Optional; used on Windows instead'),
    field(doc, 'Working directory', cwd, 'Relative to the checkout'),
    h(doc, 'div', 'ac-env-head', 'Environment'), envList, addEnv,
    field(doc, 'Open link', openUrl, 'http:// or https:// only'), readyBox, hint);
  refresh();
  return row;
}

function readAction(row) {
  const kind = val(row, '.ac-f-kind') === 'task' ? 'task' : 'service';
  const env = [...row.querySelectorAll('.ac-env-row')].map((r) => {
    const type = val(r, '.ac-env-type') === 'port' ? 'port' : 'text';
    const raw = val(r, '.ac-env-value');
    return { name: val(r, '.ac-env-name').trim(), type, value: type === 'port' ? portValue(raw) : raw };
  });
  let ready = { kind: 'immediate' };
  const rk = val(row, '.ac-ready-kind');
  if (kind === 'service' && (rk === 'port' || rk === 'output')) {
    const secs = Number(val(row, '.ac-ready-timeout'));
    const timeoutMs = Number.isFinite(secs) && secs > 0 ? Math.round(secs * 1000) : DEFAULT_TIMEOUT_MS;
    ready = rk === 'port'
      ? { kind: 'port', port: val(row, '.ac-ready-port').trim(), timeoutMs }
      : { kind: 'output', text: val(row, '.ac-ready-text').trim(), timeoutMs };
  }
  return {
    id: val(row, '.ac-f-id').trim(),
    label: val(row, '.ac-f-label').trim(),
    kind,
    cmd: val(row, '.ac-f-cmd').trim(),
    cmdWin32: orNull(val(row, '.ac-f-cmdwin32')),
    cwd: val(row, '.ac-f-cwd').trim() || '.',
    env,
    openUrl: orNull(val(row, '.ac-f-openurl')),
    ready,
  };
}

const BUILTIN_SETTING = new Set(['editor', 'terminal']);   // the two a Settings field can name

function detectNote(entry) {
  if (entry === undefined) return '';
  return entry ? entry.label || 'found' : 'not found on this machine';
}

/**
 * The project's Actions config editor: Setup, Actions (inline editor) and Built in cards.
 * `detected` maps editor/terminal/fileManager to `{label}` or null (not found). onSave gets
 * (readEditorForm(root), saveButton); onTry gets (actionId, button).
 */
export function renderProjectActionsEditor(cfg, { doc, detected = {}, onSave, onTry } = {}) {
  const root = h(doc, 'div', 'actions-config');

  const setupCard = card(doc, 'ac-setup-card', 'Setup', 'Runs once in a fresh checkout before the first action.');
  setupCard.append(field(doc, 'Setup command', input(doc, 'mono ac-setup', cfg?.setup, 'e.g. npm ci')));

  const actionsCard = card(doc, 'ac-actions-card', 'Actions', 'Services keep running; tasks run to the end.');
  const list = h(doc, 'div', 'ac-action-list');
  for (const a of cfg?.actions || []) list.append(actionRow(doc, a, { onTry }));
  const add = btn(doc, 'ac-add-action', 'Add action');
  add.addEventListener('click', () => list.append(actionRow(doc, null, { onTry })));
  actionsCard.append(list, add);

  const builtinsCard = card(doc, 'ac-builtins-card', 'Built in', 'Buttons every checkout gets.');
  const b = cfg?.builtins || {};
  for (const bi of BUILTINS) {
    const line = h(doc, 'label', 'ac-builtin');
    const box = h(doc, 'input', `ac-builtin-${bi.key}`);
    box.type = 'checkbox';
    box.checked = b[bi.key] !== false;
    line.append(box, h(doc, 'span', 'ac-builtin-label', bi.label));
    const note = bi.detect ? detectNote(detected?.[bi.key]) : '';
    // Not found: say where to name one (Settings › Runs › Actions › Editor / Terminal), as a link.
    if (note) line.append(appendWithPageLinks(doc, h(doc, 'span', `ac-builtin-note${detected?.[bi.key] ? '' : ' muted'}`),
      detected?.[bi.key] || !BUILTIN_SETTING.has(bi.key) ? note : `${note} · set one in Settings › Runs › Actions`));
    builtinsCard.append(line);
  }

  const foot = h(doc, 'div', 'ac-foot');
  const save = btn(doc, 'ac-save', 'Save', true);
  save.addEventListener('click', () => onSave?.(readEditorForm(root), save));
  foot.append(save);

  root.append(setupCard, actionsCard, builtinsCard, foot);
  return root;
}

/** The config the project editor currently shows, in the stored shape (4.1). */
export function readEditorForm(root) {
  return {
    setup: orNull(val(root, '.ac-setup')),
    actions: [...root.querySelectorAll('.ac-action')].map(readAction),
    builtins: Object.fromEntries(BUILTINS.map((bi) => [bi.key, !!root.querySelector(`.ac-builtin-${bi.key}`)?.checked])),
  };
}

// ---- Workspace stack editor -----------------------------------------------------------------
function stepEnvRow(doc, row) {
  const r = h(doc, 'div', 'ac-step-env-row');
  const remove = btn(doc, 'ac-remove-step-env', 'Remove');
  remove.addEventListener('click', () => r.remove());
  r.append(input(doc, 'mono ac-step-env-name', row?.name, 'e.g. API_URL'), input(doc, 'mono ac-step-env-value', row?.value, 'e.g. http://localhost:{api.PORT}'), remove);
  return r;
}

function renumber(stackEl) {
  stackEl.querySelectorAll('.ac-step-num').forEach((n, i) => { n.textContent = `${i + 1}.`; });
}

function stepRow(doc, step, members, stackEl) {
  const r = h(doc, 'div', 'ac-step');
  const memberOpts = members.map((m) => [m.projectKey, `${m.name} (${m.alias})`]);
  const member = select(doc, 'ac-step-member', memberOpts, step?.member ?? members[0]?.projectKey ?? '');
  const action = h(doc, 'select', 'input ac-step-action');
  const fill = (keep) => {
    const m = members.find((x) => x.projectKey === member.value);
    action.replaceChildren(...(m?.actions || []).map((a) => { const o = h(doc, 'option', null, a.label || a.id); o.value = a.id; return o; }));
    if (keep != null && [...action.options].some((o) => o.value === keep)) action.value = keep;
  };
  fill(step?.action);
  member.addEventListener('change', () => fill(null));
  const envList = h(doc, 'div', 'ac-step-env-list');
  for (const e of step?.env || []) envList.append(stepEnvRow(doc, e));
  const addEnv = btn(doc, 'ac-add-step-env', 'Add variable');
  addEnv.addEventListener('click', () => envList.append(stepEnvRow(doc, null)));
  const remove = btn(doc, 'ac-remove-step', 'Remove');
  remove.addEventListener('click', () => { r.remove(); renumber(stackEl); });
  r.append(h(doc, 'span', 'ac-step-num'), field(doc, 'Member', member), field(doc, 'Action', action), remove, envList, addEnv);
  return r;
}

function stackRow(doc, s, members) {
  const el = h(doc, 'div', 'ac-stack');
  const head = h(doc, 'div', 'ac-stack-head');
  const remove = btn(doc, 'ac-remove-stack', 'Remove stack');
  remove.addEventListener('click', () => el.remove());
  head.append(
    field(doc, 'Id', input(doc, 'mono ac-stack-id', s?.id, 'e.g. dev')),
    field(doc, 'Label', input(doc, 'ac-stack-label', s?.label, 'e.g. Dev stack')),
    field(doc, 'Kind', select(doc, 'ac-stack-kind', KIND_OPTIONS, s?.kind === 'task' ? 'task' : 'service')),
    remove);
  const steps = h(doc, 'div', 'ac-step-list');
  for (const st of s?.steps || []) steps.append(stepRow(doc, st, members, el));
  const addStep = btn(doc, 'ac-add-step', 'Add step');
  addStep.addEventListener('click', () => { steps.append(stepRow(doc, null, members, el)); renumber(el); });
  el.append(head, steps, addStep);
  renumber(el);
  return el;
}

function memberLine(doc, m) {
  const line = h(doc, 'li', 'ac-member');
  line.append(h(doc, 'b', 'ref mono', m.name), ' ', h(doc, 'span', 'ac-member-alias mono', `{${m.alias}.PORT}`));
  const acts = (m.actions || []).map((a) => `${a.label || a.id} (${a.kind})`).join(', ');
  const span = h(doc, 'span', 'ac-member-actions muted', acts ? ` · ${acts}` : ' · no actions yet, ');
  if (!acts && m.projectKey) appendWithPageLinks(doc, span, 'add them on its Actions tab', [['its Actions tab', projectActionsHref(m.projectKey)]]);
  line.append(span);
  return line;
}

/**
 * The workspace's stack editor. `data` is GET /api/workspaces/:id/actions:
 * `{stacks, members:[{projectKey, name, alias, actions:[{id,label,kind}]}]}`. Steps run in
 * order; `{alias.NAME}` reaches a member's port variable. onSave gets (readStackForm(root), saveButton).
 */
export function renderStackEditor(data, { doc, onSave } = {}) {
  const root = h(doc, 'div', 'actions-config ac-stacks');
  const members = data?.members || [];

  const membersCard = card(doc, 'ac-members-card', 'Members', 'Use {alias.NAME} in a step variable to reach another member\'s port.');
  const ul = h(doc, 'ul', 'ac-member-list');
  for (const m of members) ul.append(memberLine(doc, m));
  membersCard.append(ul);

  const stacksCard = card(doc, 'ac-stacks-card', 'Stacks', 'Steps start in order and stop together.');
  const list = h(doc, 'div', 'ac-stack-list');
  for (const s of data?.stacks || []) list.append(stackRow(doc, s, members));
  const add = btn(doc, 'ac-add-stack', 'Add stack');
  add.addEventListener('click', () => list.append(stackRow(doc, null, members)));
  stacksCard.append(list, add);

  const foot = h(doc, 'div', 'ac-foot');
  const save = btn(doc, 'ac-save', 'Save', true);
  save.addEventListener('click', () => onSave?.(readStackForm(root), save));
  foot.append(save);

  root.append(membersCard, stacksCard, foot);
  return root;
}

/** The stacks the stack editor currently shows, in the stored shape (4.2). */
export function readStackForm(root) {
  return {
    stacks: [...root.querySelectorAll('.ac-stack')].map((el) => ({
      id: val(el, '.ac-stack-id').trim(),
      label: val(el, '.ac-stack-label').trim(),
      kind: val(el, '.ac-stack-kind') === 'task' ? 'task' : 'service',
      steps: [...el.querySelectorAll('.ac-step')].map((st) => ({
        member: val(st, '.ac-step-member'),
        action: val(st, '.ac-step-action'),
        env: [...st.querySelectorAll('.ac-step-env-row')].map((r) => ({ name: val(r, '.ac-step-env-name').trim(), value: val(r, '.ac-step-env-value') })),
      })),
    })),
  };
}

// ---- Server field errors --------------------------------------------------------------------
const ACTION_FIELD_CLASS = { id: 'ac-f-id', label: 'ac-f-label', kind: 'ac-f-kind', cmd: 'ac-f-cmd', cmdWin32: 'ac-f-cmdwin32',
  cwd: 'ac-f-cwd', openUrl: 'ac-f-openurl', ready: 'ac-ready-port', env: 'ac-env-name' };
const STACK_FIELD_CLASS = { id: 'ac-stack-id', label: 'ac-stack-label', kind: 'ac-stack-kind' };
const STEP_FIELD_CLASS = { member: 'ac-step-member', action: 'ac-step-action', env: 'ac-step-env-name' };

/**
 * The input an `ActionConfigError.field` names (src/core/actions/model.mjs), or null:
 * setup | actions[i](.key)(.env[j]) | stacks[i](.key) | stacks[i].steps[j](.member|.action|.env[k]).
 */
export function editorFieldEl(root, field) {
  if (!root || !field) return null;
  if (field === 'setup') return root.querySelector('.ac-setup');
  let m = /^actions\[(\d+)\](?:\.(\w+))?(?:\[(\d+)\])?/.exec(field);
  if (m) {
    const row = root.querySelectorAll('.ac-action')[Number(m[1])];
    if (!row) return null;
    if (m[2] === 'env' && m[3] != null) return row.querySelectorAll('.ac-env-row')[Number(m[3])]?.querySelector('.ac-env-name') || null;
    // `ready` is a port OR an "output contains" text, depending on the kind select.
    if (m[2] === 'ready') return row.querySelector(row.querySelector('.ac-ready-kind')?.value === 'output' ? '.ac-ready-text' : '.ac-ready-port');
    return row.querySelector(`.${ACTION_FIELD_CLASS[m[2]] || 'ac-f-id'}`);
  }
  m = /^stacks\[(\d+)\](?:\.(\w+))?(?:\[(\d+)\])?(?:\.(\w+))?(?:\[(\d+)\])?/.exec(field);
  if (m) {
    const stack = root.querySelectorAll('.ac-stack')[Number(m[1])];
    if (!stack) return null;
    if (m[2] === 'steps' && m[3] == null) return null;      // "a stack needs at least one step" → card alert
    if (m[2] === 'steps') {
      const step = stack.querySelectorAll('.ac-step')[Number(m[3])];
      if (!step) return null;
      if (m[4] === 'env' && m[5] != null) return step.querySelectorAll('.ac-step-env-row')[Number(m[5])]?.querySelector('.ac-step-env-name') || null;
      return step.querySelector(`.${STEP_FIELD_CLASS[m[4]] || 'ac-step-member'}`);
    }
    return stack.querySelector(`.${STACK_FIELD_CLASS[m[2]] || 'ac-stack-id'}`);
  }
  return null;
}
