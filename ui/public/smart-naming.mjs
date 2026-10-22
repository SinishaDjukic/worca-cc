// ui/public/smart-naming.mjs — Smart run naming on the New run form (flag smartRunNaming, docs/feature-flags.md).
// Owns the idle / loading / suggested / edited / failed states of #title and #featureBranch. app.js passes everything
// it touches, so the module runs under jsdom without app.js. A person's own text is never overwritten, and a
// suggestion never blocks Start or Schedule.
import { renderBranch } from '../../src/shared/naming/pattern.mjs';

const DEBOUNCE_MS = 1000;
const MIN_PROMPT = 12;
const TITLE_SUGGESTED_HINT = 'Suggested from the task. Type over it to keep your own; Worca then stops suggesting.';
const EDITED_HINT = 'Your name is kept. Press Suggest again to replace it.';
const LOADING_HINT = 'Suggesting with a small model. Start is never blocked by it.';
const FALLBACK_HINT = 'Could not suggest; using today\'s name. Worca adds the run id.';

/**
 * @param {object} deps
 * @param {Document} deps.doc
 * @param {object} deps.el  prompt, title, featureBranch, branchType, branchTypeWrap, titleRetry, titleClear, branchRetry, branchClear, sameAsSource?
 * @param {(key: string) => boolean} deps.flagOn
 * @param {(method: string, path: string, body?: object, signal?: AbortSignal) => Promise<object|null>} deps.api  parsed JSON, {aborted:true}, or null
 * @param {() => (string|undefined)} deps.getProjectDir
 * @param {(doc: Document, name: string, size?: number) => HTMLElement} deps.icon
 */
