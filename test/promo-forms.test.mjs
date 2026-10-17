// test/promo-forms.test.mjs
// The Promo video workflow's two clarifier forms (promoSetup → promo-setup, promoVoice →
// promo-voice), held to the contract every other lane reads: the setup values and their
// defaults, the `when` rules that hide the mascot and audio fields, the masked ElevenLabs key
// (never shown, never stored), the attached-image gallery, the voice picker with one preview
// player per voice, and the MOCK_ASK_FORM lines that make a mock run raise the real forms.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAgentRegistry, DEFAULT_AGENTS_DIR } from '../src/core/agent-registry.mjs';
import { registryPortsFn } from '../src/core/graph/registry-ports.mjs';
import { runClarifierExecution } from '../src/core/graph/executor.mjs';
import { prepareFormAsk, redactSecrets } from '../src/core/ask-forms.mjs';
import { validateFormDef } from '../src/shared/forms/form-def.mjs';
import { autoAnswer, collectAnswer, checkAskData } from '../src/shared/forms/answer.mjs';
import { resolveAnswerSchema } from '../src/shared/forms/schema.mjs';
import { visibleFields } from '../src/shared/forms/layout.mjs';
import { checkRows } from './helpers/rows.mjs';

const REGISTRY = loadAgentRegistry(DEFAULT_AGENTS_DIR, { userAgentsDir: null, includePlugins: false });
const portsFn = registryPortsFn(REGISTRY);
const SETUP = REGISTRY.promoSetup?.ask?.forms?.['promo-setup'];
const VOICE = REGISTRY.promoVoice?.ask?.forms?.['promo-voice'];
const NARRATED = 'Narrated (ElevenLabs)';
const SILENT = 'Silent video';
const ENVKEY = 'env-SECRET-promo-123456';

/** The defaults every other lane relies on (plan "Setup values"). voiceGender and music are
 *  `when`-hidden on a silent run, so an unattended answer does not carry them. */
const SETUP_DEFAULTS = {
  tone: 'Playful', length: '60 s', pace: 'Lively', mascots: true,
  mascotSource: 'Design one for me', mascotAmount: 40, audio: SILENT,
};

const dirs = [];
after(async () => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 3 }))));
const prevHome = {};
before(async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-promo-forms-home-'));
  dirs.push(home);
  for (const k of ['HOME', 'USERPROFILE']) { prevHome[k] = process.env[k]; process.env[k] = home; }
});
after(() => { for (const [k, v] of Object.entries(prevHome)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

const scratch = async (p = 'worca-promo-forms-') => { const d = await mkdtemp(join(tmpdir(), p)); dirs.push(d); return d; };

const withEnv = async (vars, fn) => {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) { saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
};

/** gate 3 against a form's data, exactly as the engine runs it. */
const collect = (def, data, values) => collectAnswer(def, resolveAnswerSchema(def.answer, data), values);
const item = (def, field) => {
  const out = [];
  (function walk(items) { for (const i of items || []) { if (i.field === field) out.push(i); walk(i.children); for (const t of i.tabs || []) walk(t.children); } })(def.layout);
  return out[0];
};

/** The agent's prompt body (frontmatter stripped) — what production stamps on node.agentPrompt. */
async function agentBody(key) {
  const text = await readFile(join(DEFAULT_AGENTS_DIR, REGISTRY[key].agentFile), 'utf8');
  return text.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '');
}

/** A clarifier ctx through the REAL executor in mock mode, driven by the real sidecar + body. */
async function clarifierCtx(key, { askImpl, pipelineDir }) {
  const dir = pipelineDir || await scratch('worca-promo-clarify-');
  const meta = REGISTRY[key];
  const node = { id: `n_${key}`, kind: 'agent', key, x: 0, y: 0, config: {}, agentPrompt: await agentBody(key) };
  const ports = portsFn(node);
  const answers = meta.outputs.find((p) => p.id === 'answers');
  return {
    projectDir: dir, pipelineDir: dir, pipelineId: null, taskPrompt: 'Make a promo video of this app.',
    node, meta, ports, bindings: {},
    outputs: { answers: { path: join(dir, answers.filename), type: 'json' } },
    verdict: null, ordinal: 1, executionId: `x:${node.id}:1`,
    runCtx: { pipelineDir: dir, baseName: 'promo', secretEnv: {} },
    claudeOpts: { mock: true }, onEvent: () => {}, ask: askImpl,
  };
}

/** One transparent 1×1 PNG and a byte run the ask-files sniffer reads as MPEG audio (ID3v2). */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const MP3 = Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([4, 0, 0, 0, 0, 0, 0]), Buffer.alloc(256)]);

