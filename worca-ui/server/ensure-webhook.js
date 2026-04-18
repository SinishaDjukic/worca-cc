// ensure-webhook.js — auto-configure a webhook pointing to this worca-ui instance
// in a project's settings.local.json so the pipeline sends events to the UI.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { localPathFor } from './settings-merge.js';

/**
 * Ensure a webhook entry exists in the project's settings.local.json
 * pointing to the worca-ui inbox at the given host:port.
 *
 * Skips if a webhook for this host:port already exists.
 * Creates settings.local.json if it doesn't exist.
 *
 * @param {string} projectPath — absolute path to the project root
 * @param {{ host: string, port: number }} server — worca-ui server address
 */
export function ensureWebhookForUi(projectPath, { host, port }) {
  const settingsPath = join(projectPath, '.claude', 'settings.json');
  const localPath = localPathFor(settingsPath);
  // Use localhost instead of 127.0.0.1 — the pipeline validator only allows
  // https:// or http://localhost for security.
  const displayHost =
    host === '127.0.0.1' || host === '::1' ? 'localhost' : host;
  const inboxUrl = `http://${displayHost}:${port}/api/webhooks/inbox`;

  // Read existing local settings (or start fresh)
  let local = {};
  if (existsSync(localPath)) {
    try {
      local = JSON.parse(readFileSync(localPath, 'utf8'));
    } catch {
      local = {};
    }
  }

  if (!local.worca) local.worca = {};
  if (!Array.isArray(local.worca.webhooks)) local.worca.webhooks = [];

  // Check if a webhook for this URL already exists
  const exists = local.worca.webhooks.some((wh) => wh.url === inboxUrl);
  if (exists) return false;

  // Also check base settings.json (in case it was manually configured there)
  try {
    const base = JSON.parse(readFileSync(settingsPath, 'utf8'));
    const baseWebhooks = base?.worca?.webhooks || [];
    if (baseWebhooks.some((wh) => wh.url === inboxUrl)) return false;
  } catch {
    // no base settings — proceed
  }

  local.worca.webhooks.push({
    url: inboxUrl,
    events: ['pipeline.*'],
  });

  // Ensure events are enabled
  if (!local.worca.events) local.worca.events = {};
  if (local.worca.events.enabled === undefined) {
    local.worca.events.enabled = true;
  }

  writeFileSync(localPath, `${JSON.stringify(local, null, 2)}\n`, 'utf8');
  return true;
}
