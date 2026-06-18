from __future__ import annotations

import json
from pathlib import Path

from conftest import make_git_repo

from worca_bench.config import GradeConfig, profile_from_dict
from worca_bench.plugins import get_plugin
from worca_bench.plugins.base import (
    GradeResult,
    Instance,
    Prepared,
    grade_env,
    stub_grade,
)
from worca_bench.plugins.commit0 import Commit0Plugin
import pytest

from worca_bench.plugins.swebench import (
    SwebenchPlugin,
    _classify_sb_report,
    _load_dataset_with_retry,
    _resolved_from_instance_report,
    harness_report_path,
)


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


def _write_instance_report(path: Path, instance_id: str, *, resolved: bool):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({instance_id: {"resolved": resolved, "patch_exists": True}}),
        encoding="utf-8",
    )


def test_resolved_from_instance_report_reads_resolved(tmp_path: Path):
    rep = tmp_path / "report.json"
    _write_instance_report(rep, "astropy__astropy-12907", resolved=True)
    assert _resolved_from_instance_report(rep, "astropy__astropy-12907") is True

    _write_instance_report(rep, "astropy__astropy-13033", resolved=False)
    assert _resolved_from_instance_report(rep, "astropy__astropy-13033") is False


def test_resolved_from_instance_report_handles_missing_and_corrupt(tmp_path: Path):
    assert _resolved_from_instance_report(None, "x") is None
    assert _resolved_from_instance_report(tmp_path / "nope.json", "x") is None
    corrupt = tmp_path / "bad.json"
    corrupt.write_text("{not json", encoding="utf-8")
    assert _resolved_from_instance_report(corrupt, "x") is None
    # Present file but the instance isn't in it → no result.
    other = tmp_path / "other.json"
    _write_instance_report(other, "some__other-1", resolved=True)
    assert _resolved_from_instance_report(other, "astropy__astropy-1") is None


def test_harness_report_path_layout(monkeypatch, tmp_path: Path):
    monkeypatch.chdir(tmp_path)
    p = harness_report_path("wb-astropy__astropy-12907", "astropy__astropy-12907")
    assert p == (
        tmp_path / "logs" / "run_evaluation" / "wb-astropy__astropy-12907"
        / "worca-bench" / "astropy__astropy-12907" / "report.json"
    )


def _write_sb_report(path: Path, **buckets):
    """Write an sb-cli-shaped summary report with the given id buckets."""
    data = {
        "resolved_ids": [], "unresolved_ids": [], "failed_ids": [],
        "error_ids": [], "pending_ids": [], "completed_ids": [],
    }
    data.update(buckets)
    path.write_text(json.dumps(data), encoding="utf-8")


def test_classify_sb_report_buckets(tmp_path: Path):
    iid = "astropy__astropy-12907"
    rep = tmp_path / "r.json"

    _write_sb_report(rep, resolved_ids=[iid])
    v = _classify_sb_report(rep, iid)
    assert v.status == "graded" and v.resolved is True and v.score == 1.0

    _write_sb_report(rep, unresolved_ids=[iid])
    v = _classify_sb_report(rep, iid)
    assert v.status == "graded" and v.resolved is False and v.score == 0.0

    # A remote failure is an ERROR, not a graded-as-unresolved verdict.
    _write_sb_report(rep, failed_ids=[iid])
    v = _classify_sb_report(rep, iid)
    assert v.status == "error" and v.resolved is None
    assert "failed to evaluate" in v.detail

    _write_sb_report(rep, error_ids=[iid])
    assert _classify_sb_report(rep, iid).status == "error"

    _write_sb_report(rep, pending_ids=[iid])
    assert _classify_sb_report(rep, iid).status == "error"


def test_classify_sb_report_absent_and_missing(tmp_path: Path):
    assert _classify_sb_report(None, "x") is None
    assert _classify_sb_report(tmp_path / "nope.json", "x") is None
    rep = tmp_path / "r.json"
    # Report exists but the instance is in no bucket → no result.
    _write_sb_report(rep, resolved_ids=["some__other-1"])
    assert _classify_sb_report(rep, "astropy__astropy-12907") is None
    # Corrupt report → no result.
    rep.write_text("{not json", encoding="utf-8")
    assert _classify_sb_report(rep, "x") is None


