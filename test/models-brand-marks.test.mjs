// test/models-brand-marks.test.mjs — the Models page's brand marks (models-menu P1 Task 2, contract C3): the slug
// tables name real files of the icon pack, vendorOf works a model's vendor out (L3), and the tiles draw a mark, the
// worca mark or a plugin's bag, never a broken image.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { ENGINE_NAMES } from '../src/shared/engine-switch.mjs';
import { iconSvg } from '../ui/public/icons.mjs';
import {
  HARNESS_MARKS, PROVIDER_MARKS, VENDOR_MARKS, vendorOf, markUrl, gradientOf, markTile, modelMark, markedSelect, paintMarkedSelect,
} from '../ui/public/models/brand-marks.mjs';
import { renderEndpointSheet } from '../ui/public/bridge-view.mjs';
import { catalogEntryForEndpointModel } from '../src/core/bridge/providers/endpoint.mjs';
import { copilotCatalogId } from '../src/core/bridge/providers/copilot.mjs';
import { suggestModelHandle } from '../src/shared/connections.mjs';
import { suggestDuplicateId, suggestDuplicateLabel } from '../ui/public/models-view.mjs';

const PACK_DIR = path.join(path.dirname(createRequire(import.meta.url).resolve('@lobehub/icons-static-svg/package.json')), 'icons');
const GRADIENTS = ['indigo', 'teal', 'pink', 'blue', 'lime', 'slate'];

const doms = [];
afterEach(() => { for (const d of doms.splice(0)) d.window.close(); });
const docOf = () => { const d = new JSDOM('<!doctype html><body></body>'); doms.push(d); return d.window.document; };

test('every slug of the three tables is a file of the pack (exact case)', () => {
  const files = new Set(readdirSync(PACK_DIR));
  const slugs = [...Object.values(HARNESS_MARKS), ...Object.values(PROVIDER_MARKS), ...Object.values(VENDOR_MARKS).map((v) => v.slug)];
  assert.equal(slugs.length, 8 + 4 + 17);
  for (const slug of slugs) assert.ok(files.has(`${slug}.svg`), `${slug}.svg is in the pack`);
});

test('the tables: one mark per engine, the four providers, the vendors with their names', () => {
  assert.deepEqual(Object.keys(HARNESS_MARKS).sort(), [...ENGINE_NAMES].sort());
  assert.deepEqual(HARNESS_MARKS, {
    claude: 'claudecode-color', codex: 'codex-color', copilot: 'githubcopilot', cursor: 'cursor',
    gemini: 'geminicli-color', goose: 'goose', opencode: 'opencode', qwen: 'qwen-color',
  });
  assert.deepEqual(Object.keys(PROVIDER_MARKS).sort(), ['anthropic', 'copilot', 'openai', 'openrouter']);
  assert.deepEqual(PROVIDER_MARKS, { copilot: 'githubcopilot', openrouter: 'openrouter', openai: 'openai', anthropic: 'anthropic' });
  assert.equal(HARNESS_MARKS.copilot, 'githubcopilot');
  assert.equal(VENDOR_MARKS.amazon.slug, 'aws-color');
  assert.equal(VENDOR_MARKS.anthropic.slug, 'claude-color');
  assert.deepEqual(Object.entries(VENDOR_MARKS).map(([k, v]) => [k, v.slug, v.name]), [
    ['anthropic', 'claude-color', 'Anthropic'], ['openai', 'openai', 'OpenAI'], ['google', 'google-color', 'Google'],
    ['xai', 'xai', 'xAI'], ['microsoft', 'microsoft-color', 'Microsoft'], ['moonshot', 'moonshot', 'Moonshot AI'],
    ['baidu', 'baidu-color', 'Baidu'], ['meta', 'meta-color', 'Meta'], ['mistral', 'mistral-color', 'Mistral'],
    ['deepseek', 'deepseek-color', 'DeepSeek'], ['qwen', 'qwen-color', 'Qwen'], ['zhipu', 'zhipu-color', 'Zhipu'],
    ['cohere', 'cohere-color', 'Cohere'], ['nvidia', 'nvidia-color', 'NVIDIA'], ['perplexity', 'perplexity-color', 'Perplexity'],
    ['amazon', 'aws-color', 'Amazon'], ['minimax', 'minimax-color', 'MiniMax'],
  ]);
  assert.equal(markUrl('openai'), '/vendor/brand-icons/openai.svg');
});

