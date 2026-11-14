// ui/routes/scheduled-runs/keep-next.mjs — POST /api/schedules/:id/keep-next (Stillhet's "Keep next time"): undo the most
// recent "Skip next time" of a series. Its own file so ui/server.mjs (and its scheduleVerb) stays untouched; the answers
// and the frames are scheduleVerb's for skip-next.
import { actorOf } from '../../../src/core/identity.mjs';
import { keepNext, skippedNextOf } from '../../../src/core/scheduler.mjs';
import { emitChanged, findScheduleItem } from '../../server.mjs';

export function register(app) {
  app.post('/api/schedules/:id/keep-next', (req, res) => {
    try {
      const found = findScheduleItem(req.params.id);
      if (!found) return res.status(404).json({ error: 'schedule not found' });
      if (found.kind !== 'recurring') return res.status(404).json({ error: 'repeating schedule not found' });
      const s = keepNext(found.item.id, { by: actorOf(req) || undefined });
      if (!s) return res.status(404).json({ error: 'schedule not found' });   // deleted since the lookup
      if (s.refused === 'not-active') return res.status(409).json({ error: `this schedule is ${s.status}` });
      if (s.refused) return res.status(409).json({ error: 'nothing is skipped', code: 'nothing-skipped' });
      emitChanged('schedules-changed', 'keep-next');
      emitChanged('notifications-changed');
      res.json({ kind: 'recurring', item: { ...s, skippedRunAt: skippedNextOf(s.id) } });
    } catch (err) {
      console.error('[schedules] keep-next failed:', err);
      res.status(500).json({ error: 'could not keep next time', code: 'keep-failed' });
    }
  });
}
