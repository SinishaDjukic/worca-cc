"""CLI plumbing tests — the per-run reps override (and its guard).

These monkeypatch ``run_profile`` so nothing provisions a venv: we only assert
that ``cmd_run`` threads the override into the resolved profile / runner call.
"""

from __future__ import annotations

import argparse

import worca_bench.cli as cli


class _FakeSummary:
    def __init__(self, profile):
        self.profile = profile.name
        self.worca_ref = "local"
        self.reps_total = profile.reps
        self.results: list = []
        self.reps_error = 0
        self.incompatible_templates: dict = {}

    def as_dict(self):
        return {"profile": self.profile, "reps_total": self.reps_total}


def _write_profile(tmp_path):
    profiles_dir = tmp_path / "profiles"
    profiles_dir.mkdir()
    (profiles_dir / "demo.yaml").write_text(
        "name: demo\n"
        "benchmark: swe-bench-verified\n"
        "selection:\n  instance_ids: [x__y-1]\n"
        "template: builtin:quick-fix\n"
        "grade:\n  mode: stub\n",
        encoding="utf-8",
    )
    return profiles_dir


def _args(tmp_path, profiles_dir, **over):
    base = dict(
        target_dir=str(tmp_path),
        profile="demo",
        profiles_dir=str(profiles_dir),
        dry_run=False,
        no_canary=True,
        max_instances=None,
        max_parallel=None,
        reps=None,
        cache_dir=None,
        keep_work=False,
        swebench_api_key=None,
        modal_token_id=None,
        modal_token_secret=None,
        preflight=None,
        claude_md_mode=None,
        grade_mode=None,
        timeout=None,
    )
    base.update(over)
    return argparse.Namespace(**base)


def test_cmd_run_reps_override_reaches_the_runner(tmp_path, monkeypatch):
    profiles_dir = _write_profile(tmp_path)
    captured = {}

    def fake_run_profile(profile, target, **kw):
        captured["reps"] = profile.reps
        captured["max_instances"] = kw.get("max_instances")
        return _FakeSummary(profile)

    monkeypatch.setattr(cli, "run_profile", fake_run_profile)
    rc = cli.cmd_run(_args(tmp_path, profiles_dir, reps=5, max_instances=2))

    assert rc == 0
    assert captured["reps"] == 5  # overrode the profile default (1)
    assert captured["max_instances"] == 2


def test_cmd_run_without_reps_keeps_profile_default(tmp_path, monkeypatch):
    profiles_dir = _write_profile(tmp_path)
    captured = {}

    def fake_run_profile(profile, target, **kw):
        captured["reps"] = profile.reps
        return _FakeSummary(profile)

    monkeypatch.setattr(cli, "run_profile", fake_run_profile)
    rc = cli.cmd_run(_args(tmp_path, profiles_dir, reps=None))

    assert rc == 0
    assert captured["reps"] == 1  # the profile's own default


def test_cmd_run_rejects_non_positive_reps(tmp_path, monkeypatch):
    profiles_dir = _write_profile(tmp_path)
    monkeypatch.setattr(cli, "run_profile", lambda *a, **k: None)
    rc = cli.cmd_run(_args(tmp_path, profiles_dir, reps=0))
    assert rc == 2


def test_cmd_run_max_parallel_override_reaches_concurrency(tmp_path, monkeypatch):
    profiles_dir = _write_profile(tmp_path)
    captured = {}

    def fake_run_profile(profile, target, **kw):
        captured["workers"] = profile.concurrency.worca
        return _FakeSummary(profile)

    monkeypatch.setattr(cli, "run_profile", fake_run_profile)
    rc = cli.cmd_run(_args(tmp_path, profiles_dir, max_parallel=8))

    assert rc == 0
    assert captured["workers"] == 8  # overrode the profile/default concurrency


def test_cmd_run_without_max_parallel_keeps_profile_default(tmp_path, monkeypatch):
    profiles_dir = _write_profile(tmp_path)
    captured = {}

    def fake_run_profile(profile, target, **kw):
        captured["workers"] = profile.concurrency.worca
        return _FakeSummary(profile)

    monkeypatch.setattr(cli, "run_profile", fake_run_profile)
    rc = cli.cmd_run(_args(tmp_path, profiles_dir, max_parallel=None))

    assert rc == 0
    assert captured["workers"] == 4  # the dataclass default