test('vendorOf: the upstream prefix through the aliases, a built-in by engine, a family guess, else null', () => {
  const rows = [
    [{ id: 'openrouter-x-ai-grok-4-7', upstream: { provider: 'openai', model: 'x-ai/grok-4.7' } }, 'xai'],
    [{ id: 'openrouter-qwen-qwen3-8-27b-free', upstream: { provider: 'openai', model: 'qwen/qwen3.8-27b:free' } }, 'qwen'],
    [{ id: 'claude-opus-5-5', label: 'Opus 5.5' }, 'anthropic'],
    [{ id: 'gpt-6.1-sol', engine: 'codex' }, 'openai'],
    [{ id: 'copilot/gemini-4-argon', engine: 'copilot', label: 'Gemini 4 Argon' }, 'google'],
    [{ id: 'copilot-mai-code-1.1-flash', label: 'MAI-Code-1.1-Flash (Copilot)', upstream: { provider: 'copilot', model: 'mai-code-1.1-flash' } }, 'microsoft'],
    // Rule 1 falls through (no such vendor) and rule 3 reads the id and the label, never the upstream model (L3).
    [{ id: 'openrouter-nousresearch-hermes-4-llama-3-1-405b', label: 'Hermes 4 Llama 3.1 405B', upstream: { provider: 'openai', model: 'nousresearch/hermes-4-llama-3.1-405b' } }, 'meta'],
    [{ id: 'acme', upstream: { provider: 'openai', model: 'unknownco/llama-x' } }, null],
    [{ id: 'acme-stable', label: 'acme-stable' }, null],
    // The suffix an import adds names the connection, never the vendor (the walk: stub-a got OpenAI's mark).
    [{ id: 'local-stub-a', label: 'stub-a (OpenAI-compatible)', upstream: { provider: 'openai', model: 'stub-a' } }, null],
    [{ id: 'x', label: 'Acme X (Copilot)', upstream: { provider: 'copilot', model: 'acme-x' } }, null],
    [{ id: 'local-gpt-oss', label: 'gpt-oss (OpenAI-compatible)', upstream: { provider: 'openai', model: 'gpt-oss' } }, 'openai'],
    [{ id: '' }, null],
    [{ id: 'x', upstream: { provider: 'openai', model: 'unknownco/thing' } }, null],
    [{ id: 'x', upstream: { provider: 'openai', model: 'constructor/thing' } }, null],
    // The aliases, case-folded, on ids no family matches; and the prefix wins over a family the id names.
    [{ id: 'acme-1', upstream: { provider: 'openai', model: 'X-AI/acme-1' } }, 'xai'],
    [{ id: 'acme-2', upstream: { provider: 'openai', model: 'Meta-Llama/acme-2' } }, 'meta'],
    [{ id: 'acme-3', upstream: { provider: 'openai', model: 'mistralai/acme-3' } }, 'mistral'],
    [{ id: 'acme-4', upstream: { provider: 'openai', model: 'moonshotai/acme-4' } }, 'moonshot'],
    [{ id: 'acme-5', upstream: { provider: 'openai', model: 'z-ai/acme-5' } }, 'zhipu'],
    [{ id: 'acme-6', upstream: { provider: 'openai', model: 'perplexity/acme-6' } }, 'perplexity'],
    [{ id: 'openrouter-nvidia-llama-x', upstream: { provider: 'openai', model: 'nvidia/llama-x' } }, 'nvidia'],
    // A built-in Codex model is OpenAI's whatever its id; a row with upstream or env keys is not a built-in.
    [{ id: 'arctic-1', engine: 'codex' }, 'openai'],
    [{ id: 'arctic-1', engine: 'codex', env: {} }, 'openai'],
    [{ id: 'arctic-1', engine: 'codex', env: { OPENAI_BASE_URL: 'http://127.0.0.1:1' } }, null],
    [{ id: 'arctic-1', engine: 'codex', upstream: { provider: 'openai', model: 'arctic-1' } }, null],
    // Family guess: first match wins, in the rules' order.
    [{ id: 'devstral-medium' }, 'mistral'],
    [{ id: 'o3-mini' }, 'openai'],
    [{ id: 'phi-5' }, 'microsoft'],
    [{ id: 'glm-5', label: 'GLM 5' }, 'zhipu'],
    [{ id: 'command-r-plus' }, 'cohere'],
    [{ id: 'nova-pro' }, 'amazon'],
    [{ id: 'ernie-5' }, 'baidu'],
    [{ id: 'kimi-k3' }, 'moonshot'],
    [{ id: 'minimax-m3' }, 'minimax'],
    [{ id: 'deepseek-v4' }, 'deepseek'],
    [{ id: 'qwq-32b' }, 'qwen'],
    [{ id: 'x', label: 'Fable 5.2' }, 'anthropic'],
    [{ id: 'gemma-4' }, 'google'],
    [{ id: 'grok-5' }, 'xai'],
    [{ id: 'llama-4' }, 'meta'],
    // An endpoint import: the server's id prefix and the server's name in the label are not the vendor ("ollama" and
    // "llama.cpp" hold Meta's family word), so the family guess reads the model's own name (CAT-11).
    [{ id: 'ollama-qwen3-coder-30b', label: 'qwen3-coder:30b (Ollama)', upstream: { provider: 'openai', model: 'qwen3-coder:30b' } }, 'qwen'],
    [{ id: 'llama-qwen3-8b-q4', label: 'Qwen3-8B-Q4.gguf (llama.cpp)', upstream: { provider: 'openai', model: 'Qwen3-8B-Q4.gguf' } }, 'qwen'],
    [{ id: 'ollama-glm-4-7-flash-latest', label: 'glm-4.7-flash:latest (Ollama)', upstream: { provider: 'openai', model: 'glm-4.7-flash:latest' } }, 'zhipu'],
    [{ id: 'ollama-deepseek-r1-8b', label: 'deepseek-r1:8b (Ollama)', upstream: { provider: 'openai', model: 'deepseek-r1:8b' } }, 'deepseek'],
    [{ id: 'ollama-llama3-1-8b', label: 'llama3.1:8b (Ollama)', upstream: { provider: 'openai', model: 'llama3.1:8b' } }, 'meta'],
    [{ id: 'lmstudio-mistral-small', label: 'mistral-small (LM Studio)', upstream: { provider: 'openai', model: 'mistral-small' } }, 'mistral'],
    // A label the user renamed keeps the guess on the id; an id that IS the upstream model keeps its first word (the
    // import sheet's rows); a server name that is the vendor's stays a clue.
    [{ id: 'ollama-qwen3-coder-30b', label: 'My coder', upstream: { provider: 'openai', model: 'qwen3-coder:30b' } }, 'qwen'],
    [{ id: 'llama-3.1-8b.gguf', label: '', upstream: { provider: 'openai', model: 'llama-3.1-8b.gguf' } }, 'meta'],
    [{ id: 'google-learnlm-2-0-flash', label: 'learnlm-2.0-flash (Google Gemini)', upstream: { provider: 'openai', model: 'learnlm-2.0-flash' } }, 'google'],
    // An id typed by hand is not a minted handle (its rest is not its upstream model's name): its first word is the model's.
    [{ id: 'llama-4-scout', label: 'Scout', upstream: { provider: 'openai', model: 'llama4:scout' } }, 'meta'],
    [{ id: 'llama-coder', label: 'Coder', upstream: { provider: 'openai', model: 'codellama:13b' } }, 'meta'],
    [{ id: 'llama-guard', label: 'Guard', upstream: { provider: 'openai', model: 'llama-guard3:8b' } }, 'meta'],
    // Only a cut slug (48 characters and more) matches by its start: a short rest is a word of the name, not its handle.
    [{ id: 'llama-code', label: 'Code', upstream: { provider: 'openai', model: 'codellama:7b' } }, 'meta'],
  ];
  for (const [model, want] of rows) {
    const got = vendorOf(model);
    assert.equal(got, want, JSON.stringify(model));
    if (got !== null) assert.ok(Object.hasOwn(VENDOR_MARKS, got), `${got} is a VENDOR_MARKS key`);
  }
});

