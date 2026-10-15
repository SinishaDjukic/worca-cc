// ui/public/flags-view.mjs — Settings › Experimental (docs/feature-flags.md, D8): one row per
// registry flag that is not retiring, with its stage, switch, lock note and docs link; Reset all.
// Split out of app.js so a test can drive it against the real pane without booting the app.
// The host owns the endpoints: `api(method, body)` answers { ok, status, data } and never rejects
// (app.js#mcpApi bound to /api/flags); `confirm(opts)` resolves a boolean (app.js#confirmModal).
import { STAGE_LABEL, applyFlags } from './flags.mjs';
import { flagByKey } from '../../src/shared/flags/registry.mjs';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The rows' markup. `flags` is GET /api/flags' `flags`. */
export function flagRowsHtml(flags) {
  if (!flags.length) return '<p class="hint">No experimental features in this release.</p>';
  return flags.map((f) => {
    const lock = f.locked ? '<p class="flag-row-lock">Locked by WORCA_FLAGS</p>' : '';
    const docs = f.docsUrl ? `<a class="flag-row-docs" href="${esc(f.docsUrl)}" target="_blank" rel="noopener">How it works</a>` : '';
    return `<div class="flag-row" id="flag-row-${f.key}" data-flag-row="${f.key}">`
      + '<div class="flag-row-text">'
      + `<div class="flag-row-title">${esc(f.title)}<span class="badge flag-stage flag-stage-${f.stage}">${esc(STAGE_LABEL[f.stage] || f.stage)}</span></div>`
      + `<p class="flag-row-desc">${esc(f.description)}</p>${lock}${docs}</div>`
      + `<div class="switch${f.on ? ' on' : ''}${f.locked ? ' disabled' : ''}" role="switch" data-flag-switch="${f.key}"`
      + ` tabindex="${f.locked ? -1 : 0}" aria-checked="${f.on}" aria-disabled="${f.locked}" aria-label="${esc(f.title)}"></div>`
      + '</div>';
  }).join('');
}

/**
 * @param {{host:HTMLElement, msgEl?:HTMLElement, resetBtn?:HTMLButtonElement,
 *          api:(method:string, body?:object)=>Promise<{ok:boolean,status:number,data:any}>,
 *          confirm:(o:object)=>Promise<boolean>}} o
 * @returns {{load:(sub?:string)=>Promise<void>, toggle:(key:string)=>Promise<void>, resetAll:()=>Promise<void>}}
 */
export function createFlagsView({ host, msgEl = null, resetBtn = null, api, confirm }) {
  const doc = host.ownerDocument;
  let flags = [];
  const say = (text, tone = '') => { if (msgEl) { msgEl.textContent = text; msgEl.className = `form-msg${tone ? ` ${tone}` : ''}`; } };

  function paint({ focusKey = null, sub = '' } = {}) {
    // A `flags` frame repaints this tab too (app.js); keep the keyboard user's place across it.
    const active = doc.activeElement;
    if (!focusKey && active && host.contains(active) && active.dataset.flagSwitch) focusKey = active.dataset.flagSwitch;
    host.innerHTML = flagRowsHtml(flags);
    applyFlags(Object.fromEntries(flags.map((f) => [f.key, f.on])), doc);
    if (resetBtn) resetBtn.disabled = !flags.some((f) => !f.locked && f.source === 'settings');
    const target = focusKey || (flagByKey(sub) ? sub : null);
    if (!target) return;
    const row = host.querySelector(`#flag-row-${target}`);
    if (!row) return;
    if (sub) { row.classList.add('flag-row-target'); row.scrollIntoView?.({ block: 'center' }); }
    row.querySelector('[data-flag-switch]').focus();   // a repaint drops focus: put it back
  }

  async function load(sub = '') {
    const r = await api('GET');
    if (!r.ok) { say((r.data && r.data.error) || 'Could not load the experimental features.', 'err'); return; }
    flags = Array.isArray(r.data.flags) ? r.data.flags : [];
    say('');
    paint({ sub });
  }

  async function save(body, focusKey = null) {
    const r = await api('PATCH', body);
    if (!r.ok) { say((r.data && r.data.error) || 'Could not save.', 'err'); return; }
    flags = r.data.flags || [];
    say('');
    paint({ focusKey });
  }

  /** Every prerequisite of `key` that is off, transitively, in a stable order. */
  function missing(key, acc = []) {
    for (const r of (flags.find((x) => x.key === key) || {}).requires || []) {
      const f = flags.find((x) => x.key === r);
      if (f && !f.on && !acc.includes(f)) { acc.push(f); missing(r, acc); }
    }
    return acc;
  }

  async function toggle(key) {
    const f = flags.find((x) => x.key === key);
    if (!f || f.locked) return;
    const turnOn = !f.on;
    if (turnOn) {
      const need = missing(key);
      if (need.length && !(await confirm({
        title: `Turn on ${f.title}?`,
        message: `It needs ${need.map((x) => x.title).join(', ')}, which will be turned on too.`,
        confirmLabel: 'Turn on',
      }))) return;
    }
    await save({ [key]: turnOn }, key);
  }

  async function resetAll() {
    const keys = flags.filter((f) => !f.locked).map((f) => f.key);
    if (!keys.length) return;
    if (!(await confirm({
      title: 'Reset all experimental features?',
      message: 'Every feature goes back to its default. Features locked by WORCA_FLAGS stay as they are.',
      confirmLabel: 'Reset all',
    }))) return;
    await save(Object.fromEntries(keys.map((k) => [k, null])));
  }

  host.addEventListener('click', (e) => {
    const s = e.target.closest('[data-flag-switch]');
    if (s) void toggle(s.dataset.flagSwitch);
  });
  host.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    const s = e.target.closest('[data-flag-switch]');
    if (!s) return;
    e.preventDefault();
    void toggle(s.dataset.flagSwitch);
  });
  if (resetBtn) resetBtn.addEventListener('click', () => { void resetAll(); });
  return { load, toggle, resetAll };
}