test('promo-setup: gate 1, the unattended answer is the defaults, and silent hides the audio fields', async () => {
  await checkRows([
    { name: 'promoSetup ships promo-setup through the registry normalizer, gate 1 clean', run: () => {
      assert.ok(SETUP, 'promoSetup must declare the promo-setup form');
      assert.deepEqual(validateFormDef(SETUP, { id: 'promo-setup' }).errors, []);
      assert.equal(REGISTRY.promoSetup.outputs[0].filename, 'promo-setup.json');
      assert.equal(REGISTRY.promoSetup.outputs[0].artifactKind, 'promo-setup');
    } },
    { name: 'the unattended answer is Playful · 60 s · Lively · mascots on at 40 · silent, no key', run: () => {
      for (const data of [SETUP.example, { images: [] }, {}]) {
        assert.equal(checkAskData(SETUP, data).ok, true, JSON.stringify(checkAskData(SETUP, data).errors));
        const auto = autoAnswer(SETUP, data);
        assert.deepEqual(auto, SETUP_DEFAULTS);
        assert.equal('apiKey' in auto, false, 'no key in an unattended answer');
        assert.deepEqual(collect(SETUP, data, auto).errors, [], 'D10: auto passes gate 3');
      }
    } },
    { name: 'the value sets are the contract strings', run: () => {
      const p = SETUP.answer.properties;
      assert.deepEqual(p.tone.enum, ['Playful', 'Professional', 'Bold', 'Calm']);
      assert.deepEqual(p.length.enum, ['30 s', '60 s', '90 s', '2.5 min']);
      assert.deepEqual(p.pace.enum, ['Relaxed', 'Lively', 'Fast']);
      assert.deepEqual(p.mascotSource.enum, ['Design one for me', 'Use my attached image']);
      assert.deepEqual(p.audio.enum, [NARRATED, SILENT]);
      assert.deepEqual(p.voiceGender.enum, ['Female', 'Male', 'Either']);
      assert.equal(p.voiceGender.default, 'Either');
      assert.equal(p.music.default, true);
      assert.equal(p.mascotAmount.type, 'integer');
      assert.deepEqual([p.mascotAmount.minimum, p.mascotAmount.maximum, p.mascotAmount.default], [0, 100, 40]);
    } },
  ]);
});

test('promo-setup: `when` hides the mascot fields when mascots are off and the audio fields when silent', async () => {
  const everything = {
    tone: 'Bold', length: '30 s', pace: 'Fast', mascots: true, mascotSource: 'Use my attached image',
    mascotImage: 'extras/mascot.png', mascotAmount: 80, audio: NARRATED, apiKey: 'typed-key',
    voiceGender: 'Male', music: false,
  };
  const data = SETUP.example;
  await checkRows([
    { name: 'mascots on + narrated + attached image keeps every field', run: () => {
      const { values, errors } = collect(SETUP, data, everything);
      assert.deepEqual(errors, []);
      assert.deepEqual(values, everything);
    } },
    { name: 'mascots off drops mascotSource, mascotImage and mascotAmount', run: () => {
      const { values, errors } = collect(SETUP, data, { ...everything, mascots: false });
      assert.deepEqual(errors, []);
      for (const k of ['mascotSource', 'mascotImage', 'mascotAmount']) assert.equal(k in values, false, k);
      assert.equal(values.mascots, false);
    } },
    { name: 'a designed mascot drops the image pick', run: () => {
      const { values } = collect(SETUP, data, { ...everything, mascotSource: 'Design one for me' });
      assert.equal('mascotImage' in values, false);
      assert.equal(values.mascotAmount, 80);
    } },
    { name: 'silent drops the key, the voice and the music (a stale key never survives)', run: () => {
      const { values, errors } = collect(SETUP, data, { ...everything, audio: SILENT });
      assert.deepEqual(errors, []);
      for (const k of ['apiKey', 'voiceGender', 'music']) assert.equal(k in values, false, k);
    } },
    { name: 'the visible fields follow the answers', run: () => {
      assert.deepEqual(visibleFields(SETUP.layout, SETUP_DEFAULTS).sort(),
        ['audio', 'length', 'mascotAmount', 'mascotSource', 'mascots', 'pace', 'tone']);
      assert.deepEqual(visibleFields(SETUP.layout, { ...SETUP_DEFAULTS, mascots: false, audio: NARRATED }).sort(),
        ['apiKey', 'audio', 'length', 'mascots', 'music', 'pace', 'tone', 'voiceGender']);
    } },
  ]);
});

