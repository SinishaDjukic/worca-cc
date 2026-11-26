// ui/public/settings/secret-vault-card.mjs — Settings › General › Secret vault (#secret-vault-card, the secretVault
// flag; docs/secrets.md). It replaces the About card's one Secrets row. Divided rows (docs/design-system.md): State
// (one `.badge`, the tone from src/shared/secret-vault-view.mjs), Key store, In the vault and Still in files (counts by
// kind, never a value or a name), Last check; then the pending message about moved keys (Got it); then one action
// row with at most one primary. Turn on, Check now and Reset call /api/secrets/*; Export is CLI only (it refuses while
// the app runs), so its confirm hands over the command. Errors go to the card's alert (cardAlert). No fetch and no
// paint with the flag off.
import { flagOn } from '../flags.mjs';
import { notify as realNotify, cardAlert } from '../feedback.mjs';
import { docsLink } from '../docs-links.mjs';
import { copyButton, copyFromButton } from '../copy-button.mjs';
import { ago } from '../branch-sync.mjs';
import { vaultModel, kindsLine, totalOf } from '../../../src/shared/secret-vault-view.mjs';
import { keyName, noticeLines } from '../../../src/shared/secrets-notice.mjs';
import { forgetVaultNoteStatus } from './secret-vault-note.mjs';

const TONE_BADGE = Object.freeze({ ok: 'green', neutral: 'grey', attention: 'amber' });
export const EXPORT_COMMAND = 'worca secrets export';
const PRIMARY_LABEL = Object.freeze({ 'turn-on': 'Turn on', finish: 'Finish moving', reset: 'Reset', check: 'Check again' });

const el = (doc, tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const badge = (doc, value, tone) => { const b = el(doc, 'span', `badge ${TONE_BADGE[tone] || 'grey'} sv-badge`, value); b.dataset.tone = tone; return b; };

function drow(doc, { id, label, help, control, title }) {
  const row = el(doc, 'div', 'drow sv-row');
  row.dataset.row = id;
  row.append(el(doc, 'span', 'drow-label', label));
  if (help) row.append(el(doc, 'small', 'hint drow-help', help));
  if (title) row.title = title;
  if (control) { const c = el(doc, 'div', 'drow-control'); c.append(control); row.append(c); }
  return row;
}

const defaultJson = (url, body) => fetch(url, body === undefined ? undefined : {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { body: j }); return j; });

/** The confirm text for Turn on and Finish moving: what moves, by kind. */
export function moveMessage(status) {
  const what = kindsLine(status?.counts?.files) || 'the keys saved in files';
  return `These move into the vault: ${what}. Worca first checks that ${status?.label || 'the OS key store'} can write and read a test item. `
    + 'Their files then keep a reference instead of the value. You can go back with worca secrets export.';
}

/**
 * Paint `status` (GET /api/secrets/status, with `counts`) and `notice` into the card body. `act(name)` runs an action;
 * `now` is for the Last check words. Returns the model painted.
 */
