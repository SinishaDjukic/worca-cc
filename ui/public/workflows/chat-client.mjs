// ui/public/workflows/chat-client.mjs
// The Workflows chat's link to Ask Worca (D14): ONE composer thread at a time (ask_threads.mode =
// 'composer'), its ask-model.mjs reducer (the same per-thread reducer the Ask panel uses), the send path,
// the stop and card routes, and the frames app.js fans out to it. No DOM.
import { createThreadModel } from '../ask-model.mjs';
import { chatEngineOf, engineOfEntry } from '../ask-engine.mjs';

/** The dock's current thread (never the Ask panel's `worca-cc.ask.thread`). */
export const THREAD_KEY = 'worca-cc.composer.thread';

export function createComposerChatClient({ fetch: fetchFn, sendWs = () => {}, storage = null, onChange = () => {} } = {}) {
  const read = (k) => { try { return storage ? storage.getItem(k) : null; } catch { return null; } };
  const write = (k, v) => { try { if (!storage) return; if (v == null) storage.removeItem(k); else storage.setItem(k, v); } catch { /* private mode */ } };
  const json = async (res) => { try { return await res.json(); } catch { return {}; } };
  const post = (url, body) => fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  let threadId = read(THREAD_KEY);
  let model = null;
  let catalog = null;
  let sending = false;
  let awaiting = null;                           // the assistant message a 202 promised, until its first frame lands
  let gen = 0;                                   // a newer load or New chat wins over a slower one
  let resyncing = null;                          // the reload a seq gap started: later frames wait for it (ask-panel's st.resyncing)

  function newChat() {
    gen += 1;
    threadId = null;
    model = null;
    awaiting = null;
    write(THREAD_KEY, null);
    onChange('structure');
  }

  async function load(id) {
    const my = ++gen;
    let res;
    try { res = await fetchFn(`/api/ask/threads/${encodeURIComponent(id)}`); } catch { return false; }
    if (my !== gen) return false;
    if (!res.ok) { if (res.status === 404) newChat(); return false; }
    const snap = await json(res);
    if (my !== gen) return false;
    if (!snap.thread || snap.thread.mode !== 'composer') { newChat(); return false; }
    model = createThreadModel({ threadId: id });
    model.load(snap);
    awaiting = null;                             // the snapshot's inFlight speaks for any turn in progress
    if (snap.inFlight) sendWs({ type: 'subscribe', threadId: id });
    onChange('structure');
    return true;
  }

  async function defaultPick() {
    if (!catalog) {
      try { const r = await fetchFn('/api/ask/models'); catalog = r.ok ? await json(r) : null; } catch { catalog = null; }
    }
    // The server locks a chat to the engine of its first reply ("this chat runs on Codex"): an existing thread keeps
    // its engine's default, as the Ask panel keeps a thread's own pick — after the Ask engine changes, the Ask default
    // would be refused on every message.
    const engine = model && model.thread() ? model.thread().engine : null;
    const own = engine && catalog && catalog.defaults ? catalog.defaults[engine] : null;
    const d = own || (catalog && catalog.default);
    return d && typeof d.model === 'string' && typeof d.effort === 'string' ? { model: d.model, effort: d.effort } : null;
  }

  return {
    threadId: () => threadId,
    model: () => model,
    // `awaiting` covers the gap between the 202 and the turn's first frame: a second Enter there would get a 409.
    busy: () => sending || Boolean(awaiting) || Boolean(model && model.live()),
    async open() { if (threadId && !model) await load(threadId); },
    /** The engine the next message runs on (Ask's pickerEngine): the chat's lock once it has a reply, else the engine
     *  of the model defaultPick() sends. null while the catalog cannot be read (the server still refuses). A stored chat
     *  loads first, as in send(): the dock's expand() starts open() without waiting for it. */
    async engine() {
      if (threadId && !model) await load(threadId);
      const pick = await defaultPick();
      if (!pick) return null;
      const t = model && model.thread() ? model.thread() : null;
      const entry = catalog && Array.isArray(catalog.models) ? catalog.models.find((x) => x && x.id === pick.model) || null : null;
      return chatEngineOf(model ? model.messages() : [], pick.model, catalog, t && t.engine) || engineOfEntry(entry);
    },
    /** Every message carries the canvas (D11) — never "the first one only" (memory: ask-script-tools-traps). */
    // `attachments`: the dock's pending files ({name, dataBase64, bytes, attKind, mime}); only name + base64 go up.
    async send(text, { context = {}, composer = null, attachments = [] } = {}) {
      if (sending) return { ok: false, error: 'A message is already on its way.' };
      sending = true;
      onChange('sending');
      try {
        // A stored thread whose GET failed (offline at open) has no model yet: load it first. A 404 there runs
        // newChat(), and the branch below starts a fresh thread instead.
        if (threadId && !model) {
          await load(threadId);
          if (threadId && !model) return { ok: false, error: 'This chat could not be loaded — start a New chat.' };
        }
        const pick = await defaultPick();   // after the load: a stored chat keeps its own engine
        if (!pick) return { ok: false, error: 'No model is available for the chat.' };
        if (!threadId) {
          const r = await post('/api/ask/threads', { mode: 'composer' });
          const body = await json(r);
          if (r.status !== 201 || !body.thread) return { ok: false, error: body.error || `HTTP ${r.status}` };
          threadId = body.thread.id;
          write(THREAD_KEY, threadId);
          model = createThreadModel({ threadId });
          model.load({ thread: body.thread, messages: [], attachments: [], runLinks: [], inFlight: null });
        }
        const tid = threadId;
        const m = model;
        const files = (Array.isArray(attachments) ? attachments : []).filter((f) => f && typeof f.name === 'string' && typeof f.dataBase64 === 'string');
        // No attachments, no key: the body stays what it was before attachments existed.
        const r = await post(`/api/ask/threads/${encodeURIComponent(tid)}/messages`, { text, model: pick.model, effort: pick.effort, context, composer,
          ...(files.length ? { attachments: files.map((f) => ({ name: f.name, dataBase64: f.dataBase64 })) } : {}) });
        const body = await json(r);
        if (r.status !== 202) return { ok: false, error: body.error || `HTTP ${r.status}` };
        // New chat (or a 404 reload) while the POST was out: the message went to the thread it was sent to — never
        // write it into the one now showing (ask-panel.mjs guards the same race).
        if (threadId !== tid || model !== m) return { ok: true };
        // The server's rows carry the store-minted ids an image thumbnail is served by (as ask-panel.mjs); the files
        // sent are the fallback for a server without the field.
        const echo = Array.isArray(body.attachments)
          ? body.attachments.map((a) => ({ id: a.id, name: a.name, bytes: a.bytes, attKind: a.kind ?? 'text', mime: a.mime ?? null }))
          : files.map((f) => ({ name: f.name, bytes: f.bytes, attKind: f.attKind, mime: f.mime }));
        m.noteLocalUserMessage({ id: body.userMessageId, text, attachments: echo });
        awaiting = body.assistantMessageId || null;
        sendWs({ type: 'subscribe', threadId: tid });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: `Worca did not answer (${e && e.message ? e.message : e}).` };
      } finally {
        sending = false;
        onChange('structure');
      }
    },
    async stop() { if (threadId) { try { await post(`/api/ask/threads/${encodeURIComponent(threadId)}/stop`, {}); } catch { /* the turn ends anyway */ } } },
    async postCard(cardId, body) {
      if (!threadId) return { ok: false, status: 0, body: {} };
      try {
        const r = await post(`/api/ask/threads/${encodeURIComponent(threadId)}/cards/${encodeURIComponent(cardId)}`, body);
        return { ok: r.ok, status: r.status, body: await json(r) };
      } catch { return { ok: false, status: 0, body: {} }; }
    },
    newChat,
    pushFrame(frame) {
      // Settings › "Delete all chat history" deletes composer chats too (D1): drop the dead thread as the Ask panel
      // does, or every next message posts to it and fails "thread not found". A shared clear names its threads.
      if (frame && frame.type === 'ask-history-cleared') {
        if (threadId && (!Array.isArray(frame.threadIds) || frame.threadIds.includes(threadId))) newChat();
        return;
      }
      if (!model || !frame || frame.threadId !== threadId) return;
      const r = model.apply(frame);
      if (awaiting && frame.messageId === awaiting) awaiting = null;      // the turn is live: live() takes over busy()
      // Every frame after a gap gaps too, until the reload lands: ONE GET, not one per frame.
      if (r && r.gap) { if (!resyncing) resyncing = load(threadId).finally(() => { resyncing = null; }); return; }
      onChange('frame');
    },
    onHello() { if (threadId) void load(threadId); },
    resync() { return threadId ? load(threadId) : Promise.resolve(false); },
  };
}
