// ui/public/away-screensaver.mjs — an easter egg: the Worca wordmark drifts across the window like an old
// screensaver, over a faint network, with one line that says how your runs and chats are doing.
//
// It shows only while ALL of these hold, and nothing else turns it on:
//   - Away mode is on now (the account corner's away badge),
//   - the Keep awake setting is on,
//   - the Worca window is the active one (visible and focused),
//   - no mouse or key input in that window for IDLE_MS.
// Any input hides it again, and that input does not reach the page. There is no Labs flag: AWAY_SCREENSAVER is the
// one switch, in code. app.js owns the state and hands it over through getState (like activity-menu.mjs).
import { RUN_STATES } from '../../src/shared/run-model.mjs';
import { CHAT_STATES } from './chats-list.mjs';
import { renderStatusDot } from './status-dot.mjs';
import { askCardsIn } from './alerts.mjs';

/** The easter egg's on/off switch. On by design; set to false to turn it off. */
export const AWAY_SCREENSAVER = true;
export const IDLE_MS = 10 * 60 * 1000;

const INPUTS = ['pointermove', 'pointerdown', 'mousedown', 'click', 'keydown', 'wheel', 'touchstart'];
const SPEED = 60;          // px per second, each axis
const TYPE_MS = 28;        // per character of the headline
const NODES = 28;
const LINK_PX = 130;

/** True when the screensaver should be on screen. */
export function shouldShow({ enabled = AWAY_SCREENSAVER, away, keepAwake, focused, idleMs }) {
  return !!(enabled && away && keepAwake && focused && idleMs >= IDLE_MS);
}

const plural = (n, one, many) => (n === 1 ? one : many);

/** What the screensaver says, from plain counts. The most pressing state wins: a question (a run's or a chat
 *  proposal), then a failed run, then a new chat reply, then work in progress, then finished work.
 *  Input: { running, questions, askTitle, paused, failed, done, chatsReplying, chatProposals, chatUnread }.
 *  Returns { scene, headline, bubble, items: [{ model, text }] }. */
export function pickScene(s = {}) {
  const n = (k) => (Number.isFinite(s[k]) && s[k] > 0 ? s[k] : 0);
  const running = n('running'), questions = n('questions'), paused = n('paused'), failed = n('failed'), done = n('done');
  const replying = n('chatsReplying'), proposals = n('chatProposals'), unread = s.chatUnread ? 1 : 0;
  const items = [];
  if (running) items.push({ model: RUN_STATES.working, text: `${running} running` });
  if (questions) items.push({ model: RUN_STATES['needs-you'], text: `${questions} ${plural(questions, 'has a question', 'have questions')}` });
  if (proposals) items.push({ model: RUN_STATES['needs-you'], text: `${proposals} chat ${plural(proposals, 'proposal', 'proposals')} to review` });
  if (failed) items.push({ model: RUN_STATES.failed, text: `${failed} ${plural(failed, 'needs', 'need')} a look` });
  if (paused) items.push({ model: RUN_STATES.paused, text: `${paused} paused` });
  if (replying) items.push({ model: CHAT_STATES.replying, text: `${replying} ${plural(replying, 'chat', 'chats')} replying` });
  if (unread) items.push({ model: { ...CHAT_STATES.idle, word: 'New reply' }, text: 'New chat reply' });
  if (done) items.push({ model: RUN_STATES.ready, text: `${done} done` });

  if (questions || proposals) {
    const what = questions ? (s.askTitle ? `“${s.askTitle}” has a question` : 'a run has a question') : 'a chat has a proposal for you';
    return { scene: 'ask', headline: 'We could use you for a moment.', bubble: `When you have a moment, ${what}`, items };
  }
  if (failed) {
    const headline = failed === 1 ? 'One run would like a look, no rush.' : `${failed} runs would like a look, no rush.`;
    return { scene: 'look', headline, bubble: '', items };
  }
  if (unread) return { scene: 'reply', headline: 'Worca replied in a chat, whenever you are ready.', bubble: '', items };
  if (running || replying || paused) return { scene: 'busy', headline: 'Everything is under control.', bubble: '', items };
  if (done) return { scene: 'done', headline: 'All done. Nothing needs you right now.', bubble: '', items };
  return { scene: 'quiet', headline: 'All quiet. Enjoy the break.', bubble: '', items };
}