test('promo-setup: the key is a masked secret from ELEVENLABS_API_KEY; the amount slider reads Cameo → Star of the show', async () => {
  await checkRows([
    { name: 'the apiKey item is secret, mono, envDefault ELEVENLABS_API_KEY, only when narrated', run: () => {
      const key = item(SETUP, 'apiKey');
      assert.equal(key.widget, 'text');
      assert.equal(key.secret, true);
      assert.equal(key.envDefault, 'ELEVENLABS_API_KEY');
      assert.equal(key.mono, true);
      assert.deepEqual(key.when, { audio: NARRATED });
      const s = SETUP.answer.properties.apiKey;
      for (const k of ['default', 'defaultFrom', 'enum', 'enumFrom']) assert.equal(s[k], undefined, k);
      assert.equal((SETUP.answer.required || []).includes('apiKey'), false);
    } },
    { name: 'the slider labels its ends', run: () => {
      const slider = item(SETUP, 'mascotAmount');
      assert.equal(slider.widget, 'slider');
      assert.equal(slider.minLabel, 'Cameo');
      assert.equal(slider.maxLabel, 'Star of the show');
      assert.deepEqual(slider.when, { mascots: true });
    } },
    { name: 'the choice widgets are the spec’s: tone cards, length/pace/audio/voice segmented, two toggles', run: () => {
      assert.equal(item(SETUP, 'tone').style, 'cards');
      for (const f of ['length', 'pace', 'audio', 'voiceGender', 'mascotSource']) assert.equal(item(SETUP, f).style, 'segmented', f);
      for (const f of ['mascots', 'music']) assert.equal(item(SETUP, f).widget, 'toggle', f);
      assert.equal(item(SETUP, 'mascotImage').widget, 'gallery');
    } },
  ]);
});

test('promo-setup through the real clarifier (mock): the form is raised, an env key is reported set and stored as a marker', async () => {
  await withEnv({ ELEVENLABS_API_KEY: ENVKEY }, async () => {
    const seen = [];
    const ctx = await clarifierCtx('promoSetup', { askImpl: async (q) => {
      seen.push(q);
      return { form: q.form, version: q.version, values: { ...SETUP_DEFAULTS, audio: NARRATED, apiKey: '', voiceGender: 'Female', music: true } };
    } });
    const out = await runClarifierExecution(ctx);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].form, 'promo-setup', 'the MOCK_ASK_FORM line raises the real form');
    assert.equal(seen[0].layout.find((i) => i.field === 'apiKey').envSet, true);
    assert.ok(!JSON.stringify(seen[0]).includes(ENVKEY), 'the broadcast ask never carries the key');
    const text = await readFile(ctx.outputs.answers.path, 'utf8');
    assert.ok(!text.includes(ENVKEY), 'promo-setup.json carries no key');
    const file = JSON.parse(text);
    assert.equal(file.form, 'promo-setup');
    assert.equal(file.values.apiKey, '[env:ELEVENLABS_API_KEY]');
    assert.equal(file.values.voiceGender, 'Female');
    assert.equal(ctx.runCtx.secretEnv.ELEVENLABS_API_KEY, ENVKEY, 'held in memory for the script children');
    assert.ok(!JSON.stringify(out.values).includes(ENVKEY));
    // redactSecrets is the one place a typed key is swapped: typed wins, and is never stored
    const typed = redactSecrets({ audio: NARRATED, apiKey: 'typed-key-999' }, { apiKey: { env: 'ELEVENLABS_API_KEY', value: ENVKEY } });
    assert.equal(typed.values.apiKey, '[typed]');
  });
});

