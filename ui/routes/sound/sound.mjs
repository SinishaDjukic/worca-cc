// ui/routes/sound/sound.mjs — Design sound's ElevenLabs service (src/core/sound.mjs): its state, the
// Providers row's Save and Test, and a listed voice's sample. Never a key in an answer.
import { patchSound, providersState } from '../../../src/core/bridge/provider-ops.mjs';
import { soundState, testSound, voiceSample } from '../../../src/core/sound.mjs';
import { badRequest, emitChanged } from '../../server.mjs';

const VOICE_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

export function register(app) {

// Behind the global guards only (host and identity, agent caller), as /api/images and the
// Providers page are: every signed-in person reads the same state, which holds no key. The
// index registers this module before the models module, so PATCH /api/providers/:name and
// POST /api/providers/:name/test never see "sound".
app.get('/api/sound', (_req, res) => {
  res.json(soundState());
});

app.patch('/api/providers/sound', async (req, res) => {
  try {
    await patchSound(req.body || {});
    emitChanged('settings-changed');
    res.json(await providersState());
  } catch (err) {
    return badRequest(res, err && err.message ? err.message : String(err));
  }
});

// The row tests what is ON SCREEN: a typed key, else the stored one (testSound never throws).
app.post('/api/providers/sound/test', async (req, res) => {
  res.json(await testSound(req.body || {}));
});

// A voice's sample, fetched by the server with no key; only a voice listed since the server started has one.
app.get('/api/sound/voices/:id/sample', async (req, res) => {
  const id = String(req.params.id || '');
  const sample = VOICE_ID_RE.test(id) ? await voiceSample(id) : null;
  if (!sample) return res.status(404).json({ error: 'No such voice sample' });
  res.set({
    'Content-Type': sample.type,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=3600',
  });
  res.send(sample.bytes);
});
}
