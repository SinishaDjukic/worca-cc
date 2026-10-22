// ui/public/shape/release-row.mjs — Shaper s4: "Add a release" → "Release v1.12.0 · draft after merge · Edit".
// One component for the Ship card (chat, group page, Plans) and the single-run Ship it dialog.
import { isReleaseVersion } from '../../../src/shared/release-version.mjs';
import { icon } from '../icons.mjs';

const SOURCE = (h) => (h && h.from === 'tag' ? `Last tag ${h.lastTag} + minor`
  : h && h.from === 'package' ? `From package.json ${h.packageVersion}`
    : 'No tag or package.json version: type one');

/** → { el, setHint(hint), check() → { ok:true, value:{version}|null } | { ok:false } } */
export function renderReleaseRow(doc, hint = null) {
  const h = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const el = h('div', 'release-row');
  el.setAttribute('data-release-row', '');
  let cur = hint; let open = false; let editing = false; let version = null;
  const err = h('div', 'release-row-err'); err.setAttribute('aria-live', 'polite');
  const input = h('input', 'release-row-input'); input.type = 'text'; input.placeholder = 'v1.0.0';
  input.setAttribute('aria-label', 'Release version');
  const commit = () => {
    const v = input.value.trim();
    if (!isReleaseVersion(v)) { err.textContent = 'Use a version like v1.12.0'; return false; }
    version = v; editing = false; err.textContent = ''; paint(); return true;
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
  input.addEventListener('blur', () => { if (editing && input.value.trim()) commit(); });
  function paint() {
    el.replaceChildren();
    if (!open) {
      const add = h('button', 'btn btn-sm btn-quiet release-row-add'); add.type = 'button';
      add.append(icon(doc, 'plus', 12), 'Add a release');
      add.addEventListener('click', () => { open = true; version = cur && cur.version ? cur.version : null; editing = !version; paint(); if (editing) input.focus(); });
      el.appendChild(add);
      return;
    }
    const line = h('div', 'release-row-line');
    if (editing) {
      input.value = version || '';
      line.append(h('span', null, 'Release '), input, h('span', null, ' · draft after merge'));
    } else {
      const edit = h('button', 'release-row-edit', 'Edit'); edit.type = 'button';
      edit.addEventListener('click', () => { editing = true; paint(); input.focus(); });
      line.append(h('span', 'release-row-text', `Release ${version} · draft after merge · `), edit);
    }
    el.append(line, h('div', 'release-row-source', SOURCE(cur)), err);
  }
  paint();
  return {
    el,
    /** The hint arrives after the dialog opened (GET /api/pr/remotes): only an untouched row takes it. */
    setHint(next) { if (!open) { cur = next || null; } },
    check() {
      if (!open) return { ok: true, value: null };
      if (editing && !commit()) return { ok: false };
      if (version) return { ok: true, value: { version } };
      err.textContent = 'Use a version like v1.12.0';
      return { ok: false };
    },
  };
}
