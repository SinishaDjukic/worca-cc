// ui/public/model-options.mjs — the one way a <select> lists catalog models: an <optgroup> per connection
// (src/shared/connections.mjs modelGroups), each option the model's label plus who added it. Pure DOM.
import { modelGroups, modelSourceSuffix } from '../../src/shared/connections.mjs';

/** The default option text: the label, then " · team policy" / " · <plugin>". */
export const modelOptionText = (m) => (m.label || m.id) + modelSourceSuffix(m);

/** Append `models` to `select` grouped by connection. `engine`: whose sign-in leads. `text(m)`: an option's label. */
export function appendModelGroups(select, models, { engine = 'claude', text = modelOptionText } = {}) {
  const doc = select.ownerDocument;
  for (const g of modelGroups(models, { engine })) {
    const og = doc.createElement('optgroup'); og.label = g.label;
    for (const m of g.models) { const o = doc.createElement('option'); o.value = m.id; o.textContent = text(m); og.append(o); }
    select.append(og);
  }
}
