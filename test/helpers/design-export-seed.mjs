// test/helpers/design-export-seed.mjs
// Design P6: a finished web design to export (`seedDone`, moved out of test/design-export.test.mjs, which imports it,
// as does the thumbnail test), and `exportApp`, a bare Express app with only the export route over the real store. It
// calls no env helper: each test file calls its own (`useTempHome`, `useDesignEnv`) before the first test body runs.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import express from 'express';
import { requireFlag } from '../../src/core/flags.mjs';
import { assembleDesign } from '../../src/core/design/assemble.mjs';
import { registerDesignExportRoutes } from '../../src/core/design/export-routes.mjs';
import { designWorkDir } from '../../src/core/design/paths.mjs';
import { designFor } from '../../src/core/design/routes.mjs';
import { createDesign, updateDesign } from '../../src/core/design/store.mjs';

export const SHELL = '<!doctype html><html><head><meta charset="utf-8"><!--worca:head--></head><body><!--worca:sections--><!--worca:foot--></body></html>';
export const PLAN = { v: 1, kind: 'web', title: 'T', canvas: { w: 1440 }, notes: '', sections: [{ id: 'hero', job: 'Hero', brief: 'b', parts: ['html'], estHeight: 100 }] };

/**
 * A web design titled `Ship Radar` whose round has finished: one hero section with a local and a remote image, an
 * accented asset name, `over`'s extra work/ files (`{rel: text}`), `dist/` assembled and `status: 'done'`. `kind:
 * 'document'` makes it a document instead, its plan on an A4 page with a contents list.
 * @param {Record<string, string>} [over]
 * @param {{ kind?: 'web' | 'document' }} [opts]
 * @returns {object} the design row
 */
export function seedDone(over = {}, { kind = 'web' } = {}) {
  const plan = kind === 'document' ? { ...PLAN, kind, canvas: { w: 794 }, page: 'A4', toc: true, numbered: false } : PLAN;
  const d = createDesign({ kind, title: 'Ship Radar' }, { by: 'local' }); const w = designWorkDir(d.id);
  const put = (rel, text) => { mkdirSync(dirname(join(w, rel)), { recursive: true }); writeFileSync(join(w, rel), text); };
  put('plan.json', JSON.stringify(plan)); put('shell.html', SHELL);
  put('sections/hero/index.html', '<section data-section="hero"><img src="assets/logo.png"><img src="https://x.dev/a.png"></section>');
  put('assets/logo.png', 'PNG'); put('sections/hero/assets/é a.svg', '<svg/>');
  for (const [k, v] of Object.entries(over)) put(k, v);
  assembleDesign({ workDir: w, plan, mode: 'dist' });
  return updateDesign(d.id, { status: 'done' });
}

/**
 * A bare Express app (`express.json()`) with only the export route: the real `design` gate and `designFor`, and one
 * project `p1` in a fresh folder inside `WORCA_HOME`, so the test file's own temp home takes it away. `over` replaces
 * any of `registerDesignExportRoutes`'s options.
 * @param {object} [over]
 * @returns {import('express').Express}
 */
export function exportApp(over = {}) {
  const home = process.env.WORCA_HOME;
  if (!home) throw new Error('exportApp needs a temp WORCA_HOME');
  const proj = mkdtempSync(join(home, 'proj-'));
  const app = express();
  app.use(express.json());
  registerDesignExportRoutes(app, {
    flagGate: requireFlag('design'),
    designFor,
    listProjects: async () => [{ key: 'p1', name: 'One', path: proj, exists: true }],
    ...over,
  });
  return app;
}
