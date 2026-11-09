// ui/public/stillhet.mjs — Stillhet, the Rail design system behind its flag (docs/feature-flags.md): the one-time
// question under the top bar, and the root's data-rail kept in step with the flag. Every Rail rule scopes on
// :root[data-rail], so the attribute is the whole switch. The question and its answer are install-wide: "Try Stillhet"
// turns the flag on (PATCH /api/flags), "No thanks" or Esc stores onboarding.stillhetAsked (POST /api/onboarding), and
// the server marks any write of the flag as an answer too. All markup comes from the library.
import { confirmActions, confirmForm, outLink, toElement } from './design-system/components/index.mjs';
import { applyFlags, flagOn, onFlagChange } from './flags.mjs';

/** Where a person reports what looks odd: package.json bugs.url. */
export const STILLHET_ISSUES_URL = 'https://github.com/SinishaDjukic/worca-cc/issues';

const SENTENCE = 'Try Stillhet, the calmer Worca?';
const ABOUT = 'Stillhet is the next step of Worca\'s design system: only what needs you is lit, and Chat comes first. It arrives in steps; today it changes the colours. It is still being tested, so please tell us about anything odd.';
const SETTINGS_LINE = 'You can turn it on or off for this Worca any time in Settings › Labs.';
const LINK = () => outLink({ label: 'Report a bug on GitHub', href: STILLHET_ISSUES_URL });
const FAILED = { yes: 'Couldn\'t turn Stillhet on', no: 'Couldn\'t save your answer' };
const WORKING = { yes: 'Turning on…', no: 'Saving…' };

/**
 * Is this the load to ask? Only an install that is not fresh, has not been asked, with the flag known, off and
 * not locked, and no welcome or setup in this load. A missing input means no.
 * @param {{onboarding?:{stillhetAsked?:boolean, fresh?:boolean}, railFlag?:{on?:boolean, locked?:boolean}, welcomeThisLoad?:boolean, setupOpen?:boolean}} [o]
 */
export function shouldAskStillhet({ onboarding, railFlag, welcomeThisLoad, setupOpen } = {}) {
  if (!onboarding || !railFlag) return false;
  return onboarding.stillhetAsked !== true && onboarding.fresh !== true && railFlag.on !== true && railFlag.locked !== true
    && !welcomeThisLoad && !setupOpen;
}

/**
 * The strip's markup: ConfirmStrip's form variant.
 * @param {{busy?:'yes'|'no'|'', err?:{title:string, detail:string}|null}} [o]  busy: the pressed answer, working
 */
export function stillhetStripHtml({ busy = '', err = null } = {}) {
  if (err) return confirmForm({ form: 'stillhet', text: SENTENCE, err: { ...err, extra: LINK() + confirmActions({ yes: 'Try again', no: 'No thanks' }) } });
  const acts = confirmActions({ yes: busy === 'yes' ? WORKING.yes : 'Try Stillhet', no: busy === 'no' ? WORKING.no : 'No thanks', busy: !!busy });
  return confirmForm({ form: 'stillhet', text: SENTENCE, body: `<p>${ABOUT} ${LINK()}</p><p>${SETTINGS_LINE}</p>${acts}` });
}

const reasonOf = async (res) => {
  try { const j = await res.json(); if (j && typeof j.error === 'string' && j.error) return j.error; } catch { /* no body */ }
  return `The server answered ${res.status}.`;
};

/**
 * Paint the question into `host` and wire its answers.
 * @param {{host:HTMLElement, doc?:Document, fetchImpl?:typeof fetch, onDone?:(how:'accepted'|'declined')=>void}} o
 * @returns {{close:()=>void}}
 */
export function mountStillhetAsk({ host, doc = globalThis.document, fetchImpl = (...a) => globalThis.fetch(...a), onDone = () => {} }) {
  // retry: after a failure, "Try again" retries what failed; "No thanks" always declines.
  let busy = false, closed = false, answered = false, retry = null;
  const q = (s) => host.querySelector(s);

  function paint(o) { host.replaceChildren(toElement(doc, stillhetStripHtml(o))); host.classList.remove('hidden'); }

  function close() {
    if (closed) return;
    closed = true;
    offFlag();
    host.removeEventListener('click', onClick);
    host.removeEventListener('keydown', onKey);
    host.replaceChildren();
    host.classList.add('hidden');
  }

  async function answer(how) {
    if (busy || closed) return;
    busy = true;
    const inside = host.contains(doc.activeElement) || doc.activeElement === doc.body;   // before the disable blurs it
    const btn = q(`[data-confirm="${how}"]`);
    if (btn) btn.textContent = WORKING[how];
    for (const b of host.querySelectorAll('[data-confirm]')) b.disabled = true;
    let err = null;
    try {
      const res = how === 'yes'
        ? await fetchImpl('/api/flags', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rail: true }) })
        : await fetchImpl('/api/onboarding', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stillhetAsked: true }) });
      if (!res.ok) err = await reasonOf(res);
      else if (how === 'yes') {
        const j = await res.json().catch(() => null);
        answered = true;
        applyFlags(j && Array.isArray(j.flags) ? Object.fromEntries(j.flags.map((f) => [f.key, f.on])) : { rail: true }, doc);
      }
    } catch (e) { err = (e && e.message) || String(e); }
    if (closed && !answered) return;
    if (err) {
      busy = false;
      retry = how;
      paint({ err: { title: FAILED[how], detail: err } });
      if (inside) q('[data-confirm="yes"]')?.focus();
      return;
    }
    answered = true;
    close();
    onDone(how === 'yes' ? 'accepted' : 'declined');
  }

  function onClick(e) {
    const b = e.target.closest && e.target.closest('[data-confirm]');
    if (!b || !host.contains(b)) return;
    e.preventDefault();
    const which = b.dataset.confirm;
    void answer(which === 'yes' && retry ? retry : which);
  }
  function onKey(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    if (!busy) void answer('no');
  }
  const offFlag = onFlagChange('rail', (on) => { if (on && !answered) close(); });

  paint({});
  host.addEventListener('click', onClick);
  host.addEventListener('keydown', onKey);
  host.firstElementChild.addEventListener('submit', (e) => e.preventDefault());
  if (!doc.activeElement || doc.activeElement === doc.body) q('[data-confirm="no"]')?.focus();
  return { close };
}

/** Keep the root's data-rail in step with the flag, now and live. Returns the unsubscribe. */
export function syncRailRoot(doc = globalThis.document) {
  const set = (on) => doc.documentElement.toggleAttribute('data-rail', on === true);
  set(flagOn('rail', doc));
  return onFlagChange('rail', set);
}
