import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildManifest, manifestVersion, COMMANDS } from '../extension/src/manifest.mjs';

test('chrome/edge: side_panel + sidePanel, service worker, minimal permissions, no host access', () => {
  const m = buildManifest('chrome', { version: '1.10.0' });
  assert.equal(m.manifest_version, 3);
  assert.equal(m.side_panel.default_path, 'sidebar.html');
  assert.equal(m.background.service_worker, 'background.js');
  assert.deepEqual([...m.permissions].sort(), ['activeTab', 'contextMenus', 'scripting', 'sidePanel', 'storage']);
  for (const k of ['host_permissions', 'optional_host_permissions', 'web_accessible_resources', 'externally_connectable', 'content_scripts']) assert.equal(m[k], undefined, k);
  assert.deepEqual(buildManifest('edge', { version: '1.10.0' }), m);
});
test('firefox: sidebar_action, background.scripts, gecko id, min 140 (data_collection_permissions), no sidePanel', () => {
  const m = buildManifest('firefox', { version: '1.10.0' });
  assert.equal(m.sidebar_action.default_panel, 'sidebar.html');
  assert.deepEqual(m.background.scripts, ['background.js']);
  assert.equal(m.browser_specific_settings.gecko.id, 'browser-extension@worca.dev');
  assert.equal(m.browser_specific_settings.gecko.strict_min_version, '140.0');
  assert.deepEqual(m.browser_specific_settings.gecko.data_collection_permissions, { required: ['none'] });
  assert.ok(!m.permissions.includes('sidePanel'));
  assert.equal(m.side_panel, undefined);
  assert.equal(m.background.service_worker, undefined);
  assert.equal(m.version_name, undefined);
  for (const k of ['host_permissions', 'optional_host_permissions', 'web_accessible_resources', 'externally_connectable', 'content_scripts']) assert.equal(m[k], undefined, k);
});
test('both browsers declare the two rebindable commands with their default keys', () => {
  for (const b of ['chrome', 'edge', 'firefox']) {
    const m = buildManifest(b, { version: '1.0.0' });
    assert.deepEqual(Object.keys(m.commands).sort(), [COMMANDS.capture, COMMANDS.pinpoint].sort());
    assert.equal(m.commands[COMMANDS.pinpoint].suggested_key.default, 'Alt+Shift+W');
    assert.equal(m.commands[COMMANDS.capture].suggested_key.default, 'Alt+Shift+S');
    assert.match(m.commands[COMMANDS.pinpoint].description, /Pinpoint/);
    assert.equal(m.host_permissions, undefined);                 // production: still no host permissions
  }
});
test('test builds add only the fixture host (<all_urls> would strip the Origin the pairing gate needs)', () => {
  assert.deepEqual(buildManifest('chrome', { version: '1.10.0', test: true }).host_permissions, ['http://fixture.test/*']);
});
test('versions are Chrome-legal', () => {
  assert.deepEqual(manifestVersion('1.11.0-rc.2'), { version: '1.11.0', versionName: '1.11.0-rc.2' });
});

test('demo builds add localhost access and a web-accessible sidebar, nothing else', () => {
  const m = buildManifest('chrome', { version: '1.0.0', test: true, demo: true });
  assert.deepEqual(m.host_permissions, ['http://localhost/*']);
  assert.deepEqual(m.web_accessible_resources, [{ resources: ['sidebar.html'], matches: ['http://localhost/*'] }]);
  assert.ok(!m.host_permissions.some((h) => /127\.0\.0\.1|<all_urls>/.test(h)), 'never Worca\'s loopback address (Origin header)');
  const prod = buildManifest('chrome', { version: '1.0.0' });
  assert.equal(prod.web_accessible_resources, undefined);
  assert.equal(prod.host_permissions, undefined);
});