test('promo-setup unattended through the real clarifier: the defaults land in promo-setup.json', async () => {
  await withEnv({ ELEVENLABS_API_KEY: undefined }, async () => {
    const ctx = await clarifierCtx('promoSetup', { askImpl: undefined });
    await runClarifierExecution(ctx);
    const file = JSON.parse(await readFile(ctx.outputs.answers.path, 'utf8'));
    assert.deepEqual({ form: file.form, version: file.version }, { form: 'promo-setup', version: 1 });
    // redactSecrets stamps a secret field's marker even when nothing is held: '' = no key anywhere
    const { apiKey, ...rest } = file.values;
    assert.equal(apiKey ?? '', '', 'no key: an empty marker (or none), never a value');
    assert.deepEqual(rest, SETUP_DEFAULTS);
    assert.deepEqual(ctx.runCtx.secretEnv, {});
  });
});

test('promo-setup: attached images become a gallery the person can pick from', async () => {
  const dir = await scratch();
  await mkdir(join(dir, 'extras'), { recursive: true });
  await writeFile(join(dir, 'extras', 'mascot.png'), PNG);
  await writeFile(join(dir, 'extras', 'logo.png'), PNG);
  const data = {
    images: [
      { id: 'extras/mascot.png', file: 'extras/mascot.png', name: 'mascot.png' },
      { id: 'extras/logo.png', file: 'extras/logo.png', name: 'logo.png' },
    ],
    defaultImage: 'extras/mascot.png',
  };
  const r = await prepareFormAsk({ agentMeta: REGISTRY.promoSetup, payload: { form: 'promo-setup', data },
    cwd: dir, pipelineDir: dir, askId: 'clarify-n_setup-1', env: {} });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.ask.fileRefs.map((f) => f.path), ['data.images[0].file', 'data.images[1].file']);
  assert.deepEqual(r.ask.files.map((f) => f.mime), ['image/png', 'image/png']);
  assert.equal(r.ask.answerSchema.properties.mascotImage.default, 'extras/mascot.png', 'the first image is preselected');
  const picked = collect(SETUP, data, { ...SETUP_DEFAULTS, mascotSource: 'Use my attached image', mascotImage: 'extras/logo.png' });
  assert.deepEqual(picked.errors, []);
  assert.equal(picked.values.mascotImage, 'extras/logo.png');
  const bad = collect(SETUP, data, { ...SETUP_DEFAULTS, mascotSource: 'Use my attached image', mascotImage: 'extras/elsewhere.png' });
  assert.ok(bad.errors.some((e) => e.path === 'mascotImage'), 'only an attached image can be picked');
});

const VOICES = [
  { id: 'voice-a1', name: 'Ava', gender: 'female', accent: 'american', description: 'warm narrator', preview: 'promo/voices/voice-a1.mp3',
    label: '1 · Ava', about: 'female · american — warm narrator' },
  { id: 'voice-b2', name: 'Bea', gender: 'female', accent: 'british', description: 'bright, quick', preview: 'promo/voices/voice-b2.mp3',
    label: '2 · Bea', about: 'female · british — bright, quick' },
];