// CAT-11: a model added by hand through a provider gets the id the model form mints, `<connection>-<upstream>`
// (connections.mjs suggestModelHandle; a Copilot import's is copilotCatalogId). The connection's word is not the vendor:
// "openai-" read as OpenAI whatever the model was (cycle-2 review M2).
test('vendorOf: a handle minted from its upstream model drops the connection word it starts with', () => {
  const minted = [
    ['qwen3-coder:30b', 'Qwen3 Coder 30B', 'qwen'], ['llama3.1:8b', '', 'meta'], ['deepseek-r1:8b', 'DeepSeek R1', 'deepseek'],
    ['glm-4.7-flash', 'GLM 4.7 Flash', 'zhipu'], ['gemma3:12b', '', 'google'], ['kimi-k2', '', 'moonshot'],
    ['command-r', '', 'cohere'], ['nousresearch/hermes-4-405b', 'Hermes 4', null],
    // OpenAI's own models stay OpenAI's without the word.
    ['gpt-5.5', '', 'openai'], ['o3', '', 'openai'],
  ];
  for (const provider of ['openai', 'anthropic', 'copilot', 'gw']) {
    for (const [up, label, want] of minted) {
      const id = suggestModelHandle(up, provider);
      assert.equal(vendorOf({ id, label, upstream: { provider, model: up } }), want, `${id} "${label}"`);
    }
  }
  assert.equal(vendorOf({ id: copilotCatalogId('mai-code-1.1-flash'), label: 'MAI-Code-1.1-Flash (Copilot)', upstream: { provider: 'copilot', model: 'mai-code-1.1-flash' } }), 'microsoft');
  // The review's three rows, as written.
  assert.equal(vendorOf({ id: 'openai-qwen3-coder-30b', label: 'Qwen3 Coder 30B', upstream: { provider: 'openai', model: 'qwen3-coder:30b' } }), 'qwen');
  assert.equal(vendorOf({ id: 'openai-llama3.1-8b', label: '', upstream: { provider: 'openai', model: 'llama3.1:8b' } }), 'meta');
  assert.equal(vendorOf({ id: 'openai-gpt-5.5', upstream: { provider: 'openai', model: 'gpt-5.5' } }), 'openai');
});

