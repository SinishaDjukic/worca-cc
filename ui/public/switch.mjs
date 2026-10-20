// ui/public/switch.mjs — the one switch (docs/design-system.md › Switch), checkbox driver. A real checkbox drives the
// pixels (input.sw-input + span.switch), so :checked, :disabled, label clicks and the keyboard need no JS. Pure DOM;
// `doc` is injected for jsdom.

/**
 * @param {Document} doc
 * @param {object} [o]
 * @param {string} [o.label]       the visible label ('' when the row's own label names it: pass ariaLabel)
 * @param {string} [o.ariaLabel]
 * @param {boolean} [o.checked]
 * @param {string} [o.inputClass]  the hook class the screen reads (`tag-dim-required`, `step-fanout`, …)
 * @param {string} [o.rowClass]    extra classes on the label row (`fanout-toggle`, `ask-rp-ctl`, …)
 * @param {string|null} [o.locked] why it cannot change: disables it and shows the reason
 * @param {Record<string,string>} [o.data]  data-* on the input
 * @returns {{ row: HTMLLabelElement, input: HTMLInputElement, setLocked: (reason: string|null) => void }}
 */
export function makeSwitch(doc, { label = '', ariaLabel = '', checked = false, inputClass = '', rowClass = '', locked = null, data = {} } = {}) {
  const row = doc.createElement('label');
  row.className = ['switch-row', rowClass].filter(Boolean).join(' ');
  const input = doc.createElement('input');
  input.type = 'checkbox';
  input.className = ['sw-input', inputClass].filter(Boolean).join(' ');
  input.setAttribute('role', 'switch');
  input.checked = !!checked;
  if (ariaLabel) input.setAttribute('aria-label', ariaLabel);
  for (const [k, v] of Object.entries(data)) input.dataset[k] = v;
  const track = doc.createElement('span');
  track.className = 'switch';
  track.setAttribute('aria-hidden', 'true');
  row.append(input, track);
  if (label) {
    const t = doc.createElement('span');
    t.className = 'switch-label';
    t.textContent = label;
    row.append(t);
  }
  const why = doc.createElement('span');
  why.className = 'switch-why';
  row.append(why);
  // data-locked keeps setPanelBusy (app.js) and the accordion's re-enable pass from unlocking it.
  const setLocked = (reason) => {
    input.disabled = !!reason;
    if (reason) input.dataset.locked = '1'; else delete input.dataset.locked;
    why.textContent = reason || '';
    why.hidden = !reason;
    if (reason) row.title = reason; else row.removeAttribute('title');
  };
  setLocked(locked);
  return { row, input, setLocked };
}
