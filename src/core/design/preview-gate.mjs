// src/core/design/preview-gate.mjs
// The gate at `/design-preview` (P3, SPEC C-7). A sandboxed preview frame has an opaque origin, so its 256-bit path
// token is its only credential: the gate is mounted before S1, identity and G1 (L3.31), answers every request under
// the mount itself and never hands a request on to a later handler. It checks the Host, the flag, the path and token, the design and the
// method, in that order, then serves the generated doc (with a fresh nonce) or a file under `work/`. Only
// token-verified doc and file responses carry C-7's headers; every refusal stays bare (Contract issue 16).
// `registerPreviewTokenRoute` adds the mint route, an ordinary /api route behind S1, identity and G1.

import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream';
import { openArtifactUnder } from '../artifacts.mjs';
import { mimeForPath } from '../../shared/artifact-kinds.mjs';
import { DESIGN_ID_RE } from './ids.mjs';
import { TOKEN_RE } from './preview-grants.mjs';
import { previewBase, previewCsp, previewHeaders } from './preview-doc.mjs';

/** Task 1's switch: `true` would embed every asset in every doc, as `?inline=1` does. R5's probe kept it off; P8
 *  turns it on per server instead, behind an identity proxy (`designPreviewInline`, passed as `inlineDefault`). */
export const PREVIEW_INLINE_DEFAULT = false;

/**
 * Whether a doc embeds its CSS, fonts and images by default (P8 L8.17, L8.18). Behind an identity proxy (Cloudflare
 * Access, an issuer, or WORCA_INSECURE_NO_IDENTITY_CHECK) the sandboxed frame may get no cookies for its subresources
 * (R6), so it is on there. `WORCA_DESIGN_PREVIEW_INLINE` `1` or `0` wins; any other value means "use the rule". Reads
 * `env` on every call.
 * @param {{ env?: Record<string, string | undefined>, remoteAccess?: { identity?: object | null, insecureNoIdentity?: boolean } | null }} [opts]
 * @returns {boolean}
 */
export function designPreviewInline({ env = process.env, remoteAccess = null } = {}) {
  const set = env.WORCA_DESIGN_PREVIEW_INLINE;
  if (set === '1') return true;
  if (set === '0') return false;
  return !!remoteAccess?.identity || remoteAccess?.insecureNoIdentity === true;
}

const MODES = new Set(['build', 'run']);
/** Refused in a decoded segment on every OS: separators, a drive colon and control characters (Global Constraints). */
const BAD_SEGMENT_CHAR_RE = /[/\\:\x00-\x1f\x7f]/;
/** Windows drops a trailing dot or space, so `x.png.` would open `x.png` there. */
const BAD_SEGMENT_END_RE = /[. ]$/;
const SCRIPT_DESTS = ['script', 'worker', 'sharedworker', 'serviceworker'];
const PLAIN_TEXT = 'text/plain; charset=utf-8';

/**
 * Splits the path below the mount into `{token, mode, rel}`. It is the ONLY dot-segment defence:
 * `openArtifactUnder` joins `rel` before it compares, so it would serve `../secret.txt` (the plan's Invariant).
 * `/<token>/<build|run>/` is the doc (`rel: ''`). Otherwise every segment after the mode is percent-decoded (a bad
 * escape refuses) and refused when empty, dot-prefixed (L3.6: `.`, `..`, `.crew.json`, `.asks/`, `.kit/`), holding
 * `/`, `\`, `:` or a control character, or ending in a dot or a space.
 * @param {unknown} pathname the raw, undecoded path relative to the mount (`req.path`)
 * @returns {{ token: string, mode: 'build' | 'run', rel: string } | null}
 */
export function parsePreviewPath(pathname) {
  if (typeof pathname !== 'string') return null;
  const parts = pathname.split('/');
  if (parts.length < 4 || parts[0] !== '' || !TOKEN_RE.test(parts[1]) || !MODES.has(parts[2])) return null;
  const [, token, mode, ...rest] = parts;
  if (rest.length === 1 && rest[0] === '') return { token, mode, rel: '' };
  const segments = [];
  for (const raw of rest) {
    let seg;
    try { seg = decodeURIComponent(raw); } catch { return null; }
    if (seg === '' || seg.startsWith('.') || BAD_SEGMENT_CHAR_RE.test(seg) || BAD_SEGMENT_END_RE.test(seg)) return null;
    segments.push(seg);
  }
  return { token, mode, rel: segments.join('/') };
}

