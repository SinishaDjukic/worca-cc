# scripts/py-inline.py — the `py` card (workbench spec §7, W17): runs
# `params.source` in a FRESH module and calls its `main`, with the SAME api the
# harness gives a file script, so a snippet that works inline works as a file
# unchanged. Imports nothing from worca and nothing outside the standard library
# (it runs with WORCA_HOME stripped), and must parse on python 3.8.
import sys
import types


def main(api):
    source = api.params.get('source') or ''
    if not source.strip():
        raise ValueError('the py card has no source')
    # A REAL module, registered under its name — not a bare dict. dataclasses,
    # pickle and typing all look a class's module up in sys.modules; with a dict
    # namespace a `@dataclass` under `from __future__ import annotations` dies with
    # "'NoneType' object has no attribute '__dict__'", and the same snippet saved as
    # a file script works. "Works unchanged as a file script" has to be true.
    module = types.ModuleType('worca_py_card')
    module.__file__ = '<py card>'
    sys.modules[module.__name__] = module
    exec(compile(source, '<py card>', 'exec'), module.__dict__)
    entry = getattr(module, 'main', None)
    if not callable(entry):
        raise TypeError('the source must define `def main(api): …`')
    # A coroutine travels back up: the harness awaits whatever main returns.
    return entry(api)
