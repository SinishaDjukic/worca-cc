from __future__ import annotations

import json
from pathlib import Path

from conftest import make_git_repo

from worca_bench.config import GradeConfig, profile_from_dict
from worca_bench.plugins import get_plugin
from worca_bench.plugins.base import Instance, stub_grade
from worca_bench.plugins.commit0 import Commit0Plugin
import pytest

from worca_bench.plugins.swebench import SwebenchPlugin, _load_dataset_with_retry


def test_load_dataset_with_retry_recovers(monkeypatch):
    monkeypatch.setattr("time.sleep", lambda *_: None)  # no real backoff
    calls = {"n": 0}

    def flaky(name, split="test"):
        calls["n"] += 1
        if calls["n"] < 3:
            raise TimeoutError("CDN read timed out")
        return f"DS({name},{split})"

    assert _load_dataset_with_retry(flaky, "ds", attempts=4) == "DS(ds,test)"
    assert calls["n"] == 3


def test_load_dataset_with_retry_exhausts(monkeypatch):
    monkeypatch.setattr("time.sleep", lambda *_: None)

    def always_fail(name, split="test"):
        raise TimeoutError("nope")

    with pytest.raises(RuntimeError, match="after 3 attempts"):
        _load_dataset_with_retry(always_fail, "ds", attempts=3)


def test_get_plugin_dispatch():
    sp = get_plugin(profile_from_dict(
        {"name": "p", "benchmark": "swe-bench-verified",
         "selection": {"instance_ids": ["x"]}}))
    assert isinstance(sp, SwebenchPlugin)
    cp = get_plugin(profile_from_dict(
        {"name": "p", "benchmark": "commit0",
         "selection": {"instances_file": "x.json"}}))
    assert isinstance(cp, Commit0Plugin)


def test_swebench_load_from_file_filters_ids(tmp_path: Path):
    f = tmp_path / "inst.json"
    f.write_text(json.dumps([
        {"instance_id": "a__b-1", "problem_statement": "fix a", "repo": "a/b",
         "base_commit": "abc"},
        {"instance_id": "c__d-2", "problem_statement": "fix c", "repo": "c/d",
         "base_commit": "def"},
    ]), encoding="utf-8")
    prof = profile_from_dict({
        "name": "p", "benchmark": "swe-bench-verified",
        "selection": {"instances_file": str(f), "instance_ids": ["a__b-1"]},
    })
    insts = SwebenchPlugin().load_instances(prof)
    assert [i.id for i in insts] == ["a__b-1"]
    assert insts[0].prompt == "fix a"


def test_swebench_materialize_from_local_repo(tmp_path: Path):
    src = tmp_path / "src"
    base = make_git_repo(src, {"main.py": "x = 1\n"})
    dest = tmp_path / "work"
    inst = Instance(id="a__b-1", prompt="p", local_repo=str(src), base_commit=base)
    got_base = SwebenchPlugin().materialize(inst, dest)
    assert got_base == base
    assert (dest / "main.py").exists()


def test_stub_grade_resolves_on_nonempty_diff():
    inst = Instance(id="x", prompt="p")
    assert stub_grade("+new line\n", inst).resolved is True
    assert stub_grade("", inst).resolved is False


def test_stub_grade_respects_expect_override():
    inst = Instance(id="x", prompt="p", extra={"expect_resolved": False})
    r = stub_grade("+lots of changes\n", inst)
    assert r.resolved is False
    assert r.score == 0.0


def test_commit0_prepare_stashes_and_restores_gold_tests(tmp_path: Path):
    repo = tmp_path / "lib"
    make_git_repo(repo, {
        "lib.py": "def f(): pass\n",
        "tests/test_lib.py": "def test_f(): assert f()\n",
    })
    inst = Instance(id="lib", prompt="spec", local_repo=str(repo),
                    extra={"gold_test_paths": ("tests/test_lib.py",)})
    prepared = Commit0Plugin().prepare(inst, repo)
    # gold test hidden during the run
    assert not (repo / "tests" / "test_lib.py").exists()
    assert prepared.gold_test_paths == ("tests/test_lib.py",)
    assert prepared.extra_excludes == ("tests/test_lib.py",)
    # restore brings it back
    prepared.restore()
    assert (repo / "tests" / "test_lib.py").exists()


def test_commit0_grade_stub(tmp_path: Path):
    inst = Instance(id="lib", prompt="spec")
    from worca_bench.plugins.base import Prepared

    r = Commit0Plugin().grade(inst, "+impl\n", tmp_path, tmp_path,
                              GradeConfig(mode="stub"),
                              prepared=Prepared(base_commit="x"))
    assert r.status == "graded"
    assert r.resolved is True
