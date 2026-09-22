#!/usr/bin/env node
// `npm run docker:build` — pack the package exactly as npm would publish it into
// docker/.pack/worca-app.tgz, then build the image from docker/ via compose.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pack = join(root, 'docker', '.pack');
rmSync(pack, { recursive: true, force: true });
mkdirSync(pack, { recursive: true });
execFileSync('npm', ['pack', '--pack-destination', pack], { cwd: root, stdio: 'inherit' });
const tgz = readdirSync(pack).find((f) => f.endsWith('.tgz'));
renameSync(join(pack, tgz), join(pack, 'worca-app.tgz'));
execFileSync('docker', ['compose', 'build', ...process.argv.slice(2)], { cwd: join(root, 'docker'), stdio: 'inherit' });
