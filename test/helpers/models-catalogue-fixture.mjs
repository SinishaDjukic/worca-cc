// test/helpers/models-catalogue-fixture.mjs — the Catalogue's input (models-menu P4): the GET /api/models body with
// `uses`, `hiddenBuiltins` and `testable`, its `providers` replaced by the GET /api/providers payload, plus the page's
// own facts (legacy project models, engines, the run engine, locks, the ids just imported). Fresh objects per call,
// so a test can change what it got. Through the real helpers: 11 distinct ids, 3 need setup; Claude Code holds
// sign-in [old-project-model], Custom endpoint [gw-claude, acme-stable, team-glm], GitHub Copilot [my-copilot-gpt],
// OpenRouter [or-ernie] and 2 built-ins; Codex and Copilot hold their built-ins only.

const defaults = () => ({
  predefined: [
    { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'], testable: true },
    { id: 'claude-haiku-5-5', label: 'Haiku 5.5', efforts: ['medium', 'high', 'xhigh', 'max'], testable: true },
  ],
  codex: [
    { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', efforts: ['minimal', 'low', 'medium', 'high'], testable: false },
    { id: 'gpt-6-luna', label: 'GPT-6 Luna', efforts: ['minimal', 'low', 'medium', 'high'], testable: false },
  ],
  copilot: [
    { id: 'copilot/claude-opus-5.5', label: 'Claude Opus 5.5', efforts: ['low', 'medium', 'high'], testable: false },
  ],
  models: [
    {
      id: 'my-copilot-gpt', label: 'My Copilot GPT', efforts: ['low', 'medium', 'high'],
      upstream: { provider: 'copilot', api: 'anthropic', model: 'claude-sonnet-5.5' },
      cost: { free: true }, bridged: 'copilot', needsSignIn: true, testable: true,
    },
    {
      id: 'or-ernie', label: 'Baidu: ERNIE 5.5 (free) (OpenRouter)', efforts: ['medium'],
      upstream: { provider: 'openai', api: 'openai-chat', model: 'baidu/ernie-5.5:free', baseUrl: 'https://openrouter.ai/api/v1' },
      needsSignIn: true, testable: true,
    },
    { id: 'gw-claude', label: 'GW Claude', efforts: ['medium', 'high'], env: { ANTHROPIC_BASE_URL: 'https://gw.example' }, testable: true },
  ],
  plugin: [
    {
      id: 'acme-stable', label: 'Acme Stable', efforts: ['medium'], plugin: 'acme-models',
      env: { ANTHROPIC_BASE_URL: 'https://acme.example', ANTHROPIC_AUTH_TOKEN: '(secret: ACME_TOKEN)' },
      secrets: [{ key: 'ACME_TOKEN', label: 'Acme token', set: false }],
      testable: true,
    },
  ],
  policy: [
    { id: 'team-glm', label: 'Team GLM', efforts: ['medium'], env: { ANTHROPIC_BASE_URL: 'https://glm.example' }, home: 'acme/policy', testable: true },
  ],
  legacy: [{ id: 'old-project-model', label: 'Old project model' }],
  projectName: 'demo',
  providers: {},
  uses: {},
  hiddenBuiltins: { claude: false, codex: false, copilot: false },
  engines: null,
  runEngine: null,
  engineLocks: [],
  justImported: null,
});

/** The Catalogue's data: the defaults above shallow-merged with `overrides`. */
export function data(overrides = {}) {
  return { ...defaults(), ...overrides };
}
