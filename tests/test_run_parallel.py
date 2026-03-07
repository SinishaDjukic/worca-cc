"""Tests for run_parallel.py helper functions."""

import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".claude", "scripts"))

# Import the helper functions directly from the script module
import importlib.util
spec = importlib.util.spec_from_file_location(
    "run_parallel",
    os.path.join(os.path.dirname(__file__), "..", ".claude", "scripts", "run_parallel.py"),
)
run_parallel = importlib.util.module_from_spec(spec)
spec.loader.exec_module(run_parallel)

_slugify = run_parallel._slugify


# --- _slugify ---

def test_slugify_basic():
    assert _slugify("Add user auth") == "add-user-auth"


def test_slugify_special_chars():
    assert _slugify("Fix bug #42!") == "fix-bug-42"


def test_slugify_collapses_dashes():
    assert _slugify("too   many   spaces") == "too-many-spaces"


def test_slugify_strips_leading_trailing():
    assert _slugify("  --hello--  ") == "hello"


def test_slugify_truncates_to_30():
    long_title = "a" * 50
    result = _slugify(long_title)
    assert len(result) <= 30


def test_slugify_only_alphanumeric_and_dash():
    result = _slugify("Hello@World#2024!")
    assert re.match(r'^[a-z0-9\-]+$', result)