test('promo-voice: the unattended pick is the first voice; no voices cannot be asked', async () => {
  await checkRows([
    { name: 'promoVoice ships promo-voice, gate 1 clean, answers port promo-voice.json', run: () => {
      assert.ok(VOICE, 'promoVoice must declare the promo-voice form');
      assert.deepEqual(validateFormDef(VOICE, { id: 'promo-voice' }).errors, []);
      assert.equal(REGISTRY.promoVoice.outputs[0].filename, 'promo-voice.json');
      assert.equal(REGISTRY.promoVoice.outputs[0].artifactKind, 'promo-voice');
      assert.deepEqual(REGISTRY.promoVoice.inputs.map((p) => [p.id, p.type, p.as, p.required]), [['voices', 'json', 'file', true]]);
    } },
    { name: 'two voices: auto picks the first id, with or without defaultVoice', run: () => {
      for (const data of [{ voices: VOICES, defaultVoice: 'voice-a1' }, { voices: VOICES }, { voices: VOICES.map(({ preview, ...v }) => v) }]) { // eslint-disable-line no-unused-vars
        assert.equal(checkAskData(VOICE, data).ok, true, JSON.stringify(checkAskData(VOICE, data).errors));
        assert.deepEqual(autoAnswer(VOICE, data), { voiceId: 'voice-a1' });
      }
      assert.deepEqual(collect(VOICE, { voices: VOICES }, { voiceId: 'voice-b2' }).errors, []);
      assert.ok(collect(VOICE, { voices: VOICES }, { voiceId: 'someone-else' }).errors.length, 'only a listed voice');
    } },
    { name: 'no voices: gate 2 refuses the form — the agent writes no questions instead', run: () => {
      assert.equal(checkAskData(VOICE, { voices: [] }).ok, false);
      assert.equal(checkAskData(VOICE, {}).ok, false);
    } },
    { name: 'one media player per slot and a card per voice', run: () => {
      const media = [];
      (function walk(items) { for (const i of items || []) { if (i.widget === 'media') media.push(i.bind); walk(i.children); } })(VOICE.layout);
      assert.deepEqual(media, ['data.preview1', 'data.preview2', 'data.preview3', 'data.preview4', 'data.preview5', 'data.preview6']);
      const pick = item(VOICE, 'voiceId');
      assert.equal(pick.widget, 'select');
      assert.deepEqual(pick.options, { from: 'data.voices', value: 'id', label: 'label', description: 'about' });
      assert.equal(VOICE.data.properties.voices.maxItems, 6);
    } },
  ]);
});

test('promo-voice: previews are snapshotted as audio, one per slot', async () => {
  const dir = await scratch();
  await mkdir(join(dir, 'promo', 'voices'), { recursive: true });
  for (const v of VOICES) await writeFile(join(dir, v.preview), MP3);
  const data = { headline: '2 female voices for narration. Play each one, then pick.', voices: VOICES, defaultVoice: 'voice-a1',
    preview1: VOICES[0].preview, preview2: VOICES[1].preview };
  const r = await prepareFormAsk({ agentMeta: REGISTRY.promoVoice, payload: { form: 'promo-voice', data },
    cwd: dir, pipelineDir: dir, askId: 'clarify-n_voice-1', env: {} });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.ok(r.ask.fileRefs.some((f) => f.path === 'data.preview1' && f.rel === VOICES[0].preview));
  assert.ok(r.ask.fileRefs.some((f) => f.path === 'data.preview2' && f.rel === VOICES[1].preview));
  assert.ok(r.ask.files.every((f) => f.mime === 'audio/mpeg'));
  assert.deepEqual(r.autoValues, { voiceId: 'voice-a1' });
});

test('promo-voice through the real clarifier (mock) raises the real form; unattended takes the first voice', async () => {
  const seen = [];
  const asked = await clarifierCtx('promoVoice', { askImpl: async (q) => { seen.push(q); return { form: q.form, version: q.version, values: { voiceId: q.autoValues.voiceId } }; } });
  await runClarifierExecution(asked);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].form, 'promo-voice', 'the MOCK_ASK_FORM line raises the real form');
  const unattended = await clarifierCtx('promoVoice', { askImpl: undefined });
  await runClarifierExecution(unattended);
  const file = JSON.parse(await readFile(unattended.outputs.answers.path, 'utf8'));
  assert.equal(file.form, 'promo-voice');
  assert.equal(typeof file.values.voiceId, 'string');
  assert.equal(file.values.voiceId, seen[0].autoValues.voiceId);
});