/**
 * `sendArtifactRaw`'s script rule (`ui/server.mjs`, V16), copied: a script load from the worca page itself is refused,
 * and agent JS is served as a script only to a cross-site requester (the opaque preview frame). Anything else gets it
 * as text, which nosniff never runs. Header values are lowercased as `fetchHeader` does there.
 * @param {Record<string, unknown> | undefined} headers the request's headers
 * @param {string} mime `mimeForPath`'s answer for the file
 * @returns {{ refuse: boolean, servedMime: string }}
 */
export function scriptServing(headers, mime) {
  const fetchHeader = (name) => String(headers?.[name] || '').toLowerCase();
  const site = fetchHeader('sec-fetch-site');
  const dest = fetchHeader('sec-fetch-dest');
  const isScript = typeof mime === 'string' && mime.startsWith('text/javascript');
  const refuse = isScript && site === 'same-origin' && SCRIPT_DESTS.includes(dest);
  const servedMime = isScript && site !== 'cross-site' ? PLAIN_TEXT : mime;
  return { refuse, servedMime };
}

/** `<workDir>/<rel>` as the disk spells it equals the typed spelling. A wrong case (macOS, Windows) or an NFD spelling
 *  of an NFC name (macOS) opens the file, and `openArtifactUnder`'s JS `realpathSync` keeps the typed spelling, so
 *  this native pair is what refuses it (L3.28; precedent `skills-registry/import.mjs`). A throw counts as a mismatch. */
function spelledExactly(workDir, rel) {
  try {
    return realpathSync.native(join(workDir, rel)) === join(realpathSync.native(workDir), rel);
  } catch {
    return false;
  }
}

const freshNonce = () => randomBytes(16).toString('base64url');
const notFound = (res) => res.status(404).json({ error: 'not found' });

/**
 * The `(req, res)` handler for `app.use('/design-preview', gate)`. It takes no third argument and never rethrows: a
 * failure is a bare 500 that names nothing.
 * @param {{
 *   grants: { check: (token: unknown) => { designId: string } | null, revokeDesign: (designId: string) => number },
 *   hostNameOk: (host: unknown) => boolean,
 *   designFor: (designId: string) => ({ workDir: string, kind: string } | null),
 *   renderDoc: (opts: { workDir: string, kind: string, mode: 'build' | 'run', nonce: string, inline: boolean }) => string | Promise<string>,
 *   enabled: () => boolean,
 *   inlineDefault?: () => boolean,
 * }} deps `inlineDefault` is asked on every doc: true embeds every asset, as `?inline=1` does (P8 Task 8).
 * @returns {(req: import('express').Request, res: import('express').Response) => Promise<void>}
 */
export function createPreviewGate({ grants, hostNameOk, designFor, renderDoc, enabled, inlineDefault = () => false }) {
  return async (req, res) => {
    try {
      // 1. Host. hostGuard parses with `new URL`, so previewBase checks the characters again (L3.2, L3.3).
      const host = req.headers.host;
      if (!hostNameOk(host) || !previewBase({ host, token: '' }).ok) return res.status(403).json({ error: 'forbidden' });
      // 2. The design flag.
      if (!enabled()) return notFound(res);
      // 3. Path and token.
      const parsed = parsePreviewPath(req.path);
      const grant = parsed && grants.check(parsed.token);
      if (!grant) return notFound(res);
      // 4. The design. A deleted design also drops its grants, so a missed DELETE hook is not a leak.
      const design = await designFor(grant.designId);
      if (!design) {
        grants.revokeDesign(grant.designId);
        return notFound(res);
      }
      // 5. Method, only once the token holds (L3.20).
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return res.status(405).set('Allow', 'GET, HEAD').json({ error: 'method not allowed' });
      }
      const { token, mode, rel } = parsed;
      const { workDir, kind } = design;
      const { base } = previewBase({ host, forwardedProto: req.headers['x-forwarded-proto'], protocol: req.protocol, token });
      // 6. The generated doc, under a nonce minted for this response only.
      if (rel === '') {
        const nonce = freshNonce();
        const inline = req.query?.inline === '1' || base === null || PREVIEW_INLINE_DEFAULT || inlineDefault();
        const html = await renderDoc({ workDir, kind, mode, nonce, inline });
        res.status(200).set(previewHeaders({ csp: previewCsp({ mode, base, nonce }) }));
        res.set('Content-Type', 'text/html; charset=utf-8');
        return res.send(html);
      }
      // 7. A file under work/.
      return await sendPreviewFile(req, res, { workDir, rel, mode, base });
    } catch {
      if (res.headersSent) { res.destroy(); return; }
      for (const name of res.getHeaderNames()) res.removeHeader(name);
      res.status(500).json({ error: 'internal error' });
    }
  };
}

