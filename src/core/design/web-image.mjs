// src/core/design/web-image.mjs
// Design's picture download (docs/design.md "Web access"): the `save_image` tool of web-mcp.mjs. worca fetches the
// file, never the agent: https only, no address on a private or local network (Ask's guard, ask/web-fetch.mjs), a
// real picture by its first bytes whatever the server calls it, capped per file and per design, and written as a new
// file in `work/assets/web/` under a name that cannot leave that folder. Nothing is ever overwritten.

import { lstat, mkdir, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ANY_HOST } from '../web-allowlist.mjs';
import { WEB_LIMITS, WebAccessError, checkWebUrl, guardedLookup, httpsTransport } from '../ask/web-fetch.mjs';
import { safeAttachmentName } from './attachments.mjs';

const MB = 1024 * 1024;
/** A picture's URL may carry a long hash or a signed query (CDNs do), so the data-in-URL rule of a page fetch is off
 *  here; the https, credentials, port, IP-literal and private-address rules all hold. */
export const IMAGE_LIMITS = Object.freeze({
  ...WEB_LIMITS, timeoutMs: 20_000, maxBytes: 8 * MB, maxTotalBytes: 64 * MB, maxFiles: 120,
  queryMaxChars: 1024, pathMaxChars: 1024, dataRunChars: 4096, inlineMaxBytes: 1.5 * MB,
});
/** `work/assets/web`, relative to the source folder; prompts name it with forward slashes on every OS. */
export const WEB_PARTS = Object.freeze(['assets', 'web']);
const USER_AGENT = 'worca-design/1';
const HEADERS = Object.freeze({ 'user-agent': USER_AGENT, accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml,image/*;q=0.8', 'accept-encoding': 'gzip, deflate, br' });
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

const starts = (buf, bytes, at = 0) => buf.length >= at + bytes.length && bytes.every((b, i) => buf[at + i] === b);
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

/**
 * What picture `buf` is, by its first bytes: `{ mime, ext }`, or null for anything else (an HTML error page, a PDF, a
 * script). An SVG is text that opens as XML or `<svg` and holds an `<svg` element in its first 4 KB.
 * @param {Buffer} buf
 * @returns {{ mime: string, ext: string }|null}
 */
export function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return null;
  if (starts(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', ext: '.png' };
  if (starts(buf, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ext: '.jpg' };
  if (starts(buf, ascii('GIF87a')) || starts(buf, ascii('GIF89a'))) return { mime: 'image/gif', ext: '.gif' };
  if (starts(buf, ascii('RIFF')) && starts(buf, ascii('WEBP'), 8)) return { mime: 'image/webp', ext: '.webp' };
  if (starts(buf, ascii('ftyp'), 4) && (starts(buf, ascii('avif'), 8) || starts(buf, ascii('avis'), 8))) return { mime: 'image/avif', ext: '.avif' };
  const head = buf.subarray(0, 4096).toString('utf8').replace(/^﻿/, '').trimStart();
  if (/^(<\?xml|<svg[\s>]|<!--|<!DOCTYPE svg)/i.test(head) && /<svg[\s>]/i.test(head) && !buf.subarray(0, 4096).includes(0)) return { mime: 'image/svg+xml', ext: '.svg' };
  return null;
}

async function readCapped(body, max) {
  const chunks = []; let n = 0;
  for await (const c of body) {
    const b = Buffer.isBuffer(c) ? c : Buffer.from(c);
    n += b.length;
    if (n > max) return null;
    chunks.push(b);
  }
  return Buffer.concat(chunks, n);
}

/** Makes `assets/web` under `workDir` one level at a time and throws at a level that is a link or not a folder: a
 *  link would carry the download out of the design. The folder reached must be the one named. */
async function ensureWebDir(workDir) {
  let dir = workDir;
  for (const part of WEB_PARTS) {
    dir = join(dir, part);
    let st = null;
    try { st = await lstat(dir); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    if (!st) { await mkdir(dir, { mode: 0o755 }); continue; }
    if (st.isSymbolicLink() || !st.isDirectory()) throw new WebAccessError(`${WEB_PARTS.join('/')} is not a plain folder in this design, so nothing is saved there`);
  }
  if (await realpath(dir) !== join(await realpath(workDir), ...WEB_PARTS)) throw new WebAccessError(`${WEB_PARTS.join('/')} is not inside this design, so nothing is saved there`);
  return dir;
}

/** The names in `dir` and the bytes its plain files hold. */
async function folderUse(dir) {
  const names = await readdir(dir);
  let bytes = 0;
  for (const name of names) {
    try { const st = await stat(join(dir, name)); if (st.isFile()) bytes += st.size; } catch { /* gone meanwhile */ }
  }
  return { names, bytes };
}

/** The file stem a URL suggests: its last path segment without an extension, else its host. */
function stemOf(url) {
  const last = url.pathname.split('/').filter(Boolean).pop() || '';
  let name = last;
  try { name = decodeURIComponent(last); } catch { /* keep the raw segment */ }
  return name.replace(/\.[A-Za-z0-9]{1,8}$/, '') || url.hostname;
}

/**
 * The saver of one design's web pictures. `save(url, name?)` downloads one picture and returns where it is:
 * `{ file: 'assets/web/<name>', type, bytes, from }`, plus `inline` (`{ data, mimeType }`, base64) for a raster picture
 * small enough to show the agent at once. Throws `WebAccessError` for every refusal; every call is logged.
 * @param {{ workDir: string, transport?: Function, lookup?: Function, signal?: AbortSignal|null, limits?: object, log?: (entry: object) => void }} opts
 */
export function createImageSaver({ workDir, transport = httpsTransport, lookup = guardedLookup, signal = null, limits = IMAGE_LIMITS, log = () => {} }) {
  async function save(raw, wanted = null) {
    const entry = { tool: 'save_image', url: String(raw ?? '').slice(0, 512), finalUrl: null, status: null, bytes: 0, file: null, ok: false, error: null };
    const deadline = AbortSignal.timeout(limits.timeoutMs);
    const sig = signal ? AbortSignal.any([signal, deadline]) : deadline;
    try {
      let url = checkWebUrl(raw, [ANY_HOST], { limits });
      const dir = await ensureWebDir(workDir);
      const use = await folderUse(dir);
      if (use.names.length >= limits.maxFiles) throw new WebAccessError(`${WEB_PARTS.join('/')} already holds ${limits.maxFiles} files: use the pictures that are there`);
      let res; let hops = 0;
      for (;;) {
        res = await transport({ url, signal: sig, lookup, headers: { ...HEADERS } });
        if (!REDIRECTS.has(res.status)) break;
        res.destroy();
        hops += 1;
        if (hops > limits.maxRedirects) throw new WebAccessError(`more than ${limits.maxRedirects} redirects`);
        const loc = res.headers.location;
        if (!loc) throw new WebAccessError(`HTTP ${res.status} without a Location header`);
        let next; try { next = new URL(String(loc), url); } catch { throw new WebAccessError('redirect to an invalid URL'); }
        url = checkWebUrl(next.href, [ANY_HOST], { redirect: true, limits });
      }
      entry.finalUrl = url.href; entry.status = res.status;
      if (res.status < 200 || res.status >= 300) { res.destroy(); throw new WebAccessError(`HTTP ${res.status} from ${url.hostname}`, { code: 'http', status: res.status }); }
      const buf = await readCapped(res.body, limits.maxBytes);
      res.destroy();
      if (!buf) throw new WebAccessError(`the file is larger than ${limits.maxBytes / MB} MB: pick a smaller picture`);
      entry.bytes = buf.length;
      const kind = sniffImage(buf);
      if (!kind) throw new WebAccessError('that URL did not return a picture (PNG, JPEG, GIF, WebP, AVIF or SVG): open the page and find the picture\'s own URL');
      if (use.bytes + buf.length > limits.maxTotalBytes) throw new WebAccessError(`${WEB_PARTS.join('/')} would pass ${limits.maxTotalBytes / MB} MB: use the pictures that are there`);
      const stem = typeof wanted === 'string' && wanted.trim() ? wanted.trim().replace(/\.[A-Za-z0-9]{1,8}$/, '') : stemOf(url);
      // The disk may fold case: every name there is taken in lower case, and the saved name is lower case too.
      const name = safeAttachmentName(`${stem}${kind.ext}`, new Set(use.names.map((n) => n.toLowerCase())));
      await writeFile(join(dir, name), buf, { flag: 'wx', mode: 0o644 });
      entry.file = name; entry.ok = true;
      const inline = kind.mime !== 'image/svg+xml' && kind.mime !== 'image/avif' && buf.length <= limits.inlineMaxBytes
        ? { data: buf.toString('base64'), mimeType: kind.mime } : null;
      return { file: [...WEB_PARTS, name].join('/'), type: kind.mime, bytes: buf.length, from: url.href, ...(inline ? { inline } : {}) };
    } catch (err) {
      const e = err instanceof WebAccessError ? err
        : deadline.aborted ? new WebAccessError(`timed out after ${limits.timeoutMs / 1000} s`, { code: 'timeout' })
          : err?.code === 'EWORCA_BLOCKED' ? new WebAccessError(err.message, { code: 'blocked-address' })
            : new WebAccessError(`could not save the picture: ${err?.code || err?.message || err}`, { code: 'network' });
      entry.error = e.message.slice(0, 300);
      throw e;
    } finally {
      try { log(entry); } catch { /* logging never breaks a download */ }
    }
  }
  return { save };
}
