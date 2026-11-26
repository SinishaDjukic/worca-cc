// test/fixtures/secrets/vault-child.mjs — a spawned process that drives the Worca vault, for the cross-process and
// flag-off tests. The OS store comes from selectOsStore(), so the child reaches the fake only through the test switch.
//   put-many --store S --count N --ready FILE --go FILE   wait for the go file, put N values, print the write window
//   probe-store                                          print the selected store's kind and the code of one put
//   scenario                                             write a setting, print whether openVaultIfEnabled() is null
import { existsSync, writeFileSync } from 'node:fs';
import { worcaHome } from '../../../src/core/projects.mjs';
import { writeSettingsKeys } from '../../../src/core/settings.mjs';
import { selectOsStore } from '../../../src/core/secrets/os-store.mjs';
import { createVault, openVaultIfEnabled } from '../../../src/core/secrets/vault.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const opt = (name) => { const i = rest.indexOf(`--${name}`); return i < 0 ? undefined : rest[i + 1]; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A test child never reaches a real OS key store, whatever the machine has installed: with no runner marker the real
// selection runs, and these deps make it find none (on a Mac with @napi-rs/keyring it picked the Keychain).
const NO_REAL_STORE = Object.freeze({ loadKeyring: () => null, isWsl: async () => false, findPowershell: () => null });
const childStore = () => selectOsStore({ home: worcaHome(), deps: NO_REAL_STORE });

if (cmd === 'put-many') {
  const store = opt('store');
  const count = Number(opt('count'));
  const vault = createVault({ home: worcaHome(), store: await childStore() });
  writeFileSync(opt('ready'), String(process.pid));
  const deadline = Date.now() + 30_000;
  while (!existsSync(opt('go'))) {
    if (Date.now() > deadline) throw new Error('vault-child: no go file');
    await sleep(5);
  }
  const start = Date.now();
  for (let i = 0; i < count; i++) await vault.put({ store, field: `f${i}`, value: `${store}-v${i}` });
  console.log(JSON.stringify({ start, end: Date.now() }));
} else if (cmd === 'probe-store') {
  const store = await childStore();
  let result;
  try {
    result = { ref: await createVault({ home: worcaHome(), store }).put({ store: 'settings', field: 'probe', value: 'probe-value' }) };
  } catch (err) {
    result = { code: err.code };
  }
  console.log(JSON.stringify({ kind: store.kind, ...result }));
} else if (cmd === 'scenario') {
  await writeSettingsKeys({ probe: 1 });
  const vault = await openVaultIfEnabled();
  console.log(`vault: ${vault === null ? 'null' : 'open'}`);
} else {
  console.error(`vault-child: unknown command ${cmd}`);
  process.exit(2);
}
