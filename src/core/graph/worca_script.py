# src/core/graph/worca_script.py
# The `python` runtime harness (scripts-workbench spec §7) — the twin of
# script-child.mjs, one language over. Spawned as
#   <python> -u worca_script.py <program.py>
# with the envelope on stdin.
#
# Imports NOTHING from worca and nothing outside the standard library: it runs
# with WORCA_HOME stripped, on whatever interpreter the probe found, and must
# parse and run on python 3.8 (no match, no X | Y unions, no removeprefix).
#
# Protocol: read ONE JSON envelope from stdin, load the program, call its
# main(api), write ONE JSON frame to the REAL stdout, exit 0. stdout is
# protocol-reserved (base spec §5.1 rule 2) at TWO levels:
#   - the file descriptor: a private duplicate of fd 1 is kept for the frame and
#     fd 1 itself is pointed at stderr, so a child process the program starts
#     (subprocess.run([...]) with no capture, os.system) writes into the run log.
#     Rebinding sys.stdout alone does not cover that: a child inherits the OS
#     descriptor, and one stray line before the frame is "stdout is not JSON".
#   - the python object: sys.stdout points at sys.stderr from the moment user code
#     can run and is NEVER pointed back, so every print() goes through the utf-8
#     stream configured below — including one made after main() returned (an atexit
#     hook, a worker thread that outlives main): the frame handle is private.
# A non-zero exit means "crashed before the frame" and the parent reports
# "no result frame (exit N)".
import asyncio
import importlib.machinery
import importlib.util
import inspect
import json
import os
import sys
import traceback

# Never leave a __pycache__ beside a user's program — or inside the installed
# package, which is where the built-in `py` card's program lives. Process-local on
# purpose: PYTHONDONTWRITEBYTECODE in the environment would leak into every python
# tool the program starts (pytest, a build script) and change how THEY behave.
sys.dont_write_bytecode = True


def _reserve_stdout():
    """Keep a private handle on the REAL stdout for the frame, then point fd 1 at stderr.

    os.dup() returns a NON-inheritable descriptor (PEP 446), so no child process can
    ever write into the frame; os.dup2(2, 1) makes fd 1 the run log for this process
    and for everything it starts. Falls back to the plain object when the descriptors
    are not there to duplicate (an embedded interpreter) — print() is still covered.
    """
    try:
        sys.stdout.flush()
        keep = os.dup(1)
        os.dup2(2, 1)
        return os.fdopen(keep, 'w', encoding='utf-8', newline='')
    except (OSError, ValueError, AttributeError):
        return sys.stdout


# The REAL stdout, reserved before anything can rebind or inherit it: the frame goes here.
_FRAME_OUT = _reserve_stdout()
# Appended by api.log(); carried on the frame even when main() then raises.
_LOGS = []

for _stream in (sys.stdin, sys.stderr):
    # Windows consoles default to cp1252; the parent also exports PYTHONIOENCODING
    # and PYTHONUTF8, this is the belt to that pair of braces. errors='replace' so
    # an unprintable byte in a log line can never kill the execution.
    if hasattr(_stream, 'reconfigure'):
        try:
            _stream.reconfigure(encoding='utf-8', errors='replace')
        except (ValueError, OSError):
            pass


class Api(dict):
    """The api bag: api.params and api['params'] are the same thing (spec §7)."""

    def __getattr__(self, name):
        try:
            return self[name]
        except KeyError:
            # Only the MESSAGE reaches the run (`script "k": <message>`), so a bare name
            # would read as `script "k": plan`. Say what is missing and what is there.
            raise AttributeError('no "%s" here (has: %s)' % (name, ', '.join(sorted(str(k) for k in self)) or 'nothing')) from None

    def __setattr__(self, name, value):
        self[name] = value

    def __delattr__(self, name):
        try:
            del self[name]
        except KeyError:
            raise AttributeError(name) from None


def _wrap(value):
    """Envelope JSON -> Api all the way down, so api.outputs.out.path reads naturally."""
    if isinstance(value, dict):
        return Api((key, _wrap(item)) for key, item in value.items())
    if isinstance(value, list):
        return [_wrap(item) for item in value]
    return value


