// Button (docs/design-system.md › Worca Rail › Button): one look per role, never a size or colour of its own.
// `kind` is the role: '' (secondary), 'primary' (the one main step of a state), 'quiet' (a step among many), 'danger'
// (only inside the confirm of a step that cannot be taken back). An icon-only button names itself in `label`, which
// becomes its aria-label; its tooltip is `title` (the label when not given).
import { attrs, cls, esc } from './html.mjs';

const KIND = { primary: 'btn-primary', quiet: 'btn-quiet', danger: 'btn-danger', '': '' };

/**
 * @param {object} o
 * @param {string} o.label        the words, or the name of an icon-only button
 * @param {string} [o.kind]       '' | 'primary' | 'quiet' | 'danger'
 * @param {string} [o.icon]       an icon's SVG markup, before the words
 * @param {boolean} [o.iconOnly]  a square icon button: `label` goes to aria-label
 * @param {string} [o.title]      the tooltip
 * @param {string} [o.cls]        the page's hook class (never a look)
 * @param {object} [o.attrs]      data-*, aria-* and disabled, written as given
 */
export function button({ label, kind = '', icon = '', iconOnly = false, title, cls: extra = '', attrs: a = {} }) {
  if (!(kind in KIND)) throw new Error(`button: unknown kind "${kind}"`);
  const tip = title ?? (iconOnly ? label : undefined);
  const name = iconOnly ? { 'aria-label': label } : {};
  return `<button type="button" class="${cls('btn btn-sm', KIND[kind], iconOnly && 'btn-icon', extra)}"${attrs({ ...name, title: tip, ...a })}>${icon}${iconOnly ? '' : esc(label)}</button>`;
}

/**
 * A main step with its alternatives behind ▾ (StatusLine's action slot, a section's own action). The ▾ opens
 * `menuHtml` (a CompactMenu, given when open) and takes the main button's kind, so the pair reads as one control.
 *
 * @param {object} o
 * @param {object} o.main         Button options for the main step
 * @param {string} o.moreLabel    the ▾'s name ("More actions")
 * @param {string} o.chevron      the ▾ icon's SVG markup
 * @param {boolean} [o.open]      whether its menu is open
 * @param {string} [o.menuHtml]   the open menu
 * @param {object} [o.moreAttrs]  the ▾'s data-* hooks
 * @param {string} [o.cls]        the wrapper's hook classes
 */
export function splitButton({ main, moreLabel, chevron, open = false, menuHtml = '', moreAttrs = {}, cls: extra = '' }) {
  const more = moreLabel ? button({ label: moreLabel, kind: main.kind, icon: chevron, iconOnly: true, title: false,
    attrs: { 'aria-haspopup': 'menu', 'aria-expanded': String(open), ...moreAttrs } }) + (open ? menuHtml : '') : '';
  return `<div class="${cls('btn-split', extra)}">${button(main)}${more}</div>`;
}