// CAT-11 on the next paths of the same flow (cycle-3 review major 1): a Duplicate (models-view.mjs suggestDuplicateId,
// suggestDuplicateLabel), a wire id edited after the import or the form, an id typed by hand, and a label left blank,
// which GET /api/models lists as the id (settings.mjs sanitizeGlobalModel). A server's or a connection's word never decides.
test('vendorOf: a copy, a copy of a copy and an edited wire id keep the vendor; a blank label is no clue', () => {
  const listed = (m) => ({ ...m, label: String(m.label ?? '').trim() || m.id });
  const copyOf = (m, taken) => listed({ ...m, id: suggestDuplicateId(m.id, taken), label: suggestDuplicateLabel(m) });
  const form = (up, label, provider = 'openai') => listed({ id: suggestModelHandle(up, provider), label, upstream: { provider, model: up } });
  const imp = (server, baseUrl, up) => catalogEntryForEndpointModel({ id: up, name: up, servedContext: 65536, toolCalls: true }, { server, baseUrl });
  const originals = [
    [form('qwen3-coder:30b', 'Qwen3 Coder 30B'), 'qwen'], [form('qwen3-coder:30b', ''), 'qwen'],
    [form('deepseek-r1:8b', 'DeepSeek R1'), 'deepseek'], [form('llama-3.3-70b-versatile', ''), 'meta'],
    [form('glm-4.6', '', 'anthropic'), 'zhipu'], [form('gpt-5.5', ''), 'openai'],
    [form('qwen3-coder:30b', '', 'copilot'), 'qwen'], [form('kimi-k2', '', 'gw'), 'moonshot'],
    [imp('ollama', 'http://127.0.0.1:11434/v1', 'qwen3-coder:30b'), 'qwen'],
    [imp('ollama', 'http://127.0.0.1:11434/v1', 'deepseek-r1:8b'), 'deepseek'],
    [imp('llama.cpp', 'http://127.0.0.1:8080/v1', 'Qwen3-8B-Q4.gguf'), 'qwen'],
    [imp('lmstudio', 'http://127.0.0.1:1234/v1', 'qwen3-coder-30b'), 'qwen'],
    [imp('vllm', 'http://127.0.0.1:8000/v1', 'deepseek-r1-8b'), 'deepseek'],
    [imp('openai-compatible', 'http://127.0.0.1:9000/v1', 'qwen3-coder:30b'), 'qwen'],
    // A host's word holds dashes and a family word of its own.
    [imp('openai-compatible', 'https://my-llama-box.example.com/v1', 'qwen3-coder:30b'), 'qwen'],
  ];
  for (const [m, want] of originals) {
    assert.equal(vendorOf(m), want, `original ${m.id} "${m.label}"`);
    const copy = copyOf(m, [m.id]);
    const second = copyOf(m, [m.id, copy.id]);
    const copyOfCopy = copyOf(copy, [m.id, copy.id]);
    assert.match(second.id, /-copy-2$/);
    assert.match(copyOfCopy.id, /-copy-copy$/);
    for (const c of [copy, second, copyOfCopy]) assert.equal(vendorOf(c), want, `copy ${c.id} "${c.label}" of ${m.id}`);
  }
  const rows = [
    // The wire id edited after the import (a retagged quant, a swapped gguf) or after the form; the label renamed too.
    [{ id: 'ollama-qwen3-coder-30b', label: 'qwen3-coder:30b (Ollama)', upstream: { provider: 'openai', model: 'qwen3-coder:30b-q8_0' } }, 'qwen'],
    [{ id: 'ollama-deepseek-r1-8b', label: 'deepseek-r1:8b (Ollama)', upstream: { provider: 'openai', model: 'deepseek-r1:8b-q8_0' } }, 'deepseek'],
    [{ id: 'llama-qwen3-8b-q4', label: 'Qwen3-8B-Q4.gguf (llama.cpp)', upstream: { provider: 'openai', model: 'Qwen3-8B-Q8_0.gguf' } }, 'qwen'],
    [{ id: 'openai-qwen3-coder-30b', label: 'Qwen3 Coder 30B', upstream: { provider: 'openai', model: 'qwen3-coder:30b-q8_0' } }, 'qwen'],
    [{ id: 'openai-qwen3-coder-30b', label: 'openai-qwen3-coder-30b', upstream: { provider: 'openai', model: 'qwen3-coder:30b-q8_0' } }, 'qwen'],
    [{ id: 'ollama-qwen3-coder-30b', label: 'My coder', upstream: { provider: 'openai', model: 'qwen3-coder:30b-q8_0' } }, 'qwen'],
    [{ id: 'my-llama-box-qwen3-coder-30b', label: 'qwen3-coder:30b (OpenAI-compatible)', upstream: { provider: 'openai', model: 'qwen3-coder:30b-q8_0' } }, 'qwen'],
    // A team policy id may hold capitals (policy/registry.mjs MODEL_ID_RE), its label too when left blank.
    [{ id: 'OpenAI-Qwen3-Coder-30B', label: 'OpenAI-Qwen3-Coder-30B', upstream: { provider: 'openai', model: 'qwen3-coder:30b-q8_0' } }, 'qwen'],
    // An id typed by hand after a server's word, and a name with no letters the slug keeps (`模型` → `model`).
    [{ id: 'ollama-coder', label: 'Coder', upstream: { provider: 'openai', model: 'qwen3-coder:30b' } }, null],
    [{ id: 'ollama-model', label: '模型 (Ollama)', upstream: { provider: 'openai', model: '模型' } }, null],
    [{ id: 'llama-model', label: '模型.gguf (llama.cpp)', upstream: { provider: 'openai', model: '模型.gguf' } }, null],
    // `llama` is llama.cpp's word only beside its label's " (llama.cpp)": typed by hand it is Meta's family word.
    [{ id: 'llama-guard', label: 'Safety (Ollama)', upstream: { provider: 'openai', model: 'llama-guard3:8b' } }, 'meta'],
    [{ id: 'llama-guard-copy', label: 'Guard copy', upstream: { provider: 'openai', model: 'llama-guard3:8b' } }, 'meta'],
    [{ id: 'acme-copy', upstream: { provider: 'openai', model: 'unknownco/llama-x' } }, null],
    // Only what a Duplicate adds is dropped: a word ending in "copy" stays.
    [{ id: 'gpt-copywriter', label: 'Copywriter' }, 'openai'],
    // "ollama" anywhere else (cycle-4 review minor 3) is the server's word, never Meta's: no Meta model holds it.
    [{ id: 'my-coder', label: 'Qwen3 Coder on Ollama' }, 'qwen'],
    [{ id: 'my-coder', label: 'qwen3-coder:30b (ollama)' }, 'qwen'],
    [{ id: 'my-coder', label: 'qwen3-coder:30b (Ollama) fast' }, 'qwen'],
    [{ id: 'my-ollama-box', label: 'My box' }, null],
    [{ id: 'gpu-server-ollama-qwen3-coder-30b', label: 'My box', upstream: { provider: 'openai', model: 'qwen3-coder:30b' } }, 'qwen'],
    [{ id: 'codellama-7b', label: 'codellama-7b' }, 'meta'],
    [{ id: 'ollama-llama3.1-8b', label: 'ollama-llama3.1-8b' }, 'meta'],
  ];
  for (const [model, want] of rows) assert.equal(vendorOf(model), want, JSON.stringify(model));
});

