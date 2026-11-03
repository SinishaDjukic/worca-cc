// src/core/session-mode.mjs — how each session runs, decided once at run start (session groups, Task 37; spec §5.1, D3).
// Pure. The first matching row wins; it never refuses a run and never picks `shared` on its own (X4): anything that
// cannot run as sub-agents runs as separate sessions, exactly as today.
import { cmpVersions } from './preflight-node.mjs';
import { engineLabel } from '../shared/engine-switch.mjs';

/** The first Claude Code that reads `--agents <file>` (C3). Older ⇒ `separate`. */
export const CLAUDE_AGENTS_FILE_MIN = '2.1.281';

/** `modelEnvs` = JSON strings of each member's UNTAGGED resolved model env and the host's (C34; Task 44 builds them).
 *  `caps` = the engine's capabilities plus, for Claude, the probe's `forwardSubagentText`. A missing capability means
 *  capable (`capabilities.mjs`: only a literal `false` degrades). */
export function chooseSessionMode({ spec, engine, caps = {}, flagOn = false, env = {}, cliVersion = null, verified = {}, modelEnvs = [] } = {}) {
  const requested = spec?.settings?.mode;
  const members = Array.isArray(spec?.members) ? spec.members : [];
  const c = caps || {};
  const name = engineLabel(engine);
  const separate = (reason) => ({ mode: 'separate', requested, reason });
  if (members.length < 2) return separate('one step');
  if (env?.WORCA_SESSIONS_DISABLE === '1') return separate('WORCA_SESSIONS_DISABLE=1');
  if (!flagOn) return separate('the Labs flag sessionGroups is off');
  if (requested === 'shared' && c.resume === false) return separate(`${name} cannot resume a session`);
  if (requested === 'shared') return { mode: 'shared', requested, reason: 'chosen in the session settings' };
  if (c.subagents === false) return separate(`${name} has no sub-agents`);
  if (verified?.[engine] !== true) return separate(`sub-agents are not available on ${name} yet`);
  if (engine === 'claude') {
    if (!cliVersion) return separate('the Claude Code version is unknown');
    if (cmpVersions(cliVersion, CLAUDE_AGENTS_FILE_MIN) < 0) return separate(`Claude Code ${cliVersion} is older than ${CLAUDE_AGENTS_FILE_MIN}`);
    if (c.forwardSubagentText === false) return separate(`Claude Code ${cliVersion} cannot forward sub-agent text`);
  }
  if (new Set(Array.isArray(modelEnvs) ? modelEnvs : []).size > 1) return separate('the steps use different model endpoints');
  return { mode: 'subagents', requested, reason: 'ok' };
}
