// src/core/design/export-routes.mjs
// Design P6 (C-8, L6.3, L6.5): `POST /api/design/:id/export` and the thumbnail `GET /api/design/:id/thumb`, behind
// the `design` flag. Only a finished round exports
// (`requireExportable`), so every format reads the same round. The file is the response body: `html` and `pdf` carry
// what was left out in `X-Worca-Export-Problems`, `zip` streams, `project` answers JSON. Every refusal is JSON
// `{error, code, ...data}` the dialog shows. A restore or a chat hand-off holding the design refuses every format
// (`busy`). An export reads one round: `zip` and `project` read a copy of `dist/` taken when the checks pass, and a
// print waiting in the render queue checks the round again when its turn comes. A closed connection aborts the
// request's signal: the zip stops reading and the print kills its Chrome. Registered by `registerDesignRoutes`, outside
// DESIGN_ROUTES, so its own test walks its flag gate.
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { attachmentDisposition } from '../download-filename.mjs';
import { exportStem } from '../../shared/design-names.mjs';
import {
  copyDistToProject, encodeProblems, EXPORT_FORMATS, exportHtml, ExportRefusal, printDeckPdf, readExportPlan,
  requireExportable, snapshotDist, zipDist,
} from './export.mjs';
import { distDir, thumbFile } from './paths.mjs';
import { designChrome, renderQueue } from './render.mjs';
import { getDesign } from './store.mjs';

const FORMAT_TEXT = 'format must be html, zip, pdf or project';
const OVERWRITE_TEXT = 'overwrite must be true or false';
const KEY_TEXT = 'overwrite needs the collisionsKey of the list it replaces';
const NO_PROJECT = 'That project is not available.';
const FAILED = 'Could not make the file.';
const NO_THUMB = 'thumbnail not found';

const messageOf = (err) => (err && typeof err.message === 'string' ? err.message : String(err));

function abortError() {
  const e = new Error('the person closed the connection');
  e.name = 'AbortError';
  return e;
}

/**
 * Registers `POST /api/design/:id/export` and `GET /api/design/:id/thumb` on `app`.
 * @param {import('express').Express} app
 * @param {{ flagGate: import('express').RequestHandler,
 *   designFor: (req: object, res: object) => object | null,
 *   listProjects: () => Promise<Array<{ key: string, name: string, path: string, exists: boolean }>>,
 *   held?: (designId: string) => string | null,
 *   chrome?: () => string | null, queue?: { run: (fn: () => unknown, opts?: { front?: boolean }) => Promise<any> },
 *   zip?: typeof zipDist, print?: typeof printDeckPdf }} opts
 *   `designFor` answers 404 itself for an unknown or someone else's design; `held` names what holds the design now
 *   (a restore, a hand-off staging a round), else null
 */
