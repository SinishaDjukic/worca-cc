from __future__ import annotations

from pathlib import Path

from worca_bench.config import WorcaRef
from worca_bench.venvs import _pip_target, _ref_hash, resolve_worca_env


def test_ref_hash_stable_and_distinct():
    a = _ref_hash(WorcaRef(ref="master"))
    b = _ref_hash(WorcaRef(ref="master"))
    c = _ref_hash(WorcaRef(ref="v0.58.0"))
    assert a == b
    assert a != c


def test_pip_target_version_pin():
    assert _pip_target(WorcaRef(ref="0.58.0")) == "worca-cc==0.58.0"


def test_pip_target_git_ref():
    target = _pip_target(WorcaRef(ref="my-branch"))
    assert target.startswith("git+https://github.com/SinishaDjukic/worca-cc@")
    assert target.endswith("my-branch")


def test_pip_target_path_source():
    target = _pip_target(WorcaRef(ref="x", source="path:/tmp/worca"))
    assert target == "/tmp/worca"


def test_resolve_local_without_build(tmp_path: Path):
    # build=False must never create a venv or hit the network.
    env = resolve_worca_env(WorcaRef(ref="local"), tmp_path, build=False)
    assert env.ref == "local"
    assert "PYTHONPATH" in env.env_overrides
    assert not (tmp_path / "cache" / "venvs").exists()


def test_resolve_non_local_no_build_describes(tmp_path: Path):
    env = resolve_worca_env(WorcaRef(ref="master"), tmp_path, build=False)
    assert env.ref == "master"
    # no venv built
    assert not (tmp_path / "cache" / "venvs" / "master").exists()
