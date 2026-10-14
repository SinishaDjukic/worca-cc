// extension/src/pinpoint-proxy.mjs — the service worker's half of Pinpoint on web pages. The page's content script
// asks; this rebuilds the body (surface forced to "web", source = the sender frame's host, quote/context clipped to
// src/core/pinpoint.mjs's caps) and streams POST /api/pinpoint's NDJSON back. Only for the panel's active tab.
const ACTIONS = new Set(['explain', 'alternatives']);
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };

export function sanitizePinpointBody(body, { source }) {
  const b = body && typeof body === 'object' ? body : {};
  if (!ACTIONS.has(b.action)) return null;
  if (typeof b.quote !== 'string' || !b.quote.trim()) return null;
  return {
    action: b.action,
    quote: b.quote.slice(0, 4000),
    context: typeof b.context === 'string' ? b.context.slice(0, 12000) : '',
    surface: 'web',
    source: String(source ?? '').slice(0, 200),
  };
}

/** @param {{client:{call:Function}, allowed:() => boolean}} o */
export function servePinpointPort(port, { client, allowed }) {
  const ac = new AbortController();
  const post = (m) => { try { port.postMessage(m); } catch { /* the page went away */ } };
  port.onDisconnect.addListener(() => ac.abort());
  port.onMessage.addListener(async (m) => {
    if (!m || m.type !== 'pinpoint') return;
    if (!allowed()) { post({ type: 'fail', error: 'Open the Worca sidebar to use Pinpoint here' }); return; }
    const body = sanitizePinpointBody(m.body, { source: hostOf(port.sender && port.sender.url) });
    if (!body) { post({ type: 'head', ok: false, status: 400, text: JSON.stringify({ error: 'invalid Pinpoint request' }) }); return; }
    let res;
    try { res = await client.call('/api/pinpoint', { method: 'POST', body, raw: true, signal: ac.signal }); }
    catch (err) { if (!ac.signal.aborted) post({ type: 'fail', error: err && err.message ? err.message : 'Worca is not reachable' }); return; }
    if (!res.ok) { post({ type: 'head', ok: false, status: res.status, text: await res.text().catch(() => '') }); return; }
    post({ type: 'head', ok: true, status: 200 });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        post({ type: 'chunk', text: dec.decode(value, { stream: true }) });
      }
      post({ type: 'end' });
    } catch {
      if (!ac.signal.aborted) post({ type: 'fail', error: 'the answer stopped' });
    }
  });
}
