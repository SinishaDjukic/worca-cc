// ui/public/speech-browser.mjs
// The main-thread handle on one in-browser speech engine (speech-worker.mjs):
// a lazily started module worker plus request/response bookkeeping. The worker
// (and its loaded model) lives until release(), so a second voice session soon
// after the first starts warm.

/** createBrowserSpeech(win, 'stt' | 'tts') → { load(onProgress), transcribe(audio, language, signal), speak(text, opts, signal), release() } */
export function createBrowserSpeech(win, kind) {
  let worker = null;
  let seq = 0;
  let onProgress = null;
  const pending = new Map();

  function rejectAll(err) {
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  }

  function ensure() {
    if (worker) return worker;
    worker = new win.Worker(`/speech-worker.mjs?kind=${kind}`, { type: 'module' });
    worker.onmessage = (ev) => {
      const m = ev.data || {};
      if (m.op === 'progress') { if (onProgress) try { onProgress(m.loaded, m.total); } catch { /* paint only */ } return; }
      const p = pending.get(m.id);
      if (!p) return;                               // aborted: the answer is dropped
      pending.delete(m.id);
      if (m.ok) p.resolve(m); else p.reject(new Error(m.error || 'speech engine failed'));
    };
    worker.onerror = (ev) => {
      ev.preventDefault?.();
      rejectAll(new Error(`the in-browser speech engine could not start${ev.message ? `: ${ev.message}` : ''}`));
      worker.terminate();
      worker = null;
    };
    return worker;
  }

  function call(msg, { transfer = [], signal } = {}) {
    if (signal && signal.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'));
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      if (signal) signal.addEventListener('abort', () => { if (pending.delete(id)) reject(new DOMException('aborted', 'AbortError')); }, { once: true });
      ensure().postMessage({ id, ...msg }, transfer);
    });
  }

  return {
    async load(progressCb) {
      onProgress = progressCb || null;
      try { await call({ op: 'load' }); } finally { onProgress = null; }
    },
    async transcribe(audio, language, signal) {
      const copy = new Float32Array(audio);           // the VAD may reuse its buffer; ours is transferred
      return (await call({ op: 'transcribe', audio: copy, language }, { transfer: [copy.buffer], signal })).text;
    },
    async speak(text, { voice, speed } = {}, signal) {
      const r = await call({ op: 'speak', text, voice, speed }, { signal });
      return { audio: r.audio, rate: r.rate };
    },
    /** Free the model's memory (GPU and RAM); the next call starts a fresh worker. */
    release() {
      if (!worker) return;
      rejectAll(new DOMException('released', 'AbortError'));
      worker.terminate();
      worker = null;
    },
  };
}
