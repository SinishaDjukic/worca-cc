// ui/public/chat/direction.mjs — worca Chat P3 (R10): the composer's "→ <run title>" chip. When the open thread follows
// a live run (its run links, resolved through the run store), the chip shows in the composer's lead row; toggled on,
// the placeholder asks for a direction and the next send goes to the run (POST /api/ask/threads/:id/directions)
// instead of to Ask. The server keeps the direction in the thread (a user row + a notice) and broadcasts both, so
// nothing is echoed here.
import { registerComposerAddon } from './extensions.mjs';

export const DIRECTION_ADDON_ID = 'direction';
export const DIRECTION_PLACEHOLDER = 'Tell the run what to change. The next step reads it';
/** src/core/directions.mjs DIRECTION_MAX_CHARS — the browser never imports src/core; test/ui-chat-direction.test.mjs pins the two equal. */
export const DIRECTION_MAX_CHARS = 4000;
/** What a direction still reaches: the server refuses done/error/stopped (DIRECTIONS_CLOSED); a paused or
 *  interrupted run reads it when it resumes. */
const DIRECTABLE = new Set(['starting', 'running', 'pausing', 'paused', 'interrupted']);
const CLOSED = new Set(['done', 'error', 'stopped', 'failed', 'aborted', 'complete', 'completed']);

/** A thread's run links as [{runId, pipelineId}]. P1 hands add-ons `thread.runLinks` as a stable ARRAY
 *  [{runId, pipelineId, cardId, status, phase}] (never the ask-model Map); anything else reads as no links. */
export function linksOf(thread) {
  const links = thread && thread.runLinks;
  if (!Array.isArray(links)) return [];
  return links.filter((l) => l && typeof l.runId === 'string' && l.runId).map((l) => ({ runId: l.runId, pipelineId: l.pipelineId || null }));
}

/** The run the open thread follows that a direction can still reach (newest start wins), as its run-store snapshot. */
export function followedRun(thread, runStore) {
  if (!runStore || typeof runStore.get !== 'function') return null;
  let best = null;
  for (const l of linksOf(thread)) {
    const snap = (l.pipelineId && typeof runStore.byPipeline === 'function' ? runStore.byPipeline(l.pipelineId) : null) || runStore.get(l.runId) || null;
    if (!snap) continue;
    const st = String(snap.status || '');
    if (!(DIRECTABLE.has(st) || (snap.pendingQuestion && !CLOSED.has(st)))) continue;
    if (!best || String(snap.startedAt || '') > String(best.startedAt || '')) best = snap;
  }
  return best;
}

