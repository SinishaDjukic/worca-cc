"""Tests for the shared log-line formatting util (worca.utils.log_lines).

This is the single source of truth for the ISO-8601 + TAB prefix that every
persisted pipeline log line carries; the worca-ui reader's parseLogLine sniff
is its counterpart.
"""

import io
import re
from datetime import datetime, timezone

from worca.utils.log_lines import (
    LOG_NEWLINE_GLYPH,
    format_log_line,
    write_log_block,
    write_log_line,
)

_FIXED = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)
_TS_PREFIX_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})\t"
)


# ---------------------------------------------------------------------------
# format_log_line
# ---------------------------------------------------------------------------


def test_format_log_line_prefixes_iso_timestamp_and_tab():
    assert (
        format_log_line("[tool:Read] foo.py", _FIXED)
        == "2026-06-14T12:00:00.000+00:00\t[tool:Read] foo.py"
    )


def test_format_log_line_has_no_trailing_newline():
    assert not format_log_line("x", _FIXED).endswith("\n")


def test_format_log_line_collapses_embedded_newlines():
    # One logical record must stay one physical line so the reader's
    # "first field is the timestamp" invariant holds for every line.
    out = format_log_line("line one\nline two\r\nline three", _FIXED)
    assert "\n" not in out
    assert f"line one{LOG_NEWLINE_GLYPH}line two{LOG_NEWLINE_GLYPH}line three" in out


def test_format_log_line_first_field_round_trips():
    ts_field = format_log_line("anything", _FIXED).split("\t", 1)[0]
    assert datetime.fromisoformat(ts_field) == _FIXED


def test_format_log_line_preserves_tabs_in_message():
    out = format_log_line("a\tb\tc", _FIXED)
    # Only the prefix TAB is added; message tabs survive (reader splits on first).
    assert out == "2026-06-14T12:00:00.000+00:00\ta\tb\tc"


# ---------------------------------------------------------------------------
# write_log_line
# ---------------------------------------------------------------------------


def test_write_log_line_writes_one_terminated_record():
    buf = io.StringIO()
    write_log_line(buf, "[done] ok", now=_FIXED)
    assert buf.getvalue() == "2026-06-14T12:00:00.000+00:00\t[done] ok\n"


# ---------------------------------------------------------------------------
# write_log_block
# ---------------------------------------------------------------------------


def test_write_log_block_timestamps_each_line():
    buf = io.StringIO()
    write_log_block(buf, '{\n  "summary": "ok"\n}', now=_FIXED)
    lines = [ln for ln in buf.getvalue().split("\n") if ln]
    assert len(lines) == 3
    for ln in lines:
        assert _TS_PREFIX_RE.match(ln)
    # Content survives after the prefix.
    assert lines[0].endswith("\t{")
    assert lines[1].endswith('\t  "summary": "ok"')
    assert lines[2].endswith("\t}")


def test_write_log_block_shares_one_timestamp_across_lines():
    buf = io.StringIO()
    write_log_block(buf, "a\nb\nc", now=_FIXED)
    stamps = {ln.split("\t", 1)[0] for ln in buf.getvalue().split("\n") if ln}
    assert stamps == {"2026-06-14T12:00:00.000+00:00"}


def test_write_log_block_empty_text_writes_nothing():
    buf = io.StringIO()
    write_log_block(buf, "", now=_FIXED)
    assert buf.getvalue() == ""
