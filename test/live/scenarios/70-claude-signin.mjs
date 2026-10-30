// test/live/scenarios/70-claude-signin.mjs
// Claude's subscription sign-in keeps working on every route the core protection layer changed (part 2): a local run
// with the user's own login, through a single-mode credential broker holding the subscription token, and in an E2B
// sandbox behind worca's model relay. Run: WORCA_ALLOW_LIVE=1 npm run test:live -- --only 'claude-signin*'
// (`--only` is an anchored glob: a bare `claude-signin` matches no id). Each scenario skips, with its reason, where
// this machine cannot run it; a skip is never a pass.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { implementOnly } from '../lib/scenario-kit.mjs';
import { startTestBroker } from '../../helpers/test-broker.mjs';

const PROMPT = 'Add a one-line comment at the top of calc.js saying "signed in".';
const SIGN_IN_LINE = /signs in with \S+ from worca's environment/;
const E2B_LOCAL = join(homedir(), '.config', 'worca-e2b', 'local.sh');

/** The E2B connection the owner's local Lima E2B exports (`export NAME=value` lines), names only from a fixed list. */
function e2bEnvFromLocalSh() {
  const out = {};
  for (const line of readFileSync(E2B_LOCAL, 'utf8').split('\n')) {
    const m = /^\s*export\s+(E2B_API_KEY|E2B_API_URL|E2B_SANDBOX_URL|E2B_DOMAIN)=(['"]?)(.*)\2\s*$/.exec(line);
    if (m) out[m[1]] = m[3];
  }
  return out;
}

export default [
  {
    id: 'claude-signin.local',
    title: "a local run with the user's own Claude login (no credential from worca's env named unless one is set)",
    tier: 'smoke', models: 'cheap', serial: true, engines: ['claude'],
    async run(t) {
      const { res } = await implementOnly(t, PROMPT);
      t.check('cli: exit 0', res.code === 0, `code=${res.code} ${res.stderr.slice(-600)} ${res.stdout.slice(-600)}`);
      const said = SIGN_IN_LINE.test(`${res.stdout}\n${res.stderr}`);
      if (process.env.CLAUDE_CODE_OAUTH_TOKEN) t.check('the run log names the subscription token from worca\'s env', said, res.stdout.slice(-600));
      else t.check('no credential from worca\'s env is named: the keychain login signs in', !said, res.stdout.slice(-600));
    },
  },
  {
    id: 'claude-signin.broker',
    title: 'a run through a single-mode credential broker holding the Claude subscription token',
    tier: 'smoke', models: 'cheap', serial: true, engines: ['claude'],
    async run(t) {
      const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
      if (!token) t.skip('CLAUDE_CODE_OAUTH_TOKEN is not set (the broker needs a subscription token from `claude setup-token`)');
      const broker = await startTestBroker({ upstream: { url: 'https://api.anthropic.com' }, keys: { WORCA_BROKER_KEY_ANTHROPIC: token } });
      try {
        // The token lives in the broker only: worca's own env carries none (the K1 boot guard would refuse it).
        const { res } = await implementOnly(t, PROMPT, { env: { WORCA_BROKER_URL: broker.url, WORCA_BROKER_SECRET: broker.secret, CLAUDE_CODE_OAUTH_TOKEN: '' } });
        t.check('cli: exit 0', res.code === 0, `code=${res.code} ${res.stderr.slice(-600)} ${res.stdout.slice(-600)}`);
        const plans = broker.store.db.prepare('SELECT plan FROM usage').all().map((r) => r.plan);
        t.check('the broker booked the calls on the subscription', plans.includes('subscription'), JSON.stringify(plans));
      } finally { await broker.close(); }
    },
  },
  {
    id: 'claude-signin.e2b',
    title: 'a run in an E2B sandbox: the relay signs Claude\'s calls with the subscription token on the server',
    tier: 'smoke', models: 'cheap', serial: true, engines: ['claude'],
    async run(t) {
      if (!existsSync(E2B_LOCAL)) t.skip(`${E2B_LOCAL} is missing (the owner's local E2B)`);
      try { await import('e2b'); } catch { t.skip('the optional "e2b" package does not load'); }
      const { res } = await implementOnly(t, PROMPT, { extra: ['--exec-env', 'e2b'], env: e2bEnvFromLocalSh() });
      t.check('cli: exit 0', res.code === 0, `code=${res.code} ${res.stderr.slice(-600)} ${res.stdout.slice(-600)}`);
    },
  },
];