// Ids are written by plugins and team policy, with no length cap (settings.mjs): every Catalogue render reads them.
test('vendorOf costs a long id no more than its length', () => {
  const longs = [
    { id: 'a-'.repeat(25_000), label: 'b-'.repeat(25_000), upstream: { provider: 'openai', model: 'c-'.repeat(25_000) } },
    { id: `x${'-copy'.repeat(10_000)}`, label: `x${' copy'.repeat(10_000)}`, upstream: { provider: 'openai', model: 'x' } },
  ];
  const start = process.cpuUsage();
  for (const m of longs) vendorOf(m);
  const { user, system } = process.cpuUsage(start);
  assert.ok(user + system < 250_000, `${(user + system) / 1000} ms of CPU`);
});

// ADD-3 / CAT-11: the import sheet draws each listed model's mark "as its Catalogue row will wear it": the entry the
// import writes (endpoint.mjs catalogEntryForEndpointModel) wears the same mark, and it is the model's vendor's.
test('an endpoint import wears in the Catalogue the mark its import sheet row showed, its vendor\'s', () => {
  const doc = docOf();
  const SERVERS = {
    ollama: ['Ollama', 'http://127.0.0.1:11434/v1'], 'llama.cpp': ['llama.cpp', 'http://127.0.0.1:8080/v1'],
    lmstudio: ['LM Studio', 'http://127.0.0.1:1234/v1'], openrouter: ['OpenRouter', 'https://openrouter.ai/api/v1'],
    // A hosted gateway's id starts with its host's first label, dashes and all (endpoint.mjs endpointIdPrefix).
    'openai-compatible': ['OpenAI-compatible', 'https://my-llama-box.example.com/v1'],
    gemini: ['Google Gemini', 'https://generativelanguage.googleapis.com/v1beta/openai'],
  };
  const rows = [
    ['ollama', 'qwen3-coder:30b', 'qwen'], ['ollama', 'glm-4.7-flash:latest', 'zhipu'], ['ollama', 'deepseek-r1:8b', 'deepseek'],
    ['ollama', 'llama3.1:8b', 'meta'], ['ollama', 'gpt-oss:20b', 'openai'], ['ollama', 'nomic-embed-text:latest', null],
    ['llama.cpp', 'Qwen3-8B-Q4.gguf', 'qwen'], ['llama.cpp', 'Llama-3.1-8B-Instruct-Q4_K_M.gguf', 'meta'],
    ['lmstudio', 'qwen/qwen3-coder-30b', 'qwen'],
    // A name past slugModelId's 48-character cut: the id holds only the start of it.
    ['ollama', 'hf.co/unsloth/Qwen3-Coder-30B-A3B-Instruct-1M-GGUF:UD-Q4_K_XL-imatrix-long', 'qwen'],
    ['openai-compatible', 'qwen3-coder:30b', 'qwen'],
    // A vendor's own API: its host's word is the last clue, for a name no family matches (Mistral's pixtral).
    ['openai-compatible', 'pixtral-large-latest', 'mistral', 'https://api.mistral.ai/v1'],
    // Only a whole word is a vendor's: a gateway's `mistral-eu` names no vendor.
    ['openai-compatible', 'pixtral-large-latest', null, 'https://mistral-eu.example.com/v1'],
    // A host's word cut at 16 characters (`llama-box-server`) is dropped whole.
    ['openai-compatible', 'qwen3-coder:30b', 'qwen', 'https://llama-box-servers.example.com/v1'],
    // OpenAI's own API: its host's word is a connection's too, so its models whose names hold no `gpt` are named.
    ...['whisper-1', 'dall-e-3', 'tts-1-hd', 'text-embedding-3-small', 'text-embedding-ada-002', 'davinci-002', 'babbage-002',
      'omni-moderation-latest', 'computer-use-preview', 'sora-2'].map((id) => ['openai-compatible', id, 'openai', 'https://api.openai.com/v1']),
    ['gemini', 'text-embedding-004', 'google'],
    // The `vendor/` prefix decides, never the family word after it (the sheet's mark passes the listed id as upstream).
    ['openrouter', 'nvidia/llama-3.3-nemotron-super-49b-v1.5', 'nvidia'], ['openrouter', 'cohere/command-a', 'cohere'],
    ['openrouter', 'perplexity/sonar', 'perplexity'], ['openrouter', 'meta-llama/llama-3.1-8b-instruct', 'meta'],
  ];
  for (const [server, id, want, url] of rows) {
    const [serverLabel, serverUrl] = SERVERS[server];
    const baseUrl = url || serverUrl;
    const entry = catalogEntryForEndpointModel({ id, name: id, servedContext: 65536, toolCalls: true }, { server, baseUrl });
    assert.equal(vendorOf(entry), want, `${server} ${id} → ${entry.id}`);
    const sheet = renderEndpointSheet({ server, serverLabel, baseUrl, warnings: [], models: [{ id, name: id, catalogId: entry.id, importable: true }] }, { doc });
    const shown = sheet.querySelector('tbody tr .mdl-sheet-name .mdl-mark');
    assert.ok(shown, `${id}: the sheet row draws a mark`);
    assert.equal(shown.outerHTML, modelMark(doc, entry, 'sm').outerHTML, `${server} ${id}: the sheet's mark is the Catalogue row's`);
  }
});

