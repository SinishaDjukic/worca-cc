// test/helpers/run-tabs.mjs — open a run page tab the way a person does: its button in the row, or its row in the
// "More" menu when the tab sits there.
import assert from 'node:assert/strict';

export function openTab(window, button) {
  const click = (node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));
  if (!button.hasAttribute('data-overflow') || button.classList.contains('active')) { click(button); return; }
  const label = [...button.childNodes].find((n) => n.nodeType === window.Node.TEXT_NODE && n.textContent.trim()).textContent.trim();
  click(button.parentElement.querySelector(':scope > .tab-more'));
  const item = [...window.document.querySelectorAll('body > .wfv-menu .menu-item')].find((i) => i.querySelector('.wfv-menu-l').textContent === label);
  assert.ok(item, `${label} is in the More menu`);
  click(item);
}
