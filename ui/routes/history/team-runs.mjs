// ui/routes/history/team-runs.mjs — feature "history": teammates' runs from the worca-runs branch (run sharing s2).
// Read-only. Behind the Labs flag only, never the "Share my runs" switch (D9): reading works with sharing off.
import { requireFlag } from '../../../src/core/flags.mjs';
import { listTeamRuns } from '../../../src/core/runs-share/read.mjs';
import { tmProject } from '../../server.mjs';

export function register(app) {
app.get('/api/team-runs', requireFlag('runSharing'), async (req, res) => {
  let projectKey = null;
  if (req.query.project != null) {
    const p = await tmProject({ params: { key: String(req.query.project) } }, res); if (!p) return;
    projectKey = p.key;
  }
  try { res.json(await listTeamRuns({ projectKey })); }
  catch (err) {
    console.warn(`run sharing: team runs: ${err?.message || err}`);
    res.status(500).json({ error: 'could not list team runs' });
  }
});
}
