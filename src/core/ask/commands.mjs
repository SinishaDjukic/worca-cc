// src/core/ask/commands.mjs
// Ask agent mode (#574): the server half of run_command / read_output / wait_for / stop_command /
// list_blocks. Ask owns its terminal sessions (never a person's): a pool of at most
// ASK_LIMITS.commandsPerThread per chat, opened through the TerminalManager so every command is a
// recorded block (source 'ask', run_by 'ask:<threadId>') that shows live in the pane. A block's end
// wakes the chat (onFinish → the event turn) unless the model already saw it.
// The sessions are shared with the user: they can type in Ask's tab. A shell the user (or Ask) cd-ed elsewhere
// inside the target folder is kept, and every command is checked against the folder the shell is really in;
// a shell outside it is never used. The user's commands there never wake the chat: the next user turn lists
// them (takePersonCommands), and their typing keeps the session from closing as idle.
import { mkdirSync } from 'node:fs';
import { checkAskCommand, askCommandEnv } from './command-policy.mjs';
import { ASK_LIMITS } from './limits.mjs';
import { sameDir, insideDir } from '../terminal/same-dir.mjs';
import { redactAskText } from './redact.mjs';
import { askOutDir } from './store.mjs';

const BLOCK_ID_RE = /^(t-[0-9a-f]{10}):(\d{1,9})$/;
const codeError = (code, message) => Object.assign(new Error(message), { code });
export const askActor = (threadId) => `ask:${threadId}`;
export const blockIdOf = (sessionId, seq) => `${sessionId}:${seq}`;

/** This chat's output folder, created on first use: $WORCA_ASK_OUT in every shell the chat opens (show_files shows
 *  what Ask saves there). A command must name the variable: the policy refuses a spelled-out .worca-cc path. */
function defaultOutDir(threadId) { const d = askOutDir(threadId); mkdirSync(d, { recursive: true }); return d; }

