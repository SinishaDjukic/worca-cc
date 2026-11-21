// src/core/speech-assets.mjs
// Ask Worca's in-browser voice engines (docs/speech.md): the files the browser
// needs — the transformers.js bundle, its onnxruntime-web wasm runtime, misaki's
// English pronunciation dictionaries, and the Whisper / Kokoro model weights — are fetched ONCE by the
// server, on first use, and cached under ~/.worca-cc/speech-cache. The browser
// only ever loads them from worca itself (no CDN in the page).
//
// Not npm dependencies on purpose: @huggingface/transformers pulls
// onnxruntime-node and sharp (native, hundreds of MB) into every install for a
// browser-only feature. Instead every file is pinned: the runtime by exact npm
// version + SHA-256, the models by Hugging Face commit. Nothing outside these
// allow-lists is ever fetched.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable, PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { worcaHome } from './projects.mjs';

const NPM = 'https://cdn.jsdelivr.net/npm';
const TRANSFORMERS = `${NPM}/@huggingface/transformers@3.8.1/dist`;
// misaki (Kokoro's own G2P, Apache-2.0): its English pronunciation dictionaries.
const MISAKI = 'https://cdn.jsdelivr.net/gh/hexgrad/misaki@fba1236595f2d2bf21d414ba6e57d25256afada3/misaki/data';

/**
 * The browser runtime: published name → pinned source. transformers.js embeds onnxruntime-web
 * 1.22.0-dev.20250409 and fetches its wasm. Deliberately NOT kokoro-js: its bundle carries
 * eSpeak NG (GPL-3.0); Kokoro runs on transformers.js with src/shared/speech-g2p.mjs instead.
 */
export const SPEECH_LIBS = Object.freeze({
  'transformers.min.js': { url: `${TRANSFORMERS}/transformers.min.js`, sha256: 'aa5002b70e789798da263f5f99c62bd3e8fcd0c119258a493c40c180648365fa', type: 'text/javascript' },
  'us_gold.json': { url: `${MISAKI}/us_gold.json`, sha256: 'dc414872a49a28ae6c141463d502fd945f3b2fde040484fdc47d00cc4612686f', type: 'application/json' },
  'us_silver.json': { url: `${MISAKI}/us_silver.json`, sha256: 'de8f67be911bb6c659187b4a65fd966b6a30e56350e0f790d763210b053ac475', type: 'application/json' },
  'gb_gold.json': { url: `${MISAKI}/gb_gold.json`, sha256: '29e62f4b60261c88f7f3c2c7811ca3825978948090b72d2b27d565b729282f71', type: 'application/json' },
  'gb_silver.json': { url: `${MISAKI}/gb_silver.json`, sha256: '48131e2d92ccc41655f4543e87e0f938e71463eb5a54be7f0693bb712ebb6bce', type: 'application/json' },
  'ort-wasm-simd-threaded.jsep.mjs': { url: `${TRANSFORMERS}/ort-wasm-simd-threaded.jsep.mjs`, sha256: '08fb86ec433c78bfb032c5d84a68b8e8e5a8d81268fa39e24314179a5767a5b9', type: 'text/javascript' },
  'ort-wasm-simd-threaded.jsep.wasm': { url: `${TRANSFORMERS}/ort-wasm-simd-threaded.jsep.wasm`, sha256: 'c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39', type: 'application/wasm' },
});

/** Hugging Face repos the engines may read, each pinned to a commit (any revision the browser asks for maps to it). */
export const SPEECH_MODELS = Object.freeze({
  'onnx-community/whisper-base': '1846881b6b3a3024392c1eea3ad983695bc23925',
  'onnx-community/Kokoro-82M-v1.0-ONNX': '1939ad2a8e416c0acfeecc08a694d14ef25f2231',
});
/** Which repo each built-in engine loads (ui/public/speech-worker.mjs). */
export const SPEECH_ENGINE_MODELS = Object.freeze({ stt: 'onnx-community/whisper-base', tts: 'onnx-community/Kokoro-82M-v1.0-ONNX' });

const MAX_BYTES = 400 * 1024 * 1024;
const FILE_RE = /^(?:[\w-][\w.-]*\/)*[\w-][\w.-]*$/;   // no '..', no leading dot, no empty segment
const TIMEOUT_MS = 10 * 60_000;

export class SpeechAssetError extends Error {
  constructor(message, status = 502) { super(message); this.name = 'SpeechAssetError'; this.status = status; }
}

const TYPES = { '.json': 'application/json', '.onnx': 'application/octet-stream', '.bin': 'application/octet-stream', '.txt': 'text/plain' };

/**
 * createSpeechAssets({ dir, fetch, libs?, models? }) → { lib(name), model(repo, file), downloaded(), size(), clear() }.
 * Both resolve to { file, type } on disk, downloading once (concurrent callers share
 * the download). model() hands the caller that STARTS a download { type, length, body }
 * instead — the bytes as they land on disk — so the browser sees real progress on a
 * slow first download. lib() never streams: its bytes are only served once their
 * SHA-256 is verified.
 */
