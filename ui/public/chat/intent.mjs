// ui/public/chat/intent.mjs — the Chat composer's intent chip (worca Chat P6). A composer add-on ({ id: 'intent' },
// ui/public/chat/extensions.mjs) that the home's quick actions arm: the chip names what the next message is for
// (icon + label + ✕), the placeholder follows it, and on send ONE plain sentence goes in front of the text
// (transformSend) — UI only: the server receives an ordinary message. The chip is in the lead row only while an
// intent is set (P1 hides the empty row). The intent lasts until the message it rode lands in the chat (a failed send
// keeps it for the retry) and is dropped when the home is left without a send, or when the chat a send created is left
// (New chat, or by address while its message is still on the way). Backspace in an empty composer removes
// it. While the home shows, the composer is empty and no intent is set, the placeholder rotates through examples of
// real worca capabilities every 3.5 s. The add-on only gives back a placeholder it put there itself, so it never wipes
// another add-on's (P3's direction chip). transformSend runs for every Ask send (P1 folds it once no beforeSend took
// the send), which is where the home arms its hero → dock glide (onSend).
import { registerComposerAddon } from './extensions.mjs';
import { homeIcon } from './home-icons.mjs';
import { shapeFirstOn } from './shape-gate.mjs';
import { INTENT_LEADS } from '../../../src/shared/intent-leads.mjs';

export const INTENT_ADDON_ID = 'intent';
export const EXAMPLE_MS = 3500;

/** Each intent: chip label + icon, the placeholder while it is set, the sentence the sent text starts with, and —
 *  where the composer could not be sent empty otherwise — the text a quick action leaves in it (`prefill`). A tile's
 *  `badge` shows under its label on the home. Shaper (`shape`) is Shape it first's, gated.
 *  Every one is a real Ask Worca capability (src/core/ask/tools.mjs — the map is in home-actions.mjs). */
export const INTENTS = Object.freeze({
  run: Object.freeze({ label: 'New run', icon: 'run', placeholder: 'Describe the task…', lead: INTENT_LEADS.run }),
  shape: Object.freeze({ label: 'Shaper', icon: 'shape', placeholder: 'Describe the problem…',
    lead: INTENT_LEADS.shape, badge: 'Labs' }),
  workflow: Object.freeze({ label: 'Build workflow', icon: 'workflow', placeholder: 'Describe the workflow…', lead: INTENT_LEADS.workflow }),
  schedule: Object.freeze({ label: 'Schedule a run', icon: 'schedule', placeholder: 'What should run, and when?', lead: INTENT_LEADS.schedule }),
  track: Object.freeze({ label: 'Track a run', icon: 'track', placeholder: 'Which run? Pick one or type its name', lead: INTENT_LEADS.track }),
  diff: Object.freeze({ label: 'Explain a diff', icon: 'diff', placeholder: 'Which run’s changes?', lead: INTENT_LEADS.diff }),
  script: Object.freeze({ label: 'Write a script', icon: 'script', placeholder: 'What should the script check?', lead: INTENT_LEADS.script }),
  away: Object.freeze({ label: 'Step away', icon: 'away', placeholder: "I'm away now", lead: INTENT_LEADS.away, prefill: "I'm away now" }),
  metrics: Object.freeze({ label: 'Team metrics', icon: 'metrics', placeholder: 'Which project or workspace?', lead: INTENT_LEADS.metrics }),
  model: Object.freeze({ label: 'Add a model', icon: 'model', placeholder: 'Which model or endpoint?', lead: INTENT_LEADS.model }),
  workspace: Object.freeze({ label: 'New workspace', icon: 'workspace', placeholder: 'Name it and list its projects', lead: INTENT_LEADS.workspace }),
  remember: Object.freeze({ label: 'Remember something', icon: 'remember', placeholder: 'What should worca remember?', lead: INTENT_LEADS.remember }),
  tasks: Object.freeze({ label: 'Find tasks', icon: 'tasks', placeholder: 'Which tracker, and what to look for?', lead: INTENT_LEADS.tasks }),
});

/** The rotating home placeholders: each is something worca really does (a run, a workflow, a schedule of the
 *  built-in Memory defragment workflow, a question about runs). */
export const EXAMPLES = Object.freeze([
  'Fix the flaky upload test…',
  'Build a workflow that plans, implements and runs the tests…',
  'Run Memory defragment every night…',
  'Which runs are waiting for me?',
]);

const known = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(INTENTS, id);
const messageCount = (thread) => (thread && Array.isArray(thread.messages) ? thread.messages.length : 0);

/** The lead a run of one pinned workflow carries (Chat home pins, src/shared/home-pins.mjs): the id, so Ask
 *  Worca proposes that workflow; the name, for the person reading their message back. */
