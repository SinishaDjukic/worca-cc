"""Launcher env assembly — focus on the PR-defer signal.

PR defer must ride the WORCA_DEFER_PR env var, not the settings.json seed:
worca.stages is template-driven, so a settings-only seed is stripped when a
template enables the PR stage. The env var is read directly by the guardian
and composes monotonically, so it holds regardless of the template.
"""

from __future__ import annotations

from pathlib import Path

from worca_bench.config import Profile
from worca_bench.launcher import _as_text, build_launch_env
from worca_bench.venvs import WorcaEnv


def _wenv() -> WorcaEnv:
    return WorcaEnv(ref="local", python="python3")


def test_pr_defer_sets_env_signal(tmp_path: Path):
    profile = Profile(name="p", benchmark="swe-bench-verified", pr_defer=True)
    env = build_launch_env(profile, _wenv(), run_scratch=tmp_path / "s")
    assert env["WORCA_DEFER_PR"] == "1"


def test_pr_defer_disabled_omits_env_signal(tmp_path: Path):
    profile = Profile(name="p", benchmark="swe-bench-verified", pr_defer=False)
    env = build_launch_env(profile, _wenv(), run_scratch=tmp_path / "s")
    assert "WORCA_DEFER_PR" not in env


def test_as_text_coerces_bytes_str_none():
    # The timeout path can yield bytes even under text=True — must not crash.
    assert _as_text(b"hello") == "hello"
    assert _as_text("hello") == "hello"
    assert _as_text(None) == ""
    assert _as_text(b"\xff\xfe") == "��"  # invalid bytes -> replacement