test('gradientOf is stable, one of the six, and spreads names over more than one', () => {
  const g = gradientOf('acme-models');
  assert.ok(GRADIENTS.includes(g), g);
  assert.equal(gradientOf('acme-models'), g);
  const seen = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'acme-models', 'other-plugin'].map(gradientOf));
  for (const s of seen) assert.ok(GRADIENTS.includes(s), s);
  assert.ok(seen.size > 1, 'a hash, not a constant');
});

test('markTile: a pack mark as an image, an unknown key as a blank tile, never a broken image', () => {
  const doc = docOf();
  const harness = markTile(doc, { kind: 'harness', key: 'claude', size: 'lg', label: 'Claude Code' });
  assert.equal(harness.tagName, 'SPAN');
  assert.equal(harness.className, 'mdl-mark lg');
  const img = harness.querySelector('img');
  assert.equal(img.getAttribute('src'), markUrl(HARNESS_MARKS.claude));
  assert.equal(img.getAttribute('alt'), 'Claude Code');

  const provider = markTile(doc, { kind: 'provider', key: 'openrouter' });
  assert.equal(provider.className, 'mdl-mark');
  assert.equal(provider.querySelector('img').getAttribute('src'), '/vendor/brand-icons/openrouter.svg');
  assert.equal(provider.querySelector('img').getAttribute('alt'), '');

  const vendor = markTile(doc, { kind: 'vendor', key: 'mistral', size: 'xl', label: 'Mistral' });
  assert.equal(vendor.className, 'mdl-mark xl');
  assert.equal(vendor.querySelector('img').getAttribute('src'), '/vendor/brand-icons/mistral-color.svg');

  for (const [kind, key] of [['vendor', 'no-such-vendor'], ['harness', 'no-such-engine'], ['provider', 'constructor']]) {
    const tile = markTile(doc, { kind, key });
    assert.equal(tile.querySelector('img'), null, `${kind}:${key}`);
    assert.ok(tile.classList.contains('mdl-mark') && tile.classList.contains('blank'), `${kind}:${key}`);
    assert.equal(tile.querySelector('.ic').innerHTML, iconSvg('cube', 16), `${kind}:${key} draws the cube`);
  }

  const glyph = markTile(doc, { kind: 'glyph', key: 'bag', size: 'sm' });
  assert.ok(glyph.classList.contains('blank') && glyph.classList.contains('sm'));
  assert.equal(glyph.querySelector('.ic').style.width, '12px');
  assert.equal(glyph.querySelector('img'), null);
});

