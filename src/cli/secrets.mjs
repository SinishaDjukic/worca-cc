// src/cli/secrets.mjs — `worca secrets status|export|ack|reset` (the secretVault flag). Loaded with a dynamic import, and
// it reads the flag (and whether a vault file is left) before it imports the status core, so with neither no vault,
// OS-store or keyring module loads. Status is read-only and always exits 0; `status --check` round-trips the OS store
// without moving anything; export writes every vaulted secret back into its config file and removes the vault, after a
// confirmation; ack drops the message about moved secrets; reset only moves an unreadable vault aside.
//
// export, reset and ack are terminal-only by design (docs/secrets.md): they run only when stdin and stdout are a TTY
// and the person types the word shown at the prompt. There is no --yes and no environment override, so no script, pipe
// or agent can run them: an agent's command has no terminal, and clearing a variable does not give it one. The older
// check stays as a second line: an agent spawned by Worca carries WORCA_HOST_PID, and those verbs (and
// `status --check`) refuse it at once.
import { randomInt } from 'node:crypto';
import { createInterface } from 'node:readline';
import { secretVaultEnabled, vaultInUse } from '../core/secrets/flag.mjs';
import { VAULT_MESSAGES } from '../core/secrets/refs.mjs';
import { CONTAINER_TEXT, vaultUnavailableHere } from '../core/secrets/place.mjs';

export const SECRETS_HELP = `Usage: worca secrets <command>

  status                   Which OS key store holds the vault key, its state, and whether the vault can be read
  status --check           Test the OS store round trip without moving anything
  export                   Write every vaulted secret back into its config file (0600), delete the vault and its OS key, turn the flag off
  ack                      Stop showing the message about secrets moved into the vault
  reset                    Move an unreadable vault aside so a new one can start (the OS key is kept)

export, reset and ack run only in your own terminal: each asks you to type a word it shows. They never run from a
script, a pipe or an agent.

Needs the secretVault flag (worca flags), or a vault left from a migration. Provider and model keys, MCP and plugin
secrets and the proxy login saved while it is on go into the vault.
`;

const VERBS = new Set(['status', 'reset', 'export', 'ack']);
const OPTIONS = Object.freeze({ status: ['--check'], reset: [], export: [], ack: [] });
/** The verbs that need a person at a terminal. */
export const TERMINAL_VERBS = Object.freeze(['export', 'reset', 'ack']);
export const NEEDS_TERMINAL_TEXT = 'worca: run this in your own terminal: it asks you to type a word to confirm, so it never runs from a script, a pipe or an agent';
export const NO_YES_TEXT = 'worca: --yes is not accepted: this command asks you to type a word in your own terminal';

const WORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** The word the person types: the verb and four characters that change each time (no pasted or scripted answer). */
export function confirmWord(verb, pick = (n) => randomInt(n)) {
  let tail = '';
  for (let i = 0; i < 4; i++) tail += WORD_CHARS[pick(WORD_CHARS.length)];
  return `${verb.toUpperCase()}-${tail}`;
}

/** One line from the terminal. */
function readLineFrom(input, output) {
  return (prompt) => new Promise((resolve) => {
    const rl = createInterface({ input, output, terminal: true });
    let done = false;
    const finish = (v) => { if (done) return; done = true; rl.close(); resolve(v); };
    rl.on('SIGINT', () => finish(null));
    rl.on('close', () => finish(null));
    rl.question(prompt, (a) => finish(a));
  });
}

/** Ask `question`, show the word, and return whether the person typed it exactly. */
async function typedConfirm(question, verb, { output, readLine }) {
  const word = confirmWord(verb);
  output.write(`${question}\n`);
  const a = await readLine(`Type ${word} to confirm, or press Enter to cancel: `);
  return typeof a === 'string' && a.trim() === word;
}

const REFUSALS = Object.freeze({
  readable: 'the vault can be read; reset only moves an unreadable vault aside',
});

const EXPORT_REFUSALS = Object.freeze({
  'server-running': 'the Worca app is running for this home; stop it, then run export again',
  'flag-locked': 'the secretVault flag is set by WORCA_FLAGS; remove it there, then run export again',
  changed: 'a secret changed while exporting; run export again',
});

const EXPORT_CONFIRM = 'Write every vaulted secret back into its config file and delete the vault and its OS key? Entries no setting uses any more are deleted with it. Stop the Worca app first.';

const STORE_LINES = Object.freeze({ settings: 'Provider and model keys', mcp: 'MCP secrets', plugin: 'Plugin secrets', proxy: 'Proxy login' });

