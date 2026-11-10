// src/core/design/web-access.mjs
// Whether a build's lead gets the web (docs/design.md "Web access"), read once per drive from Settings › Design
// "Let the lead use the web" (`chat.designWeb`, off by default). On: the build's MCP config for `save_image`
// (web-mcp.mjs) is written beside work/, never inside it: an agent that could edit it would choose the command the
// engine starts next. Off: any config a former drive left is removed.

import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { worcaHome } from '../projects.mjs';
import { designWebOn } from '../settings.mjs';
import { designDir, designWorkDir } from './paths.mjs';
import { designWebMcpConfig } from './web-mcp.mjs';

/** `<design>/web-mcp.json`: the lead's MCP config while web access is on. */
export function designWebMcpFile(id) { return join(designDir(id), 'web-mcp.json'); }

/**
 * Stages web access for one drive of a build.
 * @param {{ designId: string, on?: () => boolean, env?: object }} opts
 * @returns {{ mcpConfigPath: string }|null} null when web access is off
 */
export function stageDesignWeb({ designId, on = designWebOn, env = process.env } = {}) {
  const file = designWebMcpFile(designId);
  if (!on()) {
    rmSync(file, { force: true });
    return null;
  }
  const doc = designWebMcpConfig({ workDir: designWorkDir(designId), logFile: join(worcaHome(), 'logs', 'design-web.jsonl'), env });
  // Readable by the owner's agent through the design folder's group (registry.claim, 0o2750); it holds no secret
  // but a proxy URL, which the agent's own environment would carry anyway.
  writeFileSync(file, JSON.stringify(doc), { mode: 0o640 });
  return { mcpConfigPath: file };
}