export function parseBlockId(id) {
  const m = BLOCK_ID_RE.exec(String(id ?? '').trim());
  return m ? { sessionId: m[1], seq: Number(m[2]) } : null;
}

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const eventText = (s, n) => clip(s, n).replace(/"/g, "'").replace(/\[(\/?)worca context\]/gi, '($1worca context)');

/** `[worca event] terminal block <id> exited <code>` — the event turn's prompt (issue #574). */
export function terminalEventPrompt(b) {
  const code = b.exitCode == null ? 'unknown' : String(b.exitCode);
  const why = b.status === 'stopped'
    ? (b.stoppedBy === 'ask:cap' ? '; stopped at the 30-minute cap' : `; stopped by ${String(b.stoppedBy || '').startsWith('ask:') ? 'Ask' : 'the user'}`)
    : b.status === 'interrupted' ? '; Worca restarted while it ran' : '';
  return `[worca event] terminal block ${blockIdOf(b.sessionId, b.seq)} exited ${code}${why}; "${eventText(b.command, 200)}"`;
}
export function terminalNoticeText(b) {
  const code = b.exitCode == null ? '' : ` (exit ${b.exitCode})`;
  return `${b.status === 'stopped' ? 'Command stopped' : 'Command finished'}${code} — ${clip(b.command, 80)}`;
}

// One token of terminal output: an OSC, a CSI (params, final byte), another escape, a CR, or one character.
const TERM_TOKEN_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[([0-9;?]*)[ -/]*([@-~])|\x1b[@-Z\\-_]|\r|[\s\S]/gu;

/**
 * A block's output as the text a terminal would show, without ANSI: per line, a carriage return moves back and
 * overwrites, erase-in-line (CSI K) and cursor-to-column (CSI G) apply, trailing blanks go. Without this a
 * spinner (`\` then CSI 1G, CSI 0K) and zsh's partial-line mark (`%`, padding, CR) show up in the card.
 */
export function plainOutput(s) {
  return String(s ?? '').replace(/\r\n/g, '\n').split('\n').map((line) => {
    if (!/[\r\x1b]/.test(line)) return line;
    let buf = [];
    let col = 0;
    for (const m of line.matchAll(TERM_TOKEN_RE)) {
      const t = m[0];
      if (t === '\r') { col = 0; continue; }
      if (m[2] === 'K') {
        if (m[1] === '2') buf = buf.map(() => ' ');
        else if (m[1] === '1') for (let i = 0; i <= col && i < buf.length; i += 1) buf[i] = ' ';
        else buf.length = Math.min(buf.length, col);
        continue;
      }
      if (m[2] === 'G') { col = Math.max(0, (Number(m[1]) || 1) - 1); continue; }
      if (t[0] === '\x1b') continue;
      while (buf.length < col) buf.push(' ');
      buf[col] = t;
      col += 1;
    }
    return buf.join('').trimEnd();
  }).join('\n');
}

/** Card-facing view of a block: state + redacted, ANSI-free tail. */
export function commandView(rec, out, { tailChars = ASK_LIMITS.commandCardTailChars } = {}) {
  const text = redactAskText(plainOutput(out));
  return { blockId: blockIdOf(rec.sessionId, rec.seq), sessionId: rec.sessionId, seq: rec.seq, command: redactAskText(rec.command),
    status: rec.status, exitCode: rec.exitCode ?? null, startedAt: rec.startedAt ?? null, endedAt: rec.endedAt ?? null,
    durationMs: rec.durationMs ?? null, stoppedBy: rec.stoppedBy ?? null, runBy: rec.runBy ?? null,
    tail: text.length > tailChars ? text.slice(-tailChars) : text, truncated: text.length > tailChars || !!rec.truncated };
}

/** run_command's optional summary (#911): one trimmed line, clipped to `max`; anything else is null. */
export function cleanCommandSummary(s, max = ASK_LIMITS.commandSummaryMaxChars) {
  if (typeof s !== 'string') return null;
  const line = s.replace(/\s+/g, ' ').trim();
  return line ? line.slice(0, max) : null;
}

/**
 * @param {object} o
 * @param {import('../terminal/manager.mjs').TerminalManager} o.terminals
 * @param {{getBlock:Function, listRecentBlocks:Function}} o.store   src/core/terminal/store.mjs
 * @param {(threadId:string, input:object) => Promise<object>} o.resolveTarget   {cwd, scope, label, runId, member, projectKey, branch, workspace, runLive, warning, actionSnaps}
 * @param {(threadId:string, block:object) => void} o.onFinish   always called when an Ask block ends; the server
 *        skips the event turn at start time when seen(blockId) is true
 * @param {(threadId:string, view:object) => void} [o.onUpdate]   the ask-command frame
 * @param {(threadId:string, target:object) => void} [o.onOpen]   once per new Ask session (the run audit line)
 * @param {(threadId:string) => string} [o.threadTitle]
 * @param {number|(() => number|null)|null} [o.serverPort]   a function: the port is known only once the server listens
 * @param {string|(() => string|null)|null} [o.home]   the worca home (protected in commands); a function is read at use
 * @param {string|null} [o.userHome]   what `~` expands to in Ask's shells (default: baseEnv.HOME, else USERPROFILE on Windows), for the home-only paths
 */
export function createAskCommands({ terminals, store, resolveTarget, onFinish, onUpdate = () => {}, onOpen = () => {}, threadTitle = () => '',
  hostPid = process.pid, serverPort = null, home = null, baseEnv = process.env, userHome = baseEnv.HOME || baseEnv.USERPROFILE || null, limits = ASK_LIMITS,
  setTimer = (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; }, clearTimer = clearTimeout, outDirFor = defaultOutDir } = {}) {
  const pools = new Map();     // threadId → Set<sessionId>
  const owner = new Map();     // sessionId → threadId
  const active = new Map();    // blockId → { threadId, capTimer }
  const seenEnd = new Set();   // blockIds whose end a tool already returned to the model (pruned at SEEN_KEEP)
  const idleTimers = new Map();// sessionId → timer
  const lastPush = new Map();  // blockId → ms (tail frames, throttled)
  const trailing = new Map();  // blockId → timer (the last frame of a burst)
  const roots = new Map();     // sessionId → the target folder it opened in (the boundary its shell must stay in)
  const touched = new Map();   // sessionId → ms of the user's last keystroke or command there
  const personRuns = new Map();// threadId → [{sessionId, seq}] the user's commands since the last takePersonCommands
  const SEEN_KEEP = 500;
  const PERSON_KEEP = 20;

  const threadOfRunBy = (runBy) => (typeof runBy === 'string' && runBy.startsWith('ask:') && runBy !== 'ask:cap' ? runBy.slice(4) : null);
  const runningCount = (threadId) => [...active.values()].filter((a) => a.threadId === threadId).length;
  const portNow = () => (typeof serverPort === 'function' ? serverPort() : serverPort);
  const homeNow = () => (typeof home === 'function' ? home() : home);
  const markSeen = (id) => { seenEnd.add(id); if (seenEnd.size > SEEN_KEEP) seenEnd.delete(seenEnd.values().next().value); };

  // The user in an Ask session: their activity resets its idle close, and their commands wait for the next user turn.
  const personActive = (sessionId) => { touched.set(sessionId, Date.now()); scheduleIdleClose(sessionId); };
  terminals.on('input', ({ sessionId }) => { if (owner.has(sessionId)) personActive(sessionId); });

  terminals.on('block', (rec) => {
    if (rec.source !== 'ask') {
      const threadId = owner.get(rec.sessionId);
      if (!threadId) return;
      if (rec.status === 'running') {
        const list = personRuns.get(threadId) || [];
        list.push({ sessionId: rec.sessionId, seq: rec.seq });
        if (list.length > PERSON_KEEP) list.shift();
        personRuns.set(threadId, list);
      }
      personActive(rec.sessionId);
      return;
    }
    const threadId = threadOfRunBy(rec.runBy);
    if (!threadId) return;
    const id = blockIdOf(rec.sessionId, rec.seq);
    if (rec.status === 'running') {
      // The slot and the cap timer are taken HERE, not after runCommand resolves: the manager handles every mark
      // of one data chunk synchronously (`_onData` loops `_onMark`, manager.mjs:198), so a fast command's start AND
      // end can both be emitted before run()'s await continues. Registering in run() would then leak a never-ending
      // "active" entry (the chat locks at TOO_MANY) and a cap timer that interrupts a later command in that session.
      const { sessionId: sid, seq } = rec;
      active.set(id, { threadId, capTimer: setTimer(() => {
        const lb = terminals.liveBlock(sid);
        if (lb && lb.seq === seq) terminals.interrupt(sid, 'ask:cap');      // only the block this timer belongs to
      }, limits.commandMaxMs) });
      onUpdate(threadId, commandView(rec, ''));
      return;
    }
    const a = active.get(id);
    if (a) { clearTimer(a.capTimer); active.delete(id); }
    lastPush.delete(id);
    clearTimer(trailing.get(id)); trailing.delete(id);
    // The manager's block event never carries output: the finished block's output is in the store.
    onUpdate(threadId, commandView(rec, store.getBlock(rec.sessionId, rec.seq)?.output ?? ''));
    scheduleIdleClose(rec.sessionId);
    try { onFinish(threadId, rec); } catch { /* a failed wake never breaks the terminal */ }
  });

  // Live tail for the card: at most one frame per block per 500 ms, plus a trailing frame so the last output of a
  // burst (a dev server's "ready" line, then silence) reaches the card.
  const pushLive = (sessionId, threadId) => {
    const lb = terminals.liveBlock(sessionId);
    if (!lb) return;
    lastPush.set(blockIdOf(sessionId, lb.seq), Date.now());
    onUpdate(threadId, commandView({ ...lb, status: 'running' }, lb.out));
  };
  terminals.on('data', ({ sessionId }) => {
    const threadId = owner.get(sessionId);
    const lb = threadId ? terminals.liveBlock(sessionId) : null;
    if (!lb || lb.source !== 'ask') return;                 // the user's own command in Ask's tab has no card
    const id = blockIdOf(sessionId, lb.seq);
    if (Date.now() - (lastPush.get(id) || 0) >= 500) { pushLive(sessionId, threadId); return; }
    if (!trailing.has(id)) trailing.set(id, setTimer(() => { trailing.delete(id); pushLive(sessionId, threadId); }, 500));
  });

  function scheduleIdleClose(sessionId) {
    clearTimer(idleTimers.get(sessionId));
    idleTimers.set(sessionId, setTimer(() => {
      idleTimers.delete(sessionId);
      if (terminals.free(sessionId)) terminals.close(sessionId, `ask:${owner.get(sessionId) || ''}`, 'Ask: idle').catch(() => {});
    }, limits.commandSessionIdleMs));
  }

  const forget = (sid) => { owner.delete(sid); roots.delete(sid); touched.delete(sid); clearTimer(idleTimers.get(sid)); idleTimers.delete(sid); };

  async function drop(threadId, sid, reason) {
    pools.get(threadId)?.delete(sid); forget(sid);
    await terminals.close(sid, askActor(threadId), reason).catch(() => {});
  }

  function poolOf(threadId) {
    const pool = pools.get(threadId) || new Set();
    pools.set(threadId, pool);
    for (const sid of [...pool]) if (!terminals.get(sid) || terminals.get(sid).status !== 'running') { pool.delete(sid); forget(sid); }
    return pool;
  }

  /** A free session of this target whose shell is still inside the target folder, with the folder it is in now
   *  (read once: the command check and runCommand's guard must agree on it). The tab the user used last first:
   *  "continue" after they cd-ed or activated a venv there means there. */
  function pick(threadId, target) {
    const fits = [];
    for (const sid of poolOf(threadId)) {
      if (!terminals.free(sid) || !sameDir(roots.get(sid), target.cwd)) continue;
      const cwd = terminals.cwdOf(sid);
      if (insideDir(cwd, target.cwd)) fits.push({ sid, cwd });
    }
    return fits.sort((a, z) => (touched.get(z.sid) || 0) - (touched.get(a.sid) || 0))[0] || null;
  }

  async function openFor(threadId, target) {
    const pool = poolOf(threadId);
    if (pool.size >= limits.commandsPerThread) {
      // Recycle a free slot the user has not touched lately (Ask's own shell for another folder); never one they work in.
      const quiet = [...pool].find((sid) => terminals.free(sid) && Date.now() - (touched.get(sid) || 0) >= limits.commandSessionIdleMs);
      if (!quiet) {
        throw codeError('NO_SLOT', `All ${limits.commandsPerThread} of this chat's terminals are in use: the user is running something in them or moved them out of ${target.label}. Ask the user to free one (or cd back into the folder), then try again.`);
      }
      await drop(threadId, quiet, 'Ask: another folder');
    }
    const title = clip(threadTitle(threadId) || 'chat', 40);
    const s = await terminals.open({ cwd: target.cwd, scope: target.scope, label: `Ask · ${title} · ${target.label}`,
      runId: target.runId ?? null, member: target.member ?? null, projectKey: target.projectKey ?? null, branch: target.branch ?? null,
      workspace: !!target.workspace, runLive: !!target.runLive, actionSnaps: target.actionSnaps || [],
      by: askActor(threadId), agent: true, baseEnv: { ...askCommandEnv(baseEnv), WORCA_ASK_OUT: outDirFor(threadId) } });
    pool.add(s.id); owner.set(s.id, threadId); roots.set(s.id, target.cwd);
    try { onOpen(threadId, target); } catch { /* audit only */ }
    return s.id;
  }

  /** Any recorded block (shared blocks): only the id's shape is checked here; stop() checks ownership. */
  function refOf(blockId, tool) {
    const ref = parseBlockId(blockId);
    if (!ref) throw codeError('BAD_BLOCK', `${tool}: blockId must look like t-0123456789:4 (from run_command or list_blocks)`);
    return ref;
  }

  function blockState(ref) {
    const lb = terminals.liveBlock(ref.sessionId);
    if (lb && lb.seq === ref.seq) return { rec: { ...lb, status: 'running' }, out: lb.out };
    const rec = store.getBlock(ref.sessionId, ref.seq);
    return rec ? { rec, out: rec.output ?? '' } : null;
  }

  return {
    seen: (blockId) => seenEnd.has(blockId),
    /** #948 s2: how many Ask-run commands of this chat are running now (the archive busy check). */
    running: (threadId) => runningCount(threadId),

    async run(threadId, input = {}) {
      if (runningCount(threadId) >= limits.commandsPerThread) {
        throw codeError('TOO_MANY', `${limits.commandsPerThread} commands are already running in this chat — wait for one (wait_for) or stop one (stop_command).`);
      }
      const target = await resolveTarget(threadId, input);
      const line = String(input.command).trim();
      // One more pick when the shell changed under the first one: a `cd` whose W mark landed after the pick (MOVED), or
      // the user starting a command in that tab (BUSY).
      for (let attempt = 0; ; attempt += 1) {
        const picked = pick(threadId, target);
        const cwd = picked ? picked.cwd : target.cwd;            // a fresh shell starts in the target folder
        const why = checkAskCommand(input.command, { cwd, home: homeNow(), userHome, hostPid, serverPort: portNow() });
        if (why) throw codeError('BLOCKED', why);
        const sid = picked ? picked.sid : await openFor(threadId, target);
        clearTimer(idleTimers.get(sid)); idleTimers.delete(sid);
        let seq;
        try { ({ seq } = await terminals.runCommand(sid, line, { by: askActor(threadId), source: 'ask', cwd })); }
        catch (e) {
          if (owner.has(sid)) scheduleIdleClose(sid);            // NOT_STARTED / BUSY: still closes when idle
          if (attempt === 0 && (e?.code === 'MOVED' || e?.code === 'BUSY')) continue;
          throw e;
        }
        const blockId = blockIdOf(sid, seq);       // the slot + cap timer were taken by the block 'running' handler
        return { ok: true, blockId, sessionId: sid, seq, command: line, cwd, folder: target.label, warning: target.warning || null,
          summary: cleanCommandSummary(input.summary, limits.commandSummaryMaxChars) };
      }
    },

    /** The user's commands in this chat's Ask sessions since the last call (the next user turn's context line):
     *  the current state of each, command redacted. Clears the list. */
    takePersonCommands(threadId) {
      const refs = personRuns.get(threadId) || [];
      personRuns.delete(threadId);
      return refs.map((ref) => {
        const st = blockState(ref);
        return st && { blockId: blockIdOf(ref.sessionId, ref.seq), command: redactAskText(st.rec.command), status: st.rec.status,
          exitCode: st.rec.exitCode ?? null };
      }).filter(Boolean);
    },

    async read(threadId, { blockId, offset = 0, maxChars = limits.commandOutputPageChars } = {}) {
      const ref = refOf(blockId, 'read_output');
      const st = blockState(ref);
      if (!st) throw codeError('NOT_FOUND', 'read_output: no such block');
      const text = plainOutput(st.out);
      const start = Math.max(0, Math.min(Number(offset) || 0, text.length));
      const page = text.slice(start, start + Math.max(1, Math.min(maxChars, limits.commandOutputPageChars)));
      if (st.rec.status !== 'running') markSeen(blockIdOf(ref.sessionId, ref.seq));
      return { blockId: blockIdOf(ref.sessionId, ref.seq), command: redactAskText(st.rec.command), status: st.rec.status, exitCode: st.rec.exitCode ?? null,
        text: page, offset: start, nextOffset: start + page.length < text.length ? start + page.length : null, totalChars: text.length,
        truncatedAtStart: !!st.rec.truncated, runBy: st.rec.runBy ?? null };
    },

    async wait(threadId, { blockId, match = null, timeoutSec = limits.commandWaitDefaultSec, pollMs = 250, signal = null } = {}) {
      const ref = refOf(blockId, 'wait_for');
      const id = blockIdOf(ref.sessionId, ref.seq);
      const deadline = Date.now() + Math.min(Math.max(Number(timeoutSec) || 0, 0), limits.commandWaitMaxSec) * 1000;
      for (;;) {
        const st = blockState(ref);
        if (!st) throw codeError('NOT_FOUND', 'wait_for: no such block');
        const text = plainOutput(st.out);
        const tail = text.slice(-2000);
        if (st.rec.status !== 'running') {
          markSeen(id);
          return { blockId: id, status: st.rec.status, exitCode: st.rec.exitCode ?? null, matched: match ? text.includes(match) : null, timedOut: false, tail };
        }
        if (match && text.includes(match)) return { blockId: id, status: 'running', exitCode: null, matched: true, timedOut: false, tail };
        if (Date.now() >= deadline || signal?.aborted) return { blockId: id, status: 'running', exitCode: null, matched: match ? false : null, timedOut: true, tail };
        await new Promise((r) => setTimeout(r, pollMs));
      }
    },

    stop(threadId, { blockId } = {}) {
      const ref = refOf(blockId, 'stop_command');
      const lb = terminals.liveBlock(ref.sessionId);
      if (!lb || lb.seq !== ref.seq) return { ok: true, alreadyEnded: true };
      if (owner.get(ref.sessionId) !== threadId || lb.source !== 'ask') throw codeError('NOT_OWNER', 'stop_command: Ask stops only its own commands; ask the user to stop this one.');
      terminals.interrupt(ref.sessionId, askActor(threadId));
      return { ok: true, stopping: true };
    },

    list(threadId, { runId = null, projectKey = null, limit = 20 } = {}) {
      const rows = store.listRecentBlocks({ runId, projectKey, limit: Math.min(Math.max(Number(limit) || 20, 1), 50) });
      return { blocks: rows.map((b) => ({ blockId: blockIdOf(b.sessionId, b.seq), command: redactAskText(b.command), status: b.status,
        exitCode: b.exitCode ?? null, startedAt: b.startedAt, durationMs: b.durationMs ?? null, cwd: b.cwd ?? null,
        runId: b.runId ?? null, by: b.source === 'ask' ? 'ask' : 'person', mine: threadOfRunBy(b.runBy) === threadId })) };
    },

    /** For the card's hydration after a reload. */
    view(blockId) {
      const ref = parseBlockId(blockId);
      const st = ref && blockState(ref);
      return st ? commandView({ ...st.rec, sessionId: ref.sessionId, seq: ref.seq }, st.out) : null;
    },

    async closeThread(threadId) {
      const pool = pools.get(threadId);
      pools.delete(threadId);
      personRuns.delete(threadId);
      for (const [id, a] of active) if (a.threadId === threadId) { clearTimer(a.capTimer); active.delete(id); }
      await Promise.allSettled([...(pool || [])].map((sid) => { forget(sid); return terminals.close(sid, askActor(threadId), 'Ask: chat deleted'); }));
    },

    /** Server shutdown / tests: drop every timer. */
    dispose() {
      for (const a of active.values()) clearTimer(a.capTimer);
      for (const t of idleTimers.values()) clearTimer(t);
      for (const t of trailing.values()) clearTimer(t);
      active.clear(); idleTimers.clear(); trailing.clear();
    },
  };
}
