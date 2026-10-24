// tools/button-audit.mjs (new) — the one-button-style audit (runs-redesign spec §1.2, §5.2; known bug 4).
// auditButtons, auditSurface, auditSizes and auditType are serialised into the page by the CDP proofs as
// `(${auditButtons})(…)`, so their bodies must not reference anything outside their own parameters.

export const BUTTON_SPEC = Object.freeze({
  sizes: ['btn-sm', 'btn-lg'],                          // none = medium
  variants: ['btn-primary', 'btn-quiet', 'btn-danger'], // none = secondary
  heights: { 'btn-sm': 28, '': 32, 'btn-lg': 40 },
  fontSizes: { 'btn-sm': '12px', '': '13px', 'btn-lg': '13px' },
  corners: ['6px', '0px'],                              // 0 for the joined halves of a split button
  // One control size on the run page bar: its made .btn-sm actions (syncActions, shared with the chat run card) are
  // medium there (style.css `:is(.rd-bar,.hd-bar) .rd-bar-end > …`).
  mediumIn: ['.rd-bar-end'],
  // D10: controls, not §1.2 buttons. They still obey the radius tokens (test/ui-design-language.test.mjs).
  controls: ['.nav button', '.seg button', '.tab', '[role="tab"]', '[role="menuitem"]', '[role="menuitemradio"]',
    '[role="menuitemcheckbox"]', '[role="option"]', '[role="radio"]', '[role="switch"]', '.switch', '.link-btn',
    '.info-tip', '.act-tile', '.ob-door', '.seg-btn', '.btn-split-menu button', '.rd-tab', '.hd-tab', '.pd-tab', '.tp-tab', '.md-tab', '.af-tab',
    '.wfl-tab', '.chat-home-tab', '.hd-cmt-tab', 'button.rd-srow', 'button.tl-tile', 'button.af-gal-card',
    'button.pd-ov-card', 'button.wd-member', 'button.ask-activity-head', 'button.act-srow-name', 'button.runs-sec-head',
    'button.gp-row', 'button.rd-fact-act', 'button.agent-row-head', 'button.hd-tree-file', 'button.hd-tree-dir', 'button.ask-filescard-thumb', 'button.ask-filescard-name', 'button.chat-home-act',
    'button.chat-home-wf', 'button.chat-home-chat', 'button.chat-home-plan-open', 'button.release-row-edit',
    '.row-btn', 'button.mcp-setrow', 'button.xtoggle', 'button.gs-tile', 'button.mk-tile', 'button.mk-facet', 'button.mk-name',
    '.mk-upd > button.mk-disc',
    '.mv-cp-terms-pill', '.cost-bd-btn', '.linkish', '.hd-dl-more-btn', '.plan-fold', '.plan-persp-edit', '.qopt', '.afb-main',
    '.afb-folder', '.acct', '.sn-btn', '[class*="chip"]'],
  // .btn labels that still type "+" instead of icon(doc, 'plus'), exactly as shown; slice 3 emptied this
  // (docs/design-system.md › Button). The static twin is DEBT.typedPlus in test/fixtures/design-debt.json.
  plusDebt: [],
});

/**
 * Every visible action button under `root` that breaks the one component, as
 * [{ sig, rule, got, text }]. `env` (tests only) supplies { style(el), rect(el), coarse }; in the page it is null and
 * the real getComputedStyle / getBoundingClientRect are used.
 */
