// The UI server keeps idle connections open for 65 s (Node's 5 s default drops a connection the browser is about to
// reuse, so each page pays a fresh connect); headersTimeout stays above keepAliveTimeout.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

test('the UI server: keepAliveTimeout 65 s, headersTimeout above it', async () => {
  const { server } = await import('../ui/server.mjs');
  assert.equal(server.keepAliveTimeout, 65_000);
  assert.ok(server.headersTimeout > server.keepAliveTimeout);
});
