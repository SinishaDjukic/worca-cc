// ui/public/about-update.mjs
// Settings ▸ About ▸ Updates (#841): is this the latest Worca, what changed since, and how to
// get it. Painted from GET /api/app/update (src/core/app-update.mjs has the policy and its why).
//
//   paintUpdateInto(root, status)   pure DOM: the state line, release notes, the steps, and the
//                                   controls this instance allows (none on a managed one)
//   mountAboutUpdate(root, {fetch}) fetch the status, paint, and wire the buttons and switches
//   paintUpdateBadge(root, status)  the account menu's "Update" chip beside Settings
//
// A managed instance (hosted, container, IT-managed laptop, source checkout) never gets an
// install button: it shows the version, whether a newer one exists, and who updates it.

const MANAGED_WHY = {
  hosted: 'This instance is hosted. Its administrator upgrades it by deploying a new image tag.',
  container: 'This instance runs from a container image. Pull the new image to update it.',
  env: 'Updates on this computer are managed by your organization (WORCA_SELF_UPDATE=0).',
  source: 'This is a source checkout. Update it with git.',
  npx: 'This copy runs through npx. Start the version you want.',
  unknown: 'This copy was not installed with npm -g, so Worca cannot update it in place.',
};

const h = (doc, tag, attrs = {}, ...kids) => {
  const n = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const k of kids) if (k) n.append(k);
  return n;
};
const link = (doc, href, text) => (href ? h(doc, 'a', { class: 'about-link', href, target: '_blank', rel: 'noopener noreferrer', text }) : h(doc, 'span', { text }));
const fmtTime = (iso) => { try { return new Date(iso).toLocaleString(); } catch { return iso; } };

/** The one-line state, e.g. "Up to date (checked …)" / "1.14.0 is available". */
export function updateStateText(s) {
  if (!s || typeof s !== 'object') return '';
  if (s.installing) return `Installing ${s.installing.version}…`;
  if (s.installed) return `${s.installed.version} is installed. Restart Worca to finish.`;
  if (!s.check?.enabled) return s.check?.lockedBy === 'env' ? 'Update checks are off on this instance (WORCA_UPDATE_CHECK=0).' : 'Update checks are off.';
  if (s.check.error && !s.check.checkedAt) return `Could not check for updates: ${s.check.error}`;
  if (!s.check.checkedAt) return 'Not checked yet.';
  if (s.updateAvailable) return `${s.target} is available${s.channel === 'rc' ? ' (release candidate channel)' : ''}.`;
  return `Up to date (checked ${fmtTime(s.check.checkedAt)}).`;
}

/**
 * Paint the status into `root`'s #aboutUpdate. Malformed input leaves the node as it was.
 * @param {ParentNode} root
 * @param {object} s  GET /api/app/update
 */
export function paintUpdateInto(root, s) {
  const box = root?.querySelector?.('#aboutUpdate');
  if (!box || !s || typeof s !== 'object' || typeof s.current !== 'string') return;
  const doc = box.ownerDocument;
  box.replaceChildren();
  box.dataset.state = s.installed ? 'installed' : s.updateAvailable ? 'available' : 'current';
  box.append(h(doc, 'div', { class: 'about-update-state', id: 'aboutUpdateState', role: 'status', text: updateStateText(s) }));

  const notes = s.notes || {};
  if (s.updateAvailable && Array.isArray(notes.releases) && notes.releases.length) {
    const list = h(doc, 'ul', { class: 'about-update-notes', id: 'aboutUpdateNotes', 'aria-label': 'Release notes since your version' });
    for (const r of notes.releases) list.append(h(doc, 'li', {}, link(doc, r.url, r.version)));
    if (notes.more > 0) list.append(h(doc, 'li', { text: `and ${notes.more} more` }));
    box.append(list);
  }
  const more = h(doc, 'div', { class: 'about-update-links' });
  if (s.updateAvailable && notes.compareUrl) more.append(link(doc, notes.compareUrl, `Changes since ${s.current}`));
  if (notes.changelogUrl) more.append(link(doc, notes.changelogUrl, 'What’s new'));
  if (more.childNodes.length) box.append(more);

  if (s.apply !== 'self') {
    box.append(h(doc, 'p', { class: 'about-update-managed', id: 'aboutUpdateManaged', text: MANAGED_WHY[s.managedBy] || MANAGED_WHY.unknown }));
  }
  const steps = Array.isArray(s.instructions?.steps) ? s.instructions.steps : [];
  if (s.updateAvailable && steps.length && (s.apply !== 'self' || s.instructions.who !== 'you')) {
    const pre = h(doc, 'pre', { class: 'about-update-steps', id: 'aboutUpdateSteps' });
    pre.textContent = steps.join('\n');
    box.append(pre);
  }

  const actions = h(doc, 'div', { class: 'about-update-actions' });
  if (s.check?.enabled) actions.append(h(doc, 'button', { type: 'button', class: 'btn btn-sm', id: 'aboutUpdateCheck', 'data-act': 'check', disabled: !!s.installing, text: 'Check now' }));
  if (s.apply === 'self' && s.updateAvailable && !s.installed) {
    actions.append(h(doc, 'button', { type: 'button', class: 'btn btn-sm btn-primary', id: 'aboutUpdateApply', 'data-act': 'apply', 'data-version': s.target, disabled: !!s.installing, text: `Update to ${s.target}` }));
  }
  if (s.apply === 'self' && s.installed) {
    const busy = s.restart?.busy || '';
    actions.append(h(doc, 'button', { type: 'button', class: 'btn btn-sm btn-primary', id: 'aboutUpdateRestart', 'data-act': 'restart', disabled: !s.restart?.available || !!busy, title: busy || null, text: 'Restart now' }));
  }
  if (actions.childNodes.length) box.append(actions);

  // The switches: only where the person owns the choice (an operator's env or a hosted
  // deployment already decided).
  if (s.deployment !== 'hosted' && s.check?.lockedBy !== 'env') {
    const sw = h(doc, 'div', { class: 'about-update-switches' });
    sw.append(h(doc, 'label', {}, h(doc, 'input', { type: 'checkbox', id: 'aboutUpdateCheckToggle', 'data-pref': 'check', checked: !!s.check?.enabled }), doc.createTextNode(' Check for updates')));
    if (s.apply === 'self') {
      sw.append(h(doc, 'label', { title: 'Stable releases only. Installs while nothing is running, then restarts once idle.' },
        h(doc, 'input', { type: 'checkbox', id: 'aboutUpdateAutoToggle', 'data-pref': 'auto', checked: !!s.auto?.enabled, disabled: !s.auto?.allowed }),
        doc.createTextNode(' Install updates automatically')));
    }
    box.append(sw);
  }
  const msg = h(doc, 'small', { class: 'about-update-msg', id: 'aboutUpdateMsg', role: 'alert' });
  box.append(msg);
}

