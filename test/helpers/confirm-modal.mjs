// Answer the app's own confirm/prompt modal.
//
// The destructive deletes and the two "name this thing" flows used to call
// window.confirm / window.prompt, which a test answered by stubbing the global.
// They now go through confirmModal() / promptModal() in the page, so a test has
// to drive the real dialog instead: wait for it to open, fill any prompt fields,
// then click OK (or Cancel).
//
//   await confirmDialog(window);                       // plain confirm -> OK
//   await confirmDialog(window, { name: 'My Flow' });  // promptModal fields
//   await cancelDialog(window);                        // -> Cancel
import assert from 'node:assert/strict';

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

// Values are keyed by field id, matching promptModal's `fields[].id` (the input
// carries id="confirm-f-<id>"). The synthetic 'input' event is what re-runs the
// required-field check that gates the OK button.
export async function confirmDialog(window, values = {}) {
  const doc = window.document;
  await tick();
  const modal = doc.getElementById('confirm-modal');
  assert.ok(modal, 'no #confirm-modal in the page');
  assert.equal(modal.classList.contains('hidden'), false, 'the confirm modal did not open');
  for (const [id, value] of Object.entries(values)) {
    const input = doc.getElementById(`confirm-f-${id}`);
    assert.ok(input, `the dialog has no field "${id}"`);
    input.value = value;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  }
  const ok = doc.getElementById('confirm-ok');
  assert.equal(ok.disabled, false, 'OK is still disabled — a required field is empty');
  // captured BEFORE the click, for tests that assert on the copy
  const message = doc.getElementById('confirm-message').textContent;
  ok.click();
  await tick();
  return message;
}

export async function cancelDialog(window) {
  const doc = window.document;
  await tick();
  doc.getElementById('confirm-cancel').click();
  await tick();
}

// The message the dialog is currently showing, for tests that assert the copy.
export function dialogText(window) {
  const doc = window.document;
  return {
    title: doc.getElementById('confirm-title').textContent,
    message: doc.getElementById('confirm-message').textContent,
    confirmLabel: doc.getElementById('confirm-ok').textContent,
  };
}