export function paintSecretVault(card, status, { notice = null, act = () => {}, now = Date.now(), busy = null } = {}) {
  const body = card?.querySelector('#secretVaultBody');
  if (!body) return null;
  const doc = card.ownerDocument;
  body.replaceChildren();
  if (!status || typeof status.state !== 'string') {
    body.append(el(doc, 'p', 'hint', 'The secret vault status is not available from this server.'));
    return null;
  }
  const m = vaultModel(status, status.counts || {});
  card.dataset.state = m.state;
  const list = el(doc, 'div', 'drows sv-rows');
  list.append(drow(doc, { id: 'state', label: 'State', help: m.detail, control: badge(doc, m.value, m.tone) }));
  if (m.state !== 'container') {
    list.append(drow(doc, { id: 'store', label: 'Key store', help: 'Holds the key that opens the vault. Never the secrets.', control: badge(doc, status.label || 'None', 'neutral') }));
    const inVault = totalOf(status.counts?.vault); const inFiles = totalOf(status.counts?.files);
    list.append(drow(doc, { id: 'vault', label: 'In the vault', help: kindsLine(status.counts?.vault) || 'Nothing yet.', control: badge(doc, String(inVault), 'neutral') }));
    if (inFiles) list.append(drow(doc, { id: 'files', label: 'Still in files', help: kindsLine(status.counts?.files), control: badge(doc, String(inFiles), m.state === 'interrupted' ? 'attention' : 'neutral') }));
    if (status.checkedAt) list.append(drow(doc, { id: 'checked', label: 'Last check', help: null, title: status.checkedAt, control: el(doc, 'span', 'sv-when', ago(status.checkedAt, now)) }));
  }
  body.append(list);
  paintNotice(doc, body, notice, act);
  if (m.state !== 'container') {
    const row = el(doc, 'div', 'sv-actions');
    row.dataset.cardActions = '';
    const button = (name, label, cls) => {
      const b = el(doc, 'button', cls, label); b.type = 'button'; b.dataset.act = name;
      b.disabled = !!busy; if (busy === name) b.setAttribute('aria-busy', 'true');
      b.addEventListener('click', () => act(name));
      return b;
    };
    if (m.primary) row.append(button(m.primary === 'check' ? 'check' : m.primary, PRIMARY_LABEL[m.primary], 'btn btn-primary'));
    if (m.primary !== 'check') row.append(button('check', 'Check now', 'btn'));
    if (totalOf(status.counts?.vault) > 0 || status.vault === 'readable') row.append(button('export', 'Export to files', 'btn'));
    if (m.primary !== 'reset' && status.vault === 'unreadable') row.append(button('reset', 'Reset', 'btn'));
    body.append(row);
  }
  const links = el(doc, 'p', 'hint sv-links');
  links.append(docsLink(doc, 'secrets', 'Secrets and the vault'));
  if (m.state === 'container') links.append(doc.createTextNode(' · '), docsLink(doc, 'credential-broker', 'Credential broker'));
  body.append(links);
  return m;
}

function paintNotice(doc, body, notice, act) {
  const keys = Array.isArray(notice?.keys) ? notice.keys.map(keyName).filter(Boolean) : [];
  if (!notice || typeof notice.id !== 'string' || !keys.length) return;
  const lines = noticeLines(notice, { surface: 'settings' });
  const box = el(doc, 'div', 'update-callout sv-notice');
  box.dataset.tone = 'info'; box.dataset.id = notice.id; box.setAttribute('role', 'status');
  box.append(el(doc, 'p', null, `${lines[0]} ${lines[1]}`));
  const ul = el(doc, 'ul'); ul.append(...keys.map((k) => el(doc, 'li', null, k))); box.append(ul);
  const left = lines.length > 2 + keys.length ? lines[2 + keys.length] : '';
  if (left) box.append(el(doc, 'p', null, left));
  const got = el(doc, 'button', 'btn btn-sm btn-quiet sv-ack', 'Got it'); got.type = 'button';
  got.addEventListener('click', () => act('ack', notice.id));
  box.append(got);
  body.append(box);
}

/**
 * Load and paint the card each time Settings opens; wire its actions. `confirm(opts)` is the app's confirmModal.
 * `json(url, body?)` GETs (no body) or POSTs; `notify` is injectable for tests.
 */