/** The account menu's chip beside Settings: shown while a newer version is available. */
export function paintUpdateBadge(root, s) {
  const chip = root?.querySelector?.('#acct-update-badge');
  if (!chip) return;
  const on = !!(s && s.updateAvailable && typeof s.target === 'string');
  chip.hidden = !on;
  chip.textContent = on ? `${s.target}` : '';
  chip.title = on ? `Worca ${s.target} is available (you have ${s.current})` : '';
}

async function readJson(res) {
  try { return await res.json(); } catch { return {}; }
}

/**
 * Fetch, paint and wire the Updates row. Safe to call on every Settings open: the click
 * and change handlers are bound once per box.
 * @param {ParentNode} root
 * @param {{ fetch?: typeof fetch }} [o]
 */
export async function mountAboutUpdate(root, { fetch: fetchImpl = globalThis.fetch } = {}) {
  const box = root?.querySelector?.('#aboutUpdate');
  if (!box) return null;
  let status = null;
  const paint = (s) => { if (s && typeof s.current === 'string') { status = s; paintUpdateInto(root, s); paintUpdateBadge(root, s); } };
  const say = (text) => { const m = box.querySelector('#aboutUpdateMsg'); if (m) m.textContent = text || ''; };
  const post = async (url, body) => {
    const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
    return { res, data: await readJson(res) };
  };

  if (!box.dataset.bound) {
    box.dataset.bound = '1';
    box.addEventListener('click', async (ev) => {
      const btn = ev.target?.closest?.('button[data-act]');
      if (!btn || btn.disabled) return;
      btn.disabled = true;
      const act = btn.dataset.act;
      try {
        if (act === 'check') {
          const { res, data } = await post('/api/app/update/check');
          paint(data);
          if (!res.ok) say(data.error || `HTTP ${res.status}`);
        } else if (act === 'apply') {
          say(`Installing ${btn.dataset.version}… this can take a minute.`);
          const { res, data } = await post('/api/app/update/apply', { version: btn.dataset.version });
          if (res.ok) paint(data);
          else { say(data.error || `HTTP ${res.status}`); btn.disabled = false; }
        } else if (act === 'restart') {
          const { res, data } = await post('/api/app/update/restart');
          if (res.ok) say(`Restarting onto ${data.version}… this page reconnects when it is back.`);
          else { say(data.error || `HTTP ${res.status}`); btn.disabled = false; }
        }
      } catch (err) {
        say(err?.message || String(err));
        btn.disabled = false;
      }
    });
    box.addEventListener('change', async (ev) => {
      const input = ev.target;
      const pref = input?.dataset?.pref;
      if (!pref) return;
      try {
        const res = await fetchImpl('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ updates: { [pref]: !!input.checked } }) });
        const data = await readJson(res);
        if (!res.ok) { input.checked = !input.checked; say(data.error || `HTTP ${res.status}`); return; }
        const r = await fetchImpl('/api/app/update');
        if (r.ok) paint(await readJson(r));
      } catch (err) {
        input.checked = !input.checked;
        say(err?.message || String(err));
      }
    });
  }

  try {
    const res = await fetchImpl('/api/app/update');
    if (res.ok) paint(await readJson(res));
    // A server that has not asked the registry yet (it waits a little after boot): ask now,
    // so opening About answers the question instead of saying "Not checked yet".
    if (status?.check?.enabled && !status.check.checkedAt && !status.check.error) {
      const { data } = await post('/api/app/update/check');
      paint(data);
    }
  } catch { /* the row keeps its placeholder */ }
  return status;
}
