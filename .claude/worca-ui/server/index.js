// server/index.js
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.js';
import { attachWsServer } from './ws.js';

// Parse argv
let port = parseInt(process.env.PORT, 10) || 3400;
let host = process.env.HOST || '127.0.0.1';
let isGlobal = false;
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === '--port' && process.argv[i + 1])
    port = parseInt(process.argv[++i], 10);
  if (process.argv[i] === '--host' && process.argv[i + 1])
    host = process.argv[++i];
  if (process.argv[i] === '--global') isGlobal = true;
}

// Resolve project root: walk up from cwd until we find .claude/settings.json
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

function findProjectRoot(startDir) {
  let dir = startDir;
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, '.claude', 'settings.json'))) return dir;
    dir = dirname(dir);
  }
  return startDir; // fallback
}

import { createInbox } from './webhook-inbox.js';

let projectRoot, worcaDir, settingsPath;

if (isGlobal) {
  // Global mode: no project root needed
  projectRoot = null;
  worcaDir = null;
  settingsPath = null;
} else {
  // Per-project mode: resolve from cwd
  projectRoot = findProjectRoot(process.cwd());
  worcaDir = join(projectRoot, '.worca');
  settingsPath = join(projectRoot, '.claude', 'settings.json');
}

const prefsDir = join(homedir(), '.worca');
const webhookInbox = createInbox();
const app = createApp({
  settingsPath,
  worcaDir,
  projectRoot,
  webhookInbox,
  prefsDir,
});
const server = createServer(app);

const { broadcast, scheduleRefresh } = attachWsServer(server, {
  worcaDir,
  settingsPath,
  prefsPath: join(homedir(), '.worca', 'preferences.json'),
  prefsDir,
  webhookInbox,
  projectRoot,
});

// Expose broadcast and scheduleRefresh to REST route handlers
app.locals.broadcast = broadcast;
app.locals.scheduleRefresh = scheduleRefresh;

server.listen(port, host, () => {
  console.log(
    `worca-ui${isGlobal ? ' (global)' : ''} running at http://${host}:${port}`,
  );
});