/**
 * `POST /api/design/:id/preview-token` (C-8): mints a grant for a design this viewer may see and answers
 * `{base: '/design-preview/<token>', expiresAt}`, a path with no trailing slash and epoch ms (L3.21). A malformed id
 * (`getDesign` does not check the format), an unknown design and another person's design all read 404, as P2's
 * `designFor` does; a design with no maker is everyone's. Only this route, behind S1, identity and G1, hands a token
 * out (L3.31), and the grant records who minted it.
 * @param {import('express').Express} app
 * @param {{
 *   flagGate: import('express').RequestHandler,
 *   grants: { mint: (grant: { designId: string, owner: string|null }) => { token: string, expiresAt: number } },
 *   getDesign: (id: string) => ({ createdBy?: string|null } | null),
 *   viewerOf: (req: import('express').Request) => string|null,
 * }} deps
 * @returns {void}
 */
export function registerPreviewTokenRoute(app, { flagGate, grants, getDesign, viewerOf }) {
  app.post('/api/design/:id/preview-token', flagGate, (req, res) => {
    const id = req.params.id;
    const design = typeof id === 'string' && DESIGN_ID_RE.test(id) ? getDesign(id) : null;
    const viewer = viewerOf(req);
    if (!design || (viewer && design.createdBy && design.createdBy !== viewer)) {
      return res.status(404).json({ error: 'design not found' });
    }
    const { token, expiresAt } = grants.mint({ designId: id, owner: viewer });
    return res.json({ base: `/design-preview/${token}`, expiresAt });
  });
}

/** Serves `<workDir>/<rel>` from the handle `openArtifactUnder` checked, with `sendArtifactRaw`'s Range and HEAD
 *  handling (minus its `If-*` preconditions, size cap and `Content-Disposition`). The handle is closed on every path
 *  that does not stream; a stream closes it itself, also when the client aborts. */
async function sendPreviewFile(req, res, { workDir, rel, mode, base }) {
  const mime = mimeForPath(rel);
  if (!mime) return notFound(res);                              // L3.19: an unknown type discloses nothing
  const { refuse, servedMime } = scriptServing(req.headers, mime);
  if (refuse) return res.status(403).json({ error: 'artifact scripts do not run in the worca page' });
  const fh = await openArtifactUnder(workDir, rel);
  if (!fh) return notFound(res);
  let streaming = false;
  try {
    if (!spelledExactly(workDir, rel)) return notFound(res);
    const { size } = await fh.stat();
    res.set(previewHeaders({ csp: previewCsp({ mode, base, nonce: freshNonce() }) }));
    res.set('Accept-Ranges', 'bytes');
    const ranges = req.headers.range ? req.range(size, { combine: true }) : null;
    if (ranges === -1 || (ranges && size === 0)) {
      res.set('Content-Range', `bytes */${size}`);
      return res.status(416).end();
    }
    let start = 0, end = size - 1, status = 200;
    if (Array.isArray(ranges) && ranges.type === 'bytes' && ranges.length === 1) {
      ({ start, end } = ranges[0]);
      status = 206;
      res.set('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    res.status(status);
    res.set('Content-Length', String(size ? end - start + 1 : 0));
    res.set('Content-Type', servedMime);
    // A zero-byte file never streams: createReadStream({start: 0, end: -1}) throws ERR_OUT_OF_RANGE.
    if (req.method === 'HEAD' || size === 0) return res.end();
    const stream = fh.createReadStream({ start, end });
    streaming = true;
    pipeline(stream, res, () => {});
  } finally {
    if (!streaming) await fh.close().catch(() => {});
  }
}
