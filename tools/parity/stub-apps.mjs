// tools/parity/stub-apps.mjs — #919 wrap-up: a preload (`node --import`) for every server the parity tools start. External apps
// (Terminal, Finder, an editor, `open`, `xdg-open`, the native pickers) become recorded no-ops, compared A vs B per click, and
// with WORCA_PARITY_CLOCK_MS the server's clock starts at the crawl's fixed time (docs/parity-harness.md). No app code
// changes: only the tools add this file. Installs nothing unless WORCA_STUB_APPS_LOG is set, so tests can import it.
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import http from 'node:http';
import { AsyncLocalStorage } from 'node:async_hooks';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { appendFileSync } from 'node:fs';
import { basename } from 'node:path';

/** Programs that open a window or an app (builtins.mjs EDITORS and LINUX_TERMS, `open`, the pickers of folder-dialog.mjs). */
export const APP_BINS = new Set(['open', 'osascript', 'xdg-open', 'gio', 'explorer', 'explorer.exe', 'wt', 'wt.exe', 'gnome-terminal',
  'konsole', 'xfce4-terminal', 'x-terminal-emulator', 'kitty', 'code', 'cursor', 'idea', 'webstorm', 'zeditor', 'zenity', 'kdialog']);
/** Routes where every spawn launches an app: a saved Editor / Terminal line runs as `/bin/sh -c LINE` (launcher.mjs). */
export const APP_ROUTES = [/^POST \/api\/runs\/[^/]+\/builtins\/[^/]+$/, /^POST \/api\/actions\/launchers\/(try|browse)$/,
  /^POST \/api\/ask\/threads\/[^/]+\/attachments\/[^/]+\/reveal$/, /^POST \/api\/fs\/pick-folder$/];

export function isAppLaunch(file, req) {
  if (req && APP_ROUTES.some((re) => re.test(`${req.method} ${String(req.path).split('?')[0]}`))) return true;
  return APP_BINS.has(basename(String(file)).toLowerCase());
}

/** A child that "opened" at once: 'spawn', then exit 0 and close on the next tick (launchAndWatch reads exit; folder-dialog close). */
export function fakeChild() {
  const c = new EventEmitter();
  Object.assign(c, { pid: undefined, exitCode: null, stdin: null, stdout: new PassThrough(), stderr: new PassThrough(),
    unref() {}, ref() {}, kill: () => true });
  process.nextTick(() => { c.emit('spawn'); c.stdout.end(); c.stderr.end(); c.exitCode = 0; c.emit('exit', 0, null); c.emit('close', 0, null); });
  return c;
}

/** Date whose now starts at `ms` and advances at the real rate; dated constructors, statics and instanceof are the real ones. */
export function pinClock(ms, RealDate = Date) {
  const start = RealDate.now();
  const now = () => ms + (RealDate.now() - start);
  return new Proxy(RealDate, {
    construct: (T, a, nt) => Reflect.construct(T, a.length ? a : [now()], nt),
    apply: () => new RealDate(now()).toString(),
    get: (T, k) => (k === 'now' ? now : Reflect.get(T, k)),
  });
}

/** The stub log (NDJSON) as crawl `net` lines: `app METHOD path command…`. */
export const appLines = (text) => String(text).split('\n').filter(Boolean).map((l) => {
  const e = JSON.parse(l); return `app ${e.method ?? '-'} ${e.path ?? '-'} ${e.command.join(' ')}`;
});

function install(env = process.env) {
  const als = new AsyncLocalStorage();
  const emit = http.Server.prototype.emit;
  http.Server.prototype.emit = function (ev, req, ...rest) {
    return ev === 'request' ? als.run({ method: req.method, path: req.url }, () => emit.call(this, ev, req, ...rest)) : emit.call(this, ev, req, ...rest);
  };
  const home = env.HOME;
  const tidy = (s) => (home ? String(s).split(home).join('~') : String(s));
  const real = cp.spawn;
  cp.spawn = function spawn(file, args, opts) {
    const req = als.getStore();
    if (!isAppLaunch(file, req)) return real.apply(this, arguments);
    const list = Array.isArray(args) ? args : [];
    appendFileSync(env.WORCA_STUB_APPS_LOG, `${JSON.stringify({ method: req?.method ?? null, path: req ? String(req.path).split('?')[0] : null, command: [file, ...list].map(tidy) })}\n`);
    return fakeChild();
  };
  syncBuiltinESMExports();
  if (Number(env.WORCA_PARITY_CLOCK_MS) > 0) globalThis.Date = pinClock(Number(env.WORCA_PARITY_CLOCK_MS));
}
if (process.env.WORCA_STUB_APPS_LOG) install();
