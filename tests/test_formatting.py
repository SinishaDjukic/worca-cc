"""Tests for worca.utils.formatting - Human-readable formatting utilities."""

import pytest

from worca.utils.formatting import format_bytes


def test_format_bytes_zero():
    assert format_bytes(0) == "0 B"


def test_format_bytes_bytes():
    assert format_bytes(512) == "512 B"


def test_format_bytes_kilobytes():
    assert format_bytes(1024) == "1.0 KB"


def test_format_bytes_kilobytes_fractional():
    assert format_bytes(1536) == "1.5 KB"


def test_format_bytes_megabytes():
    assert format_bytes(3_355_443) == "3.2 MB"


def test_format_bytes_gigabytes():
    assert format_bytes(1_073_741_824) == "1.0 GB"


def test_format_bytes_terabytes():
    assert format_bytes(1_099_511_627_776) == "1.0 TB"


def test_format_bytes_negative_raises():
    with pytest.raises(ValueError):
        format_bytes(-1)