def test_cmd_run_timeout_override_reaches_profile(tmp_path, monkeypatch):
    profiles_dir = _write_profile(tmp_path)
    captured = {}

    def fake_run_profile(profile, target, **kw):
        captured["timeout"] = profile.timeout
        return _FakeSummary(profile)

    monkeypatch.setattr(cli, "run_profile", fake_run_profile)
    rc = cli.cmd_run(_args(tmp_path, profiles_dir, timeout=3600))
    assert rc == 0
    assert captured["timeout"] == 3600


def test_cmd_run_timeout_zero_means_no_limit(tmp_path, monkeypatch):
    profiles_dir = _write_profile(tmp_path)
    captured = {}

    def fake_run_profile(profile, target, **kw):
        captured["timeout"] = profile.timeout
        return _FakeSummary(profile)

    monkeypatch.setattr(cli, "run_profile", fake_run_profile)
    rc = cli.cmd_run(_args(tmp_path, profiles_dir, timeout=0))
    assert rc == 0
    assert captured["timeout"] is None  # 0 => unbounded


def test_cmd_run_without_timeout_keeps_profile_default(tmp_path, monkeypatch):
    profiles_dir = _write_profile(tmp_path)
    captured = {}

    def fake_run_profile(profile, target, **kw):
        captured["timeout"] = profile.timeout
        return _FakeSummary(profile)

    monkeypatch.setattr(cli, "run_profile", fake_run_profile)
    rc = cli.cmd_run(_args(tmp_path, profiles_dir, timeout=None))
    assert rc == 0
    assert captured["timeout"] is None  # profile default (unset)


def test_cmd_run_records_actions_ledger(tmp_path, monkeypatch):
    import json
    profiles_dir = _write_profile(tmp_path)
    monkeypatch.setattr(
        cli, "run_profile", lambda profile, target, **kw: _FakeSummary(profile)
    )
    rc = cli.cmd_run(_args(tmp_path, profiles_dir))
    assert rc == 0
    recs = [
        json.loads(line)
        for line in (tmp_path / "actions.jsonl").read_text().splitlines()
        if line.strip()
    ]
    assert recs[0]["type"] == "run"
    assert recs[0]["status"] == "running"
    assert recs[0]["profile"] == "demo"
    assert recs[-1]["status"] == "completed"  # CLI wrote its own terminal state


def test_cmd_run_records_failed_on_exception(tmp_path, monkeypatch):
    import json

    def boom(profile, target, **kw):
        raise RuntimeError("kaboom")

    profiles_dir = _write_profile(tmp_path)
    monkeypatch.setattr(cli, "run_profile", boom)
    try:
        cli.cmd_run(_args(tmp_path, profiles_dir))
    except RuntimeError:
        pass
    recs = [
        json.loads(line)
        for line in (tmp_path / "actions.jsonl").read_text().splitlines()
        if line.strip()
    ]
    assert recs[-1]["status"] == "failed"
    assert "kaboom" in (recs[-1].get("error") or "")


def test_cmd_run_rejects_non_positive_max_parallel(tmp_path, monkeypatch):
    profiles_dir = _write_profile(tmp_path)
    monkeypatch.setattr(cli, "run_profile", lambda *a, **k: None)
    rc = cli.cmd_run(_args(tmp_path, profiles_dir, max_parallel=0))
    assert rc == 2


def test_cmd_run_preflight_override(tmp_path, monkeypatch):
    profiles_dir = _write_profile(tmp_path)
    captured = {}

    def fake_run_profile(profile, target, **kw):
        captured["skip_preflight"] = profile.skip_preflight
        return _FakeSummary(profile)

    monkeypatch.setattr(cli, "run_profile", fake_run_profile)
    # --preflight on => run preflight => skip_preflight False.
    cli.cmd_run(_args(tmp_path, profiles_dir, preflight="on"))
    assert captured["skip_preflight"] is False
    # --preflight off => skip it.
    cli.cmd_run(_args(tmp_path, profiles_dir, preflight="off"))
    assert captured["skip_preflight"] is True
    # Absent => profile default (True).
    cli.cmd_run(_args(tmp_path, profiles_dir, preflight=None))
    assert captured["skip_preflight"] is True


def test_cmd_run_claude_md_mode_override(tmp_path, monkeypatch):
    profiles_dir = _write_profile(tmp_path)
    captured = {}

    def fake_run_profile(profile, target, **kw):
        captured["mode"] = profile.claude_md_mode
        return _FakeSummary(profile)

    monkeypatch.setattr(cli, "run_profile", fake_run_profile)
    cli.cmd_run(_args(tmp_path, profiles_dir, claude_md_mode="project"))
    assert captured["mode"] == "project"
    cli.cmd_run(_args(tmp_path, profiles_dir, claude_md_mode=None))
    assert captured["mode"] == "none"  # profile default


