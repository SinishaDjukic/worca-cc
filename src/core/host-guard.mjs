// src/core/host-guard.mjs
// The host-process guard. Every agent worca spawns carries this file as a
// PreToolUse hook on Bash (see buildSettingsPayload in claude-runner.mjs), so
// no agent — predefined role, custom agent, plugin agent, or their in-process
// sub-agents — can kill the worca server that runs it.
//
// Born of the 2026-08-31 incident: an implementer cleaning up stray test
// servers ran `ps aux | grep '[n]ode --disable' | awk '{print $2}' | while
// read p; do kill $p; done` and took down its own host mid-run (the pattern
// matches the production server argv exactly).
//
// Policy — deny when the command:
//   - invokes `pkill` or `killall` (pattern kills, unbounded blast radius);
//   - invokes `kill` with anything but literal numeric PIDs or `%N` jobspecs
//     (variables, substitutions, piped/xargs input, `-PGID` group targets —
//     all of these are how a kill reaches processes nobody named);
//   - names the host PID (WORCA_HOST_PID) as a literal kill target;
//   - wraps a kill in a nested `sh -c` / `bash -c` payload.
// Everything else is allowed, so an agent can still stop processes it spawned:
// look PIDs up first (ps is read-only and always allowed), then kill the
// literal numbers. Forcing literal PIDs is the point — every literal target
// passes through the host-PID check.
//
// The hook CLI is deliberately fail-open on malformed input: a broken payload
// must not brick every Bash call of every agent. The DECISION is fail-closed.
import { fileURLToPath, pathToFileURL } from 'node:url';

/** ON unless WORCA_HOST_GUARD is "0"/"false" — the one kill-switch for the
 *  hook, the WORCA_HOST_PID env var, and the system-prompt preamble alike. */
export function hostGuardEnabled() {
  const v = process.env.WORCA_HOST_GUARD;
  return !(v === '0' || String(v ?? '').toLowerCase() === 'false');
}

/** The PreToolUse hook entry buildSettingsPayload merges into --settings.
 *  Runs THIS file with the server's own node; JSON.stringify double-quotes
 *  both paths for the shell. */
export function hostGuardHookEntry() {
  // Forward slashes on purpose: JSON.stringify would double every Windows
  // backslash and the hook shell's unescaping is unverified there, while
  // CreateProcess and Git Bash both accept forward-slash paths. POSIX node
  // paths never contain backslashes, so the replace is a no-op off Windows.
  const q = (s) => JSON.stringify(String(s).replaceAll('\\', '/'));
  return {
    matcher: 'Bash',
    hooks: [{ type: 'command', command: `${q(process.execPath)} ${q(fileURLToPath(import.meta.url))}` }],
  };
}

/** The system-prompt preamble every real spawn carries (runReal prepends it). */
export function hostGuardSystemPrompt(pid) {
  return [
    '## Host process protection',
    `You run under the worca app server (PID ${pid}, \`node ui/server.mjs\`). Never kill it, and never kill any process you did not spawn yourself.`,
    'Pattern kills are forbidden and a PreToolUse hook blocks them on every OS: `pkill`, `killall`, `xargs kill`, `taskkill /IM`, `Stop-Process -Name`, `wmic process … delete`, and any `kill` fed from a pipe, variable, or substitution (e.g. `ps aux | grep … | while read p; do kill $p; done`).',
    'To stop a process you started: record its PID when you spawn it (or list PIDs with `ps`, which is always allowed), then run `kill <literal pid>`.',
  ].join('\n');
}

/** Command words that may prefix the one we care about. */
const SKIP_WORDS = new Set([
  'do', 'then', 'else', 'elif', 'if', 'while', 'until',
  'exec', 'command', 'builtin', 'nohup', 'time', 'sudo', 'env',
]);

const NESTED_SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'powershell', 'pwsh', 'cmd']);

/** Any killer, POSIX or Windows, appearing anywhere in a nested-shell payload. */
const KILLER_WORD_RE = /\b(?:p?kill|killall|taskkill|stop-process|spps|wmic)\b/i;

/** Replace quoted spans so quoted data ("fix; killall handling") never looks
 *  like a command, and substitutions so `kill $(…)` / `kill \`…\`` surface as a
 *  non-literal target instead of vanishing into the segment split; the RAW
 *  text is still consulted for nested-shell payloads. */
