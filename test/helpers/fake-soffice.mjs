// test/helpers/fake-soffice.mjs — a POSIX stand-in for LibreOffice's `soffice --headless --convert-to pdf --outdir <d> <src>`.
// It writes `<outdir>/<src base>.pdf`, counts its calls in `<dir>/calls`, and fails (`mode-fail`) or hangs (`mode-hang`)
// when those files exist beside it. A hang waits on a child `sleep` (pid in `<dir>/hang.pid`), as soffice waits on
// soffice.bin: only a process-GROUP kill stops that child. Marker files, not env: the converter passes a scrubbed env,
// which each call records in `<dir>/env` (one NAME=value per line) so a test can see what reached soffice.
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = `#!/bin/sh
here=$(cd "$(dirname "$0")" && pwd)
echo x >> "$here/calls"
env > "$here/env"
out=""; src=""
while [ $# -gt 0 ]; do
  case "$1" in
    --outdir) out="$2"; shift 2 ;;
    *) src="$1"; shift ;;
  esac
done
[ -f "$here/mode-fail" ] && exit 3
[ -f "$here/mode-hang" ] && { sleep 30 & echo $! > "$here/hang.pid"; wait; exit 0; }
b=$(basename "$src"); b=\${b%.*}
printf '%%PDF-1.4\\n%% fake from %s\\n' "$(basename "$src")" > "$out/$b.pdf"
`;

/** → { dir, bin, calls(), mode(name|null), hangPid(), envNames(), cleanup() }. `dir` holds `soffice` (put it first on PATH for the server). */
export function makeFakeSoffice() {
  const dir = mkdtempSync(join(tmpdir(), 'worca-fake-soffice-'));
  const bin = join(dir, 'soffice');
  writeFileSync(bin, SCRIPT, 'utf8');
  chmodSync(bin, 0o755);
  const calls = () => { try { return readFileSync(join(dir, 'calls'), 'utf8').split('\n').filter(Boolean).length; } catch { return 0; } };
  const mode = (name) => {
    for (const m of ['mode-fail', 'mode-hang', 'hang.pid']) rmSync(join(dir, m), { force: true });
    if (name) writeFileSync(join(dir, `mode-${name}`), '');
  };
  const hangPid = () => { try { return Number(readFileSync(join(dir, 'hang.pid'), 'utf8')) || null; } catch { return null; } };
  const envNames = () => { try { return readFileSync(join(dir, 'env'), 'utf8').split('\n').map((l) => l.split('=')[0]).filter(Boolean); } catch { return []; } };
  return { dir, bin, calls, mode, hangPid, envNames, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
