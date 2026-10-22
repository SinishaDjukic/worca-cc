// ui/public/chat/home-presets.mjs — the Chat home's "Start from a preset" chips (docs/run-presets.md): the
// viewer's presets pinned to New run's current target, then Any project ones, at most HOME_PRESETS_MAX; a click
// opens New run with the preset applied (the app's usePreset, Settings › Presets' Use path).
import { presetSetupSummary } from '../run-presets-names.mjs';

export const HOME_PRESETS_MAX = 6;

/** { shown, more }: this target's pinned presets first, then the global ones, in the server's (name) order. */
export function homePresets(presets, target, max = HOME_PRESETS_MAX) {
  const list = Array.isArray(presets) ? presets.filter((p) => p && p.id && p.scope) : [];
  const pinned = target ? list.filter((p) => p.scope.kind === target.kind && p.scope.ref === target.ref) : [];
  const all = [...pinned, ...list.filter((p) => p.scope.kind === 'global')];
  return { shown: all.slice(0, max), more: Math.max(0, all.length - max) };
}

export function createHomePresets({ doc, onUse, onMore }) {
  const h = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const el = h('section', 'chat-home-presets');
  el.hidden = true;
  const hd = h('h2', 'section-title chat-home-presets-h', 'Start from a preset');
  hd.id = 'chat-home-presets-h';
  el.setAttribute('aria-labelledby', hd.id);
  const row = h('div', 'chat-home-preset-row');
  row.setAttribute('role', 'group');
  el.append(hd, row);
  function render({ on, presets, target, workflowNames = null }) {
    const { shown, more } = on ? homePresets(presets, target) : { shown: [], more: 0 };
    row.replaceChildren();
    el.hidden = shown.length === 0;
    for (const p of shown) {
      const b = h('button', 'chat-home-preset', p.name);
      b.type = 'button';
      b.dataset.preset = p.id;
      const scope = p.scope.kind === 'global' ? 'Any project' : p.scope.kind === 'workspace' ? 'Only this workspace' : 'Only this project';
      b.title = `${scope} · ${presetSetupSummary(p.setup, workflowNames).text}`;
      b.addEventListener('click', () => onUse(p.id));
      row.append(b);
    }
    if (more) {
      const m = h('button', 'chat-home-preset-more', `${more} more…`);
      m.type = 'button';
      m.addEventListener('click', () => onMore());
      row.append(m);
    }
  }
  return { el, render };
}