export function registerDesignExportRoutes(app, {
  flagGate, designFor, listProjects, held = () => null, chrome = designChrome, queue = renderQueue, zip = zipDist,
  print = printDeckPdf,
}) {
  /** A finished round that nothing holds now; else the refusal. */
  function requireReady(design) {
    requireExportable(design);
    const busy = held(design.id);
    if (busy) throw new ExportRefusal(409, 'busy', busy);
  }

  /** The HTML page: the standalone file, never run in worca's origin if opened in place. A deck's bundle stops when the
   *  person leaves (`signal`). */
  async function sendHtml(res, design, signal) {
    const { name, html, problems } = await exportHtml(design, { signal });
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': attachmentDisposition(name),
      'X-Worca-Export-Problems': encodeProblems(problems),
      'Content-Security-Policy': 'sandbox',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    res.send(html);
  }

  /** The zip, streamed. Its headers go with the first chunk, so a failure before it still answers JSON. */
  async function sendZip(res, design, dist, signal) {
    const stem = exportStem(design.title);
    const start = () => {
      if (res.headersSent) return;
      res.status(200).set({ 'Content-Type': 'application/zip', 'Content-Disposition': attachmentDisposition(`${stem}.zip`) });
    };
    // A destroyed socket never emits `drain`, and an abort that fired before the `await` never fires again: the signal
    // goes to `once`, which rejects with an AbortError either way.
    const write = async (c) => {
      if (signal.aborted) throw abortError();
      start();
      if (!res.write(c)) await once(res, 'drain', { signal });
    };
    await zip({ dist, root: stem, write, signal });
    start();
    res.end();
  }

  /**
   * The deck PDF: printed at the queue's front (a person is waiting), sent, then its temp folder goes. The wait can be
   * long (a thumbnail, another print), so the turn checks the round again and hands the print what it finds, in the
   * same tick as the print's own reads of work/.
   */
  async function sendPdf(res, design, signal) {
    readExportPlan(design);
    const out = await queue.run(() => {
      if (signal.aborted) throw abortError();
      const now = getDesign(design.id);
      if (!now) throw new ExportRefusal(404, 'not-found', 'design not found');
      requireReady(now);
      return print({ design: now, plan: readExportPlan(now), chrome: chrome(), signal });
    }, { front: true });
    // The person left while it printed: a pipeline into a closed response never ends, so nothing would remove it.
    if (signal.aborted) {
      out.cleanup();
      throw abortError();
    }
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': attachmentDisposition(out.name),
      'X-Worca-Export-Problems': encodeProblems(out.problems),
    });
    const file = createReadStream(out.file);
    // The folder goes once the file is closed (Windows holds an open file): on success, and on an error or a closed
    // socket mid-way, where the pipeline destroys the file.
    file.once('close', () => out.cleanup());
    await pipeline(file, res);
  }

  /**
   * A copy of `dist/` into a known project's folder (`design/<stem>` unless `subdir`). `overwrite` replaces only the
   * list its 409 showed, in the folder it was found in: `collisionsKey` comes back from that answer.
   */
  async function copyToProject(res, design, dist, body) {
    const project = (await listProjects()).find((p) => p.key === body.projectKey);
    if (!project || !project.exists) throw new ExportRefusal(422, 'no-project', NO_PROJECT);
    const subdir = body.subdir === undefined ? `design/${exportStem(design.title)}` : body.subdir;
    const r = await copyDistToProject({
      dist, projectDir: project.path, subdir, overwrite: body.overwrite === true, expect: body.collisionsKey,
    });
    res.json({ ok: true, target: r.target, files: r.files, projectKey: project.key });
  }

  // The thumbnail (Task 6): its URL carries the file's mtime (`thumbUrl`), so a version is cached for good.
  app.get('/api/design/:id/thumb', flagGate, async (req, res) => {
    const design = designFor(req, res);
    if (!design) return;
    const file = createReadStream(thumbFile(design.id));
    try {
      await once(file, 'open');
    } catch {
      res.status(404).json({ error: NO_THUMB });
      return;
    }
    res.set({
      'Content-Type': 'image/png',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=31536000, immutable',
    });
    try {
      await pipeline(file, res);
    } catch {
      res.destroy();
    }
  });

  app.post('/api/design/:id/export', flagGate, async (req, res) => {
    const design = designFor(req, res);
    if (!design) return;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (!EXPORT_FORMATS.includes(body.format)) {
      res.status(400).json({ error: FORMAT_TEXT });
      return;
    }
    if (body.overwrite !== undefined && typeof body.overwrite !== 'boolean') {
      res.status(400).json({ error: OVERWRITE_TEXT });
      return;
    }
    if (body.format === 'project' && body.overwrite === true && (typeof body.collisionsKey !== 'string' || !body.collisionsKey)) {
      res.status(400).json({ error: KEY_TEXT });
      return;
    }
    const ac = new AbortController();
    const { signal } = ac;
    res.on('close', () => {
      if (!res.writableFinished) ac.abort();
    });
    let snap = null;
    try {
      requireReady(design);
      if (body.format === 'html') await sendHtml(res, design, signal);
      else if (body.format === 'pdf') await sendPdf(res, design, signal);
      else {
        // Taken in the checks' tick: what the zip or the copy reads afterwards is this round, whatever comes next.
        snap = snapshotDist(distDir(design.id));
        if (body.format === 'zip') await sendZip(res, design, snap.dir, signal);
        else await copyToProject(res, design, snap.dir, body);
      }
    } catch (e) {
      // The person left: the socket is gone, so nothing is answered (a print stopped mid-way reads as `no-pdf`).
      if (signal.aborted || e?.name === 'AbortError') {
        res.destroy();
        return;
      }
      if (e instanceof ExportRefusal && !res.headersSent) {
        res.status(e.status).json({ error: e.message, code: e.code, ...e.data });
        return;
      }
      // A file system error names server paths: the log keeps it, the browser gets words.
      console.error(`[worca-design] export of ${design.id} as ${body.format} failed: ${messageOf(e)}`);
      if (res.headersSent) res.destroy();
      else res.status(500).json({ error: FAILED });
    } finally {
      try { snap?.cleanup(); } catch (e) { console.error(`[worca-design] export copy of ${design.id} not removed: ${messageOf(e)}`); }
    }
  });
}
