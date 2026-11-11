// ui/public/currency-settings.mjs - Settings › General › Appearance: the currency AI costs show in
// (docs/display-currency.md; contract: plans note "Contrato - Moeda" v1.1). A SentencePicker in the row's sentence
// (`AI costs show in [US dollar (USD) ▾].`), the rate under it (`1 USD = 5.42 BRL · Frankfurter, rate of Nov 7`) and
// one quiet Update rate. The exchange-rate service is reached ONLY by a pick or Update rate: POST
// /api/settings/display-currency, whose server makes the call. Nothing here runs on boot, render or a timer.
// A save reloads this tab (Tarefa 1, A8: 17 files print costs, a live repaint would miss some); other tabs follow the
// settings-changed frame through `refresh()` (no reload: it would lose drafts). Split out of app.js so a test can drive it.
import { sentencePicker } from './design-system/components/settings-row.mjs';
import { button } from './design-system/components/button.mjs';
import { toElement } from './design-system/components/html.mjs';
import { toggleMenu as defaultToggleMenu } from './workflows/menu.mjs';
import { notify as defaultNotify } from './feedback.mjs';
import { iconSvg } from './icons.mjs';
import { displayCurrency, setDisplayCurrency, rateText } from './money.mjs';

export const CURRENCY_ROUTE = '/api/settings/display-currency';
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SOURCE_LABEL = { frankfurter: 'Frankfurter (European Central Bank)', 'open-er-api': 'ExchangeRate-API' };

