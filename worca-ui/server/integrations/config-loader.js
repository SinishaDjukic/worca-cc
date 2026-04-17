import { readFileSync } from 'node:fs';
import { validateIntegrationsConfig } from '../settings-validator.js';

/**
 * Loads and validates ~/.worca/integrations/config.json.
 * Returns the parsed config object, or null if missing/invalid.
 * Missing file → null (silent). Invalid JSON or validation failure → null + console.warn.
 *
 * @param {string} configPath
 * @returns {object|null}
 */
export function loadIntegrationsConfig(configPath) {
  let raw;
  try {
    raw = readFileSync(configPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    console.warn('[integrations] failed to read config', err.message);
    return null;
  }

  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch (err) {
    console.warn('[integrations] config is not valid JSON', err.message);
    return null;
  }

  const result = validateIntegrationsConfig(cfg);
  if (!result.valid) {
    console.warn(
      '[integrations] config validation failed',
      result.details.join('; '),
    );
    return null;
  }

  return cfg;
}
