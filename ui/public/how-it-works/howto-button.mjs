// The "How it works" button and its "New" mark: a small .btn with a question icon, the words and
// a trailing hidden dot. The dot holds no text (a hidden word would count as a label word and as text on
// the dot); while it shows, the button says "New" through aria-description. The controller (how-it-works.mjs) places it.

const LABEL = 'How it works';
const TIP = 'How this area works';
const QUESTION_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" '
  + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.8 9a3.2 3.2 0 1 1 5 2.7c-1.2.8-1.8 1.4-1.8 2.8"></path>'
  + '<path d="M12 18.5h.01"></path></svg>';
const MARK = '<span class="howto-new" aria-hidden="true" hidden></span>';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The button's HTML: question icon, the words (their own span, so a narrow top bar can show the icon only;
 *  aria-label keeps the name), and a trailing hidden "New" dot. */
export function howtoButtonHtml({ id, cls, icon = false }) {
  // icon: the quiet icon button of a bar of icons (the Workflows editor's, beside the Library toggle): no words.
  const classes = [...(icon ? ['btn', 'btn-quiet', 'btn-icon'] : ['btn', 'btn-sm']), cls].filter(Boolean).join(' ');
  const words = icon ? '' : `<span class="howto-label">${LABEL}</span>`;
  return `<button type="button" class="${esc(classes)}" title="${TIP}" aria-label="${LABEL}" id="${esc(id)}" data-min-level="simple">`
    + `${QUESTION_ICON}${words}${MARK}</button>`;
}

/** The button as an element, for a page that builds elements. */
export function howtoButtonElement(doc, opts) {
  const t = doc.createElement('template');
  t.innerHTML = howtoButtonHtml(opts);
  return t.content.firstElementChild;
}

/** Show or hide the "New" mark on a button; a missing button is a no-op. */
export function paintHowtoMark(btn, isNew) {
  if (!btn) return;
  btn.dataset.new = isNew ? 'true' : 'false';
  const mark = btn.querySelector('.howto-new');
  if (mark) mark.hidden = !isNew;
  if (isNew) btn.setAttribute('aria-description', 'New');
  else btn.removeAttribute('aria-description');
}
