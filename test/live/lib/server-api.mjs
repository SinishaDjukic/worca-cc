// test/live/lib/server-api.mjs
// Helpers for scenarios that drive worca through its UI server (Ask Worca, model
// tests, PR description, run overview, the agent generator).
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { waitFor } from './sandbox.mjs';

/** Start the real (non-mock) server with the calc fixture registered. */
export async function serverWithProject(t, name = 'calc') {
  const proj = t.sb.addProject(name);
  const srv = await t.sb.server();
  const r = await srv.api('POST', '/api/projects', { name, path: proj });
  if (r.status !== 200) throw new Error(`POST /api/projects: ${r.status} ${r.text.slice(0, 300)}`);
  const key = r.json.projects.find((p) => p.path === proj || p.name === name)?.key;
  return { srv, proj, key };
}

/** An effort the model accepts (haiku-4-5 has no `low`). */
export function effortFor(model) {
  return 'medium';
}

/**
 * One Ask turn: POST the message, wait until the thread is idle and the
 * assistant reply has settled. Returns {post, thread, msg} (msg = the reply).
 */
export async function askTurn(srv, threadId, text, { model, effort = effortFor(model), context, timeoutMs = 600000, extra = {} } = {}) {
  const post = await srv.api('POST', `/api/ask/threads/${threadId}/messages`, { text, model, effort, ...(context ? { context } : {}), ...extra });
  if (post.status !== 202) return { post, thread: null, msg: null };
  const id = post.json.assistantMessageId;
  const thread = await waitFor(async () => {
    const g = await srv.api('GET', `/api/ask/threads/${threadId}`);
    if (!g.json || g.json.inFlight) return null;
    const m = g.json.messages.find((x) => x.id === id);
    return m && m.status && m.status !== 'streaming' && m.status !== 'pending' && m.status !== 'running' ? g.json : null;
  }, { timeoutMs, everyMs: 1500 });
  return { post, thread, msg: thread ? thread.messages.find((x) => x.id === id) : null };
}

export async function newThread(srv) {
  const r = await srv.api('POST', '/api/ask/threads', {});
  if (r.status !== 201) throw new Error(`POST /api/ask/threads: ${r.status} ${r.text.slice(0, 200)}`);
  return r.json.thread.id;
}

/** Wait for the chat title the background kickoff writes (null if it never comes). */
export async function waitTitle(srv, threadId, timeoutMs = 90000) {
  return waitFor(async () => {
    const g = await srv.api('GET', `/api/ask/threads/${threadId}`);
    return g.json?.thread?.title || null;
  }, { timeoutMs, everyMs: 1500 });
}

/**
 * Collect WebSocket frames (the server's /ws) until `done(frame)` is true or the
 * time runs out. `query` e.g. {genId}. Uses the checkout's own `ws` package.
 */
export async function wsCollect(t, srv, query, done, timeoutMs = 600000) {
  const require = createRequire(join(t.repo, 'package.json'));
  const WebSocket = require('ws');
  const qs = new URLSearchParams(query).toString();
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws?${qs}`, { headers: { origin: srv.url } });
  const frames = [];
  return new Promise((res) => {
    const finish = () => { clearTimeout(timer); try { ws.close(); } catch { /* closing */ } res(frames); };
    const timer = setTimeout(finish, timeoutMs);
    ws.on('message', (d) => {
      let f; try { f = JSON.parse(String(d)); } catch { return; }
      frames.push(f);
      if (done(f)) finish();
    });
    ws.on('error', (e) => { frames.push({ type: 'ws-error', message: String(e.message || e) }); finish(); });
  });
}

/** Ask-turn taps (the chat's own claude, not the title helper or a nested classifier). */
export const isAskTurnTap = (tp) => tp.args.includes('--disable-slash-commands') && /You are Ask Worca/.test(tp.site);
export const flagOf = (tp, f) => { const i = tp.args.indexOf(f); return i >= 0 ? tp.args[i + 1] : null; };
export const GPT_RE = /\bgpt-[0-9][\w.-]*/g;

/** Wait until every harness spawn the tap saw has exited (a background helper such as the chat-title
 *  kickoff can outlive the reply; stopping the server under it would cut it off mid-stream). */
export async function waitSpawnsIdle(t, timeoutMs = 120000) {
  return waitFor(() => t.sb.taps().every((r) => r.endedAt), { timeoutMs, everyMs: 1000 });
}
