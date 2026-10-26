// test/helpers/engine-upstream.mjs
// A loopback stand-in for every vendor API an engine's model calls reach (moved from test/exec-env-engine-relay.test.mjs
// startUpstream): Anthropic Messages (Claude Code), OpenAI Responses (codex), the Copilot API's three wires (copilot,
// with its account lookup) and api2.cursor.sh (the key exchange and RunSSE). Each answers its streaming shape with
// usage, checks the credential worca (or the broker) must have added, records every call in `calls`, and echoes a
// secret inside its reply so a test can prove the scrub. The relay's routes reach it under /v1, /copilot and /cursor
// (`relayUpstreams`); a broker slot's upstream is cut to the origin, so the un-prefixed paths answer too.
import http from 'node:http';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
export const CODEX_KEY = 'sk-codex-server-0123456789abcdef';
export const PAT = `github_pat_${'R2d2'.repeat(10)}`;
export const CURSOR_KEY = 'crsr-server-key-0123456789abcdef';
export const ANTHROPIC_KEY = 'sk-ant-api03-upstream-0123456789abcdef';
export const ACCESS = `${b64({ alg: 'HS256' })}.${b64({ sub: 'user', exp: Math.floor(Date.now() / 1000) + 3600 })}.c2ln`;
export const REFRESH = `${b64({ alg: 'HS256' })}.${b64({ sub: 'user', typ: 'refresh' })}.cmVm`;
export const ALL_SECRETS = Object.freeze([CODEX_KEY, PAT, CURSOR_KEY, ACCESS, REFRESH, ANTHROPIC_KEY]);

const sse = (events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
export const envelope = (flag, b) => { const h = Buffer.alloc(5); h[0] = flag; h.writeUInt32BE(b.length, 1); return Buffer.concat([h, b]); };
const varint = (n) => { const o = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; o.push(b); } while (n); return Buffer.from(o); };
export const pbLen = (no, b) => Buffer.concat([Buffer.from([(no << 3) | 2]), varint(b.length), b]);
export const pbInt = (no, n) => Buffer.concat([Buffer.from([(no << 3) | 0]), varint(n)]);

/**
 * @param {{usage?:{input_tokens:number, output_tokens:number}|null, cut?:boolean}} [o]
 *   usage: the token counts every reply reports instead of each API's defaults (codex 120 with 20 cached / 7, copilot
 *   30/4, 40/5, 50/6, cursor 60/8/5, Claude 1000/500); cut: write the first usage-bearing event, then drop the socket.
 * @returns {Promise<{url:string, calls:object[], keys:object, serverEnv:object, relayUpstreams:object, close:()=>Promise<void>}>}
 */