def _log(level, msg):
    _LOGS.append({'level': str(level), 'msg': str(msg)})


def _load(path):
    """Load the program as its own module, with its directory first on sys.path so
    a script's sibling imports work (the node runtime gets that for free)."""
    directory = os.path.dirname(os.path.abspath(path))
    if directory not in sys.path:
        sys.path.insert(0, directory)
    # An EXPLICIT source loader: left to itself spec_from_file_location() picks the
    # loader by suffix and answers None for anything that is not .py, and the sidecar
    # only asks `file` to be a plain basename.
    loader = importlib.machinery.SourceFileLoader('worca_user_script', path)
    spec = importlib.util.spec_from_file_location('worca_user_script', path, loader=loader)
    if spec is None or spec.loader is None:
        raise ImportError('cannot load script module: ' + str(path))
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


async def _resolve(value):
    return await value


def _run(envelope, path):
    api = Api(
        inputs=_wrap(envelope.get('inputs') or {}),
        outputs=_wrap(envelope.get('outputs') or {}),
        params=_wrap(envelope.get('params') or {}),
        ctx=_wrap(envelope.get('ctx') or {}),
        verdictPath=envelope.get('verdictPath'),
        node=_wrap(envelope.get('node') or {}),
        execution=_wrap(envelope.get('execution') or {}),
        log=_log,
    )
    module = _load(path)
    entry = getattr(module, 'main', None)
    if not callable(entry):
        raise TypeError('script module has no callable main(api): ' + str(path))
    result = entry(api)
    if inspect.isawaitable(result):
        result = asyncio.run(_resolve(result))
    returned = result if isinstance(result, dict) else {}
    frame = {'ok': True, 'logs': _LOGS}
    if isinstance(returned.get('outputs'), dict):
        frame['outputs'] = returned['outputs']
    if 'verdict' in returned:
        frame['verdict'] = returned['verdict']
    if isinstance(returned.get('summary'), str):
        frame['summary'] = returned['summary']
    return frame


def _message(err):
    """str(err), except where python's own str() says nothing useful on its own."""
    text = str(err)
    if not text:
        return err.__class__.__name__
    if isinstance(err, KeyError):        # str(KeyError('plan')) is just "'plan'"
        return 'KeyError: ' + text
    return text


def _encode(frame):
    """ONE line of pure-ASCII JSON. ensure_ascii (the default) keeps the frame ASCII
    whatever the console encoding is; the parent's JSON.parse restores every escape.
    A returned set / bytes / datetime / Path, a NaN (which json would happily print
    as the non-JSON token NaN) or a nesting json gives up on (RecursionError — not a
    ValueError) is reported the way script-child.mjs reports it — as a frame —
    instead of dying with no frame at all."""
    try:
        return json.dumps(frame, allow_nan=False)
    except Exception as err:
        return json.dumps({'ok': False, 'logs': _LOGS,
                           'error': {'message': 'frame is not serializable: ' + (str(err) or err.__class__.__name__)}})


def main():
    try:
        raw = sys.stdin.read()
        envelope = json.loads(raw) if raw.strip() else {}
        path = sys.argv[1] if len(sys.argv) > 1 else None
        if not path:
            raise ValueError('worca_script.py: no program file argument')
        sys.stdout = sys.stderr          # stdout is protocol-reserved: prints go to the run log
        frame = _run(envelope, path)
    except Exception as err:             # a user's sys.exit() is SystemExit and is left to propagate:
        frame = {'ok': False, 'logs': _LOGS,   # no frame, non-zero exit, "no result frame (exit N)" upstream
                 'error': {'message': _message(err), 'stack': traceback.format_exc()}}
    # sys.stdout is NOT pointed back at the frame handle — not here, not ever. User
    # code is not over when main() returns: an atexit hook, a finalizer or a worker
    # thread that outlives main (the exit below waits for a non-daemon one) can still
    # print, and one byte after the frame is "stdout is not JSON" for a card that
    # succeeded. Only this function ever writes to _FRAME_OUT.
    _FRAME_OUT.write(_encode(frame))
    _FRAME_OUT.flush()
    sys.exit(0)


if __name__ == '__main__':
    main()