export function createDirectionAddon() {
  return {
    id: DIRECTION_ADDON_ID,
    mount(leadEl, ctx) {
      const doc = ctx.doc;
      // One wrapper, in P1's lead row (div.chat-composer-lead) ONLY while a followed run exists: the row hides
      // itself while :empty, so an idle add-on leaves no blank row in the composer.
      const wrap = doc.createElement('span');
      wrap.className = 'chat-dir';
      const chip = doc.createElement('button');
      chip.type = 'button';
      chip.className = 'chat-dir-chip';
      chip.title = 'Send to the run. The next step reads it';
      chip.setAttribute('aria-pressed', 'false');
      const arrow = doc.createElement('span');
      arrow.className = 'chat-dir-arrow';
      arrow.textContent = '→';
      arrow.setAttribute('aria-hidden', 'true');
      const label = doc.createElement('span');
      label.className = 'chat-dir-title';
      chip.append(arrow, label);
      const err = doc.createElement('span');
      err.className = 'chat-dir-err';
      err.hidden = true;
      err.setAttribute('role', 'status');
      wrap.append(chip, err);

      let on = false, run = null, lastThread = null, sending = false;
      // Direction mode is armed for ONE chat and ONE run (the pipeline, so a resume's new runId keeps it): another chat,
      // or a newer run in this chat, never inherits the switch — a direction cannot be taken back.
      let armed = null;
      const tidOf = () => (lastThread && lastThread.id) || (typeof ctx.threadId === 'function' ? ctx.threadId() : null);
      const sameTarget = (r) => !!armed && armed.tid === tidOf()
        && ((!!r.pipelineId && r.pipelineId === armed.pipelineId) || (!!r.runId && r.runId === armed.runId));
      const say = (t) => { if (typeof ctx.announce === 'function') ctx.announce(t); };
      const composer = () => (leadEl.closest ? leadEl.closest('.ask-composer') : null);
      function setOn(next) {
        const was = on;
        on = !!next && !!run;
        armed = on ? { tid: tidOf(), pipelineId: run.pipelineId || null, runId: run.runId || null } : null;
        chip.setAttribute('aria-pressed', on ? 'true' : 'false');
        chip.classList.toggle('is-on', on);
        const c = composer();
        if (c) c.classList.toggle('is-direction', on);
        if (on !== was && typeof ctx.setPlaceholder === 'function') ctx.setPlaceholder(on ? DIRECTION_PLACEHOLDER : null);
      }
      function showErr(text) {
        err.textContent = text || '';
        err.hidden = !text;
        if (text) say(text);
      }
      function paint() {
        run = followedRun(lastThread, ctx.runStore);
        if (!run) { setOn(false); showErr(''); wrap.remove(); return; }
        if (on && !sameTarget(run)) setOn(false);
        else if (on) armed = { ...armed, pipelineId: run.pipelineId || armed.pipelineId, runId: run.runId || armed.runId };
        label.textContent = run.title || 'run';
        if (wrap.parentNode !== leadEl) leadEl.appendChild(wrap);
      }
      chip.addEventListener('click', () => {
        if (sending) return;
        showErr('');
        setOn(!on);
        if (typeof ctx.focus === 'function') ctx.focus();
      });
      const unsub = ctx.runStore && typeof ctx.runStore.subscribe === 'function'
        ? ctx.runStore.subscribe((runId, type) => { if (type !== 'log') paint(); })
        : null;

      return {
        update(thread) {
          lastThread = thread || (typeof ctx.thread === 'function' ? ctx.thread() : null);
          paint();
        },
        async beforeSend(text) {
          if (!on || !run) return false;
          const body = String(text == null ? '' : text).trim();
          if (!body) return false;
          const tid = typeof ctx.threadId === 'function' ? ctx.threadId() : null;
          if (!tid) return false;
          if (body.length > DIRECTION_MAX_CHARS) { showErr(`A direction can be at most ${DIRECTION_MAX_CHARS} characters`); return 'keep'; }
          if (sending) return 'keep';
          sending = true;
          chip.disabled = true;
          const target = run;
          try {
            const res = await ctx.fetch(`/api/ask/threads/${encodeURIComponent(tid)}/directions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ runId: target.pipelineId || target.runId, text: body }),
            });
            if (res && res.ok) {
              showErr('');
              setOn(false);
              say(`Direction sent to ${target.title || 'the run'}`);
              return true;
            }
            let msg = `HTTP ${res ? res.status : 0}`;
            try { const j = await res.json(); if (j && typeof j.error === 'string' && j.error) msg = j.error; } catch { /* not JSON */ }
            showErr(`Not sent: ${msg}`);
            return 'keep';
          } catch {
            // A dropped connection: the chip's own words, never the browser's TypeError ("Failed to fetch", "Load failed").
            showErr('Not sent: network error');
            return 'keep';
          } finally {
            sending = false;
            chip.disabled = false;
          }
        },
        destroy() {
          if (unsub) unsub();
          setOn(false);
          wrap.remove();
        },
      };
    },
  };
}

/** Register the "→ run" add-on (CONTRACT §2). app.js calls this BEFORE createAskPanel. */
export function registerDirectionAddon() {
  const addon = createDirectionAddon();
  registerComposerAddon(addon);
  return addon;
}
