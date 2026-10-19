// ui/public/run-presets-view.mjs — Settings › Presets (docs/run-presets.md): one card per run preset with Use,
// Rename, Duplicate, Edit scope and Delete. app.js owns the fetches; this module only renders and calls back.
// Every name goes through textContent (a preset name is user input).
import { ago } from './branch-sync.mjs';

export const PRESETS_EMPTY_TEXT = 'No presets yet. Set up a run in New run, then use Save current setup…';

function h(doc, tag, cls, text) {
  const el = doc.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** "Any project", "Only api" or "Only workspace Platform"; `names` maps "project:key" / "workspace:id" to a label. */
export function presetScopeLabel(scope, names = {}) {
  if (!scope || scope.kind === 'global') return 'Any project';
  const label = names[`${scope.kind}:${scope.ref}`] || scope.ref;
  return scope.kind === 'workspace' ? `Only workspace ${label}` : `Only ${label}`;
}

/**
 * The list element: the empty state, or one card per preset. A pinned preset whose target is not in `names`
 * is gone (the badge "Project gone" / "Workspace gone"). `names` also maps "workflow:id" to a workflow's name.
 */
export function renderPresetsList(doc, presets, { names = {}, now = Date.now(), onUse, onRename, onDuplicate, onEditScope, onDelete } = {}) {
  const list = h(doc, 'div', 'presets-list');
  if (!presets.length) {
    list.append(h(doc, 'div', 'hist-empty', PRESETS_EMPTY_TEXT));
    return list;
  }
  for (const p of presets) {
    const card = h(doc, 'div', 'card preset-card');
    card.dataset.preset = p.id;
    const head = h(doc, 'div', 'pl-head');
    head.append(h(doc, 'b', 'preset-name', p.name), h(doc, 'span', 'badge', presetScopeLabel(p.scope, names)));
    if (p.scope && p.scope.kind !== 'global' && !names[`${p.scope.kind}:${p.scope.ref}`]) {
      head.append(h(doc, 'span', 'badge amber preset-gone', p.scope.kind === 'workspace' ? 'Workspace gone' : 'Project gone'));
    }
    card.append(head);
    const wf = (p.setup && p.setup.workflowId) || 'wf_default';
    const engine = (p.setup && p.setup.engine) || 'claude';
    card.append(h(doc, 'small', 'hint', `${names[`workflow:${wf}`] || wf} · ${engine} · Updated ${ago(p.updatedAt, now)}`));
    const acts = h(doc, 'div', 'pl-actions');
    for (const [label, act, fn] of [['Use', 'use', onUse], ['Rename', 'rename', onRename], ['Duplicate', 'duplicate', onDuplicate],
      ['Edit scope', 'scope', onEditScope], ['Delete', 'delete', onDelete]]) {
      const b = h(doc, 'button', act === 'use' ? 'btn btn-primary btn-sm' : 'btn btn-sm', label);
      b.type = 'button';
      b.dataset.act = act;
      b.addEventListener('click', () => fn && fn(p));
      acts.append(b);
    }
    card.append(acts);
    list.append(card);
  }
  return list;
}
