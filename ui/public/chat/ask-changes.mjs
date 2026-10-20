// ui/public/chat/ask-changes.mjs — Shaper s5: the one-line "Ask for changes" field on finished run, feature, Ship and PR
// cards. onSend(text) posts it (POST /api/ask/threads/:id/changes); a failure keeps the text and shows the reason.
const errorOf = (e) => String((e && e.body && e.body.error) || (e && e.message) || e || 'Something went wrong');

export function renderAskChanges(doc, { onSend, placeholder = 'Ask for changes…' }) {
  const el = doc.createElement('div'); el.className = 'ask-changes';
  const input = doc.createElement('input'); input.type = 'text'; input.className = 'ask-changes-input';
  input.placeholder = placeholder; input.setAttribute('aria-label', 'Ask for changes'); input.maxLength = 4000;
  const send = doc.createElement('button'); send.type = 'button'; send.className = 'btn btn-sm btn-quiet ask-card-not-now ask-changes-send'; send.textContent = 'Send';
  const err = doc.createElement('div'); err.className = 'ask-card-err ask-changes-err'; err.setAttribute('aria-live', 'polite');
  const sync = () => { send.disabled = !input.value.trim(); };
  input.addEventListener('input', sync);
  let busy = false;
  async function go() {
    const text = input.value.trim();
    if (!text || busy) return;
    busy = true; input.disabled = true; send.disabled = true; send.textContent = 'Sending…'; err.textContent = '';
    try { await onSend(text); input.value = ''; }
    catch (e) { err.textContent = `Not sent: ${errorOf(e)}`; }
    finally { busy = false; input.disabled = false; send.textContent = 'Send'; sync(); }
  }
  send.addEventListener('click', go);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(); } });
  sync();
  el.append(input, send, err);
  return { el, focus: () => input.focus() };
}
