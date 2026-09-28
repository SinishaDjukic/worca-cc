// src/broker/main.mjs
// `worca broker`: the credential broker (plans/credential-broker-design.html).
// Two listeners:
//   WORCA_BROKER_PORT (8080)    private only: the /p/<slot>/… proxy agents call with a
//                               spawn token, and the /internal API the worca server calls
//   WORCA_BROKER_UI_PORT (8081) the key page, the only port a public route may point at
//                               (multi mode only)
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { readBrokerConfig } from './config.mjs';
import { builtinSlots, mergeSlots } from './slots.mjs';
import { openStore } from './store.mjs';
import { createBrokerService } from './service.mjs';
import { createUiHandler } from './ui-server.mjs';

const EX_CONFIG = 78;

function version() {
  try { return JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version || null; }
  catch { return null; }
}

/** Load config + slots; returns {config, slots} or {errors}. */
export function loadBroker(env = process.env) {
  const { config, errors } = readBrokerConfig(env);
  let slots = [];
  try {
    const extra = config.slotsFile ? JSON.parse(readFileSync(config.slotsFile, 'utf8')) : undefined;
    slots = mergeSlots(builtinSlots({ localUrl: config.localUrl, github: config.github }), extra);
  } catch (err) {
    errors.push(`slots: ${err.message}`);
  }
  if (config.mode === 'multi' && Object.keys(config.singleKeys).length && !config.allowTeamKeys) {
    errors.push('WORCA_BROKER_KEY_* is for single mode; in multi mode each person saves their own key on the key page (WORCA_BROKER_ALLOW_TEAM_KEYS=1 allows team keys for operator slots)');
  }
  for (const id of Object.keys(config.singleKeys)) {
    if (!slots.some((s) => s.id === id)) errors.push(`WORCA_BROKER_KEY_${id.toUpperCase().replace(/-/g, '_')} names an unknown slot`);
  }
  return { config: { ...config, version: version() }, slots, errors };
}

/**
 * Start both listeners. Resolves with {close, ports} once listening.
 * @param {object} o {config, slots, store?, log?}
 */
export async function startBroker({ config, slots, store, log = (l) => process.stdout.write(`${l}\n`) }) {
  const st = store || openStore(config.dataDir ? join(config.dataDir, 'broker.db') : ':memory:');
  const service = createBrokerService({ config, slots, store: st, log });
  const rot = service.rotateVault();
  if (rot.rotated) log(`vault: re-encrypted ${rot.rotated} credential(s) with the new key`);
  if (rot.unreadable) log(`vault key changed: ${rot.unreadable} credential(s) can't be decrypted; people must enter them again (or set WORCA_BROKER_VAULT_KEY_OLD)`);

  const priv = http.createServer((req, res) => service.handlePrivate(req, res));
  // No forward-proxy behaviour: a CONNECT tunnel is refused outright.
  priv.on('connect', (_req, socket) => { socket.end('HTTP/1.1 405 Method Not Allowed\r\n\r\n'); });
  priv.on('clientError', (_err, socket) => socket.destroy());
  priv.requestTimeout = 0;           // streamed completions can run for many minutes
  priv.headersTimeout = 30_000;

  const listen = (server, port) => new Promise((resolveP, rejectP) => {
    server.once('error', rejectP);
    server.listen(port, config.host, () => { server.off('error', rejectP); resolveP(server.address().port); });
  });
  const ports = { private: await listen(priv, config.port) };
  let ui = null;
  if (config.uiEnabled) {
    ui = http.createServer(createUiHandler({ config, service, store: st, log }));
    ui.on('clientError', (_err, socket) => socket.destroy());
    ports.ui = await listen(ui, config.uiPort);
  }
  const sweep = setInterval(() => {
    try { st.deleteExpiredTokens(); st.deleteOldUsage(); } catch { /* next time */ }
  }, 3_600_000);
  sweep.unref();

  return {
    ports, service, store: st,
    close: () => new Promise((resolveP) => {
      clearInterval(sweep);
      let n = ui ? 2 : 1;
      const done = () => { if (--n === 0) { if (!store) st.close(); resolveP(); } };
      priv.close(done); priv.closeAllConnections?.();
      if (ui) { ui.close(done); ui.closeAllConnections?.(); }
    }),
  };
}

/** `worca broker secrets`: a fresh shared secret and vault key, for pasting into a secret store. */
export function generateSecrets() {
  return { secret: randomBytes(32).toString('base64url'), vaultKey: randomBytes(32).toString('base64') };
}

/** `worca broker [serve]` entry. Returns an exit code, or never returns while serving. */
export async function runBrokerCli(args = []) {
  const sub = args[0] || 'serve';
  if (sub === 'secrets') {
    const s = generateSecrets();
    process.stdout.write(`WORCA_BROKER_SECRET=${s.secret}\nWORCA_BROKER_VAULT_KEY=${s.vaultKey}\n`);
    return 0;
  }
  if (sub === 'revoke') {
    const i = args.indexOf('--person');
    const person = i >= 0 ? args[i + 1] : null;
    if (!person) { process.stderr.write('usage: worca broker revoke --person <email>\n'); return 2; }
    const { config, errors } = loadBroker();
    if (errors.length || !config.dataDir) { process.stderr.write(`worca broker: ${errors[0] || 'WORCA_BROKER_DATA_DIR is not set'}\n`); return EX_CONFIG; }
    const st = openStore(join(config.dataDir, 'broker.db'));
    const n = st.revokeWhere({ billTo: String(person).trim().toLowerCase() });
    st.close();
    process.stdout.write(`revoked ${n} live token(s) for ${person}\n`);
    return 0;
  }
  if (sub !== 'serve') { process.stderr.write('usage: worca broker [serve | secrets | revoke --person <email>]\n'); return 2; }

  const { config, slots, errors } = loadBroker();
  if (errors.length) {
    for (const e of errors) process.stderr.write(`worca broker: ${e}\n`);
    return EX_CONFIG;
  }
  const b = await startBroker({ config, slots });
  process.stdout.write(`worca broker ${config.version || ''} (${config.mode}) listening: private :${b.ports.private}${b.ports.ui ? `, key page :${b.ports.ui}` : ''}; slots ${slots.map((s) => s.id).join(', ')}\n`);
  if (config.publicUrl) process.stdout.write(`key page: ${config.publicUrl}\n`);
  await new Promise((resolveP) => {
    for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => { b.close().then(resolveP); });
  });
  return 0;
}