export function createSmartNaming({ doc, el, flagOn, api, getProjectDir, icon, timers = { setTimeout, clearTimeout } }) {
  const st = { title: 'idle', branch: 'idle' };   // idle | loading | suggested | edited | failed
  let last = null, lastPrompt = '', timer = null, ctl = null, cfg = null, cfgLoad = null, fallbackValue = null;
  const hintEl = (which) => doc.getElementById(which === 'title' ? 'titleHint' : 'featureBranchHint');
  const idleHint = { title: hintEl('title')?.textContent || '', branch: hintEl('branch')?.textContent || '' };
  const inputOf = (which) => (which === 'title' ? el.title : el.featureBranch);

  for (const [btn, name] of [[el.titleRetry, 'refresh'], [el.branchRetry, 'refresh'], [el.titleClear, 'x'], [el.branchClear, 'x']]) {
    if (btn && !btn.firstChild) btn.append(icon(doc, name, 14));
  }

  const chip = (which, on) => {
    const slot = doc.getElementById(`${which}SnChip`);
    if (!slot) return;
    slot.replaceChildren();
    if (!on) return;
    const c = doc.createElement('span');
    c.className = 'flag-chip sn-chip';
    c.textContent = 'Suggested';
    slot.append(c);
  };
  const hint = (which, text, warn = false) => {
    const h = hintEl(which);
    if (!h) return;
    h.textContent = text;
    h.classList.toggle('warn', warn);
  };

  function setState(which, s) {
    st[which] = s;
    const input = inputOf(which);
    input.closest('.sn-adorn')?.classList.toggle('sn-loading', s === 'loading');
    input.setAttribute('aria-busy', s === 'loading' ? 'true' : 'false');
    chip(which, s === 'suggested');
    if (which === 'branch' && el.branchTypeWrap) el.branchTypeWrap.hidden = s !== 'suggested';
    if (s === 'idle') hint(which, idleHint[which]);
    else if (s === 'loading') hint(which, LOADING_HINT);
  }

  function apply(r) {
    last = r;
    cfg = { ...(cfg || {}), pattern: r.pattern, addRunId: false };
    const titleFree = st.title === 'suggested' || (st.title !== 'edited' && !el.title.value.trim());
    const branchFree = st.branch === 'suggested' || (st.branch !== 'edited' && !el.featureBranch.value.trim());
    if (r.title && titleFree) {
      el.title.value = r.title;
      setState('title', 'suggested');
      hint('title', TITLE_SUGGESTED_HINT);
    }
    if (r.branch && branchFree) {
      el.branchType.replaceChildren(...r.types.map((t) => Object.assign(doc.createElement('option'), { value: t, textContent: t, selected: t === r.type })));
      el.featureBranch.value = r.branch;
      setState('branch', 'suggested');
      // The model's reason is the only model text reaching the DOM: textContent, never innerHTML.
      hint('branch', `Pattern ${r.pattern} · ${r.type}${r.reason ? ` because ${r.reason}` : ''}. Worca adds the run id. Pick another type to rename.`);
    }
    for (const w of ['title', 'branch']) if (st[w] === 'loading') setState(w, 'idle');
  }

  function fail(r) {
    for (const w of ['title', 'branch']) if (st[w] === 'loading') setState(w, 'failed');
    // D10: today's name fills the field with no chip; Start sends featureBranchFallback while it is untouched.
    if (r?.branchHint && st.branch === 'failed' && !el.featureBranch.value.trim()) {
      el.featureBranch.value = r.branchHint;
      fallbackValue = r.branchHint;
    }
    if (st.branch === 'failed') hint('branch', FALLBACK_HINT, true);
    if (st.title === 'failed') setState('title', 'idle');
  }

  function loadConfig() {
    cfgLoad ||= api('GET', `/api/naming/config${getProjectDir() ? `?projectDir=${encodeURIComponent(getProjectDir())}` : ''}`)
      .then((c) => { if (c && !c.aborted) cfg = { ...(cfg || {}), ...c }; return cfg; })
      .catch(() => cfg);
    return cfgLoad;
  }

  async function suggest(force = false) {
    if (!flagOn('smartRunNaming')) return;
    const prompt = el.prompt.value.trim();
    if (prompt.length < MIN_PROMPT || el.sameAsSource?.checked) return;
    if (!force && prompt === lastPrompt) return;
    const wantTitle = force || st.title !== 'edited';
    const wantBranch = force || st.branch !== 'edited';
    if (!wantTitle && !wantBranch) return;
    ctl?.abort();
    ctl = new AbortController();
    lastPrompt = prompt;
    if (wantTitle && !el.title.value.trim()) setState('title', 'loading');
    if (wantBranch && !el.featureBranch.value.trim()) setState('branch', 'loading');
    const r = await api('POST', '/api/naming/suggest', { prompt, title: el.title.value.trim() || undefined, projectDir: getProjectDir() }, ctl.signal);
    if (r?.aborted) return;
    if (!r || r.source !== 'model') return fail(r);
    apply(r);
  }

  async function onPromptInput() {
    if (!flagOn('smartRunNaming')) return;
    timers.clearTimeout(timer);
    const c = cfg || await loadConfig();
    if ((c?.trigger ?? 'debounce') === 'manual') return;
    timer = timers.setTimeout(() => suggest(false), DEBOUNCE_MS);
  }
  const edited = (which) => () => {
    if (!flagOn('smartRunNaming')) return;
    setState(which, 'edited');
    hint(which, EDITED_HINT);
  };

  el.prompt.addEventListener('input', onPromptInput);
  el.title.addEventListener('input', edited('title'));
  el.featureBranch.addEventListener('input', edited('branch'));
  el.titleRetry.addEventListener('click', () => { setState('title', 'idle'); el.title.value = ''; suggest(true); });
  el.branchRetry.addEventListener('click', () => { setState('branch', 'idle'); el.featureBranch.value = ''; fallbackValue = null; suggest(true); });
  el.titleClear.addEventListener('click', () => { el.title.value = ''; setState('title', 'edited'); hint('title', EDITED_HINT); });
  el.branchClear.addEventListener('click', () => { el.featureBranch.value = ''; fallbackValue = null; setState('branch', 'edited'); hint('branch', EDITED_HINT); });
  el.branchType.addEventListener('change', () => {
    if (st.branch !== 'suggested' || !last) return;
    el.featureBranch.value = renderBranch({ ...cfg, addRunId: false }, { type: el.branchType.value, slug: last.slug });
  });

  return {
    /** Form reset or prefill. A reset drops the suggestions it made; `keep` (a prefill) treats filled fields as typed. */
    reset({ keep = false } = {}) {
      ctl?.abort();
      timers.clearTimeout(timer);
      cfgLoad = null;
      for (const w of ['title', 'branch']) {
        const input = inputOf(w);
        const ours = st[w] === 'suggested' || st[w] === 'failed' || st[w] === 'loading';
        if (!keep && ours) input.value = '';
        setState(w, keep && input.value.trim() ? 'edited' : 'idle');
      }
      last = null; fallbackValue = null; lastPrompt = '';
    },
    /** The body fields for Start: the branch is marked suggested only while untouched. */
    bodyExtras() {
      if (!flagOn('smartRunNaming')) return {};
      if (st.branch === 'suggested') return { featureBranchSuggested: true };
      if (st.branch === 'failed' && fallbackValue && el.featureBranch.value === fallbackValue) return { featureBranchFallback: true };
      return {};
    },
    ownsBranchHint: () => ['loading', 'suggested', 'failed'].includes(st.branch),
    state: () => ({ ...st }),
    dispose() { ctl?.abort(); timers.clearTimeout(timer); el.prompt.removeEventListener('input', onPromptInput); },
  };
}