export function auditButtons(root, spec, env) {
  const win = root.ownerDocument.defaultView;
  const style = (env && env.style) || ((el) => win.getComputedStyle(el));
  const rect = (env && env.rect) || ((el) => el.getBoundingClientRect());
  const coarse = !!(env && env.coarse);
  const sig = (el) => el.tagName.toLowerCase() + [...el.classList].sort().map((c) => `.${c}`).join('');
  const visible = (el) => { const r = rect(el); return r.width > 0 && r.height > 0; };
  const controls = spec.controls.join(',');
  const out = [];
  for (const el of root.querySelectorAll('button, input[type="button"], input[type="submit"], a.btn, [role="button"].btn')) {
    if (!visible(el) || el.closest(controls)) continue;
    const label = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40);
    const bad = (rule, got) => out.push({ sig: sig(el), rule, got: String(got), text: label });
    const cl = el.classList;
    if (!cl.contains('btn')) { bad('not-the-component', [...cl].join(' ') || '(no class)'); continue; }
    const sizes = spec.sizes.filter((c) => cl.contains(c));
    const variants = spec.variants.filter((c) => cl.contains(c));
    if (sizes.length > 1) bad('two-sizes', sizes.join(' '));
    if (variants.length > 1) bad('two-variants', variants.join(' '));
    const size = el.closest(spec.mediumIn.join(',')) ? '' : (sizes[0] || '');
    const cs = style(el);
    const h = Math.round(rect(el).height);
    if (coarse ? h < 40 : h !== spec.heights[size]) bad('height', `${h}px`);
    for (const k of ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius']) {
      if (!spec.corners.includes(cs[k])) bad('corner', `${k} ${cs[k]}`);
    }
    if (cs.backgroundImage && cs.backgroundImage !== 'none') bad('gradient', cs.backgroundImage);
    if (cs.boxShadow && cs.boxShadow !== 'none') bad('shadow-at-rest', cs.boxShadow);
    if (cs.fontSize !== spec.fontSizes[size]) bad('font-size', cs.fontSize);
    const weight = variants[0] === 'btn-primary' ? '600' : '500';
    if (String(cs.fontWeight) !== weight) bad('font-weight', cs.fontWeight);
    // A14: at most 3 words of visible text (the aria-label may be longer); decided exceptions: "Approve with N open
    // issue(s)", the Add marketplace result's "Browse these N plugins" and "N notes from the manifest" (marketplace P7).
    const shown = (el.textContent || '').replace(/[…]/g, '').trim();
    const words = shown.split(/\s+/).filter((w) => /\w/.test(w));
    if (words.length > 3 && !/^(?:Approve with \d+ open issues?|Browse these \d+ plugins|\d+ notes? from the manifest)$/.test(shown)) bad('long-label', shown.slice(0, 40));
    if (/^\+ ?[A-Z][a-z]/.test(shown) && !spec.plusDebt.includes(shown)) bad('typed-plus', shown.slice(0, 40));
  }
  // One primary per group of actions (spec §1.3). A .btn-split (main half + caret) is one action (D11).
  const isPrimary = (c) => visible(c) && (c.classList.contains('btn-primary')
    || (c.classList.contains('btn-split') && !!c.querySelector(':scope > .btn-primary')));
  const groups = new Set();
  for (const el of root.querySelectorAll('.btn.btn-primary')) {
    if (!visible(el) || !el.parentElement) continue;
    const p = el.parentElement.classList.contains('btn-split') ? el.parentElement.parentElement : el.parentElement;
    if (p) groups.add(p);
  }
  for (const p of groups) {
    const n = [...p.children].filter(isPrimary).length;
    if (n > 1) out.push({ sig: sig(p), rule: 'two-primaries', got: String(n), text: '' });
  }
  return out;
}

export const SURFACE_SPEC = Object.freeze({
  heights: [28, 32, 40],
  infoMin: 28,
  controls: ['.tab', '.seg', '.wfl-folder', '.chat-home-preset', '.filter-chip'],
  tiles: { sel: '.chat-home-act:not(.btn)', min: 56, max: 64 },   // a tile wearing .btn.btn-lg is a 40px control, checked with the heights
  cards: ['.ask-card', '.chat-rc', '.shape-feature', '.rd-sheet', '.card'],
  fields: '.file, .ta-hl-back',   // input-like boxes (the file drop zone, a textarea's highlight backdrop) keep their borders
  floating: '[role="menu"], [role="dialog"], [role="listbox"], [role="tooltip"], .confirm-modal, .info-bubble, .tsearch-list',
  bars: ['.runs-row-prog > i', '.run-prog-fill', '.run-prog > i'],
  blue: ['rgb(91, 166, 204)'],
});

