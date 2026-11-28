// ui/routes/shape/guide.mjs — Shaper ask screens: the composer's Guide (flag shaperSmallRuns). GET /api/shape/guide
// answers the viewer's Guide prefs and the name of the model a check would run on; PUT /api/shape/guide/prefs merges
// the viewer's prefs into their answerer record. Off, both are 404. No check runs here.
import { listModels, modelCostConfig, modelLabelOf } from '../../../src/core/config.mjs';
import { requireFlag } from '../../../src/core/flags.mjs';
import { resolveGuideModel } from '../../../src/core/guide-model.mjs';
import { guidePrefsFor, setGuidePrefsFor } from '../../../src/core/settings.mjs';
import { askViewer } from '../../server.mjs';

const message = (err) => String((err && err.message) || err);

export function register(app) {
  const gate = requireFlag('shaperSmallRuns');

  app.get('/api/shape/guide', gate, async (req, res) => {
    try {
      const { model } = resolveGuideModel(await listModels(''), modelCostConfig);
      res.json({ model: model ? { id: model, label: modelLabelOf(model) } : null, ...guidePrefsFor(askViewer(req)) });
    } catch (err) {
      res.status(500).json({ error: { code: 'GUIDE_READ_FAILED', message: message(err) } });
    }
  });

  app.put('/api/shape/guide/prefs', gate, async (req, res) => {
    try {
      res.json(await setGuidePrefsFor(askViewer(req), req.body));
    } catch (err) {
      if (err && err.code === 'BAD_GUIDE_PREFS') return res.status(400).json({ error: { code: 'BAD_GUIDE_PREFS', message: err.message } });
      res.status(500).json({ error: { code: 'GUIDE_SAVE_FAILED', message: message(err) } });
    }
  });
}