test('modelMark: the vendor mark, else the worca mark on blue, else the plugin bag on its gradient', () => {
  const doc = docOf();
  const vendor = modelMark(doc, { id: 'claude-opus-5-5', label: 'Opus 5.5' });
  assert.equal(vendor.className, 'mdl-mark');
  assert.equal(vendor.querySelector('img').getAttribute('src'), markUrl('claude-color'));
  assert.equal(vendor.querySelector('img').getAttribute('alt'), 'Anthropic');

  const own = modelMark(doc, { id: 'acme-stable', label: 'acme-stable' });
  assert.ok(own.classList.contains('mdl-mark') && own.classList.contains('own') && own.classList.contains('g-blue'));
  assert.equal(own.querySelector('img').getAttribute('src'), '/assets/worca-mark-mask.png');
  assert.equal(own.querySelector('img').getAttribute('alt'), '');

  const plugin = modelMark(doc, { id: 'acme-stable', label: 'acme-stable', plugin: 'acme-models' }, 'sm');
  for (const c of ['mdl-mark', 'own', `g-${gradientOf('acme-models')}`, 'sm']) assert.ok(plugin.classList.contains(c), c);
  assert.equal(plugin.querySelector('img'), null);
  assert.ok(plugin.querySelector('svg'));
  assert.equal(plugin.querySelector('.ic').style.width, '12px');
  assert.equal(plugin.querySelector('.ic').innerHTML, iconSvg('bag', 12), 'the plugin tile draws the bag');

  const big = markTile(doc, { kind: 'plugin', key: 'acme-models', size: 'xl' });
  assert.equal(big.querySelector('.ic').style.width, '24px');
  assert.equal(markTile(doc, { kind: 'plugin', key: 'acme-models' }).querySelector('.ic').style.width, '16px');
  assert.equal(markTile(doc, { kind: 'plugin', key: 'acme-models', size: 'lg' }).querySelector('.ic').style.width, '20px');
});

