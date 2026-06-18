"""Launcher env assembly — focus on the PR-defer signal.

PR defer must ride the WORCA_DEFER_PR env var, not the settings.json seed:
worca.stages is template-driven, so a settings-only seed is stripped when a
template enables the PR stage. The env var is read directly by the guardian
and composes monotonically, so it holds regardless of the template.
"""

from __future__ import annotations

from pathlib import Path

import worca_bench.launcher as launcher_mod
from worca_bench.config import Profile
from worca_bench.launcher import _as_text, build_launch_env, launch
from worca_bench.venvs import WorcaEnv


def _wenv() -> WorcaEnv:
    return WorcaEnv(ref="local", python="python3")


class _FakeProc:
    returncode = 0
    stdout = ""
    stderr = ""


def test_launch_default_timeout_is_unbounded(tmp_path: Path, monkeypatch):
    # The hardcoded 1800s cap is gone — default timeout is None (no limit).
    captured = {}

    def fake_run(args, **kw):
        captured["timeout"] = kw.get("timeout", "MISSING")
        return _FakeProc()

    monkeypatch.setattr(launcher_mod.subprocess, "run", fake_run)
    profile = Profile(name="p", benchmark="swe-bench-verified")
    launch(profile, _wenv(), tmp_path, prompt="x", template="builtin:feature",
           run_id="r1", run_scratch=tmp_path / "s")
    assert captured["timeout"] is None


def test_launch_forwards_explicit_timeout(tmp_path: Path, monkeypatch):
    captured = {}

    def fake_run(args, **kw):
        captured["timeout"] = kw.get("timeout")
        return _FakeProc()

    monkeypatch.setattr(launcher_mod.subprocess, "run", fake_run)
    profile = Profile(name="p", benchmark="swe-bench-verified")
    launch(profile, _wenv(), tmp_path, prompt="x", template="builtin:feature",
           run_id="r2", run_scratch=tmp_path / "s", timeout=42)
    assert captured["timeout"] == 42


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
