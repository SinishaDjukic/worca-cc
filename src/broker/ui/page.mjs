// The key page's script (src/broker/ui-server.mjs serves it). No framework, no
// third-party code: everything on this page talks only to this origin.
const $ = (sel) => document.querySelector(sel);
let csrf = '';
let me = null;

const STATE_TEXT = { set: 'Set', missing: 'Not set', invalid: 'Rejected', keyless: 'No key needed', operator: 'Provided by the team' };

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k);
  return n;
}

const usd = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const when = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} hours ago`;
  return d.toISOString().slice(0, 10);
};

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-worca-csrf': csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function showError(text) {
  const e = $('#error');
  e.textContent = text || '';
  e.hidden = !text;
}

function slotCard(slot) {
  const card = el('article', { class: 'slot', id: `slot-${slot.id}` });
  const msg = el('p', { class: 'msg', hidden: true, role: 'status' });
  const say = (text, ok) => { msg.textContent = text; msg.className = `msg ${ok ? 'ok' : 'err'}`; msg.hidden = !text; };
  const kindText = slot.kind === 'subscription' ? ' · Claude subscription' : '';
  const chipText = (slot.state === 'set' && slot.suffix ? `Set ••••${slot.suffix}` : STATE_TEXT[slot.state] || slot.state) + (slot.state === 'set' ? kindText : '');
  // GitHub ("push as me"): a GitHub sign-in, or a pasted fine-grained token, both.
  const pasteToo = slot.id === 'github' || slot.protocol === 'github';

  const metaParts = [];
  if (slot.updatedAt) metaParts.push(`added ${when(slot.updatedAt)}`);
  if (slot.lastUsedAt) metaParts.push(`used ${when(slot.lastUsedAt)}`);
  if (slot.state === 'invalid' && slot.verifyError) metaParts.push(`last check: ${slot.verifyError}`);
  if (slot.state === 'missing' && slot.credential === 'per-person') metaParts.push('Runs on these models are refused until you add a key');

  card.append(el('div', { class: 'slot-top' },
    el('div', {}, el('h2', {}, slot.label), metaParts.length ? el('p', { class: 'meta' }, metaParts.join(' · ')) : null),
    el('span', { class: `chip ${slot.state}` }, chipText)));

  if (slot.credential === 'per-person' && slot.signIn === 'github-device') {
    card.append(githubSignIn(slot, say));
    if (slot.protocol === 'github') {
      card.append(el('p', { class: 'meta' }, "worca's pushes and pull requests for runs you start go out as you. Nothing here is ever given to an agent."));
    }
  }
  if (slot.credential === 'per-person' && (slot.signIn !== 'github-device' || pasteToo)) {
    const input = el('input', { type: 'password', id: `key-${slot.id}`, autocomplete: 'off', spellcheck: 'false', placeholder: slot.keyHint ? `Paste your key (${slot.keyHint})` : 'Paste your key', 'aria-label': `${slot.label}` });
    const form = el('div', { class: 'row', hidden: slot.state === 'set' || (pasteToo && slot.state !== 'invalid') });
    const save = el('button', { class: 'primary', type: 'button' }, 'Save');
    save.addEventListener('click', async () => {
      if (!input.value.trim()) { say('Paste the key first.', false); return; }
      save.disabled = true; say('Checking the key with the provider…', true);
      try {
        await api('PUT', `/api/slots/${slot.id}`, { secret: input.value });
        input.value = '';
        await load(slot.protocol === 'github' ? 'Saved. GitHub accepted the token.' : `Saved. The provider accepted your ${slot.label}.`, slot.id);
      } catch (err) { say(err.message, false); save.disabled = false; }
    });
    form.append(el('div', { class: 'grow' }, input), save);
    if (slot.state === 'set') {
      form.append(el('button', { type: 'button', onclick: () => { form.hidden = true; actions.hidden = false; say('', true); } }, 'Cancel'));
    }

    const actions = el('div', { class: 'row', hidden: slot.state !== 'set' && slot.state !== 'invalid' });
    const test = el('button', { type: 'button' }, 'Test');
    test.addEventListener('click', async () => {
      test.disabled = true; say('Testing…', true);
      try { await api('POST', `/api/slots/${slot.id}/test`); say('The provider accepted the key.', true); }
      catch (err) { say(err.message, false); }
      test.disabled = false;
    });
    const replace = el('button', { type: 'button', onclick: () => { form.hidden = false; actions.hidden = true; input.focus(); } }, pasteToo ? 'Paste a token instead' : 'Replace');
    const del = el('button', { type: 'button', class: 'danger' }, 'Delete');
    const confirmRow = el('div', { class: 'row', hidden: true },
      el('span', { class: 'grow' }, `Delete your ${slot.label}? Runs using it will pause until you add another.`),
      el('button', { type: 'button', class: 'danger', onclick: async () => {
        try { await api('DELETE', `/api/slots/${slot.id}`); await load(`Deleted your ${slot.label}.`, slot.id); }
        catch (err) { say(err.message, false); }
      } }, 'Delete key'),
      el('button', { type: 'button', onclick: () => { confirmRow.hidden = true; actions.hidden = false; } }, 'Keep it'));
    del.addEventListener('click', () => { confirmRow.hidden = false; actions.hidden = true; say('', true); });
    // GitHub: the sign-in box above already has "Sign in again" and "Sign out"; here only
    // pasting a token is offered (always shown when nothing is set yet).
    if (pasteToo) {
      actions.append(replace);
      actions.hidden = false;
    } else actions.append(test, replace, del);
    if (slot.state === 'invalid') form.hidden = false;
    card.append(form, actions, confirmRow);

    if (slot.kind === 'subscription' && slot.state === 'set') {
      card.append(el('p', { class: 'usage' }, "Runs on your Claude plan: no per-call cost, and your plan's usage limits apply. Only agents that run under your own user use it."));
    } else if (!pasteToo && (slot.state === 'set' || slot.state === 'invalid')) {
      const u = me.usage?.[slot.id] || { todayUsd: 0, monthUsd: 0 };
      card.append(el('p', { class: 'usage' }, `Today ${usd(u.todayUsd)} · This month ${usd(u.monthUsd)}`));
      const dIn = el('input', { type: 'number', min: '0', step: '1', id: `daily-${slot.id}`, value: slot.dailyUsd ?? '', placeholder: me.defaults?.dailyUsd != null ? String(me.defaults.dailyUsd) : 'none' });
      const mIn = el('input', { type: 'number', min: '0', step: '1', id: `monthly-${slot.id}`, value: slot.monthlyUsd ?? '', placeholder: me.defaults?.monthlyUsd != null ? String(me.defaults.monthlyUsd) : 'none' });
      const saveCaps = el('button', { type: 'button' }, 'Save caps');
      saveCaps.addEventListener('click', async () => {
        try { await api('PUT', `/api/budget/${slot.id}`, { dailyUsd: dIn.value, monthlyUsd: mIn.value }); say('Spending caps saved.', true); }
        catch (err) { say(err.message, false); }
      });
      card.append(el('div', { class: 'caps' },
        el('label', { for: `daily-${slot.id}` }, 'Daily cap $', dIn),
        el('label', { for: `monthly-${slot.id}` }, 'Monthly cap $', mIn),
        saveCaps));
    }
  }
  card.append(msg);
  return { card, say };
}

/** Copilot: GitHub's device sign-in, run by the broker. The page only shows the code. */
function githubSignIn(slot, say) {
  const box = el('div', {});
  const signedIn = slot.state === 'set' || slot.state === 'invalid';
  const start = el('button', { type: 'button', class: signedIn ? '' : 'primary' }, signedIn ? 'Sign in again' : 'Sign in with GitHub');
  const codeRow = el('div', { class: 'row', hidden: true });
  const actions = el('div', { class: 'row' }, start);
  if (signedIn) {
    const del = el('button', { type: 'button', class: 'danger' }, 'Sign out');
    del.addEventListener('click', async () => {
      try { await api('DELETE', `/api/slots/${slot.id}`); await load('Signed out of GitHub Copilot.', slot.id); }
      catch (err) { say(err.message, false); }
    });
    actions.append(del);
  }
  let timer = null;
  start.addEventListener('click', async () => {
    start.disabled = true; say('', true);
    let flow;
    try { flow = await api('POST', `/api/slots/${slot.id}/device`); }
    catch (err) { say(err.message, false); start.disabled = false; return; }
    const link = el('a', { href: flow.verificationUri, target: '_blank', rel: 'noopener' }, flow.verificationUri);
    codeRow.replaceChildren(el('span', { class: 'grow' }, 'Enter ', el('strong', { class: 'code' }, flow.userCode), ' at ', link, ', then come back here.'));
    codeRow.hidden = false;
    let wait = Math.max(2, flow.interval || 5) * 1000;
    const poll = async () => {
      try {
        const r = await api('POST', `/api/slots/${slot.id}/device/poll`);
        if (r.pending) { if (r.slowDown) wait += 5000; timer = setTimeout(poll, wait); return; }
        await load('Signed in. GitHub Copilot works for your runs now.', slot.id);
      } catch (err) { codeRow.hidden = true; start.disabled = false; say(err.message, false); }
    };
    timer = setTimeout(poll, wait);
  });
  window.addEventListener('beforeunload', () => clearTimeout(timer));
  box.append(actions, codeRow);
  return box;
}

async function load(notice = '', focusSlot = null) {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    if (!res.ok) throw new Error(res.status === 401 ? 'Your sign-in has expired. Reload the page to sign in again.' : `Could not load your credentials (HTTP ${res.status}).`);
    me = await res.json();
  } catch (err) { showError(err.message); return; }
  showError('');
  csrf = me.csrf;
  $('#who').textContent = `Signed in as ${me.email}`;
  const back = $('#back');
  if (me.returnUrl) { back.href = me.returnUrl; back.hidden = false; }
  const list = $('#slots');
  list.replaceChildren();
  for (const slot of me.slots) {
    const { card, say } = slotCard(slot);
    list.append(card);
    if (notice && slot.id === focusSlot) say(notice, true);
  }
}

load();