// ADD-2, FRM-1 (the whole-menu walk): "a select with marks". A native select keeps its options; the picked value's mark
// sits inside its left edge, as the mock's closed select draws it, and follows every change.
test('markedSelect: the picked value\'s mark inside the select, following each change; none for a value with no mark', () => {
  const doc = docOf();
  const selOf = (values, value) => {
    const s = doc.createElement('select');
    for (const v of values) { const o = doc.createElement('option'); o.value = v; o.textContent = v; s.append(o); }
    s.value = value;
    return s;
  };
  const src = (wrap) => wrap.querySelector(':scope > .mdl-mark img')?.getAttribute('src') ?? null;
  const sel = selOf(['copilot', 'openai', 'nope'], 'copilot');
  const wrap = markedSelect(doc, sel, 'provider');
  assert.ok(wrap.matches('span.mdl-picksel.has-mark'));
  assert.equal(wrap.lastElementChild, sel, 'the select itself, kept');
  assert.equal(src(wrap), markUrl(PROVIDER_MARKS.copilot));
  assert.ok(wrap.querySelector(':scope > .mdl-mark').classList.contains('sm'));
  sel.value = 'openai';
  sel.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  assert.equal(src(wrap), markUrl(PROVIDER_MARKS.openai), 'a pick repaints it');
  assert.equal(wrap.querySelectorAll('.mdl-mark').length, 1);
  sel.value = 'nope';
  paintMarkedSelect(wrap);
  assert.deepEqual([src(wrap), wrap.classList.contains('has-mark')], [null, false], 'a value set by code, with no mark: none');
  const h = markedSelect(doc, selOf(['claude', 'codex'], 'codex'), 'harness');
  assert.equal(src(h), markUrl(HARNESS_MARKS.codex));
});