def test_cmd_run_grade_mode_override(tmp_path, monkeypatch):
    profiles_dir = _write_profile(tmp_path)
    captured = {}

    def fake_run_profile(profile, target, **kw):
        captured["mode"] = profile.grade.mode
        return _FakeSummary(profile)

    monkeypatch.setattr(cli, "run_profile", fake_run_profile)
    cli.cmd_run(_args(tmp_path, profiles_dir, grade_mode="modal"))
    assert captured["mode"] == "modal"
    # Absent => profile default (stub, from _write_profile).
    cli.cmd_run(_args(tmp_path, profiles_dir, grade_mode=None))
    assert captured["mode"] == "stub"


def test_cmd_run_grade_mode_rejected_for_benchmark(tmp_path, monkeypatch):
    """sb-cli is SWE-bench-only — overriding a commit0 profile to it fails (rc=2)
    before the runner is ever called."""
    profiles_dir = tmp_path / "profiles"
    profiles_dir.mkdir()
    (profiles_dir / "c0.yaml").write_text(
        "name: c0\n"
        "benchmark: commit0\n"
        "selection:\n  instances_file: x.json\n"
        "grade:\n  mode: stub\n",
        encoding="utf-8",
    )
    called = {"n": 0}

    def fake_run_profile(profile, target, **kw):
        called["n"] += 1
        return _FakeSummary(profile)

    monkeypatch.setattr(cli, "run_profile", fake_run_profile)
    rc = cli.cmd_run(_args(tmp_path, profiles_dir, profile="c0", grade_mode="sb-cli"))
    assert rc == 2
    assert called["n"] == 0  # never reached the runner


def test_cmd_run_threads_cache_dir(tmp_path, monkeypatch):
    profiles_dir = _write_profile(tmp_path)
    cache = tmp_path / "cache"
    cache.mkdir()
    captured = {}

    def fake_run_profile(profile, target, **kw):
        captured["cache_dir"] = kw.get("cache_dir")
        return _FakeSummary(profile)

    monkeypatch.setattr(cli, "run_profile", fake_run_profile)
    cli.cmd_run(_args(tmp_path, profiles_dir, cache_dir=str(cache)))
    assert str(captured["cache_dir"]) == str(cache)


def test_cmd_run_secret_flags_thread_into_secret_env(tmp_path, monkeypatch):
    profiles_dir = _write_profile(tmp_path)
    # Clear ambient grader creds so the flag value is unambiguous.
    for k in ("SWEBENCH_API_KEY", "MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET"):
        monkeypatch.delenv(k, raising=False)
    captured = {}

    def fake_run_profile(profile, target, **kw):
        captured["secret_env"] = kw.get("secret_env")
        return _FakeSummary(profile)

    monkeypatch.setattr(cli, "run_profile", fake_run_profile)
    rc = cli.cmd_run(_args(tmp_path, profiles_dir,
                           swebench_api_key="swb_flag", modal_token_id="mid_flag"))
    assert rc == 0
    assert captured["secret_env"]["SWEBENCH_API_KEY"] == "swb_flag"
    assert captured["secret_env"]["MODAL_TOKEN_ID"] == "mid_flag"
    assert "MODAL_TOKEN_SECRET" not in captured["secret_env"]


def test_cmd_run_secret_flag_overrides_environment(tmp_path, monkeypatch):
    profiles_dir = _write_profile(tmp_path)
    monkeypatch.setenv("SWEBENCH_API_KEY", "from_env")
    captured = {}

    def fake_run_profile(profile, target, **kw):
        captured["secret_env"] = kw.get("secret_env")
        return _FakeSummary(profile)

    monkeypatch.setattr(cli, "run_profile", fake_run_profile)
    cli.cmd_run(_args(tmp_path, profiles_dir, swebench_api_key="from_flag"))
    assert captured["secret_env"]["SWEBENCH_API_KEY"] == "from_flag"


def test_cmd_run_cache_dir_falls_back_to_env(tmp_path, monkeypatch):
    profiles_dir = _write_profile(tmp_path)
    cache = tmp_path / "envcache"
    cache.mkdir()
    monkeypatch.setenv("WORCA_BENCH_CACHE", str(cache))
    captured = {}

    def fake_run_profile(profile, target, **kw):
        captured["cache_dir"] = kw.get("cache_dir")
        return _FakeSummary(profile)

    monkeypatch.setattr(cli, "run_profile", fake_run_profile)
    cli.cmd_run(_args(tmp_path, profiles_dir, cache_dir=None))
    assert str(captured["cache_dir"]) == str(cache)
