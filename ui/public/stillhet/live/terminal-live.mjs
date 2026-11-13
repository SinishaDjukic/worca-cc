// ui/public/stillhet/live/terminal-live.mjs — Stillhet's client for dev's terminal sessions (D14): the TerminalPane under a
// command reads `GET /api/terminal/sessions/:id` first and attaches over dev's term-* frames only while the shell runs.
// Input goes through dev's shared line editor (src/shared/terminal-line.mjs); Stop is dev's stop route; Close detaches
// and never ends the shell. Dev's pane (ui/public/terminal-pane.mjs) is a screen and is not used.
import { createLineEditor } from '../../../../src/shared/terminal-line.mjs';
import { SHELL_CLOSED } from '../../design-system/components/terminal-pane.mjs';

const MAX_LINES = 500;
const pad = (n) => String(n).padStart(2, '0');
const clock = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
// terminal output as lines: escapes dropped, \r\n and \n split, a half line kept until its end comes
// eslint-disable-next-line no-control-regex
const ESC = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;

/** `send(msg)` writes a socket message; `frame(f)` takes every term-* frame. */
export function createTerminalLive({ fetch, send = () => {}, now = Date.now }) {
  const open = new Map();
  async function openSession(id) {
    const r = await fetch(`/api/terminal/sessions/${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' } }).catch(() => null);
    const body = r && r.ok ? await r.json().catch(() => null) : null;
    if (!body || body.session?.status !== 'running') return { closed: true, tip: SHELL_CLOSED };
    const fns = new Set(), editor = createLineEditor();
    let tail = '';
    const s = {
      closed: false, lines: [],
      onChange: (fn) => { fns.add(fn); return () => fns.delete(fn); },
      send: (text) => { if (s.closed) return; const { send: out } = editor.feed(`${text}\r`); if (out) send({ type: 'term-input', sessionId: id, data: out }); },
      stop: () => fetch(`/api/terminal/sessions/${encodeURIComponent(id)}/stop`, { method: 'POST', headers: { Accept: 'application/json' } }).then((x) => ({ ok: !!x?.ok }), () => ({ ok: false })),
      close: () => { open.delete(id); send({ type: 'term-detach', sessionId: id }); },
      write: (data) => {
        const parts = (tail + String(data).replace(ESC, '')).split(/\r?\n/);
        tail = parts.pop();
        for (const p of parts) s.lines.push({ t: clock(now()), text: p.replace(/\r/g, '') });
        if (s.lines.length > MAX_LINES) s.lines.splice(0, s.lines.length - MAX_LINES);
        for (const fn of fns) fn();
      },
      end: () => { s.closed = true; if (tail) { s.lines.push({ t: clock(now()), text: tail }); tail = ''; } for (const fn of fns) fn(); },
    };
    open.set(id, s);
    send({ type: 'term-attach', sessionId: id });
    return s;
  }
  function frame(f) {
    if (!f || typeof f.type !== 'string') return;
    if (f.type === 'term-status') { const sn = f.snapshot || {}, s = open.get(sn.id || sn.sessionId); if (s && sn.status !== 'running') s.end(); return; }
    const s = open.get(f.sessionId);
    if (s && (f.type === 'term-data' || f.type === 'term-replay') && typeof f.data === 'string') s.write(f.data);
  }
  return { openSession, frame };
}
