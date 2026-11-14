// ui/routes/images/images.mjs — Design pictures' image service (src/core/images.mjs): its state, the
// Providers row's Save and its Test picture. Never a key in an answer.
import { patchImages, providersState } from '../../../src/core/bridge/provider-ops.mjs';
import { imagesState, testImages } from '../../../src/core/images.mjs';
import { badRequest, emitChanged } from '../../server.mjs';

export function register(app) {

// Behind the global guards only (host and identity, agent caller), as /api/speech and the
// Providers page are: every signed-in person reads the same state, which holds no key. The
// index registers this module before /api/providers/:name, so that param route never sees "images".
app.get('/api/images', (_req, res) => {
  res.json(imagesState());
});

app.patch('/api/providers/images', async (req, res) => {
  try {
    await patchImages(req.body || {});
    emitChanged('settings-changed');
    res.json(await providersState());
  } catch (err) {
    return badRequest(res, err && err.message ? err.message : String(err));
  }
});

// The row tests what is ON SCREEN: unsaved fields are laid over the stored ones (testImages never throws).
app.post('/api/images/test', async (req, res) => {
  res.json(await testImages(req.body || {}));
});
}
