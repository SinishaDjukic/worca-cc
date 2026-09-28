// test/helpers/fake-model-upstream.mjs
// A stand-in model provider for the credential broker's tests: speaks enough of
// Anthropic's Messages API (and OpenAI's chat completions) to be proxied, records
// every request it receives, and can misbehave on demand (echo the key in an error,
// redirect, reject the key).
import http from 'node:http';

export const GOOD_KEY = 'sk-ant-test-0123456789abcdefGOODKEY';

/**
 * @returns {Promise<{url:string, requests:object[], set:(o:object)=>void, close:()=>Promise<void>}>}
 */
export async function startFakeUpstream({ validKeys = [GOOD_KEY], host = '127.0.0.1', port = 0 } = {}) {
  const requests = [];
  const state = { mode: 'ok' };
  const keyOf = (req) => req.headers['x-api-key'] || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const server = http.createServer((req, res) => {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      const body = Buffer.concat(parts).toString('utf8');
      requests.push({ method: req.method, url: req.url, headers: { ...req.headers }, body });
      const key = keyOf(req);
      const path = req.url.split('?')[0];
      if (state.mode === 'redirect') { res.writeHead(302, { location: 'https://evil.example/steal' }); res.end(); return; }
      if (!validKeys.includes(key)) {
        res.writeHead(401, { 'content-type': 'application/json', 'request-id': 'req_bad' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
        return;
      }
      if (state.mode === 'echo-key') {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `Incorrect API key provided: ${key}. Also sk-ab****wxyz` } }));
        return;
      }
      if (req.method === 'GET' && (path === '/v1/models' || path === '/api/v1/models')) {
        res.writeHead(200, { 'content-type': 'application/json', 'x-secret-upstream-header': 'should-not-pass' });
        res.end(JSON.stringify({ data: [{ id: 'claude-sonnet-5' }] }));
        return;
      }
      if (req.method === 'POST' && path === '/v1/messages') {
        let parsed = {};
        try { parsed = JSON.parse(body || '{}'); } catch { /* keep {} */ }
        if (parsed.stream) {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'request-id': 'req_1', 'set-cookie': 'leak=1' });
          const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
          ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5', content: [], stop_reason: null, usage: { input_tokens: 1000, output_tokens: 1, cache_read_input_tokens: 200, cache_creation_input_tokens: 0 } } });
          ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
          // A first chunk now, the rest after a pause: proves the broker streams instead of buffering.
          ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'hello' } });
          setTimeout(() => {
            ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: ' world' } });
            ev('content_block_stop', { index: 0 });
            ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 500 } });
            ev('message_stop', {});
            res.end();
          }, state.streamDelayMs ?? 150);
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'msg_2', type: 'message', role: 'assistant', model: 'claude-sonnet-5', content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }));
        return;
      }
      if (req.method === 'POST' && (path === '/api/v1/chat/completions' || path === '/v1/chat/completions')) {
        let parsed = {};
        try { parsed = JSON.parse(body || '{}'); } catch { /* keep {} */ }
        const usage = { prompt_tokens: 7, completion_tokens: 3, ...(path.startsWith('/api/') ? { cost: 0.0123 } : {}) };
        if (parsed.stream) {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          const chunk = (o) => res.write(`data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', model: 'gpt-x', ...o })}\n\n`);
          chunk({ choices: [{ index: 0, delta: { role: 'assistant', content: 'hello' }, finish_reason: null }] });
          chunk({ choices: [{ index: 0, delta: { content: ' from openai' }, finish_reason: null }] });
          chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
          chunk({ choices: [], usage });
          res.end('data: [DONE]\n\n');
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'c1', model: 'gpt-x', choices: [{ index: 0, message: { role: 'assistant', content: 'hello from openai' }, finish_reason: 'stop' }], usage }));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'nope' } }));
    });
  });
  await new Promise((r) => server.listen(port, host, r));
  const bound = server.address().port;
  return {
    url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${bound}`,
    requests,
    set(o) { Object.assign(state, o); },
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}
