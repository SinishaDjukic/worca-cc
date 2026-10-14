// extension/src/manifest.mjs — one MV3 manifest per browser (tools/build-extension.mjs writes it). Minimal permissions
// (docs/browser-extension.md): no host permissions in production, no content_scripts, no web_accessible_resources — the
// content script is injected into the sidebar's tab via activeTab + scripting only. `commands` declares the two
// keyboard shortcuts (Pinpoint, area capture). Test builds add only the fixture host: <all_urls> would make Chrome drop
// the Origin header on the extension's requests to Worca, and the pairing gate keys on it (see DEVIATIONS, D3).
const ICONS = { 16: 'icons/worca-16.png', 32: 'icons/worca-32.png', 48: 'icons/worca-48.png', 128: 'icons/worca-128.png' };

/** The keyboard commands (chrome://extensions/shortcuts, Firefox: Manage Extension Shortcuts). Rebindable; the keys are defaults. */
export const COMMANDS = Object.freeze({ pinpoint: 'worca-pinpoint', capture: 'worca-capture' });
const COMMAND_KEYS = {
  [COMMANDS.pinpoint]: { suggested_key: { default: 'Alt+Shift+W' }, description: 'Open Pinpoint on the selected text' },
  [COMMANDS.capture]: { suggested_key: { default: 'Alt+Shift+S' }, description: 'Capture an area of the page into the Worca chat' },
};

export function manifestVersion(pkgVersion) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(pkgVersion));
  const version = m ? `${m[1]}.${m[2]}.${m[3]}` : '0.0.0';
  return { version, versionName: String(pkgVersion) };
}

export function buildManifest(browser, { version, versionName = version, test = false }) {
  const base = {
    manifest_version: 3,
    name: 'Worca',
    short_name: 'Worca',
    description: 'Chat with your local Worca from a browser sidebar, with the page you are reading in context.',
    version,
    icons: ICONS,
    action: { default_title: 'Open Worca', default_icon: { 16: ICONS[16], 32: ICONS[32] } },
    permissions: ['activeTab', 'scripting', 'storage', 'contextMenus'],
    commands: COMMAND_KEYS,
    ...(test ? { host_permissions: ['http://fixture.test/*'] } : {}),
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
  };
  if (browser === 'firefox') {
    return {
      ...base,
      background: { scripts: ['background.js'] },
      sidebar_action: { default_panel: 'sidebar.html', default_title: 'Worca', default_icon: ICONS[32], open_at_install: false },
      // 140.0: the first desktop Firefox with data_collection_permissions (web-ext lint flags it below that).
      browser_specific_settings: { gecko: { id: 'browser-extension@worca.dev', strict_min_version: '140.0', data_collection_permissions: { required: ['none'] } } },
    };
  }
  return {
    ...base,
    ...(versionName !== version ? { version_name: versionName } : {}),
    minimum_chrome_version: '116',
    background: { service_worker: 'background.js' },
    side_panel: { default_path: 'sidebar.html' },
    permissions: [...base.permissions, 'sidePanel'],
  };
}
