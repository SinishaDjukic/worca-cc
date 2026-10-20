// test/ask-command-policy.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAskCommand, askCommandEnv } from '../src/core/ask/command-policy.mjs';

const ctx = { cwd: '/w/proj', home: '/Users/me/.worca-cc', userHome: '/Users/me', hostPid: 4242, serverPort: 4317 };

test('allows ordinary commands', () => {
  for (const c of ['npm test', 'git status && git diff', 'rm -rf node_modules', 'rm -rf ./dist build/', 'ls -la', 'kill 999', 'rm -rf *'])
    assert.equal(checkAskCommand(c, ctx), null, c);
});

test('a run worktree under the worca home: paths inside the session folder pass', () => {
  const run = { ...ctx, cwd: '/Users/me/.worca-cc/runs/abc/repos/p' };
  for (const c of ['cd /Users/me/.worca-cc/runs/abc/repos/p && npm test', 'ls /Users/me/.worca-cc/runs/abc/repos/p/src',
    'rm -rf /Users/me/.worca-cc/runs/abc/repos/p/dist', 'cd "/Users/me/.worca-cc/runs/abc/repos/p" && npm test', 'npm test'])
    assert.equal(checkAskCommand(c, run), null, c);
  assert.match(checkAskCommand('cat /Users/me/.worca-cc/settings.json', run), /protected/);
  assert.match(checkAskCommand('ls /Users/me/.worca-cc/runs/abc/repos/p-other', run), /protected/);   // a sibling, not the folder
});

test('refuses newlines and over-long commands', () => {
  assert.match(checkAskCommand('npm test\nnpm run lint', ctx), /one line/);
  assert.match(checkAskCommand('x'.repeat(4001), ctx), /4000/);
});

test('host guard: pattern kills and the host PID', () => {
  assert.match(checkAskCommand('pkill node', ctx), /worca/i);
  assert.match(checkAskCommand('kill 4242', ctx), /4242/);
});

test('worca and credential paths', () => {
  for (const c of ['cat ~/.worca-cc/settings.json', 'sqlite3 worca-cc.db .dump', 'cat ~/.ssh/id_ed25519',
    'cat .env.local', 'ls ~/.claude', 'cat /proc/1/environ', 'cat /Users/me/.worca-cc/logs/x', 'cat ~/.config/gh/hosts.yml',
    'cat ~/.claude.json', 'cat $HOME/.npmrc', 'ls /Users/me/.docker', 'cd ~ && cat .claude/settings.json', 'cd && ls .kube'])
    assert.match(checkAskCommand(c, ctx), /protected/, c);
});

test('quoted paths are still paths', () => {
  for (const c of ['cat "$HOME/.ssh/id_rsa"', "cat '/Users/me/.aws/credentials'", 'cat "~/.worca-cc/settings.json"',
    'cp "/Users/me/.claude/.credentials.json" .', 'cat ".env"'])
    assert.match(checkAskCommand(c, ctx), /protected/, c);
  for (const c of ['rm -rf "/tmp/x"', "rm -r '../other'", 'rm -rf "$HOME"', 'git push "--force"'])
    assert.match(checkAskCommand(c, ctx), /blocked/, c);
});

test("a project's own .claude, .docker, .kube and .npmrc are ordinary files", () => {
  for (const c of ['ls .claude/rules', 'git add .claude/agents/x.md', 'cat ./.npmrc', 'docker compose -f .docker/compose.yml config',
    'kubectl apply -f .kube/dev.yaml --dry-run=client', 'cat /w/proj/.claude/settings.json'])
    assert.equal(checkAskCommand(c, ctx), null, c);
});