/** `Nov 7, 2026` from `2026-11-07`; '' when it is not a date. */
function dayText(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  return m && MO[Number(m[2]) - 1] ? `${MO[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : '';
}

/**
 * The rate line under the sentence: `1 USD = 5.42 BRL · Frankfurter (European Central Bank), rate of Nov 7, 2026`.
 * '' in USD. Pure: reads money.mjs's current display currency.
 */
export function rateLine() {
  const dc = displayCurrency();
  const head = rateText();
  if (!head) return '';
  const src = SOURCE_LABEL[dc.source] || '';
  const day = dayText(dc.rateDate) || dayText(String(dc.rateAt || '').slice(0, 10));
  return [head, [src, day ? `rate of ${day}` : ''].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
}

/**
 * Why a save failed, in words, by the contract's `code` and the HTTP status (never by the server's text).
 * @param {number} status  0 = offline / no answer
 * @param {{error?:string, code?:string}} data
 * @param {string} code    the picked currency
 */
export function currencyErrorText(status, data, code) {
  const c = data && data.code;
  if (c === 'RATE_UNAVAILABLE' || status === 502) return `Could not get the exchange rate for ${code}. Costs still show in ${displayCurrency().currency}.`;
  if (c === 'RATE_LIMITED' || status === 429) return 'Too many rate requests. Try again in a minute.';
  if (c === 'BAD_CURRENCY' || status === 400) return `${code} is not a currency Worca can show.`;
  if (c === 'SAVE_FAILED' || status === 500) return 'Could not save the currency. Nothing changed.';
  if (!status) return 'Worca did not answer. Nothing changed.';
  return `The server answered ${status}. Nothing changed.`;
}

/**
 * Mount the currency row's live parts into the static markup of settings/settings.html (#currencySentence,
 * #currencyRate, #currencyActions).
 * @param {object} o
 * @param {Document} o.doc
 * @param {{code:string, name:string}[]} o.currencies  src/shared/currencies.mjs CURRENCIES
 * @param {typeof fetch} [o.fetchFn]
 * @param {() => void} [o.reload]   the controlled reload after a save
 * @param {Function} [o.notify]     feedback.mjs notify
 * @param {Function} [o.toggleMenu] workflows/menu.mjs toggleMenu
 * @param {number} [o.timeoutMs]    how long a save may take before the row gives up (the server tries two services, 5 s each)
 * @returns {{paint:() => void, refresh:() => Promise<boolean>, choose:(code:string) => Promise<boolean>, busy:() => boolean}}
 */
export function createCurrencySettings({ doc, currencies, fetchFn = (...a) => globalThis.fetch(...a), reload = () => doc.defaultView.location.reload(),
  notify = defaultNotify, toggleMenu = defaultToggleMenu, timeoutMs = 12000 }) {
  const sentenceEl = doc.getElementById('currencySentence');
  const rateEl = doc.getElementById('currencyRate');
  const actionsEl = doc.getElementById('currencyActions');
  const list = Array.isArray(currencies) ? currencies : [];
  let saving = null;   // the code being saved, or null
  let picker = null;
  let update = null;

  const nameOf = (code) => {
    const c = list.find((x) => x.code === code);
    return c ? `${c.name} (${c.code})` : code;
  };

  function paint() {
    if (!sentenceEl) return;
    const cur = displayCurrency().currency;
    const pick = toElement(doc, sentencePicker({ id: 'display-currency', text: saving ? `${nameOf(saving)}…` : nameOf(cur), items: [],
      tip: 'The currency every AI cost shows in. Costs are kept in USD; this only changes how they read.',
      chevron: iconSvg('chevron-down', 12) }));
    picker = pick.querySelector('.spick-b');
    picker.setAttribute('aria-label', `Currency: ${nameOf(cur)}`);
    if (saving) { picker.disabled = true; picker.setAttribute('aria-busy', 'true'); }
    picker.addEventListener('click', () => toggleMenu({ doc, anchor: picker, label: 'Show AI costs in', items: list.map((c) => ({
      label: `${c.name} (${c.code})`, checked: c.code === cur, onSelect: () => { void choose(c.code); },
    })) }));
    sentenceEl.replaceChildren('AI costs show in ', pick, '.');

    const line = rateLine();
    if (rateEl) { rateEl.textContent = line; rateEl.hidden = !line; }

    if (actionsEl) {
      actionsEl.replaceChildren();
      update = null;
      if (cur !== 'USD') {
        update = toElement(doc, button({ label: saving === cur ? 'Updating…' : 'Update rate', kind: 'quiet', cls: 'currency-update',
          title: 'Ask the exchange-rate service for today\'s rate', attrs: { disabled: !!saving, 'aria-busy': saving ? 'true' : null } }));
        update.addEventListener('click', () => { void choose(cur); });
        actionsEl.append(update);
      }
    }
  }

  /**
   * Save `code` (the same code again re-reads its rate). Only a 200 changes anything: then this tab reloads.
   * @returns {Promise<boolean>} true when saved
   */
  async function choose(code) {
    if (saving) return false;   // one save at a time: a double click never sends two
    saving = code;
    const focusUpdate = !!(update && doc.activeElement === update);
    paint();
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    let status = 0;
    let data = {};
    try {
      const res = await fetchFn(CURRENCY_ROUTE, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currency: code }), ...(ctl ? { signal: ctl.signal } : {}) });
      status = res.status;
      try { data = await res.json(); } catch { data = {}; }
      if (res.ok) {
        setDisplayCurrency(data);
        reload();
        return true;
      }
    } catch { status = 0; } finally { if (timer) clearTimeout(timer); }
    saving = null;
    paint();
    if (focusUpdate && update) update.focus();
    else if (picker) picker.focus();
    // The contract's `error` is written for people (no URL or stack); our own words when there is none (offline).
    const detail = status && typeof data.error === 'string' && data.error ? data.error : currencyErrorText(status, data, code);
    notify({ tone: 'err', title: 'Currency not changed', detail, key: 'display-currency' }, { doc });
    return false;
  }

  /**
   * Another tab saved: re-read the currency (GET, never the exchange-rate service), mirror it on <html> and repaint
   * this row. Figures already on screen change at their next paint; no reload.
   * @returns {Promise<boolean>} true when the currency or its rate changed
   */
  async function refresh() {
    let data;
    try {
      const res = await fetchFn(CURRENCY_ROUTE);
      if (!res || !res.ok) return false;
      data = await res.json();
    } catch { return false; }
    const changed = setDisplayCurrency(data);
    const dc = displayCurrency();
    const html = doc.documentElement;
    html.dataset.currency = dc.currency;
    html.dataset.currencyRate = String(dc.rate);
    if (!saving) paint();
    return changed;
  }

  paint();
  return { paint, refresh, choose, busy: () => !!saving };
}
