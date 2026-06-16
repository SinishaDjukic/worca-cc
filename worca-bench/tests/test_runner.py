"""Runner-level cache wiring: HF dataset cache redirect."""

from __future__ import annotations

import os

from worca_bench.runner import _apply_cache_env

_CACHE_ENV = ("HF_HOME", "HF_DATASETS_CACHE", "WORCA_BENCH_CACHE")


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
