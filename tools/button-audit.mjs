// tools/button-audit.mjs (new) — the one-button-style audit (runs-redesign spec §1.2, §5.2; known bug 4).
// auditButtons is serialised into the page by the CDP proofs as `(${auditButtons})(…)`, so its body must not
// reference anything outside its own parameters.

export const BUTTON_SPEC = Object.freeze({
  sizes: ['btn-sm', 'btn-lg'],                          // none = medium
  variants: ['btn-primary', 'btn-quiet', 'btn-danger'], // none = secondary
  heights: { 'btn-sm': 28, '': 32, 'btn-lg': 40 },
  fontSizes: { 'btn-sm': '12.5px', '': '13px', 'btn-lg': '14px' },
  corners: ['4px', '0px'],                              // 0 for the joined halves of a split button
  // D10: controls, not §1.2 buttons. They still obey the radius tokens (test/ui-design-language.test.mjs).
  controls: ['.nav button', '.seg button', '[role="tab"]', '[role="menuitem"]', '[role="menuitemradio"]',
    '[role="menuitemcheckbox"]', '[role="option"]', '[role="radio"]', '[role="switch"]', '.switch', '.link-btn',
    '.info-tip', '.act-tile', '.ob-door', '.seg-btn', '.btn-split-menu button', '.rd-tab', '.hd-tab', '.pd-tab', '.tp-tab', '.md-tab', '.af-tab',
    '.wfl-tab', '.chat-home-tab', '.hd-cmt-tab', 'button.rd-srow', 'button.tl-tile', 'button.af-gal-card',
    'button.pd-ov-card', 'button.wd-member', 'button.ask-activity-head', 'button.act-srow-name', 'button.runs-group-head',
    'button.runs-chain-toggle', 'button.agent-row-head', 'button.hd-tree-file', 'button.hd-tree-dir', 'button.chat-home-act',
    'button.chat-home-wf', 'button.wfl-folder', 'button.mcp-setrow', 'button.mv-sec-toggle', 'button.proj-open', 'button.xtoggle',
    '.mv-filter', '.mv-cp-terms-pill', '.cost-bd-btn', '.linkish', '.hd-dl-more-btn', '.plan-fold', '.plan-persp-edit', '.qopt', '.afb-main',
    '.afb-folder', '.acct', '[class*="chip"]'],
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
    const size = sizes[0] || '';
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
