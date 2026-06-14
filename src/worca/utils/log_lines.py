"""Shared formatting for persisted pipeline log lines.

Every line written to a stage or orchestrator log file is prefixed with an
ISO-8601 UTC write-time and a TAB:

    2026-06-14T12:34:56.789+00:00\t[tool:Read] foo.py

The worca-ui reader (``worca-ui/server/log-tailer.js`` → ``parseLogLine``)
sniffs this prefix and renders the timestamp in each viewer's local timezone.
Lines without the prefix are treated as legacy (pre-timestamp) records and
rendered with a ``--:--:--`` placeholder.

Centralising the format here keeps every producer byte-for-byte consistent so
the single reader-side parser stays valid:

  - agent stage logs   — ``claude_cli.process_stream``
  - orchestrator log    — ``orchestrator.runner._log``
  - preflight stdout    — ``orchestrator.runner.run_preflight``
"""

from datetime import datetime, timezone
from typing import Optional, TextIO

# Embedded newlines are collapsed to this glyph so one logical record is always
# exactly one physical line — keeping the reader's "first field is the
# timestamp" invariant sound for every line it sees.
LOG_NEWLINE_GLYPH = "⏎ "


def format_log_line(message: str, now: Optional[datetime] = None) -> str:
    """Return *message* as one timestamped log record (no trailing newline).

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
    return f"{ts}\t{safe}"


def write_log_line(
    log_file: TextIO, message: str, *, now: Optional[datetime] = None
) -> None:
    """Write a single timestamped record to *log_file* and flush."""
    log_file.write(format_log_line(message, now) + "\n")
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