export function workflowLead(workflow) {
  return `Propose a pipeline run of workflow ${workflow.id} ("${workflow.name}") for this task.`;
}

/** The text a send carries for intent `id`: its sentence, a blank line, then what was typed (trimmed). A run
 *  armed from a pinned workflow leads with that workflow instead. */
export function intentText(id, text, workflow = null) {
  const body = String(text ?? '').trim();
  if (!known(id)) return body;
  const lead = id === 'run' && workflow ? workflowLead(workflow) : INTENTS[id].lead;
  return body ? `${lead}\n\n${body}` : lead;
}

const asWorkflow = (w) => (w && typeof w.id === 'string' && w.id
  ? Object.freeze({ id: w.id, name: String(w.name || w.id) }) : null);

/** The person's sent text split for their bubble (D21): the Shaper lead is for the model only, so a message
 *  that opens with it — alone, or then a blank line — shows the intent chip and the rest. Exact match, ungated: only a
 *  send made with the gate on can carry it, and a reload renders before the flags arrive. */
export function splitIntentLead(text) {
  const s = String(text ?? '');
  const lead = INTENTS.shape.lead;
  if (s === lead) return { intent: 'shape', text: '' };
  if (s.startsWith(`${lead}\n\n`)) return { intent: 'shape', text: s.slice(lead.length + 2) };
  return { intent: null, text: s };
}

/**
 * @param {{ win?: { setInterval, clearInterval }, onSend?: () => void, examples?: string[], intervalMs?: number }} o
 * @returns {{ addon: { id: string, mount(leadEl, ctx) }, set(id, { focus, workflow }?): boolean, clear({ focus }?): void, leave(): void, current(): string|null, workflow(): { id, name }|null }}
 */
