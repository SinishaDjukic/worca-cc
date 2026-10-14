// extension/src/content/port-fetch.mjs — the fetch Pinpoint gets on a web page. It never reaches worca itself: the
// request rides a runtime Port to the service worker (pinpoint-proxy.mjs), which alone holds the token. The URL is
// ignored — the service worker only ever calls POST /api/pinpoint.
export function createPortFetch(connect) {
  return function portFetch(_url, opts = {}) {
    return new Promise((resolve, reject) => {
      let body;
      try { body = JSON.parse(String(opts.body ?? '{}')); } catch { reject(new TypeError('invalid Pinpoint request')); return; }
      // An already-aborted signal never fires 'abort': refuse before opening a port (v7).
      if (opts.signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
      const port = connect();
      const enc = new TextEncoder();
      let ctl = null;
      let settled = false;
      let ended = false;   // the service worker sent `end`: only then is a closed stream a complete answer
      const stream = new ReadableStream({ start(c) { ctl = c; }, cancel() { try { port.disconnect(); } catch { /* gone */ } } });
      const fail = (msg) => { if (!settled) { settled = true; reject(new TypeError(msg)); } else { try { ctl.error(new Error(msg)); } catch { /* closed */ } } };
      port.onMessage.addListener((m) => {
        if (!m || typeof m.type !== 'string') return;
        if (m.type === 'head') {
          settled = true;
          if (m.ok) resolve(new Response(stream, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } }));
          else { resolve(new Response(m.text || '', { status: m.status || 500, headers: { 'Content-Type': 'application/json' } })); try { port.disconnect(); } catch { /* gone */ } }
        } else if (m.type === 'chunk') { try { ctl.enqueue(enc.encode(String(m.text ?? ''))); } catch { /* closed */ } }
        else if (m.type === 'end') { ended = true; try { ctl.close(); } catch { /* closed */ } try { port.disconnect(); } catch { /* gone */ } }
        else if (m.type === 'fail') fail(m.error || 'Worca is not reachable');
      });
      // A service worker that dies mid-stream must not make a partial Explain look complete (review cycle 1).
      port.onDisconnect.addListener(() => {
        if (!settled) { fail('Worca is not reachable'); return; }
        if (ended) { try { ctl.close(); } catch { /* closed */ } } else fail('Worca is not reachable');
      });
      if (opts.signal) {
        opts.signal.addEventListener('abort', () => {
          // Chrome fires no onDisconnect on the side that calls disconnect(), so end the stream here, or a
          // reader.read() in streamPinpoint waits forever after a Stop.
          try { port.disconnect(); } catch { /* gone */ }
          if (!settled) { settled = true; reject(new DOMException('Aborted', 'AbortError')); }
          else if (!ended) { try { ctl.error(new DOMException('Aborted', 'AbortError')); } catch { /* closed */ } }
        }, { once: true });
      }
      port.postMessage({ type: 'pinpoint', body });
    });
  };
}
