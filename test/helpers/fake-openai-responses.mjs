// test/helpers/fake-openai-responses.mjs
// A stand-in OpenAI-compatible endpoint for Codex custom endpoints: serves the
// streaming Responses API (POST /v1/responses) that `codex exec` speaks with
// `wire_api = "responses"`, plus GET /v1/models. Every request is recorded, and a
// request without the expected bearer key gets a 401, so a test can prove which
// key codex sent.
import http from 'node:http';

export const FAKE_RESPONSES_KEY = 'sk-fake-responses-0123456789';

/**
 * @param {{key?:string|null, reply?:string, usage?:{input_tokens:number, output_tokens:number}}} [o]
 *   key: the bearer token the server accepts (null accepts any, including none)
 * @returns {Promise<{url:string, requests:object[], close:()=>Promise<void>}>}
 */
export async function startFakeResponses({ key = FAKE_RESPONSES_KEY, reply = 'hello from the fake endpoint', usage = { input_tokens: 120, output_tokens: 8 } } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(parts).toString('utf8');
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
      requests.push({ method: req.method, url: req.url, headers: { ...req.headers }, body });
      const path = req.url.split('?')[0];
      const sent = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (key !== null && sent !== key) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'invalid api key', type: 'invalid_request_error' } }));
        return;
      }
      if (req.method === 'GET' && path.endsWith('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'fake-model', object: 'model' }] }));
        return;
      }
      if (req.method === 'POST' && path.endsWith('/responses')) {
        const model = (body && body.model) || 'fake-model';
        const id = `resp_${requests.length}`;
        const msg = { id: `msg_${requests.length}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: reply, annotations: [] }] };
        const response = (status, output, extra = {}) => ({ id, object: 'response', created_at: Math.floor(Date.now() / 1000), model, status, output, ...extra });
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        let seq = 0;
        const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: seq++, ...data })}\n\n`);
        ev('response.created', { response: response('in_progress', []) });
        ev('response.output_item.added', { output_index: 0, item: { ...msg, status: 'in_progress', content: [] } });
        ev('response.content_part.added', { item_id: msg.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
        ev('response.output_text.delta', { item_id: msg.id, output_index: 0, content_index: 0, delta: reply });
        ev('response.output_text.done', { item_id: msg.id, output_index: 0, content_index: 0, text: reply });
        ev('response.content_part.done', { item_id: msg.id, output_index: 0, content_index: 0, part: msg.content[0] });
        ev('response.output_item.done', { output_index: 0, item: msg });
        ev('response.completed', { response: response('completed', [msg], {
          usage: { input_tokens: usage.input_tokens, input_tokens_details: { cached_tokens: 0 }, output_tokens: usage.output_tokens, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: usage.input_tokens + usage.output_tokens },
        }) });
        res.end();
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `no route ${req.method} ${path}` } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}/v1`,
    requests,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}
