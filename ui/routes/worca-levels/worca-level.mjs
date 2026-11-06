// ui/routes/worca-levels/worca-level.mjs — feature "worca-levels": the signed-in person's usage level.
// Identity comes only from resolveIdentity(req) inside the service; no route reads a person parameter.
import { createWorcaLevelService, WorcaLevelRequestError, personOf } from '../../../src/core/worca-levels/service.mjs';
import { badRequest, emitChanged, isFreshInstall } from '../../server.mjs';

const STATS_VIEWED = 'stats-viewed';

let service = null;
/** The one service instance, wired to the server's install check and change poke on first use. */
export function worcaLevelService() {
  service ??= createWorcaLevelService({ isFreshInstall, emitChanged });
  return service;
}

const LIVE_STATUS = /^(running|starting|created|pausing)$/i;

/** A run was just added to the runs map: record the starter's count of live runs as their peak (a shared install
 *  counts only the runs the same person started; a single install counts them all). Never throws. */
export function noteRunStarted(runs, entry, req) {
  const { person, shared } = personOf(req);
  if (shared && !entry.startedBy) return;
  const mine = (r) => r.kind === 'run' && LIVE_STATUS.test(String(r.status || '')) && (!shared || r.startedBy === entry.startedBy);
  const peakParallel = [...runs.values()].filter(mine).length;
  worcaLevelService().noteLiveEvent(shared ? entry.startedBy.toLowerCase() : person, { peakParallel })
    .catch((err) => console.error(`[worca-levels] live run event not recorded: ${err?.message || err}`));
}

function fail(res, err) {
  if (err instanceof WorcaLevelRequestError) return badRequest(res, err.message);
  console.error('[worca-levels] request failed:', err?.stack || err);
  return res.status(500).json({ error: 'Could not read your level.' });
}

export function register(app) {

app.get('/api/worca-level', async (req, res) => {
  try { res.json(await worcaLevelService().getState(req)); }
  catch (err) { fail(res, err); }
});

app.post('/api/worca-level/ack', async (req, res) => {
  try { res.json(await worcaLevelService().ack(req, { what: req.body?.what, index: req.body?.index })); }
  catch (err) { fail(res, err); }
});

app.post('/api/worca-level/events', async (req, res) => {
  if (req.body?.type !== STATS_VIEWED) return badRequest(res, `type must be "${STATS_VIEWED}"`);
  try {
    await worcaLevelService().recordStatsViewed(req);
    res.status(204).end();
  } catch (err) { fail(res, err); }
});

}