def test_grade_env_merges_secrets_over_os_environ(monkeypatch):
    monkeypatch.setenv("PATH", "/usr/bin")
    env = grade_env({"SWEBENCH_API_KEY": "swb_test"})
    assert env["SWEBENCH_API_KEY"] == "swb_test"
    assert env["PATH"] == "/usr/bin"  # ambient env preserved
    assert grade_env(None).get("SWEBENCH_API_KEY") is None


class _Proc:
    def __init__(self, returncode=0, stdout="", stderr=""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


def test_sb_cli_reads_report_and_threads_secret(monkeypatch, tmp_path: Path):
    """sb-cli grading: report is authoritative even when the CLI exits non-zero,
    and the SWEBENCH_API_KEY secret reaches the subprocess env."""
    iid = "astropy__astropy-12907"
    captured_envs = []

    def fake_run(cmd, *a, **kw):
        captured_envs.append(kw.get("env") or {})
        if cmd[:2] == ["sb-cli", "get-report"]:
            out = Path(cmd[cmd.index("-o") + 1])
            out.mkdir(parents=True, exist_ok=True)
            # sb-cli summary report format: disjoint id buckets.
            (out / "report.json").write_text(
                json.dumps({"resolved_ids": [iid], "unresolved_ids": [],
                            "failed_ids": []}), encoding="utf-8")
        # Non-zero exit must NOT discard the written report.
        return _Proc(returncode=1, stderr="benign warning")

    monkeypatch.setattr("worca_bench.plugins.swebench.subprocess.run", fake_run)
    plugin = SwebenchPlugin()
    grade = GradeConfig(mode="sb-cli", options={})
    res = plugin.grade(Instance(id=iid, prompt=""), "+patch\n", tmp_path, tmp_path,
                       grade, prepared=Prepared(base_commit=""),
                       secret_env={"SWEBENCH_API_KEY": "swb_test"})
    assert res.status == "graded"
    assert res.resolved is True
    assert res.score == 1.0
    assert all(e.get("SWEBENCH_API_KEY") == "swb_test" for e in captured_envs)


def test_sb_cli_errors_when_no_report(monkeypatch, tmp_path: Path):
    def fake_run(cmd, *a, **kw):
        return _Proc(returncode=2, stderr="auth failed")

    monkeypatch.setattr("worca_bench.plugins.swebench.subprocess.run", fake_run)
    plugin = SwebenchPlugin()
    grade = GradeConfig(mode="sb-cli", options={})
    res = plugin.grade(Instance(id="x__y-1", prompt=""), "+p\n", tmp_path, tmp_path,
                       grade, prepared=Prepared(base_commit=""))
    assert res.status == "error"
    assert "auth failed" in res.detail


def test_grade_unsupported_mode_errors(tmp_path: Path):
    plugin = SwebenchPlugin()
    grade = GradeConfig(mode="bogus", options={})
    res = plugin.grade(Instance(id="x__y-1", prompt=""), "+p\n", tmp_path, tmp_path,
                       grade, prepared=Prepared(base_commit=""))
    assert res.status == "error"
    assert "unsupported grade mode bogus" in res.detail


def test_grade_modal_requires_tokens(monkeypatch, tmp_path: Path):
    """Modal grading fails fast (no subprocess) when its tokens are absent."""
    for k in ("MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET"):
        monkeypatch.delenv(k, raising=False)
    called = {"n": 0}

    def fake_run(*a, **kw):
        called["n"] += 1
        return _Proc(returncode=0)

    monkeypatch.setattr("worca_bench.plugins.swebench.subprocess.run", fake_run)
    plugin = SwebenchPlugin()
    grade = GradeConfig(mode="modal", options={})
    res = plugin.grade(Instance(id="x__y-1", prompt=""), "+p\n", tmp_path, tmp_path,
                       grade, prepared=Prepared(base_commit=""))
    assert res.status == "error"
    assert "MODAL_TOKEN_ID" in res.detail and "MODAL_TOKEN_SECRET" in res.detail
    assert called["n"] == 0  # never reached the harness


def test_grade_modal_dispatches_to_harness_with_tokens(monkeypatch, tmp_path: Path):
    """With tokens present, modal routes through the harness grader (registry),
    passes --modal true, threads the tokens into the env, and reads the report."""
    monkeypatch.chdir(tmp_path)
    iid = "astropy__astropy-12907"
    captured = {}

    def fake_run(cmd, *a, **kw):
        captured["cmd"] = cmd
        captured["env"] = kw.get("env") or {}
        rep = harness_report_path(f"wb-{iid}", iid)
        _write_instance_report(rep, iid, resolved=True)
        return _Proc(returncode=0)

    monkeypatch.setattr("worca_bench.plugins.swebench.subprocess.run", fake_run)
    plugin = SwebenchPlugin()
    grade = GradeConfig(mode="modal", options={})
    res = plugin.grade(Instance(id=iid, prompt=""), "+patch\n", tmp_path, tmp_path,
                       grade, prepared=Prepared(base_commit=""),
                       secret_env={"MODAL_TOKEN_ID": "mid", "MODAL_TOKEN_SECRET": "msec"})
    assert res.status == "graded" and res.resolved is True
    assert "--modal" in captured["cmd"]
    assert captured["cmd"][captured["cmd"].index("--modal") + 1] == "true"
    assert captured["env"]["MODAL_TOKEN_ID"] == "mid"


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
    # gold tests + the Commit0 spec artifacts are all excluded from the graded diff
    assert prepared.extra_excludes == (
        "tests/test_lib.py", "spec.pdf", "spec.pdf.bz2",
    )
    # restore brings it back
    prepared.restore()
    assert (repo / "tests" / "test_lib.py").exists()


def test_commit0_prepare_excludes_spec_artifacts_without_gold(tmp_path: Path):
    # Even with no gold tests, the spec.pdf / spec.pdf.bz2 that ship in every Commit0
    # repo root must be excluded — they materialize in the tree and otherwise leak into
    # the prediction patch as a binary diff that breaks `git apply` at grade time.
    repo = tmp_path / "lib"
    make_git_repo(repo, {"lib.py": "def f(): pass\n"})
    inst = Instance(id="lib", prompt="spec", local_repo=str(repo), extra={})
    prepared = Commit0Plugin().prepare(inst, repo)
    assert prepared.extra_excludes == ("spec.pdf", "spec.pdf.bz2")


def test_commit0_grade_stub(tmp_path: Path):
    inst = Instance(id="lib", prompt="spec")
    from worca_bench.plugins.base import Prepared

    r = Commit0Plugin().grade(inst, "+impl\n", tmp_path, tmp_path,
                              GradeConfig(mode="stub"),
                              prepared=Prepared(base_commit="x"))
    assert r.status == "graded"
    assert r.resolved is True


def test_commit0_grade_threads_timeout_from_options(tmp_path: Path, monkeypatch):
    """grade.options.timeout flows to _grade_on_pristine (→ `commit0 test --timeout`,
    which is the Modal sandbox timeout). Raising it unblocks slow suites that
    otherwise SandboxTimeout."""
    captured = {}

    def fake_pristine(self, instance, diff, target_dir, prepared, secret_env,
                      backend, grade_timeout=None, rebuild=False):
        captured["timeout"] = grade_timeout
        captured["backend"] = backend
        captured["rebuild"] = rebuild
        return GradeResult(status="graded", resolved=True, score=1.0)

    monkeypatch.setattr(Commit0Plugin, "_grade_on_pristine", fake_pristine)
    inst = Instance(id="lib", prompt="",
                    extra={"commit0": {"base_dir": "b", "config_file": "c"}})
    tokens = {"MODAL_TOKEN_ID": "a", "MODAL_TOKEN_SECRET": "b"}

    Commit0Plugin().grade(
        inst, "+d\n", tmp_path, tmp_path,
        GradeConfig(mode="modal", options={"timeout": 5400, "rebuild": True}),
        prepared=Prepared(base_commit=""), secret_env=tokens,
    )
    assert captured["timeout"] == 5400
    assert captured["backend"] == "modal"
    assert captured["rebuild"] is True

    # No timeout/rebuild in options => defaults (None / False).
    Commit0Plugin().grade(
        inst, "+d\n", tmp_path, tmp_path,
        GradeConfig(mode="modal", options={}),
        prepared=Prepared(base_commit=""), secret_env=tokens,
    )
    assert captured["timeout"] is None
    assert captured["rebuild"] is False


def test_commit0_load_instances_sets_lib(tmp_path: Path):
    """The library name `commit0 test` needs is carried in extra['lib'] — defaulting
    to the instance id but honoring an explicit per-record override."""
    f = tmp_path / "instances.json"
    f.write_text(json.dumps([
        {"instance_id": "tinydb", "spec": "build it", "local_repo": "/x",
         "gold_test_paths": ["tests/"]},
        {"instance_id": "foo__1", "lib": "foolib", "prompt": "p"},
    ]), encoding="utf-8")
    profile = profile_from_dict(
        {"name": "p", "benchmark": "commit0", "selection": {"instances_file": str(f)}})
    insts = Commit0Plugin().load_instances(profile)
    assert insts[0].extra["lib"] == "tinydb"          # defaults to instance id
    assert insts[0].extra["gold_test_paths"] == ("tests/",)
    assert insts[1].extra["lib"] == "foolib"          # explicit override wins


def test_commit0_grade_unsupported_mode_errors(tmp_path: Path):
    """sb-cli is SWE-bench-only; commit0 must reject it with an actionable error."""
    r = Commit0Plugin().grade(Instance(id="tinydb", prompt=""), "+x\n", tmp_path,
                              tmp_path, GradeConfig(mode="sb-cli"),
                              prepared=Prepared(base_commit=""))
    assert r.status == "error"
    assert "unsupported grade mode" in r.detail


def test_commit0_grade_modal_without_tokens_errors(tmp_path: Path):
    """Modal grading fails fast (before any shell-out) when tokens are absent."""
    r = Commit0Plugin().grade(Instance(id="tinydb", prompt=""), "+x\n", tmp_path,
                              tmp_path, GradeConfig(mode="modal"),
                              prepared=Prepared(base_commit=""), secret_env={})
    assert r.status == "error"
    assert "MODAL_TOKEN_ID" in r.detail and "MODAL_TOKEN_SECRET" in r.detail


def test_commit0_grade_modal_with_tokens_dispatches_backend(monkeypatch, tmp_path: Path):
    """With tokens present, modal dispatches to the pristine grader with backend=modal."""
    captured = {}
    plugin = Commit0Plugin()

    def fake_pristine(instance, diff, target_dir, prepared, secret_env, backend,
                      grade_timeout=None, rebuild=False):
        captured["backend"] = backend
        return GradeResult(status="graded", resolved=True, score=1.0)

    monkeypatch.setattr(plugin, "_grade_on_pristine", fake_pristine)
    r = plugin.grade(Instance(id="tinydb", prompt=""), "+x\n", tmp_path, tmp_path,
                     GradeConfig(mode="modal"), prepared=Prepared(base_commit=""),
                     secret_env={"MODAL_TOKEN_ID": "i", "MODAL_TOKEN_SECRET": "s"})
    assert captured["backend"] == "modal"
    assert r.status == "graded" and r.resolved is True


def test_commit0_grade_local_docker_dispatches_backend(monkeypatch, tmp_path: Path):
    """local-docker dispatches to the pristine grader with backend=local (no token check)."""
    captured = {}
    plugin = Commit0Plugin()

    def fake_pristine(instance, diff, target_dir, prepared, secret_env, backend,
                      grade_timeout=None, rebuild=False):
        captured["backend"] = backend
        return GradeResult(status="graded", resolved=False, score=0.0)

    monkeypatch.setattr(plugin, "_grade_on_pristine", fake_pristine)
    r = plugin.grade(Instance(id="tinydb", prompt=""), "+x\n", tmp_path, tmp_path,
                     GradeConfig(mode="local-docker"), prepared=Prepared(base_commit=""))
    assert captured["backend"] == "local"
    assert r.status == "graded"