export async function startEngineUpstream({ usage = null, cut = false } = {}) {
  const calls = [];
  const u = (input, output) => (usage ? { input: usage.input_tokens, output: usage.output_tokens } : { input, output });
  const srv = http.createServer((req, res) => {
    const parts = []; req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      const body = Buffer.concat(parts).toString('utf8');
      calls.push({ method: req.method, url: req.url, headers: req.headers, body });
      const auth = req.headers.authorization || '';
      const deny = (...want) => {
        if (want.some((w) => auth === `Bearer ${w}` || req.headers['x-api-key'] === w)) return false;
        res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":"bad key"}'); return true;
      };
      /** Write `chunks` (the first carries the usage), or cut the socket after the first. */
      const stream = (type, chunks) => {
        res.writeHead(200, { 'content-type': type });
        if (cut) { res.write(chunks[0]); setTimeout(() => res.socket.destroy(), 20); return; }
        res.end(Buffer.concat(chunks.map((c) => Buffer.from(c))));
      };
      const path = req.url.replace(/^\/(copilot|cursor)(?=\/)/, '');
      const via = req.url.startsWith('/copilot/') ? 'copilot' : req.url.startsWith('/cursor/') ? 'cursor' : null;
      if (path === '/copilot_internal/user') {
        if (deny(PAT)) return;
        res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"login":"ada"}');
      }
      if (path === '/v1/responses' || (via === 'copilot' && path === '/responses') || (!via && path === '/responses')) {
        if (deny(CODEX_KEY, PAT)) return;
        if (auth === `Bearer ${PAT}`) {
          const n = u(40, 5);
          return stream('text/event-stream', [sse([{ type: 'response.completed', response: { model: 'gpt-5-mini', usage: { input_tokens: n.input, output_tokens: n.output } } }])]);
        }
        const n = usage ? { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens } : { input_tokens: 120, input_tokens_details: { cached_tokens: 20 }, output_tokens: 7 };
        return stream('text/event-stream', [sse([{ type: 'response.completed', response: { model: 'gpt-5.5', usage: n } }]),
          sse([{ type: 'response.output_text.delta', delta: `echo ${CODEX_KEY}` }])]);
      }
      if (path === '/v1/messages') {
        if (via === 'copilot' || auth === `Bearer ${PAT}`) {
          if (deny(PAT)) return;
          const n = u(30, 4);
          return stream('text/event-stream', [sse([{ type: 'message_start', message: { model: 'claude-sonnet-4.5', usage: { input_tokens: n.input, output_tokens: 1 } } }]),
            sse([{ type: 'content_block_delta', delta: { type: 'text_delta', text: `echo ${PAT}` } }, { type: 'message_delta', usage: { output_tokens: n.output } }, { type: 'message_stop' }])]);
        }
        if (deny(ANTHROPIC_KEY)) return;
        const n = u(1000, 500);
        return stream('text/event-stream', [sse([{ type: 'message_start', message: { id: 'm1', type: 'message', model: 'claude-sonnet-5', usage: { input_tokens: n.input, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }]),
          sse([{ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: n.output } }, { type: 'message_stop' }])]);
      }
      if (path === '/chat/completions') {
        if (deny(PAT)) return;
        const n = u(50, 6);
        return stream('text/event-stream', [`${sse([{ model: 'gpt-4.1', choices: [], usage: { prompt_tokens: n.input, completion_tokens: n.output } }])}`,
          `${sse([{ model: 'gpt-4.1', choices: [{ delta: { content: 'hi' } }] }])}data: [DONE]\n\n`]);
      }
      if (path === '/auth/exchange_user_api_key') {
        if (deny(CURSOR_KEY)) return;
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ accessToken: ACCESS, refreshToken: REFRESH }));
      }
      if (/^\/(aiserver\.v1\.|agent\.v1\.)/.test(path)) {
        if (deny(ACCESS)) return;
        if (path === '/agent.v1.AgentService/RunSSE') {
          const n = usage ? [usage.input_tokens, usage.output_tokens, 0] : [60, 8, 5];
          const text = pbLen(1, pbLen(1, pbLen(1, Buffer.from(`echo ${REFRESH}`))));
          const ended = pbLen(1, pbLen(14, Buffer.concat([pbInt(1, n[0]), pbInt(2, n[1]), pbInt(3, n[2])])));
          return stream('application/connect+proto', [envelope(0, ended), Buffer.concat([envelope(0, text), envelope(2, Buffer.from('{}'))])]);
        }
        res.writeHead(200, { 'content-type': 'application/proto', 'content-length': 0 });
        return res.end();
      }
      res.writeHead(404); res.end();
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  return {
    url, calls,
    keys: { CODEX_KEY, PAT, CURSOR_KEY, ACCESS, REFRESH, ANTHROPIC_KEY },
    serverEnv: { CODEX_API_KEY: CODEX_KEY, COPILOT_GITHUB_TOKEN: PAT, CURSOR_API_KEY: CURSOR_KEY },
    relayUpstreams: { openai: `${url}/v1`, copilotApi: `${url}/copilot`, cursor: `${url}/cursor` },
    close: () => new Promise((r) => { srv.closeAllConnections(); srv.close(() => r()); }),
  };
}
