// ui/routes/settings/display-currency.mjs — feature "settings": the display currency (docs/display-currency.md).
// Costs stay USD everywhere; this picks how they are SHOWN. The POST is the only place Worca calls an exchange-rate
// provider, and only for a currency other than USD: GET never touches the network, nor does the shell render
// (it reads the stored value into <html data-currency>). Its own route, not POST /api/settings, because a save
// can fail upstream (502) and that route answers every failure with 400.
// Contract: the 'Contrato - Moeda' note / docs/display-currency.md. Errors are fixed sentences: a provider's
// message or URL never reaches the body, the real reason goes to the log in one line.
import { CURRENCY_CODES, DEFAULT_CURRENCY, isSupportedCurrency } from '../../../src/shared/currencies.mjs';
import { displayCurrency, setDisplayCurrency } from '../../../src/core/settings.mjs';
import { fetchDisplayRate, fxTryConsume, serializeDisplayCurrency } from '../../../src/core/display-currency-fx.mjs';
import { agentMayBeCaller, emitChanged, refuseAgentCaller } from '../../server.mjs';

const BAD_CURRENCY_TEXT = `currency must be one of ${CURRENCY_CODES.join(', ')}`;

export function register(app) {
app.get('/api/settings/display-currency', (req, res) => {
  res.json(displayCurrency());
});

app.post('/api/settings/display-currency', async (req, res) => {
  // The route makes the server call out to the network: an agent on this machine does not get to trigger that.
  if (agentMayBeCaller(req)) return refuseAgentCaller(res);
  const b = req.body || {};
  const currency = b.currency;
  if (!isSupportedCurrency(currency)) return res.status(400).json({ error: BAD_CURRENCY_TEXT, code: 'BAD_CURRENCY', field: 'currency' });
  if (currency !== DEFAULT_CURRENCY && !fxTryConsume()) {
    return res.status(429).json({ error: 'Too many currency changes. Try again in a moment.', code: 'RATE_LIMITED' });
  }
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ac.abort(); });
  try {
    const saved = await serializeDisplayCurrency(async () => {
      if (ac.signal.aborted) return null;   // the page left while an earlier save ran: nothing to do
      let next = { currency: DEFAULT_CURRENCY, rate: 1, rateDate: null, rateAt: null, source: 'fixed' };
      if (currency !== DEFAULT_CURRENCY) {
        const q = await fetchDisplayRate(currency, { signal: ac.signal });
        if (ac.signal.aborted) return null;   // nobody is waiting for this rate: do not store it
        next = { currency, rate: q.rate, rateDate: q.rateDate ?? null, rateAt: new Date().toISOString(), source: q.source };
      }
      try { return await setDisplayCurrency(next); } catch (err) { throw Object.assign(err, { saveFailed: true }); }
    });
    if (!saved) return;
    emitChanged('settings-changed');   // the other tabs re-read it (contract R6)
    res.json(saved);
  } catch (err) {
    if (res.headersSent || ac.signal.aborted) return;
    if (err && err.saveFailed) {
      console.warn(`[worca-ui] display currency: save failed (${(err && err.code) || 'error'})`);
      return res.status(500).json({ error: 'Could not save the display currency.', code: 'SAVE_FAILED' });
    }
    const why = err && Array.isArray(err.reasons) && err.reasons.length ? err.reasons.join('; ') : (err && err.message) || 'error';
    console.warn(`[worca-ui] display currency: no rate for ${currency} (${why})`);
    res.status(502).json({ error: `Could not get the exchange rate for ${currency}. The currency was not changed.`, code: 'RATE_UNAVAILABLE' });
  }
});
}
