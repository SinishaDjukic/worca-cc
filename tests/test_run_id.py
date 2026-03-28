"""Tests for run ID generation — format, uniqueness, and parseability."""

import re
from datetime import datetime

from worca.orchestrator.runner import _generate_run_id

# Expected format: YYYYMMDD-HHMMSS-mmm-xxxx
RUN_ID_PATTERN = re.compile(r"^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(\d{3})-([0-9a-f]{4})$")


def test_run_id_matches_expected_pattern():
    """Run ID must match YYYYMMDD-HHMMSS-mmm-xxxx format."""
    run_id = _generate_run_id("2026-03-23T14:30:52.847000+00:00")
    assert RUN_ID_PATTERN.match(run_id), f"Run ID '{run_id}' does not match expected pattern"


def test_run_id_pattern_with_no_microseconds():
    """Run ID should work when ISO timestamp has no fractional seconds."""
    run_id = _generate_run_id("2026-01-15T09:30:00")
    assert RUN_ID_PATTERN.match(run_id), f"Run ID '{run_id}' does not match expected pattern"
    # Milliseconds should be 000 when no fractional part
    assert run_id.startswith("20260115-093000-000-")


def test_run_id_pattern_with_microseconds():
    """Milliseconds are extracted correctly from microsecond-precision timestamps."""
    run_id = _generate_run_id("2026-03-09T17:15:45.583887+00:00")
    # 583887 microseconds -> 583 milliseconds
    assert run_id.startswith("20260309-171545-583-")


def test_run_id_uniqueness_same_timestamp():
    """Two IDs generated from the same timestamp must differ (random suffix)."""
    ts = "2026-03-23T14:30:52.847000+00:00"
    id1 = _generate_run_id(ts)
    id2 = _generate_run_id(ts)
    assert id1 != id2, f"Expected unique IDs but both were '{id1}'"


def test_run_id_uniqueness_batch():
    """A batch of 10 IDs from the same timestamp should all be unique."""
    ts = "2026-06-01T00:00:00.000000+00:00"
    ids = {_generate_run_id(ts) for _ in range(10)}
    assert len(ids) == 10, f"Expected 10 unique IDs, got {len(ids)}"


def test_run_id_is_parseable():
    """The datetime portion of the run ID can be parsed back to the original datetime."""
    ts = "2026-03-23T14:30:52.847000+00:00"
    run_id = _generate_run_id(ts)

    m = RUN_ID_PATTERN.match(run_id)
    assert m is not None

    year, month, day = int(m.group(1)), int(m.group(2)), int(m.group(3))
    hour, minute, second = int(m.group(4)), int(m.group(5)), int(m.group(6))
    millis = int(m.group(7))

    parsed = datetime(year, month, day, hour, minute, second)
    original = datetime.fromisoformat(ts).replace(tzinfo=None)

    assert parsed.year == original.year
    assert parsed.month == original.month
    assert parsed.day == original.day
    assert parsed.hour == original.hour
    assert parsed.minute == original.minute
    assert parsed.second == original.second
    assert millis == original.microsecond // 1000


def test_run_id_hex_suffix_is_lowercase():
    """The random hex suffix should only contain lowercase hex characters."""
    for _ in range(20):
        run_id = _generate_run_id("2026-01-01T00:00:00")
        suffix = run_id.split("-")[-1]
        assert re.match(r"^[0-9a-f]{4}$", suffix), f"Suffix '{suffix}' is not lowercase hex"


def test_run_id_length():
    """Run ID should be exactly 24 characters: 8-6-3-4 plus 3 dashes."""
    run_id = _generate_run_id("2026-03-23T14:30:52.847000+00:00")
    assert len(run_id) == 24, f"Expected length 24, got {len(run_id)}: '{run_id}'"