export async function loadSecretVaultCard(doc, { confirm = async () => false, json = defaultJson, notify = realNotify, now = () => Date.now() } = {}) {
  const card = doc.getElementById('secret-vault-card');
  if (!card) return null;
  if (!flagOn('secretVault', doc)) { card.hidden = true; return null; }
  card.hidden = false;
  let status = null; let notice = null; let busy = null; let alert = null;
  // The alert is state: a repaint rebuilds the body and puts it back above the action row.
  const paint = () => { const m = paintSecretVault(card, status, { notice, act, now: now(), busy }); cardAlert(card, alert); return m; };
  const fail = (title, err) => (alert = { tone: 'err', title, detail: `${err?.body?.error || 'Worca could not reach the server.'} Nothing changed.` });
  async function run(name, fn) {
    busy = name; paint();
    try { alert = null; await fn(); } finally { busy = null; forgetVaultNoteStatus(); paint(); }
  }
  async function act(name, arg) {
    if (name === 'ack') {
      try { await json('/api/secrets/notice/ack', { id: arg }); notice = null; paint(); }
      catch { notify({ tone: 'warn', title: 'Not saved', detail: 'The message stays until Got it is saved. Try again, or run worca secrets ack.' }, { doc }); }
      return;
    }
    if (name === 'check') {
      await run(name, async () => {
        try {
          const r = await json('/api/secrets/check', {});
          status = r.status || status;
          if (!r.ok) alert = ({ tone: 'warn', title: 'The check did not pass', detail: `${r.label}: ${r.message}. Nothing changed.` });
          else notify({ tone: 'ok', title: 'Key store checked', detail: `${r.label} wrote and read a test item.` }, { doc });
        } catch (err) { fail('Could not check the key store', err); }
      });
      return;
    }
    if (name === 'turn-on' || name === 'finish') {
      const ok = await confirm({ title: name === 'finish' ? 'Finish moving into the vault?' : 'Turn on the secret vault?', message: moveMessage(status),
        confirmLabel: name === 'finish' ? 'Finish moving' : 'Turn on' });
      if (!ok) return;
      await run(name, async () => {
        try {
          const r = await json('/api/secrets/enable', { confirm: true });
          status = r.status || status;
          notify({ tone: 'ok', title: 'Keys moved into the vault', detail: r.moved ? `${r.moved} saved ${r.moved === 1 ? 'secret' : 'secrets'} moved.` : 'Nothing was left to move.' }, { doc });
          try { notice = (await json('/api/secrets/notice'))?.notice ?? null; } catch { /* keep */ }
        } catch (err) { if (err?.body?.status) status = err.body.status; fail('Keys not moved', err); }
      });
      return;
    }
    if (name === 'reset') {
      const ok = await confirm({ title: 'Reset the vault?', danger: true, confirmLabel: 'Reset vault',
        message: 'The unreadable vault moves aside, and a new one starts. The secrets in it must be entered again. The old file is kept.' });
      if (!ok) return;
      await run(name, async () => {
        try { const r = await json('/api/secrets/reset', { confirm: true }); status = r.status || status; notify({ tone: 'ok', title: 'Vault reset', detail: 'Enter the keys it held again.' }, { doc }); }
        catch (err) { if (err?.body?.status) status = err.body.status; fail('Vault not reset', err); }
      });
      return;
    }
    if (name === 'export') {
      const ok = await confirm({ title: 'Export the secrets to files?', danger: true, confirmLabel: 'Show the command',
        message: ['Export writes every vaulted secret back into its config file as plain text, deletes the vault and its key and turns the flag off. ',
          { strong: 'Anyone who can read those files then reads your keys.' },
          ' Export runs in a terminal while Worca is stopped. Stop Worca, then run: worca secrets export'] });
      if (!ok) return;
      const box = el(doc, 'div', 'sv-export');
      box.append(el(doc, 'p', 'hint', 'Stop Worca, then run this in a terminal:'));
      const btn = copyButton(doc, { name: 'Copy command', label: EXPORT_COMMAND });
      btn.addEventListener('click', () => copyFromButton(btn, EXPORT_COMMAND));
      box.append(btn);
      card.querySelector('.sv-export')?.remove();
      const links = card.querySelector('#secretVaultBody .sv-links');
      if (links) links.before(box); else card.querySelector('#secretVaultBody')?.append(box);
    }
  }
  try { status = await json('/api/secrets/status'); } catch { status = null; }
  try { notice = (await json('/api/secrets/notice'))?.notice ?? null; } catch { notice = null; }
  paint();
  return status;
}