test("worca's own API", () => {
  assert.match(checkAskCommand('curl -s http://localhost:4317/api/settings', ctx), /Worca's own API/);
  assert.match(checkAskCommand('curl 127.0.0.1:4317', ctx), /Worca's own API/);
  assert.equal(checkAskCommand('curl http://localhost:3000/health', ctx), null);
});

test('hard-to-undo commands', () => {
  for (const c of ['git push --force', 'git push -f origin main', 'git push origin +main', 'git push --delete origin x',
    'git push origin :old', 'rm -rf /', 'rm -rf ~', 'rm -rf ../other', 'rm -rf /tmp/x', 'rm -r $HOME/x', 'sudo rm x',
    'mkfs.ext4 /dev/sda1', 'dd if=/dev/zero of=/dev/disk2', 'shutdown -h now'])
    assert.match(checkAskCommand(c, ctx), /blocked/, c);
  assert.equal(checkAskCommand('rm -rf /w/proj/dist', ctx), null);
  assert.equal(checkAskCommand('git push origin feature', ctx), null);
});

test('hard-to-undo: common forms that hide the target or the command', () => {
  for (const c of ['cd .. && rm -rf proj', 'cd /tmp; rm -rf x', 'cd ~ && rm -rf build', 'xargs rm -rf /', 'echo / | xargs rm -rf',
    'xargs -0 rm -r', 'nice -n 10 rm -rf /', 'timeout 5 rm -rf ../x', 'stdbuf -oL rm -rf /', 'ionice -c3 rm -rf /',
    'bash -c "rm -rf /"', "sh -c 'git push --force'", 'zsh -lc "sudo reboot"', 'eval "rm -rf /"', 'rm -rf $(pwd)/..',
    'rm -rf `pwd`/..', 'git -C . push --force', 'git -c a=b push -f', 'git --no-pager push --delete origin x', 'doas rm x'])
    assert.match(checkAskCommand(c, ctx) ?? '', /blocked/, c);
  for (const c of ['cd src && rm -rf dist', 'cd ./src; rm -rf build', 'git -C . push origin feature', 'bash -c "npm test"',
    'xargs grep foo', 'timeout 60 npm test', 'echo $(pwd)', 'git -c core.pager=cat log'])
    assert.equal(checkAskCommand(c, ctx), null, c);
});

test('gh commands that print the stored GitHub token are refused', () => {
  for (const c of ['gh auth token', 'gh auth token --hostname github.com', 'gh auth status -t', 'gh auth status --show-token',
    'bash -c "gh auth token"', 'x=$(gh auth token) && echo ok'])
    assert.match(checkAskCommand(c, ctx) ?? '', /credential/, c);
  for (const c of ['gh auth status', 'gh pr list', 'gh auth login --help'])
    assert.equal(checkAskCommand(c, ctx), null, c);
});

test('quoted data is not a command', () => {
  assert.equal(checkAskCommand('git commit -m "fix rm -rf / handling"', ctx), null);
  assert.equal(checkAskCommand('git commit -m "a; sudo reboot"', ctx), null);
  assert.equal(checkAskCommand("echo 'git push --force is blocked'", ctx), null);
});

test('askCommandEnv keeps the base, drops tokens and model credentials', () => {
  const env = askCommandEnv({ PATH: '/bin', HOME: '/h', LANG: 'C', SSH_AUTH_SOCK: '/s', ANTHROPIC_API_KEY: 'k',
    CLAUDE_CODE_OAUTH_TOKEN: 't', GITHUB_TOKEN: 'g', WORCA_HOME: '/w', OPENAI_API_KEY: 'o', PORT: '4317' });
  assert.deepEqual(env, { PATH: '/bin', HOME: '/h', LANG: 'C', SSH_AUTH_SOCK: '/s' });
});

test('$WORCA_ASK_OUT: the variable form passes; the spelled-out .worca-cc path is refused', () => {
  assert.equal(checkAskCommand('npx playwright screenshot http://localhost:3000 "$WORCA_ASK_OUT/home.png"', ctx), null);
  assert.match(checkAskCommand('npx playwright screenshot http://localhost:3000 ~/.worca-cc/ask/ask_00000001/out/home.png', ctx), /names a protected path/);
});
