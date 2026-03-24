// server/index.js
import { createServer } from 'node:http';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createApp } from './app.js';
import { attachWsServer } from './ws.js';

// Parse argv
let port = 3400;
let host = '127.0.0.1';
let standaloneMode = false;
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === '--port' && process.argv[i + 1]) port = parseInt(process.argv[++i], 10);
  if (process.argv[i] === '--host' && process.argv[i + 1]) host = process.argv[++i];
  if (process.argv[i] === '--standalone') standaloneMode = true;
}

// Resolve project root: walk up from cwd until we find .claude/settings.json
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

function findProjectRoot(startDir) {
  let dir = startDir;
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, '.claude', 'settings.json'))) return dir;
    dir = dirname(dir);
  }
  return startDir; // fallback
}

// In standalone mode, use worca-cc's own directory as the project root
// This allows running the UI without being inside a target project
const projectRoot = standaloneMode
  ? join(dirname(import.meta.url.replace('file://', '')), '..', '..')
  : findProjectRoot(process.cwd());

const worcaDir = join(projectRoot, '.worca');
const settingsPath = join(projectRoot, '.claude', 'settings.json');

// Ensure .worca dir exists in standalone mode
if (standaloneMode) {
  mkdirSync(worcaDir, { recursive: true });
  console.log(`Standalone mode: worca-cc root at ${projectRoot}`);
}
const app = createApp({ settingsPath, worcaDir, projectRoot });
const server = createServer(app);

const { broadcast } = attachWsServer(server, {
  worcaDir,
  settingsPath,
  prefsPath: join(homedir(), '.worca', 'preferences.json')
});

// Expose broadcast to REST route handlers
app.locals.broadcast = broadcast;

server.listen(port, host, () => {
  console.log(`worca-ui running at http://${host}:${port}`);
});
