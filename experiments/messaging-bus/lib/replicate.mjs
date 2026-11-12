// experiments/messaging-bus/lib/replicate.mjs — the distributed option (plan §3 item 4, §4.1):
// each host serves ONLY the rows it originated (`GET /outbox`, full mesh, no relay) and pulls each
// peer by cursor. There is no push endpoint. The puller stores the rows and the peer cursor in one
// transaction (bus.ingest), so a crash between them can neither lose nor duplicate a row.
import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';

const MAX_WAIT_MS = 25_000;
const MAX_LIMIT = 1000;

/** Constant-time: both sides hashed to 32 bytes, so the buffers are always the same length. */
function tokenOk(header, token) {
  const m = /^Bearer (.+)$/.exec(String(header ?? ''));
  if (!m) return false;
  const h = (s) => createHash('sha256').update(s).digest();
  return timingSafeEqual(h(m[1]), h(token));
}

export function startOutboxServer({ bus, port = 0, token }) {
  if (typeof token !== 'string' || token.length < 8) throw new Error('a bearer token of 8+ chars is required');
  const waiting = new Set();
  const server = createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== '/outbox') return send(404, { code: 'NOT_FOUND' });
    if (req.method !== 'GET') return send(405, { code: 'METHOD_NOT_ALLOWED' });
    if (!tokenOk(req.headers.authorization, token)) return send(401, { code: 'BUS_UNAUTHORIZED' });
    const after = Math.max(0, Number.parseInt(url.searchParams.get('after') ?? '0', 10) || 0);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '500', 10) || 500));
    const wait = Math.min(MAX_WAIT_MS, Math.max(0, Number.parseInt(url.searchParams.get('wait') ?? '0', 10) || 0));
    const answer = () => {
      const items = bus.outboxAfter(after, limit);
      send(200, { origin: bus.origin, items, next: items.length ? items.at(-1).seq : after });
      return items.length;
    };
    let items;
    try { items = bus.outboxAfter(after, 1).length; } catch (e) { return send(503, { code: e?.code ?? 'BUS_ERROR' }); }
    if (items > 0 || wait === 0) return answer();
    // long poll: hold until a local publish (or the wait runs out)
    let done = false;
    const entry = {};
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(entry.timer);
      entry.stop?.();
      waiting.delete(entry);
      if (!res.writableEnded) { try { answer(); } catch (e) { send(503, { code: e?.code ?? 'BUS_ERROR' }); } }
    };
    entry.finish = finish;
    entry.timer = setTimeout(finish, wait);
    entry.stop = bus.wake(`server:${bus.origin}`, () => {
      if (bus.outboxAfter(after, 1).length > 0) finish();
    }, { watch: false, pollMs: 25 });
    waiting.add(entry);
    req.on('close', () => { if (!done) { done = true; clearTimeout(entry.timer); entry.stop?.(); waiting.delete(entry); } });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const bound = server.address().port;
      resolve({
        url: `http://127.0.0.1:${bound}`,
        port: bound,
        close: () => new Promise((r) => {
          for (const w of [...waiting]) { clearTimeout(w.timer); w.stop?.(); waiting.delete(w); }
          server.close(() => r());
          server.closeAllConnections();
        }),
      });
    });
  });
}

/**
 * Pulls one peer by cursor. Seams for tests and E4: `_afterInsert` runs after a page's rows are inserted and before
 * its cursor is written; `_splitCursor` writes the cursor in a SECOND transaction (the broken design E4 contrasts).
 */
export function createPuller({
  bus, url, token, peerOrigin, intervalMs = 100, longPollMs = 5000, limit = 500, onIngest,
  _failAfterInsert = false, _afterInsert, _splitCursor = false,
}) {
  const cursorKey = `peer:${peerOrigin}`;
  const st = { pulls: 0, inserted: 0, duplicates: 0, errors: 0, unauthorized: 0, running: false, lastError: null };
  let controller = null;
  let loop = null;

  const cursor = () => bus.cursors(cursorKey).find((c) => c.origin === peerOrigin)?.seq ?? 0;

  async function pullOnce({ wait = longPollMs } = {}) {
    st.pulls += 1;
    controller = new AbortController();
    try {
      const after = cursor();
      const res = await fetch(`${url}/outbox?after=${after}&limit=${limit}&wait=${wait}`, {
        headers: { authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      const body = await res.json();
      if (res.status !== 200) {
        if (res.status === 401) st.unauthorized += 1;
        st.errors += 1;
        return { status: res.status, items: 0, inserted: 0, duplicates: 0, error: body.code ?? `HTTP_${res.status}` };
      }
      if (body.origin !== peerOrigin) throw new Error(`peer answered as ${body.origin}, expected ${peerOrigin}`);
      const items = body.items.filter((e) => e.origin === peerOrigin);
      if (items.length === 0) return { status: 200, items: 0, inserted: 0, duplicates: 0 };
      let r;
      if (_splitCursor) {
        r = bus.ingest(items, { _failAfterInsert });
        _afterInsert?.();
        bus.ack(cursorKey, { origin: peerOrigin, seq: body.next });
      } else r = bus.ingest(items, { cursorKey, cursorSeq: body.next, _failAfterInsert, _afterInsert });
      st.inserted += r.inserted;
      st.duplicates += r.duplicates;
      onIngest?.(items, r, Date.now());
      return { status: 200, items: items.length, ...r };
    } catch (e) {
      st.errors += 1;
      st.lastError = String(e?.message ?? e);
      return { status: 0, items: 0, inserted: 0, duplicates: 0, error: st.lastError };
    } finally {
      controller = null;
    }
  }

  function start() {
    if (st.running) return;
    st.running = true;
    loop = (async () => {
      while (st.running) {
        const r = await pullOnce();
        if (!st.running) break;
        if (r.items === 0 && (r.error || longPollMs === 0)) await new Promise((res) => setTimeout(res, intervalMs));
      }
    })();
  }

  async function stop() {
    st.running = false;
    controller?.abort();
    await loop;
    loop = null;
  }

  return { start, stop, pullOnce, stats: () => ({ ...st }) };
}
