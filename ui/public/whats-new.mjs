// ui/public/whats-new.mjs — spec §5a.9: a one-time "What's new" note on the Runs list, dismissible, remembered per
// browser. A storage that throws (private mode) shows the note and forgets the dismissal; it never breaks the page.
export const WHATS_NEW_KEY = 'worca-cc.whatsNew.runsRedesign';
export const WHATS_NEW = Object.freeze({
  title: 'The Runs list has a new look',
  body: 'Runs and groups share one status line. A ? marks a run waiting on your answer and a ! one that failed. '
    + 'Filter and group from View, and tick rows to Stop, Archive or Delete them.',
});

const seen = (storage) => { try { return storage.getItem(WHATS_NEW_KEY) === '1'; } catch { return false; } };

/** Paint the note into `host` unless dismissed (idempotent). `focusAfter`: where focus goes after "Got it". */
export function paintWhatsNew(host, { storage, focusAfter = null } = {}) {
  if (!host) return;
  if (seen(storage)) { host.replaceChildren(); host.hidden = true; return; }
  if (host.querySelector('aside.whats-new')) return;
  const doc = host.ownerDocument;
  const aside = doc.createElement('aside');
  aside.className = 'whats-new';
  aside.setAttribute('aria-label', "What's new");
  const text = doc.createElement('div');
  text.className = 'whats-new-text';
  const t = doc.createElement('p');
  t.className = 'whats-new-title';
  t.textContent = WHATS_NEW.title;
  const b = doc.createElement('p');
  b.className = 'whats-new-body';
  b.textContent = WHATS_NEW.body;
  text.append(t, b);
  const ok = doc.createElement('button');
  ok.type = 'button';
  ok.className = 'btn btn-sm btn-secondary whats-new-ok';
  ok.textContent = 'Got it';
  ok.addEventListener('click', () => {
    try { storage.setItem(WHATS_NEW_KEY, '1'); } catch { /* private mode: gone for this page only */ }
    host.replaceChildren();
    host.hidden = true;
    if (focusAfter) { if (!focusAfter.hasAttribute('tabindex')) focusAfter.setAttribute('tabindex', '-1'); focusAfter.focus(); }
  });
  aside.append(text, ok);
  host.hidden = false;
  host.replaceChildren(aside);
}