export function createSpeechAssets({ dir, fetch: f = globalThis.fetch, libs = SPEECH_LIBS, models = SPEECH_MODELS }) {
  const inflight = new Map();

  function once(dest, download) {
    if (fs.existsSync(dest)) return Promise.resolve();
    if (!inflight.has(dest)) {
      const p = download().finally(() => inflight.delete(dest));
      inflight.set(dest, p);
    }
    return inflight.get(dest);
  }

  async function fetchTo(url, dest, sha256, tap = null) {
    let r;
    try {
      r = await f(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      throw new SpeechAssetError(`could not download ${url} — ${err && err.message ? err.message : err}`);
    }
    if (r.status === 404) throw new SpeechAssetError('not found', 404);
    if (!r.ok || !r.body) throw new SpeechAssetError(`download of ${url} answered ${r.status}`);
    const len = Number(r.headers.get('content-length'));
    if (len > MAX_BYTES) throw new SpeechAssetError(`${url} is larger than ${MAX_BYTES} bytes`);
    if (tap) tap.head(len || null);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.part`;
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    try {
      await pipeline(Readable.fromWeb(r.body), async function* (src) {
        for await (const chunk of src) {
          bytes += chunk.length;
          if (bytes > MAX_BYTES) throw new SpeechAssetError(`${url} is larger than ${MAX_BYTES} bytes`);
          hash.update(chunk);
          if (tap) tap.data(chunk);
          yield chunk;
        }
      }, fs.createWriteStream(tmp));
      if (sha256 && hash.digest('hex') !== sha256) throw new SpeechAssetError(`${url} failed its integrity check`);
      fs.renameSync(tmp, dest);
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      throw err instanceof SpeechAssetError ? err : new SpeechAssetError(`could not download ${url} — ${err && err.message ? err.message : err}`);
    }
  }

  async function lib(name) {
    const spec = Object.hasOwn(libs, name) ? libs[name] : null;
    if (!spec) throw new SpeechAssetError('not found', 404);
    const dest = path.join(dir, 'lib', name);
    await once(dest, () => fetchTo(spec.url, dest, spec.sha256));
    return { file: dest, type: spec.type };
  }

  async function model(repo, file) {
    const rev = Object.hasOwn(models, repo) ? models[repo] : null;
    if (!rev || typeof file !== 'string' || !FILE_RE.test(file)) throw new SpeechAssetError('not found', 404);
    const dest = path.join(dir, 'hf', repo, rev, ...file.split('/'));
    const type = TYPES[path.extname(file)] || 'application/octet-stream';
    if (fs.existsSync(dest) || inflight.has(dest)) {
      await once(dest, null);
      return { file: dest, type };
    }
    return new Promise((resolve, reject) => {
      const body = new PassThrough();
      let started = false;
      const tap = {
        head: (length) => { started = true; resolve({ type, length, body }); },
        data: (chunk) => { if (!body.destroyed) body.write(chunk); },   // a gone browser never stops the download
      };
      once(dest, () => fetchTo(`https://huggingface.co/${repo}/resolve/${rev}/${file}`, dest, null, tap))
        .then(() => body.end(), (err) => { if (started) body.destroy(err); else reject(err); });
    });
  }

  /** { stt, tts }: is each engine's model already on disk? (Any finished .onnx: the variant depends on the browser.) */
  function downloaded() {
    const has = (repo) => {
      try { return fs.readdirSync(path.join(dir, 'hf', repo, models[repo], 'onnx')).some((n) => n.endsWith('.onnx')); } catch { return false; }
    };
    return { stt: has(SPEECH_ENGINE_MODELS.stt), tts: has(SPEECH_ENGINE_MODELS.tts) };
  }

  /** Bytes on disk (finished files and partial downloads alike). */
  function size() {
    let bytes = 0;
    const walk = (d) => {
      let entries;
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile()) { try { bytes += fs.statSync(p).size; } catch { /* raced a rename */ } }
      }
    };
    walk(dir);
    return bytes;
  }

  /** Remove every downloaded file (the next mic use downloads again). Refused mid-download. */
  function clear() {
    if (inflight.size) throw new SpeechAssetError('a speech model is downloading — try again when it finishes', 409);
    const bytes = size();
    fs.rmSync(dir, { recursive: true, force: true });
    return bytes;
  }

  return { lib, model, downloaded, size, clear };
}

let store = null;
/** The one store the server and the Speech row (Models › Providers) share: ~/.worca-cc/speech-cache. */
export function speechAssetStore() {
  return (store ||= createSpeechAssets({ dir: path.join(worcaHome(), 'speech-cache') }));
}
