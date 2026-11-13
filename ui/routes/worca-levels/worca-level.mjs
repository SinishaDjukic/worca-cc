// ui/routes/worca-levels/worca-level.mjs — feature "worca-levels": the signed-in person's usage level.
// Identity comes only from resolveIdentity(req) inside the service; no route reads a person parameter.
// There is no route that sets an item, a level or doneAt: the level is derived from facts, and these routes
// only read the view, acknowledge what was shown, and note that a screen was opened.
import { createWorcaLevelService, WorcaLevelRequestError, VIEWED_TYPES } from '../../../src/core/worca-levels/service.mjs';
import { emitChanged, isFreshInstall } from '../../server.mjs';

const BAD_REQUEST = 'WORCA_LEVEL_BAD_REQUEST';
const UNAVAILABLE = 'WORCA_LEVEL_UNAVAILABLE';
const TYPE_MESSAGE = `type must be ${VIEWED_TYPES.map((t) => `"${t}"`).join(' or ')}`;

let service = null;
/** The one service instance, wired to the server's install check and change poke on first use. */
export function worcaLevelService() {
  service ??= createWorcaLevelService({ isFreshInstall, emitChanged });
  return service;
}

const refuse = (res, message) => res.status(400).json({ error: message, code: BAD_REQUEST });

function fail(res, err) {
  if (err instanceof WorcaLevelRequestError) return refuse(res, err.message);
  console.error('[worca-levels] request failed:', err?.stack || err);
  return res.status(500).json({ error: 'Could not read your level.', code: UNAVAILABLE });
}

/** The IANA zone a client sent, or undefined; the service ignores one it cannot use. */
const tzOf = (v) => (typeof v === 'string' ? v : undefined);

export function register(app) {

app.get('/api/worca-level', async (req, res) => {
  try { res.json(await worcaLevelService().getState(req, { tz: tzOf(req.query?.tz) })); }
  catch (err) { fail(res, err); }
});

app.post('/api/worca-level/ack', async (req, res) => {
  try {
    const { what, index, tz } = req.body ?? {};
    res.json(await worcaLevelService().ack(req, { what, index, tz: tzOf(tz) }));
  } catch (err) { fail(res, err); }
});

app.post('/api/worca-level/events', async (req, res) => {
  const { type, tz } = req.body ?? {};
  if (!VIEWED_TYPES.includes(type)) return refuse(res, TYPE_MESSAGE);
  try {
    await worcaLevelService().recordViewed(req, { type, tz: tzOf(tz) });
    res.status(204).end();
  } catch (err) { fail(res, err); }
});

}
