"""Runner-level cache wiring: HF dataset cache redirect."""

from __future__ import annotations

import os
import types

import worca_bench.runner as R
from worca_bench.config import GradeConfig, Profile, Selection
from worca_bench.plugins.base import Instance
from worca_bench.runner import _apply_cache_env

_CACHE_ENV = ("HF_HOME", "HF_DATASETS_CACHE", "WORCA_BENCH_CACHE")


def test_run_profile_skips_ungradeable_before_building(tmp_path, monkeypatch):
    """The grade preflight skips un-gradeable instances *without* building them
    (no venv provision, no _run_one_rep) — so no tokens are spent."""
    insts = [Instance(id="a", prompt=""), Instance(id="b", prompt="")]

    class FakePlugin:
        def load_instances(self, profile):
            return insts

        def grade_preflight(self, inst, grade, *, secret_env=None):
            return False, f"{inst.id} image not published"

        def materialize(self, *a, **k):  # would be the build path
            raise AssertionError("must not build an un-gradeable instance")

    monkeypatch.setattr(R, "get_plugin", lambda p: FakePlugin())
    monkeypatch.setattr(
        R, "resolve_worca_env",
        lambda *a, **k: types.SimpleNamespace(
            describe=lambda: "local", resolved_sha="sha", version="0.0",
        ),
    )
    monkeypatch.setattr(R, "load_overlay", lambda sha: {})

    profile = Profile(
        name="p", benchmark="commit0",
        selection=Selection(instance_ids=["a", "b"]),
        grade=GradeConfig(mode="modal"),
    )
    summary = R.run_profile(profile, tmp_path, canary_first=False, secret_env={})

    assert summary.reps_skipped == 2
    assert summary.reps_run == 0
    assert set(summary.ungradeable) == {"a", "b"}
    assert "not published" in summary.ungradeable["a"]


def test_run_profile_preflight_opt_out(tmp_path, monkeypatch):
    """`grade.options.preflight: false` disables the preflight (no skips from it)."""
    calls = {"preflight": 0}

    class FakePlugin:
        def load_instances(self, profile):
            return [Instance(id="a", prompt="")]

        def grade_preflight(self, inst, grade, *, secret_env=None):
            calls["preflight"] += 1
            return False, "would skip"

        def materialize(self, *a, **k):
            raise RuntimeError("stop before build")

    monkeypatch.setattr(R, "get_plugin", lambda p: FakePlugin())
    monkeypatch.setattr(
        R, "resolve_worca_env",
        lambda *a, **k: types.SimpleNamespace(
            describe=lambda: "local", resolved_sha="sha", version="0.0",
        ),
    )
    monkeypatch.setattr(R, "load_overlay", lambda sha: {})

    profile = Profile(
        name="p", benchmark="commit0",
        selection=Selection(instance_ids=["a"]),
        grade=GradeConfig(mode="modal", options={"preflight": False}),
    )
    # Preflight disabled => grade_preflight never consulted; the instance proceeds
    # to build (our fake raises, proving we got past the skip).
    try:
        R.run_profile(profile, tmp_path, canary_first=False, secret_env={})
    except Exception:
        pass
    assert calls["preflight"] == 0


def test_apply_cache_env_redirects_hf_and_creates_dir(tmp_path, monkeypatch):
    for k in _CACHE_ENV:
        monkeypatch.delenv(k, raising=False)
    cache = tmp_path / "cache"
    try:
        _apply_cache_env(cache)
        assert os.environ["HF_DATASETS_CACHE"] == str(cache / "hf" / "datasets")
        assert os.environ["HF_HOME"] == str(cache / "hf")
        assert os.environ["WORCA_BENCH_CACHE"] == str(cache)
        assert (cache / "hf").is_dir()  # created eagerly
    finally:
        for k in _CACHE_ENV:
            os.environ.pop(k, None)