/** Size scale, shadows, tabs, nesting, bars and flag chips (UI/UX review 2026-10-19 A–C) under `root`. */
export function auditSurface(root, spec, env) {
  const win = root.ownerDocument.defaultView;
  const style = (env && env.style) || ((el) => win.getComputedStyle(el));
  const rect = (env && env.rect) || ((el) => el.getBoundingClientRect());
  const out = [];
  const sig = (el) => el.tagName.toLowerCase() + [...el.classList].sort().map((c) => `.${c}`).join('');
  const visible = (el) => { const r = rect(el); return r.width > 0 && r.height > 0; };
  const bad = (el, rule, got) => out.push({ sig: sig(el), rule, got: String(got), text: (el.textContent || '').trim().slice(0, 40) });
  const bordered = (cs) => ['Top', 'Right', 'Bottom', 'Left'].filter((s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== 'none').length >= 3;
  const h = (el) => Math.round(rect(el).height);
  for (const el of root.querySelectorAll(spec.controls.join(','))) {
    if (visible(el) && !spec.heights.includes(h(el))) bad(el, 'control-height', `${h(el)}px`);
  }
  for (const el of root.querySelectorAll(spec.tiles.sel)) {
    if (visible(el) && (h(el) < spec.tiles.min || h(el) > spec.tiles.max)) bad(el, 'control-height', `${h(el)}px`);
  }
  // QA 1: a badge never truncates (its text wider than its box).
  const size = (env && env.size) || ((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  for (const el of root.querySelectorAll('[class*="badge"]')) {
    if (!visible(el) || el.classList.contains('auto-badge')) continue;
    const s = size(el);
    if (s.client > 0 && s.scroll > s.client + 1) bad(el, 'badge-truncated', `${s.scroll}px in ${s.client}px`);
  }
  for (const el of root.querySelectorAll('.info-tip')) if (visible(el) && h(el) < spec.infoMin) bad(el, 'control-height', `${h(el)}px`);
  for (const el of root.querySelectorAll('*')) {
    if (!visible(el) || el.closest(spec.floating)) continue;
    const cs = style(el);
    const pos = cs.position;
    if (pos === 'fixed' || pos === 'absolute' || pos === 'sticky') continue;   // floats over content
    if (cs.boxShadow && cs.boxShadow !== 'none' && !/inset/.test(cs.boxShadow)
      && !/\b0px 0px 0px [\d.]+px\b/.test(cs.boxShadow)) bad(el, 'shadow-at-rest', cs.boxShadow);
  }
  for (const el of root.querySelectorAll('[role="tab"], .tab')) {
    if (!visible(el)) continue;
    const cs = style(el);
    if (bordered(cs) || (cs.backgroundColor && !/^(?:transparent|rgba\(0, 0, 0, 0\))$/.test(cs.backgroundColor))) bad(el, 'boxed-tab', cs.backgroundColor);
  }
  for (const card of root.querySelectorAll(spec.cards.join(','))) {
    if (!visible(card) || !bordered(style(card))) continue;
    for (const el of card.querySelectorAll('div, section, article, li, fieldset')) {
      if (visible(el) && !el.matches(spec.fields) && bordered(style(el))) bad(el, 'nested-border', sig(card));
    }
  }
  for (const el of root.querySelectorAll(spec.bars.join(','))) {
    if (visible(el) && spec.blue.includes(style(el).backgroundColor)) bad(el, 'blue-bar', style(el).backgroundColor);
  }
  for (const c of root.querySelectorAll('.flag-chip')) {
    const p = c.parentElement;
    if (p && p.matches('[role="tablist"], .tabs, .seg')) bad(c, 'chip-outside-label', p.className);
  }
  return out;
}

/** Field, segmented and chip sizes (docs/design-system.md › Field, Segmented control, Chips). `spec.debt` holds the
 *  field selectors test/fixtures/design-debt.json still allows their own size; a field they match is skipped. */
export const SIZE_SPEC = Object.freeze({
  // .tag-dim-key-small is the borderless key line under a cost tag's name (an editable caption, not a boxed field).
  fields: 'input[type="text"]:not(.tag-dim-key-small),input[type="number"],select,.input:not(.tag-dim-key-small),.select',
  fieldHeights: [28, 32],
  fieldCorner: '6px',
  seg: '.seg button',
  segHeight: 28,
  chips: '.badge,.flag-chip,.issue-sev,.artifact-kind,.tp-kind,.sk-kind,.team-chip .kind,.hd-ov-file-kind,.ask-mcard-kind,.wf-log-live,.kind-chip',
  chipHeight: 18,
  debt: [],
});

export function auditSizes(root, spec, env) {
  const win = root.ownerDocument.defaultView;
  const style = (env && env.style) || ((el) => win.getComputedStyle(el));
  const rect = (env && env.rect) || ((el) => el.getBoundingClientRect());
  const sig = (el) => el.tagName.toLowerCase() + [...el.classList].sort().map((c) => `.${c}`).join('');
  const visible = (el) => { const r = rect(el); return r.width > 0 && r.height > 0; };
  const h = (el) => Math.round(rect(el).height);
  const out = [];
  const bad = (el, rule, got) => out.push({ sig: sig(el), rule, got: String(got), text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40) });
  const excused = (el) => spec.debt.some((s) => { try { return el.matches(s); } catch { return false; } });
  for (const el of root.querySelectorAll(spec.fields)) {
    if (!visible(el) || excused(el)) continue;
    if (!spec.fieldHeights.includes(h(el))) bad(el, 'field-height', `${h(el)}px`);
    if (style(el).borderTopLeftRadius !== spec.fieldCorner) bad(el, 'field-corner', style(el).borderTopLeftRadius);
  }
  for (const el of root.querySelectorAll(spec.seg)) if (visible(el) && h(el) !== spec.segHeight) bad(el, 'seg-height', `${h(el)}px`);
  const over = (env && env.over) || ((el) => el.scrollWidth > el.clientWidth);
  for (const el of root.querySelectorAll(spec.chips)) {
    if (!visible(el)) continue;
    if (h(el) !== spec.chipHeight) bad(el, 'chip-height', `${h(el)}px`);
    // 18px with zero vertical padding must not clip the label sideways either (R-ux-2: "none truncates").
    if (over(el)) bad(el, 'chip-truncated', `${el.scrollWidth}>${el.clientWidth}`);
  }
  return out;
}

/** Type scale (docs/design-system.md › Type): every visible element with its own text renders at a step. The graph
 *  canvases, SVG and the terminal are skipped (D23). One entry per element signature. */
export const TYPE_SPEC = Object.freeze({
  sizes: [11, 12, 13, 15, 18, 22, 26, 32],               // 32 = --fs-hero, the Chat home hero only
  skip: 'svg, .run-flow, .gv-world, .xterm',
});

export function auditType(root, spec, env) {
  const win = root.ownerDocument.defaultView;
  const style = (env && env.style) || ((el) => win.getComputedStyle(el));
  const rect = (env && env.rect) || ((el) => el.getBoundingClientRect());
  const out = [];
  const seen = new Set();
  for (const el of root.querySelectorAll('*')) {
    if (el.closest(spec.skip)) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const r = rect(el);
    if (!(r.width > 0 && r.height > 0)) continue;
    const px = parseFloat(style(el).fontSize);
    // Not rounded: Math.round(12.5) is 13 and would hide a half size. 0.1 lets `.92em` code (11.96px) pass.
    if (spec.sizes.some((s) => Math.abs(s - px) < 0.1)) continue;
    const sig = el.tagName.toLowerCase() + [...el.classList].sort().map((c) => `.${c}`).join('');
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ sig, rule: 'type-scale', got: `${px}px`, text: el.textContent.trim().slice(0, 40) });
  }
  return out;
}

