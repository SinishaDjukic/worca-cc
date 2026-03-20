// server/index.js
import { createServer } from 'node:http';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createApp } from './app.js';
import { attachWsServer } from './ws.js';

// Parse argv
let port = 3400;
let host = '127.0.0.1';
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === '--port' && process.argv[i + 1]) port = parseInt(process.argv[++i], 10);
  if (process.argv[i] === '--host' && process.argv[i + 1]) host = process.argv[++i];
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

const projectRoot = findProjectRoot(process.cwd());
const worcaDir = join(projectRoot, '.worca');
const settingsPath = join(projectRoot, '.claude', 'settings.json');
const webhookInbox = createInbox();
const app = createApp({ settingsPath, worcaDir, projectRoot, webhookInbox });
const server = createServer(app);

const { broadcast, scheduleRefresh } = attachWsServer(server, {
  worcaDir,
  settingsPath,
  prefsPath: join(homedir(), '.worca', 'preferences.json'),
  webhookInbox,
});

// Expose broadcast and scheduleRefresh to REST route handlers
app.locals.broadcast = broadcast;
app.locals.scheduleRefresh = scheduleRefresh;

server.listen(port, host, () => {
  console.log(`worca-ui running at http://${host}:${port}`);
});
