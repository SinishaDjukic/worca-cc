// The "How it works" button and its "New" mark. The button is the design-system Button; this
// module only adds the mark span and paints it. The controller (how-it-works.mjs) places it.
import { button, icon, toElement } from '../design-system/components/index.mjs';

const LABEL = 'How it works';
const TIP = 'How this area works';

/** The button's HTML: question icon, the words, and a trailing hidden "New" mark. */
export function howtoButtonHtml({ id, cls }) {
  const html = button({ label: LABEL, icon: icon('question'), cls, attrs: { id, 'data-min-level': 'simple', title: TIP } });
  const mark = '<span class="howto-new" hidden><span class="sr-only">New</span></span>';
  return html.replace(/<\/button>$/, `${mark}</button>`);
}

/** The button as an element, for a page that builds elements. */
export function howtoButtonElement(doc, opts) {
  return toElement(doc, howtoButtonHtml(opts));
}

/** Show or hide the "New" mark on a button; a missing button is a no-op. */
export function paintHowtoMark(btn, isNew) {
  if (!btn) return;
  btn.dataset.new = isNew ? 'true' : 'false';
  const mark = btn.querySelector('.howto-new');
  if (mark) mark.hidden = !isNew;
}
