#!/usr/bin/env node
import { mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function run() {
  const thisFile = fileURLToPath(new URL(import.meta.url));
  const repoRoot = path.resolve(path.dirname(thisFile), '..');
  const appDir = path.join(repoRoot, 'app');
  const entry = path.join(appDir, 'main.js');
  const outfile = path.join(appDir, 'main.bundle.js');
  const vendorDir = path.join(appDir, 'vendor');

  mkdirSync(appDir, { recursive: true });
  mkdirSync(vendorDir, { recursive: true });

  // Copy vendor CSS assets
  const vendorAssets = [
    ['@shoelace-style/shoelace/dist/themes/light.css', 'shoelace-light.css'],
    ['@shoelace-style/shoelace/dist/themes/dark.css', 'shoelace-dark.css'],
    ['@xterm/xterm/css/xterm.css', 'xterm.css'],
  ];
  for (const [src, dest] of vendorAssets) {
    const srcPath = path.join(repoRoot, 'node_modules', src);
    copyFileSync(srcPath, path.join(vendorDir, dest));
    console.log('copied', dest);
  }

  try {
    const esbuild = await import('esbuild');
    await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2020',
      outfile,
      sourcemap: true,
      minify: true,
      legalComments: 'none'
    });
    console.log('built', path.relative(repoRoot, outfile));
  } catch (err) {
    console.error('bundle error', err);
    process.exitCode = 1;
  }
}

run();
