"""Benchmark plugins. Each adapts one benchmark to the shared runner contract."""

from __future__ import annotations

from ..config import Profile
from .base import BenchmarkPlugin


def get_plugin(profile: Profile) -> BenchmarkPlugin:
    """Return the plugin for a profile's benchmark."""
    if profile.benchmark == "swe-bench-verified":
        from .swebench import SwebenchPlugin

        return SwebenchPlugin()
    if profile.benchmark == "commit0":
        from .commit0 import Commit0Plugin

        return Commit0Plugin()
    raise ValueError(f"no plugin for benchmark {profile.benchmark!r}")