function stripQuotes(s) {
  return s
    .replace(/'[^']*'/g, ' __q__ ')
    .replace(/"(?:[^"\\]|\\.)*"/g, ' __q__ ')
    .replace(/\$\([^()]*\)/g, ' __sub__ ')
    .replace(/`[^`]*`/g, ' __sub__ ');
}

const basename = (w) => w.slice(w.lastIndexOf('/') + 1);

/** Leading env assignments and wrapper words stripped off a token list. */
function commandWord(tokens) {
  let i = 0;
  while (i < tokens.length && (SKIP_WORDS.has(tokens[i]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]))) i++;
  return { cmd: basename(tokens[i] ?? ''), rest: tokens.slice(i + 1) };
}

/** kill's targets: signal options consumed, redirections ignored. */
function killTargets(rest) {
  const targets = [];
  let sawSignal = false;
  let afterDashDash = false;
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (t.startsWith('#')) break;                                  // trailing comment
    if (/^\d*(?:>>?|<<?|>&|&>>?)$/.test(t)) { i++; continue; }     // spaced redirect: skip its operand too
    if (/^\d*[<>]/.test(t) || t.includes('>') || t.includes('<')) continue; // attached redirection
    if (!afterDashDash && t === '--') { afterDashDash = true; continue; }
    if (!afterDashDash && t.startsWith('-')) {
      if (t === '-s' || t === '-n') { i++; sawSignal = true; continue; }   // -s TERM / -n 15
      if (!sawSignal && /^-(?:\d+|[A-Za-z]+\d*)$/.test(t)) { sawSignal = true; continue; } // first -9/-TERM
      targets.push(t);                                                     // second dash token = a target
      continue;
    }
    targets.push(t);
  }
  return targets;
}

/**
 * The pure decision. `null` = allow; a non-empty string = deny, with the reason
 * the agent will read (hook exit 2 feeds stderr back to the model).
 * @param {string} command   the Bash tool's command text
 * @param {number} [hostPid] the protected server PID (WORCA_HOST_PID); pattern
 *   bans apply even without it
 * @returns {string|null}
 */
export function evaluateKillCommand(command, hostPid) {
  const raw = String(command ?? '');
  if (!raw.trim()) return null;
  const pidNote = Number.isFinite(hostPid)
    ? ` The worca app server (PID ${hostPid}) runs this agent and must survive.`
    : ' The worca app server runs this agent and must survive.';
  const advice = ' To stop a process you spawned: list PIDs first (ps is always allowed), then `kill <literal pid>`.';

  const segments = stripQuotes(raw).split(/(?:\|\||&&|;|\||&|\n|\$\(|`|[(){}])+/);
  for (const seg of segments) {
    const tokens = seg.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const { cmd: cmdRaw, rest } = commandWord(tokens);
    // Windows commands are case-insensitive and may carry .exe (`TASKKILL`,
    // `taskkill.exe`) — normalize once; POSIX names pass through unchanged.
    const cmd = cmdRaw.toLowerCase().replace(/\.exe$/, '');

    if (cmd === 'pkill' || cmd === 'killall') {
      return `host guard: blocked \`${cmd}\` — pattern kills are forbidden.${pidNote}${advice}`;
    }
    if (cmd === 'xargs'
        && rest.some((t) => ['kill', 'pkill', 'killall', 'taskkill'].includes(basename(t).toLowerCase().replace(/\.exe$/, '')))) {
      return `host guard: blocked \`xargs kill\` — kill may only take literal numeric PIDs you name yourself.${pidNote}${advice}`;
    }
    // A nested shell is suspicious only when it carries an INLINE payload
    // (-c / /c / -Command); `bash scripts/kill-dev-server.sh` is a script FILE
    // and stays allowed (deliberate evasion via files is out of the threat
    // model). PowerShell is the exception: its bare argument IS an inline
    // command (`powershell "Stop-Process -Name node"`), so it is always scanned.
    if (NESTED_SHELLS.has(cmd)
        && (cmd === 'powershell' || cmd === 'pwsh' || rest.some((t) => /^(?:-c|\/c|-command|--command)$/i.test(t)))
        && KILLER_WORD_RE.test(raw)) {
      return `host guard: blocked a kill inside a nested \`${cmd}\` invocation — run the kill directly with literal PIDs so it can be checked.${pidNote}${advice}`;
    }

    // ── Windows-native killers (reachable from Git Bash on Windows) ──────────
    if (cmd === 'taskkill') {
      for (let i = 0; i < rest.length; i++) {
        const flag = rest[i].toLowerCase().replace(/^[/-]+/, '');
        if (flag === 'im') {
          return `host guard: blocked \`taskkill /IM\` — killing by image name is a pattern kill.${pidNote}${advice}`;
        }
        if (flag === 'pid') {
          const target = rest[++i] ?? '';
          if (!/^\d+$/.test(target)) {
            return `host guard: blocked \`taskkill /PID ${target}\` — only literal numeric PIDs are allowed.${pidNote}${advice}`;
          }
          if (Number.isFinite(hostPid) && Number(target) === hostPid) {
            return `host guard: blocked taskkill of PID ${hostPid} — that is the worca app server this agent runs under. Kill only processes you spawned yourself.`;
          }
        }
      }
      continue;
    }
    if (cmd === 'stop-process' || cmd === 'spps') {
      let sawId = false;
      for (let i = 0; i < rest.length; i++) {
        const t = rest[i].toLowerCase();
        if (t === '-name' || t.startsWith('-name:')) {
          return `host guard: blocked \`Stop-Process -Name\` — killing by process name is a pattern kill.${pidNote}${advice}`;
        }
        if (t === '-id' || t.startsWith('-id:')) {
          sawId = true;
          const value = t.includes(':') ? t.split(':')[1] : (rest[++i] ?? '');
          for (const part of value.split(',')) {
            if (!/^\d+$/.test(part)) {
              return `host guard: blocked \`Stop-Process -Id ${part}\` — only literal numeric PIDs are allowed.${pidNote}${advice}`;
            }
            if (Number.isFinite(hostPid) && Number(part) === hostPid) {
              return `host guard: blocked Stop-Process of PID ${hostPid} — that is the worca app server this agent runs under. Kill only processes you spawned yourself.`;
            }
          }
        }
      }
      if (!sawId) {
        return `host guard: blocked \`Stop-Process\` with no literal -Id — pipeline-fed or bare Stop-Process is a pattern kill.${pidNote}${advice}`;
      }
      continue;
    }
    if (cmd === 'wmic') {
      // Checked against the RAW command: a parenthesized WHERE clause splits
      // the segment (`where (name="node.exe") delete`), hiding the verb from
      // this segment's tokens. A kill-verb elsewhere in a compound command can
      // false-positive here — acceptable, the reason explains itself.
      if (/\bprocess\b/i.test(raw) && /\b(?:delete|terminate)\b/i.test(raw)) {
        return `host guard: blocked \`wmic process … delete\` — pattern kills are forbidden.${pidNote}${advice}`;
      }
      continue; // read-only wmic queries stay allowed
    }

    if (cmd !== 'kill') continue;

    for (const t of killTargets(rest)) {
      if (/^\d+$/.test(t)) {
        if (Number.isFinite(hostPid) && Number(t) === hostPid) {
          return `host guard: blocked kill of PID ${hostPid} — that is the worca app server this agent runs under. Kill only processes you spawned yourself.`;
        }
        continue;
      }
      if (/^%\d+$/.test(t)) continue; // this shell's own job
      if (t.startsWith('-')) {
        return `host guard: blocked \`kill ${t}\` — process-group/broadcast kills are forbidden.${pidNote}${advice}`;
      }
      return `host guard: blocked \`kill ${t}\` — kill accepts only literal numeric PIDs (no variables, substitutions, or piped input).${pidNote}${advice}`;
    }
  }
  return null;
}

// ── hook CLI ─────────────────────────────────────────────────────────────────
// stdin: the PreToolUse payload ({ tool_name, tool_input: { command } }).
// exit 0 = allow; exit 2 = block, stderr is shown to the agent.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { raw += d; });
  process.stdin.on('end', () => {
    let command = '';
    try {
      const payload = JSON.parse(raw);
      if (payload?.tool_name !== 'Bash') process.exit(0);
      command = String(payload?.tool_input?.command ?? '');
    } catch {
      process.exit(0); // fail-open: a malformed payload must not brick Bash
    }
    const pid = Number(process.env.WORCA_HOST_PID);
    const reason = evaluateKillCommand(command, Number.isFinite(pid) && pid > 0 ? pid : undefined);
    if (reason) {
      process.stderr.write(`${reason}\n`);
      process.exit(2);
    }
    process.exit(0);
  });
}
