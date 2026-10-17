// test/helpers/marketplace-publish-stub.mjs
// Preloaded with `node --import` by the CLI spawn tests: the marketplace publisher talks to local
// bare repos (WORCA_TEST_MKT_REMOTES = JSON {hostedUrl: localPath}) and a scripted forge.
import { _testing } from '../../src/core/marketplace-publish.mjs';
import { stripHostCredentials } from '../../src/core/host-credentials.mjs';

const remotes = JSON.parse(process.env.WORCA_TEST_MKT_REMOTES || '{}');
_testing.setDeps({
  transport: (url) => remotes[url] || url,
  gitEnv: async () => ({ env: stripHostCredentials(process.env), error: null }),
  access: async () => ({ ok: true, canPush: true }),
  providerAvailable: async () => ({ ok: true }),
  createPr: async () => ({ ok: true, url: 'https://github.com/acme/market/pull/7', existed: false }),
  editPrBody: async () => ({ ok: true }),
  runCases: async () => ({ scripts: [], passed: 0, failed: 0, unchecked: 0, stopped: false, problems: [] }),
});