export function createIntentAddon({ win = globalThis, onSend = null, examples = EXAMPLES, intervalMs = EXAMPLE_MS } = {}) {
  let current = null;
  let workflow = null;       // { id, name }: the pinned workflow a run intent was armed with, null = none
  const key = () => (current == null ? null : `${current}|${workflow ? workflow.id : ''}`);
  let pending = null;        // { count }: a send carried the intent; it is spent once the chat holds more than `count` messages
  const mounts = new Set();

  function set(id, { focus = true, workflow: wf = null } = {}) {
    if (!known(id)) return false;
    if (id === 'shape' && !shapeFirstOn()) return false;
    current = id;
    workflow = id === 'run' ? asWorkflow(wf) : null;
    pending = null;
    for (const m of mounts) m.paint(focus);
    return true;
  }
  function clear({ focus = false } = {}) {
    pending = null;
    if (current == null) return;
    current = null;
    workflow = null;
    for (const m of mounts) m.paint(focus);
  }
  /** The Chat page was left (app.js showView): an intent no send carries never outlives the visit. */
  function leave() {
    if (!pending) clear();
  }

  function mount(leadEl, ctx = {}) {
    const doc = ctx.doc || leadEl.ownerDocument;
    const call = (name, ...args) => (typeof ctx[name] === 'function' ? ctx[name](...args) : undefined);
    // Built once, in the lead row only while an intent is set: an empty row is display:none (P1's
    // `.chat-composer-lead:empty`), so a hidden child would leave a strip on every composer.
    const chip = doc.createElement('span');
    chip.className = 'chat-intent';
    const ic = doc.createElement('span');
    ic.className = 'chat-intent-ic';
    const label = doc.createElement('span');
    label.className = 'chat-intent-l';
    const x = doc.createElement('button');
    x.type = 'button';
    x.className = 'chat-intent-x';
    x.appendChild(homeIcon(doc, 'x', 12));
    chip.append(ic, label, x);

    // P1's lead row is the first child of .ask-composer-box, so the composer's textarea is a sibling below it.
    const composer = typeof leadEl.closest === 'function' ? leadEl.closest('.ask-composer') : null;
    const input = (composer && composer.querySelector('.ask-input')) || doc.querySelector('[data-chat-page] .ask-input');
    const page = (typeof leadEl.closest === 'function' && leadEl.closest('[data-chat-page]')) || doc.querySelector('[data-chat-page]');
    const onHome = () => !page || page.dataset.view === 'home';
    let shown = null;      // the intent (and pinned workflow) this chip paints
    let example = -1;      // the example on screen, -1 = none
    let mine = null;       // the placeholder this add-on put on screen (an intent's or an example), null = none

    function own(text) {
      mine = text;
      call('setPlaceholder', text);
    }
    /** Give the placeholder back — only if what shows is still ours (another add-on may have set its own since). */
    function release() {
      if (mine == null) return;
      const ours = !input || input.placeholder === mine;
      mine = null;
      if (ours) call('setPlaceholder', null);
    }
    function dropExample() {
      if (example < 0) return;
      example = -1;
      release();
    }
    function paint(focus) {
      if (key() !== shown) {
        shown = key();
        example = -1;
        if (current) {
          const it = INTENTS[current];
          const name = workflow ? workflow.name : it.label;
          chip.dataset.intent = current;
          ic.replaceChildren(homeIcon(doc, workflow ? 'workflow' : it.icon, 14));
          label.textContent = name;
          x.setAttribute('aria-label', `Remove ${name}`);
          x.title = `Remove ${name}`;
          if (chip.parentNode !== leadEl) leadEl.appendChild(chip);
          own(it.placeholder);
          call('announce', name);
        } else {
          chip.remove();
          delete chip.dataset.intent;
          release();
        }
      }
      if (focus) call('focus');
    }
    x.addEventListener('click', () => clear({ focus: true }));
    const onKey = (e) => {
      if (e.key !== 'Backspace' || current == null || e.isComposing) return;
      if (!e.target || e.target.value !== '') return;
      e.preventDefault();
      clear();
    };
    if (input) input.addEventListener('keydown', onKey);
    // New chat (P1's head button [data-ask-new-btn]) is a trip to another chat: the intent — set, or riding a send that
    // is still in flight or was refused — never follows it. Capture phase: before P1 swaps the chat.
    const onNewChat = (e) => {
      const t = e.target;
      if (t && typeof t.closest === 'function' && t.closest('[data-ask-new-btn]')) clear();
    };
    if (page) page.addEventListener('click', onNewChat, true);
    // The chat a send from the home creates reaches the add-ons only once its message POST answers (P1 renders it
    // without a flush), so a riding intent cannot see that chat's id. Leaving it by address meanwhile — the logo
    // (#chat/new), the Chat row, Back — is a trip to another chat too: an `oldURL` naming a chat the page no longer
    // shows drops the intent. The add-ons mount after app.js's router, so the page already shows the next chat here.
    const view = doc.defaultView;
    const onHash = (e) => {
      if (!pending) return;
      const m = /#chat\/(ask_[0-9a-f]{8})(?:[/?]|$)/.exec(String((e && e.oldURL) || ''));
      if (m && (call('threadId') || null) !== m[1]) clear();
    };
    if (view && typeof view.addEventListener === 'function') view.addEventListener('hashchange', onHash);
    function tick() {
      // visibilityState, not `hidden`: jsdom reports hidden=true for every document it does not pretend to render.
      const idle = current == null && onHome() && !!input && input.value === '' && doc.visibilityState !== 'hidden';
      if (!idle) { dropExample(); return; }
      example = (example + 1) % examples.length;
      own(examples[example]);
    }
    const timer = examples.length && typeof win.setInterval === 'function' ? win.setInterval(tick, intervalMs) : null;

    const handle = {
      paint,
      /** Every Chat render (P1 flush): the intent is spent once its message landed; it is dropped when the home was
       *  left without a send; a home example never survives into the dock. */
      update(thread) {
        if (pending) { if (messageCount(thread) > pending.count) clear(); }
        else if (current != null && !onHome()) clear();
        if (!onHome()) dropExample();
      },
      /** Never takes the send (CONTRACT §2: only `true` / `'keep'` would). */
      beforeSend() { return false; },
      /** CONTRACT §2 transformSend (P1 note 1) — runs for every Ask send: the home arms its glide; with an intent set,
       *  the text the send carries gets the intent's sentence in front. */
      transformSend(text) {
        if (typeof onSend === 'function') {
          try { onSend(); } catch { /* the home's animation never blocks a send */ }
        }
        if (current == null) return text;
        if (!pending) pending = { count: messageCount(call('thread')) };
        return intentText(current, text, workflow);
      },
      destroy() {
        if (timer != null && typeof win.clearInterval === 'function') win.clearInterval(timer);
        if (input) input.removeEventListener('keydown', onKey);
        if (page) page.removeEventListener('click', onNewChat, true);
        if (view && typeof view.removeEventListener === 'function') view.removeEventListener('hashchange', onHash);
        chip.remove();
        mounts.delete(handle);
      },
    };
    mounts.add(handle);
    if (current) paint(false);    // a composer built while an intent is set shows it at once
    return handle;
  }

  return { addon: Object.freeze({ id: INTENT_ADDON_ID, mount }), set, clear, leave,
    current: () => current, workflow: () => workflow };
}

/** Create the controller and register its add-on (CONTRACT §2). app.js calls this BEFORE createAskPanel. */
export function installIntentAddon(opts = {}) {
  const ctl = createIntentAddon(opts);
  registerComposerAddon(ctl.addon);
  return ctl;
}