export async function cmdSecrets(argv, {
  out, c = (_n, s) => s, fail,
  err = (s) => process.stderr.write(`${s}\n`),
  env = process.env,
  input = process.stdin, output = process.stdout,
  readLine = readLineFrom(input, output),
} = {}) {
  const [verb = 'status', ...rest] = argv;
  if (verb === 'help' || verb === '--help' || verb === '-h') { out(SECRETS_HELP.trimEnd()); return 0; }
  if (!VERBS.has(verb)) { fail(`unknown secrets command: ${verb}. See: worca secrets help`); return 2; }
  if (TERMINAL_VERBS.includes(verb) && rest.includes('--yes')) { err(NO_YES_TEXT); return 2; }
  const unknown = rest.filter((a) => !OPTIONS[verb].includes(a));
  if (unknown.length) { fail(`unknown option for secrets ${verb}: ${unknown[0]}`); return 2; }
  const check = verb === 'status' && rest.includes('--check');
  // D17: an agent spawned by Worca carries WORCA_HOST_PID; the person's own shell does not.
  if (env.WORCA_HOST_PID && (verb !== 'status' || check)) { err('worca: run this in your own terminal, not from an agent'); return 1; }

  // A container has no OS key store: the vault never works there, so status says so and nothing else runs.
  if (vaultUnavailableHere(env)) {
    if (verb === 'status' && !check) { out('Secrets vault: not available in a container'); out(CONTAINER_TEXT); return 0; }
    err(`worca: the secret vault is not available in a container. ${CONTAINER_TEXT}`);
    return 2;
  }
  // The real control: a person at a terminal. Checked before anything is read, asked or moved.
  if (TERMINAL_VERBS.includes(verb) && !(input && input.isTTY && output && output.isTTY)) { err(NEEDS_TERMINAL_TEXT); return 1; }
  const confirm = (question) => typedConfirm(question, verb, { output, readLine });
  if (verb === 'ack') return ack({ out, err, confirm });
  if (verb === 'export') return exportVault({ out, err, confirm });
  if (check) return storeCheck({ out, err });

  if (verb === 'status' && !vaultInUse()) { out('Secrets vault: off (the secretVault flag is off)'); return 0; }
  if (verb === 'reset' && !secretVaultEnabled()) { err('worca: the secretVault flag is off; nothing to reset'); return 2; }
  const { secretsStatus, statusLines, resetVault } = await import('../core/secrets/status.mjs');
  try {
    if (verb === 'status') {
      const on = secretVaultEnabled();
      for (const line of statusLines(await secretsStatus(), { flagOn: on, flagOff: !on })) out(line);
      return 0;
    }
    const r = await resetVault({ confirm: () => confirm('Move the unreadable vault aside? Secrets stored in it will need to be entered again; the old file is kept.') });
    if (r.outcome === 'moved') { out(`Moved the vault aside to ${r.movedTo}. The next secret Worca stores starts a new vault.`); return 0; }
    if (r.outcome === 'nothing') { out('Nothing to reset: no unreadable vault was found.'); return 0; }
    if (r.outcome === 'cancelled') { err('worca: reset cancelled; nothing was moved'); return 2; }
    err(`worca: cannot reset: ${REFUSALS[r.reason] ?? VAULT_MESSAGES[r.reason] ?? 'the vault cannot be reset'}`);
    return 1;
  } catch (e) {
    err(`worca: secrets ${verb} failed: ${e?.name === 'VaultError' ? e.message : 'unexpected error'}`);
    return verb === 'status' ? 0 : 1;
  }
}

async function ack({ out, err, confirm }) {
  const { ackNotice, readNotice } = await import('../core/secrets/notice.mjs');
  const n = readNotice();
  if (!n) { out('No message to acknowledge.'); return 0; }
  if (!(await confirm('Stop showing the message about the secrets moved into the vault?'))) { err('worca: ack cancelled; the message stays'); return 2; }
  out(await ackNotice({ id: n.id }) ? 'Done: the message will not be shown again.' : 'No message to acknowledge.');
  return 0;
}

// D21: the migration's preflight (a round trip on a throwaway item, then the key read back) without the migrate lock
// and without moving anything.
async function storeCheck({ out, err }) {
  if (!secretVaultEnabled()) { err('worca: the secretVault flag is off; nothing to check'); return 2; }
  const { checkOsStore } = await import('../core/secrets/status.mjs');
  const r = await checkOsStore();
  if (r.ok) { out(`OS store check: passed (${r.label})`); return 0; }
  err(`OS store check: failed (${VAULT_MESSAGES[r.code] ?? VAULT_MESSAGES['store-check']})`);
  return 1;
}

async function exportVault({ out, err, confirm }) {
  const { exportSecrets } = await import('../core/secrets/export.mjs');
  let r;
  try {
    r = await exportSecrets({ confirm: () => confirm(EXPORT_CONFIRM) });
  } catch {
    err('worca: secrets export failed: unexpected error');
    return 1;
  }
  if (r.outcome === 'cancelled') { err('worca: export cancelled; nothing was changed'); return 2; }
  if (r.outcome === 'refused') {
    const text = r.reason === 'unresolved'
      ? `these saved secrets cannot be read from the vault: ${(r.unresolved ?? []).join(', ')}; clear them in Settings, then run export again`
      : EXPORT_REFUSALS[r.reason] ?? VAULT_MESSAGES[r.reason] ?? 'the vault cannot be exported';
    err(`worca: cannot export: ${text}`);
    return 1;
  }
  if (r.outcome === 'nothing') { out('Nothing to export: no vault.'); return 0; }
  for (const [store, n] of Object.entries(r.restored)) if (n) out(`${STORE_LINES[store]}: ${n} written back to the config file.`);
  if (r.keyError) {
    err(`The OS key item could not be removed (${r.keyError}); run \`worca secrets export\` again.`);
    return 1;
  }
  if (r.outcome === 'key-removed') out(r.keyRemoved ? `Removed the leftover vault key from ${r.label}.` : `No vault key was left in ${r.label}.`);
  else out(r.keyRemoved ? `Removed the vault and its key from ${r.label}.` : `Removed the vault; no vault key was left in ${r.label}.`);
  if (r.flag === 'off') out('Turned the secretVault flag off.');
  return 0;
}
