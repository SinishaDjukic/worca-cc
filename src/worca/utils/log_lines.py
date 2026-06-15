"""Shared formatting for persisted pipeline log lines.

Every line written to a stage or orchestrator log file is prefixed with an
ISO-8601 UTC write-time, an origin-stream tag, and TABs:

    2026-06-14T12:34:56.789+00:00\tout\t[tool:Read] foo.py
    2026-06-14T12:34:57.001+00:00\terr\tOverloaded, retrying in 4s

The middle column is the origin stream — ``out`` (CLI stdout, the default) or
``err`` (CLI stderr, e.g. 429/529 throttling text). The worca-ui reader
(``worca-ui/server/log-tailer.js`` → ``parseLogLine``) sniffs this prefix,
renders the timestamp in each viewer's local timezone, and colors ``err`` lines.
Legacy lines without a recognized stream token (``<ts>\\t<text>`` or no prefix
at all) parse back as ``stream="out"`` — no migration of old files needed.

Centralising the format here keeps every producer byte-for-byte consistent so
the single reader-side parser stays valid:

  - agent stage logs   — ``claude_cli.process_stream`` (stdout, ``out``)
  - agent stderr tee    — ``claude_cli._tee_stderr`` (``err``)
  - orchestrator log    — ``orchestrator.runner._log``
  - preflight stdout    — ``orchestrator.runner.run_preflight``
"""

from datetime import datetime, timezone
from typing import Optional, TextIO

# Embedded newlines are collapsed to this glyph so one logical record is always
# exactly one physical line — keeping the reader's "first field is the
# timestamp" invariant sound for every line it sees.
LOG_NEWLINE_GLYPH = "⏎ "


def format_log_line(
    message: str, now: Optional[datetime] = None, *, stream: str = "out"
) -> str:
    """Return *message* as one timestamped, stream-tagged log record.

    The canonical shape is ``<ISO-ts>\\t<stream>\\t<text>`` (no trailing
    newline). ``stream`` is the origin channel — ``out`` (default) or ``err``.

    The timestamp is captured at format time — the closest available proxy to
    event time, since the underlying events carry no per-event timestamp.
    ``now`` is injectable for deterministic tests.
    """
    ts = (now or datetime.now(timezone.utc)).isoformat(timespec="milliseconds")
    safe = (
        str(message)
        .replace("\r\n", "\n")
        .replace("\r", "\n")
        .replace("\n", LOG_NEWLINE_GLYPH)
    )
    return f"{ts}\t{stream}\t{safe}"


def write_log_line(
    log_file: TextIO,
    message: str,
    *,
    now: Optional[datetime] = None,
    stream: str = "out",
    stamp: bool = False,
) -> None:
    """Write a single timestamped, stream-tagged record to *log_file* and flush.

    ``stream`` tags the origin channel (``out``/``err``). ``stamp=True`` forces
    a fresh worca receive-time timestamp, ignoring any ``now`` argument — used by
    the stderr tee, where each raw CLI line carries no timestamp of its own and
    must be stamped at the instant worca receives it.
    """
    effective_now = None if stamp else now
    log_file.write(format_log_line(message, effective_now, stream=stream) + "\n")
    log_file.flush()


def write_log_block(
    log_file: TextIO, text: str, *, now: Optional[datetime] = None
) -> None:
    """Write a multi-line *text* blob as timestamped records, one per line.

    Used for captured subprocess output (e.g. the preflight script's JSON
    stdout) where the whole block is produced at one instant — every emitted
    line shares the same write-time so they collate correctly in the UI.
    """
    stamp = now or datetime.now(timezone.utc)
    for line in text.splitlines():
        log_file.write(format_log_line(line, stamp) + "\n")
    log_file.flush()
