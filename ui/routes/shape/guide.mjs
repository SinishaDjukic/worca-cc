// ui/routes/shape/guide.mjs — Shaper ask screens: the composer's Guide (flag shaperSmallRuns). GET /api/shape/guide
// answers the viewer's Guide prefs and the name of the model a check would run on; PUT /api/shape/guide/prefs merges
// the viewer's prefs into their answerer record; POST /api/shape/guide/check checks a prompt on the Guide model
// (src/core/prompt-check/grade.mjs) and answers five checks in the role's wording. Off, all three are 404. The check
// path logs nothing: no prompt text, no reply, no error message.
import { listModels, modelCostConfig, modelLabelOf } from '../../../src/core/config.mjs';
import { budgetStatus, recordUtilityCost } from '../../../src/core/cost-budget.mjs';
import { requireFlag } from '../../../src/core/flags.mjs';
import { resolveGuideModel } from '../../../src/core/guide-model.mjs';
import { checkPrompt, claimGuideCheck, guideCheckModel, releaseGuideCheck } from '../../../src/core/prompt-check/grade.mjs';
import { guidePrefsFor, setGuidePrefsFor } from '../../../src/core/settings.mjs';
import { assertGuideCheckInput, guideRegister } from '../../../src/shared/prompt-check/assessment.mjs';
import { askViewer } from '../../server.mjs';

const message = (err) => String((err && err.message) || err);
const refuse = (res, status, code, msg) => res.status(status).json({ error: { code, message: msg } });

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

  // Gates in order: flag, input, the viewer's Guide switch, the cost limit, the model pick, the slot, then the call.
  app.post('/api/shape/guide/check', gate, async (req, res) => {
    try {
      let input;
      try { input = assertGuideCheckInput(req.body); } catch (err) {
        if (err && err.code && err.status) return refuse(res, err.status, err.code, err.message);
        throw err;
      }
      const viewer = askViewer(req);
      if (guidePrefsFor(viewer).on === false) return refuse(res, 409, 'GUIDE_OFF', 'Guide is off.');
      if (budgetStatus().blocked) return refuse(res, 429, 'GUIDE_COST_LIMIT', 'The cost limit is reached; Guide waits until it resets.');
      const { model, effort } = await guideCheckModel();
      if (!model) return refuse(res, 503, 'GUIDE_NO_MODEL', 'Guide has no model to run on.');
      const key = viewer ?? 'local';
      const ctl = claimGuideCheck(key);
      if (!ctl) return refuse(res, 429, 'GUIDE_BUSY', 'Guide is busy; try again in a moment.');
      const closed = new AbortController();
      res.on('close', () => { if (!res.writableEnded) closed.abort(); });
      try {
        const r = await checkPrompt({ text: input.text, register: guideRegister(input.role) }, {
          model, effort, signal: AbortSignal.any([ctl.signal, closed.signal]),
          onCost: (c) => { try { recordUtilityCost('guide', c); } catch { /* a ledger write never fails a check */ } },
        });
        if (closed.signal.aborted || res.headersSent) return undefined;
        if (!r.ok && r.reason === 'aborted') return refuse(res, 409, 'GUIDE_SUPERSEDED', 'A newer check replaced this one.');
        if (!r.ok) return refuse(res, 502, 'GUIDE_MODEL_FAILED', 'Guide is not answering right now.');
        return res.json({ ...r.result, model: { id: model, label: modelLabelOf(model) } });
      } finally {
        releaseGuideCheck(key, ctl);
      }
    } catch {
      // Express 4 does not catch a rejected async handler; the body is fixed, never the error's message.
      if (!res.headersSent) refuse(res, 500, 'GUIDE_CHECK_FAILED', 'Guide could not check the prompt.');
      return undefined;
    }
  });
}