// Slice 3 (D13): stray clickables. Every visible button under `root` is .btn or one of the shared controls, or one of
// the rows and tiles a person opens (docs/design-system.md › Cards versus divided rows). Nothing screen-specific.
export const STRAY_SPEC = Object.freeze({
  allow: ['.tab', '[role="tab"]', '.seg button', '.seg-btn', '.filter-chip', '.switch', '[role="switch"]', '[role^="menuitem"]',
    '[role="option"]', '[role="radio"]', '.info-tip', '.row-btn', 'div.wfl-main', 'button.mcp-setrow', 'button.gs-tile',
    'button.ob-door', 'button.wfc-chip-btn', 'button.mk-tile', 'button.mk-facet', 'button.mk-name', '.mk-upd > button.mk-disc',
    'button.rd-fact-act'],
  skip: '#wfv-canvas',
});
export function auditStray(root, spec, env) {
  const rect = (env && env.rect) || ((el) => el.getBoundingClientRect());
  const visible = (el) => { const r = rect(el); return r.width > 0 && r.height > 0; };
  const allow = spec.allow.join(',');
  const out = [];
  if (!root) return out;
  for (const el of root.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]')) {
    if (!visible(el) || el.classList.contains('btn') || el.matches(allow) || el.closest(spec.skip)) continue;
    out.push({ sig: el.tagName.toLowerCase() + [...el.classList].sort().map((c) => `.${c}`).join(''), rule: 'outside-btn',
      text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40) });
  }
  return out;
}
