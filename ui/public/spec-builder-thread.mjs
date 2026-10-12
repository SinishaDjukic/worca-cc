// ui/public/spec-builder-thread.mjs — the Spec Builder pane's Ask client (R3): create a thread, post on it pinned to the
// project, stop it, load its snapshot, subscribe to its frames. The Ask panel never opens; frames arrive through
// app.js's ask-* fan-out and are reduced by ask-model.mjs in the pane.
async function body(r) { return r.json().catch(() => ({})); }
/** An Error carrying the HTTP status, so the pane can tell "thread deleted" (404) from other refusals (R26). */
function httpError(message, status) { const e = new Error(message); e.status = status; return e; }

export function createSpecThreadClient({ fetch, sendWs }) {
  let pick = null;
  async function modelPick() {
    if (pick) return pick;
    const r = await fetch('/api/ask/models');
    const j = await body(r);
    if (!r.ok || !j.default || !j.default.model) throw new Error('Ask Worca has no model to draft with. Pick one in Ask Worca first.');
    pick = { model: j.default.model, effort: j.default.effort };
    return pick;
  }
  return {
    async create(title) {
      const r = await fetch('/api/ask/threads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: String(title || '').slice(0, 120) }) });
      const j = await body(r);
      if (r.status !== 201 || !j.thread) throw new Error(j.error || `could not create the thread (${r.status})`);
      return j.thread.id;
    },
    /** @returns {Promise<{userMessageId:string|null}>} — the 202's id, so the pane can echo the user row (R3). */
    async send(threadId, text, projectKey) {
      const { model, effort } = await modelPick();
      const r = await fetch(`/api/ask/threads/${encodeURIComponent(threadId)}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model, effort, context: { pinned: true, projectKey } }) });
      const j = await body(r);
      if (r.status !== 202) throw httpError(j.error || `request failed (${r.status})`, r.status);
      return { userMessageId: typeof j.userMessageId === 'string' ? j.userMessageId : null };
    },
    async stop(threadId) {
      await fetch(`/api/ask/threads/${encodeURIComponent(threadId)}/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
    },
    /** The snapshot, or null when the thread is gone (404). */
    async load(threadId) {
      const r = await fetch(`/api/ask/threads/${encodeURIComponent(threadId)}`);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`could not load the draft (${r.status})`);
      return body(r);
    },
    subscribe(threadId) { sendWs({ type: 'subscribe', threadId }); },
  };
}