/** Chat turns and proposals, from the Ask frames app.js already receives (alerts.mjs reads the same cards). */
export function createChatTracker() {
  const replying = new Set();
  const proposals = new Set();
  return {
    onFrame(msg) {
      if (!msg || typeof msg.threadId !== 'string') return;
      if (msg.type === 'ask-start') replying.add(msg.threadId);
      if (msg.type === 'ask-done' || msg.type === 'ask-error') replying.delete(msg.threadId);
      for (const { threadId, block } of askCardsIn(msg)) {
        const key = `${threadId}:${block.id}`;
        if (block.state === 'proposed') proposals.add(key);
        else if (block.state !== 'building') proposals.delete(key);
      }
    },
    counts() { return { chatsReplying: replying.size, chatProposals: proposals.size }; },
  };
}

/** getState() → { away, keepAwake, runs: { running, questions, askTitle, paused, failed, done }, chatUnread }.
 *  app.js calls tick() from its 1 s timer and onAskFrame() for every Ask frame. */
export function createAwayScreensaver({ doc, win, getState, now = () => Date.now() }) {
  const chats = createChatTracker();
  const reduced = () => !!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let lastInput = now();
  let root = null, raf = 0, typer = 0, shown = '';
  let pos = null, net = [], lastFrame = 0, lastSpark = 0;
  let eatUntil = 0;   // the rest of the click that woke the window (mousedown, click) after the overlay is gone

  const onInput = (ev) => {
    lastInput = now();
    const eat = ev.type !== 'pointermove' && (root || (ev.type !== 'keydown' && now() < eatUntil));
    // The input that wakes the window only wakes it: it does not type, click or scroll the page under it.
    if (eat) { ev.preventDefault(); ev.stopPropagation(); }
    if (!root) return;
    if (ev.type !== 'pointermove' && ev.type !== 'keydown') eatUntil = now() + 600;
    hide();
  };
  for (const type of INPUTS) win.addEventListener(type, onInput, { capture: true, passive: false });

  function build() {
    root = doc.createElement('div');
    root.className = 'ss';
    root.setAttribute('role', 'status');
    root.innerHTML = '<canvas class="ss-net" aria-hidden="true"></canvas>'
      + '<div class="ss-block"><p class="ss-bubble"><span class="ss-bubble-tx"></span></p>'
      + '<div class="ss-logo" aria-hidden="true"></div>'
      + '<p class="ss-head"><span class="ss-head-tx"></span><span class="ss-caret" aria-hidden="true"></span></p>'
      + '<ul class="ss-items"></ul></div>'
      + '<p class="ss-hint">Move the mouse whenever you are ready</p>';
    doc.body.append(root);
    const bubbleDot = renderStatusDot(doc, RUN_STATES['needs-you']);
    root.querySelector('.ss-bubble').prepend(bubbleDot);
  }

  function paint(view) {
    const key = JSON.stringify(view);
    if (key === shown) return;
    const headChanged = !shown || JSON.parse(shown).headline !== view.headline;
    shown = key;
    const bubble = root.querySelector('.ss-bubble');
    bubble.classList.toggle('is-on', !!view.bubble);
    root.querySelector('.ss-bubble-tx').textContent = view.bubble;
    root.querySelector('.ss-items').replaceChildren(...view.items.map(({ model, text }) => {
      const li = doc.createElement('li');
      li.append(renderStatusDot(doc, model), doc.createTextNode(text));
      return li;
    }));
    root.dataset.scene = view.scene;
    if (headChanged) typeHeadline(view.headline);
  }

  // The headline types itself out, like a model writing its answer.
  function typeHeadline(text) {
    const tx = root.querySelector('.ss-head-tx');
    win.clearInterval(typer);
    if (reduced()) { tx.textContent = text; return; }
    let i = 0;
    tx.textContent = '';
    typer = win.setInterval(() => {
      tx.textContent = text.slice(0, ++i);
      if (i >= text.length) win.clearInterval(typer);
    }, TYPE_MS);
  }

  function seedNet(w, h) {
    net = Array.from({ length: NODES }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 14, vy: (Math.random() - 0.5) * 14,
    }));
  }

  function drawNet(ctx, w, h, dt) {
    // The hint is --ink-2: its computed colour is a plain rgb() a canvas can read (the token itself is light-dark()).
    const ink = win.getComputedStyle(root.querySelector('.ss-hint')).color || 'gray';
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    for (const p of net) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.x < 0 || p.x > w) p.vx = -p.vx;
      if (p.y < 0 || p.y > h) p.vy = -p.vy;
    }
    for (let a = 0; a < net.length; a++) {
      for (let b = a + 1; b < net.length; b++) {
        const d = Math.hypot(net[a].x - net[b].x, net[a].y - net[b].y);
        if (d > LINK_PX) continue;
        ctx.globalAlpha = 0.28 * (1 - d / LINK_PX);
        ctx.beginPath(); ctx.moveTo(net[a].x, net[a].y); ctx.lineTo(net[b].x, net[b].y); ctx.stroke();
      }
    }
    ctx.globalAlpha = 0.5;
    for (const p of net) { ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
  }

  function spark(x, y) {
    const s = doc.createElement('i');
    s.className = 'ss-spark';
    s.style.transform = `translate(${x}px, ${y}px)`;
    s.addEventListener('animationend', () => s.remove(), { once: true });
    root.append(s);
  }

  function frame(t) {
    if (!root) return;
    const dt = lastFrame ? Math.min(0.05, (t - lastFrame) / 1000) : 0;
    lastFrame = t;
    const block = root.querySelector('.ss-block');
    const logo = root.querySelector('.ss-logo');
    const w = win.innerWidth, h = win.innerHeight;
    const bw = block.offsetWidth, bh = block.offsetHeight;
    if (!pos) pos = { x: Math.random() * Math.max(0, w - bw), y: Math.random() * Math.max(0, h - bh - 40), vx: SPEED, vy: SPEED };
    pos.x += pos.vx * dt; pos.y += pos.vy * dt;
    const hit = (axis) => { logo.classList.remove('is-squash-x', 'is-squash-y'); void logo.offsetWidth; logo.classList.add(`is-squash-${axis}`); };
    if (pos.x < 0 || pos.x > w - bw) { pos.vx = -pos.vx; pos.x = Math.max(0, Math.min(pos.x, w - bw)); hit('x'); }
    if (pos.y < 0 || pos.y > h - bh - 40) { pos.vy = -pos.vy; pos.y = Math.max(0, Math.min(pos.y, h - bh - 40)); hit('y'); }
    block.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
    if (t - lastSpark > 140) {   // a short trail behind the wordmark
      lastSpark = t;
      const lx = pos.x + logo.offsetLeft + Math.random() * logo.offsetWidth;
      const ly = pos.y + logo.offsetTop + Math.random() * logo.offsetHeight;
      spark(lx - Math.sign(pos.vx) * 24, ly - Math.sign(pos.vy) * 12);
    }
    const canvas = root.querySelector('.ss-net');
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; seedNet(w, h); }
    const ctx = canvas.getContext?.('2d');
    if (ctx) drawNet(ctx, w, h, dt);
    raf = win.requestAnimationFrame(frame);
  }

  function show() {
    build();
    shown = '';
    pos = null; lastFrame = 0;
    if (!reduced() && win.requestAnimationFrame) raf = win.requestAnimationFrame(frame);
    else root.classList.add('is-still');
  }

  function hide() {
    if (!root) return;
    win.cancelAnimationFrame?.(raf);
    win.clearInterval(typer);
    root.remove();
    root = null;
  }

  return {
    tick() {
      const st = getState() || {};
      const focused = doc.visibilityState === 'visible' && doc.hasFocus();
      const on = shouldShow({ away: st.away, keepAwake: st.keepAwake, focused, idleMs: now() - lastInput });
      if (!on) { hide(); return; }
      if (!root) show();
      paint(pickScene({ ...(st.runs || {}), ...chats.counts(), chatUnread: !!st.chatUnread }));
    },
    onAskFrame(msg) { chats.onFrame(msg); },
    isShown() { return !!root; },
    stop() {
      hide();
      for (const type of INPUTS) win.removeEventListener(type, onInput, { capture: true });
    },
  };
}
