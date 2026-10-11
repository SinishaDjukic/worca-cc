// ui/public/spec-builder.mjs — the Spec Builder wizard (plans/spec-builder §3.3): What → Roles → Scope →
// Estimate → Generate. Pure DOM; the only I/O is injected (`api`), so jsdom tests drive it directly.
import { ROLES } from '../../src/shared/spec-builder/roles.mjs';
import { SPEC_KINDS, SPEC_SIZES, SPEC_LEVELS, SPEC_FLAG_STAGES, normalizeAnswers, frontMatterFromAnswers } from '../../src/shared/spec-builder/front-matter.mjs';

const STEPS = ['What', 'Roles', 'Scope', 'Estimate'];
function h(doc, tag, cls, text) { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

export const blankAnswers = () => ({ goal: '', kind: 'feature', roles: ['product'], size: 'medium', areas: [], flag: null, levels: '' });

const usd = (n) => `$${n < 10 ? n.toFixed(2) : Math.round(n)}`;
const mins = (ms) => `${Math.max(1, Math.round(ms / 60_000))} min`;
/** One line, shared with the Ask spec card. */
export function estimateSummary(e) {
  if (!e) return '';
  const basis = e.basis === 'rough' ? 'Rough estimate' : `Based on ${e.samples}+ past runs${e.basis === 'mixed' ? ' (some stages rough)' : ''}`;
  return `${usd(e.low)}–${usd(e.high)} · ${mins(e.ms)}–${mins(e.msHigh)} · ${basis}`;
}

/**
 * @param {{doc?:Document, api:{estimate:(fm)=>Promise<object>, areas:(q)=>Promise<string[]>},
 *          onGenerate:(answers)=>Promise<void>, onOpenAsk:()=>void}} deps
 * @returns {{el:HTMLElement, answers:()=>object, reset:()=>void}}
 */
export function createSpecBuilder({ doc = globalThis.document, api, onGenerate, onOpenAsk }) {
  let a = blankAnswers();
  let step = 0;
  let estimate = null;
  let phase = 'edit';                       // 'edit' | 'drafting'
  let estimateTicket = 0;
  let areasAskedFor = null;
  const root = h(doc, 'div', 'sb-pane');
  root.setAttribute('data-spec-builder-pane', '');

  const err = (box, msg) => { box.textContent = msg || ''; box.hidden = !msg; };

  function track() {
    const t = h(doc, 'div', 'wz-track');
    STEPS.forEach((name, i) => {
      const pill = h(doc, 'span', `wz-step-pill${i === step ? ' on' : ''}${i < step ? ' done' : ''}`);
      pill.append(h(doc, 'span', 'wz-step-n', String(i + 1)), doc.createTextNode(` ${name}`));
      t.appendChild(pill);
    });
    return t;
  }

  function whatStep(errBox) {
    const wrap = h(doc, 'div', 'sb-step');
    const goal = h(doc, 'input', 'input');
    Object.assign(goal, { type: 'text', value: a.goal, maxLength: 300, placeholder: 'One line: what should this change do?' });
    goal.setAttribute('data-sb-goal', '');
    goal.setAttribute('aria-label', 'Goal');
    goal.addEventListener('input', () => { a.goal = goal.value; err(errBox, ''); });
    const kinds = h(doc, 'div', 'seg seg-sm');
    for (const k of SPEC_KINDS) {
      const b = h(doc, 'button', a.kind === k ? 'on' : '', k);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(a.kind === k));
      b.addEventListener('click', () => { a.kind = k; render(); });
      kinds.appendChild(b);
    }
    wrap.append(h(doc, 'label', 'sb-label', 'Goal'), goal, h(doc, 'label', 'sb-label', 'Kind'), kinds);
    return wrap;
  }

  function rolesStep() {
    const grid = h(doc, 'div', 'sb-roles');
    for (const r of ROLES) {
      const on = a.roles.includes(r.key);
      const tile = h(doc, 'button', `rt sb-role${on ? ' sel' : ''}`);
      tile.type = 'button';
      tile.setAttribute('data-sb-role', r.key);
      tile.setAttribute('aria-pressed', String(on));
      if (r.locked) { tile.disabled = true; tile.title = 'Product is always on'; }
      tile.append(h(doc, 'span', 'sb-role-icon', r.icon), h(doc, 'strong', '', r.label), h(doc, 'small', 'hint', r.help));
      tile.addEventListener('click', () => {
        if (r.locked) return;
        a.roles = on ? a.roles.filter((k) => k !== r.key) : [...a.roles, r.key];
        render();
      });
      grid.appendChild(tile);
    }
    return grid;
  }

  function scopeStep() {
    const wrap = h(doc, 'div', 'sb-step');
    const goalNow = a.goal;
    const sizes = h(doc, 'div', 'seg seg-sm');
    for (const s of SPEC_SIZES) {
      const b = h(doc, 'button', a.size === s ? 'on' : '', s);
      b.type = 'button';
      b.setAttribute('data-sb-size', s);
      b.setAttribute('aria-pressed', String(a.size === s));
      b.addEventListener('click', () => { a.size = s; render(); });
      sizes.appendChild(b);
    }
    const areas = h(doc, 'textarea', 'textarea');
    areas.rows = 4;
    areas.value = a.areas.join('\n');
    areas.setAttribute('data-sb-areas', '');
    areas.setAttribute('aria-label', 'Areas (one path per line)');
    areas.addEventListener('input', () => { a.areas = areas.value.split('\n').map((s) => s.trim()).filter(Boolean); });
    // Suggest once per goal: re-renders (size clicks) and an empty answer must not refetch on every render.
    if (!a.areas.length && goalNow && areasAskedFor !== goalNow) {
      areasAskedFor = goalNow;
      api.areas(goalNow).then((list) => {
        if (!a.areas.length && list.length && a.goal === goalNow) { a.areas = list; if (areas.isConnected) areas.value = list.join('\n'); }
      }, () => {});
    }
    const flagKey = h(doc, 'input', 'input');
    Object.assign(flagKey, { type: 'text', value: a.flag?.key || '', placeholder: 'Feature flag key (optional, camelCase)' });
    const flagStage = h(doc, 'select', 'select');
    for (const s of SPEC_FLAG_STAGES) flagStage.appendChild(Object.assign(h(doc, 'option', '', s), { value: s }));
    flagStage.value = a.flag?.stage || 'beta';
    const syncFlag = () => { a.flag = flagKey.value.trim() ? { key: flagKey.value.trim(), stage: flagStage.value } : null; };
    flagKey.addEventListener('input', syncFlag);
    flagStage.addEventListener('change', syncFlag);
    const levels = h(doc, 'select', 'select');
    levels.appendChild(Object.assign(h(doc, 'option', '', 'Levels: not set'), { value: '' }));
    for (const l of SPEC_LEVELS) levels.appendChild(Object.assign(h(doc, 'option', '', l), { value: l }));
    levels.value = a.levels;
    levels.addEventListener('change', () => { a.levels = levels.value; });
    wrap.append(h(doc, 'label', 'sb-label', 'Size'), sizes, h(doc, 'label', 'sb-label', 'Areas'), areas,
      h(doc, 'label', 'sb-label', 'Feature flag'), flagKey, flagStage, h(doc, 'label', 'sb-label', 'Levels'), levels);
    return wrap;
  }

  function estimateStep(errBox) {
    const wrap = h(doc, 'div', 'sb-estimate');
    wrap.setAttribute('data-sb-estimate', '');
    if (!estimate) {
      wrap.appendChild(h(doc, 'small', 'hint', 'Estimating…'));
      // A token per request: going Back and returning re-estimates, and a slower older answer must not win.
      const ticket = ++estimateTicket;
      api.estimate(frontMatterFromAnswers(normalizeAnswers(a))).then(
        (e) => { if (ticket === estimateTicket && step === STEPS.length - 1) { estimate = e; render(); } },
        (e) => { if (ticket === estimateTicket && errBox.isConnected) err(errBox, e.message || 'Could not estimate'); });
      return wrap;
    }
    const tiles = h(doc, 'div', 'sb-stages');
    for (const s of estimate.stages) {
      const t = h(doc, 'div', 'sb-stage');
      t.setAttribute('data-sb-stage', s.phase);
      t.append(h(doc, 'strong', '', s.phase), h(doc, 'small', 'hint', s.model || 'Run default'),
        h(doc, 'span', '', `${usd(s.low)}–${usd(s.high)}`), h(doc, 'small', 'hint', s.basis === 'rough' ? 'rough' : `${s.n} samples`));
      tiles.appendChild(t);
    }
    const sum = h(doc, 'p', 'sb-summary', estimateSummary(estimate));
    sum.setAttribute('data-sb-summary', '');
    wrap.append(tiles, sum);
    return wrap;
  }

  function render() {
    root.replaceChildren();
    if (phase === 'drafting') {
      const p = h(doc, 'p', 'sb-drafting', 'Drafting in Ask Worca… ');
      const link = h(doc, 'button', 'btn-ghost', 'Open the thread');
      link.type = 'button';
      link.addEventListener('click', () => onOpenAsk());
      const again = h(doc, 'button', 'btn-ghost', 'Back to the wizard');
      again.type = 'button';
      again.addEventListener('click', () => { phase = 'edit'; render(); });
      p.append(link, again);
      root.appendChild(p);
      return;
    }
    const errBox = h(doc, 'div', 'field-error');
    errBox.setAttribute('data-sb-error', '');
    errBox.setAttribute('role', 'alert');
    errBox.hidden = true;
    const body = [whatStep, rolesStep, scopeStep, estimateStep][step](errBox);
    const nav = h(doc, 'div', 'sb-nav');
    const back = h(doc, 'button', 'btn-ghost', 'Back');
    back.type = 'button';
    back.disabled = step === 0;
    back.addEventListener('click', () => { step -= 1; render(); });
    const reset = h(doc, 'button', 'btn-ghost', 'Start over');
    reset.type = 'button';
    reset.addEventListener('click', () => resetAll());
    const next = h(doc, 'button', 'btn-primary', step === STEPS.length - 1 ? 'Generate spec' : 'Next');
    next.type = 'button';
    next.setAttribute(step === STEPS.length - 1 ? 'data-sb-generate' : 'data-sb-next', '');
    next.addEventListener('click', async () => {
      if (step === 0 && !a.goal.trim()) { err(errBox, 'Describe the goal in one line.'); return; }
      if (step < STEPS.length - 1) {
        if (step + 1 === STEPS.length - 1) estimate = null;   // re-estimate on every arrival: roles/size may have changed
        step += 1;
        render();
        return;
      }
      next.disabled = true;
      try { await onGenerate(normalizeAnswers(a)); phase = 'drafting'; render(); }
      catch (e) { next.disabled = false; err(errBox, e.message || 'Could not start the Ask thread'); }
    });
    nav.append(back, reset, next);
    root.append(track(), body, errBox, nav);
  }

  function resetAll() { a = blankAnswers(); step = 0; estimate = null; estimateTicket += 1; areasAskedFor = null; phase = 'edit'; render(); }

  render();
  return { el: root, answers: () => normalizeAnswers(a), reset: resetAll };
}
