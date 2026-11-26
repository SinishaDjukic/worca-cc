// ui/routes/worca-levels/worca-level.mjs — feature "worca-levels": the signed-in person's usage level.
// Identity comes only from resolveIdentity(req) inside the service; no route reads a person parameter.
// There is no route that sets an item, a level or doneAt: the level is derived from facts, and these routes
// only read the view, acknowledge what was shown, and note that a screen was opened.
import { createWorcaLevelService, WorcaLevelRequestError, VIEWED_TYPES } from '../../../src/core/worca-levels/service.mjs';
import { prStateEvents } from '../../../src/core/artifacts.mjs';
import { emitChanged, isFreshInstall } from '../../server.mjs';

const BAD_REQUEST = 'WORCA_LEVEL_BAD_REQUEST';
const BAD_KEY = 'WORCA_LEVEL_BAD_KEY';
const UNAVAILABLE = 'WORCA_LEVEL_UNAVAILABLE';
const TYPE_MESSAGE = `type must be ${VIEWED_TYPES.map((t) => `"${t}"`).join(' or ')}`;

let service = null;
/** The one service instance, wired to the server's install check and change poke on first use. */
export function worcaLevelService() {
  service ??= createWorcaLevelService({ isFreshInstall, emitChanged });
  return service;
}

/** Tell every open tab a level fact changed; a no-op until the first level request created the service. */
export function pokeWorcaLevel() {
  service?.pokeLevelFactsChanged();
}

// A run's stored PR state moved (merged…): a level fact changed, so every open tab re-reads. Wired here, not in
// ui/server.mjs, which is at its size cap (tools/split-by-feature/size-caps.json).
prStateEvents.on('changed', () => pokeWorcaLevel());

const refuse = (res, message) => res.status(400).json({ error: message, code: BAD_REQUEST });

function fail(res, err) {
  if (err instanceof WorcaLevelRequestError) return refuse(res, err.message);
  if (err?.code === BAD_KEY) console.warn(`[worca-levels] ${err.message}`);   // a person key the store refuses: the same 500, no stack
  else console.error('[worca-levels] request failed:', err?.stack || err);
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
    const { what, index, id, mode, answer, tz } = req.body ?? {};
    res.json(await worcaLevelService().ack(req, { what, index, id, mode, answer, tz: tzOf(tz) }));
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
