from __future__ import annotations

import json

import pytest

from worca_bench.config import (
    ProfileError,
    load_profile,
    profile_from_dict,
    valid_grade_modes,
)


def _base(**over):
    data = {
        "name": "p1",
        "benchmark": "swe-bench-verified",
        "selection": {"instance_ids": ["a__b-1"]},
    }
    data.update(over)
    return data


def test_minimal_profile_defaults():
    prof = profile_from_dict(_base())
    assert prof.name == "p1"
    assert prof.worca.ref == "local"
    assert prof.template == "builtin:feature"
    assert prof.reps == 1
    assert prof.grade.mode == "stub"
    assert prof.claude_md_mode == "none"
    assert prof.pr_defer is True
    assert prof.canary is True  # serial canary on by default


def test_canary_flag_parses():
    assert profile_from_dict(_base(canary=False)).canary is False
    assert profile_from_dict(_base(canary=True)).canary is True


def test_timeout_parses():
    # Unset => no limit (None).
    assert profile_from_dict(_base()).timeout is None
    # Positive int => that cap in seconds.
    assert profile_from_dict(_base(timeout=3600)).timeout == 3600
    # 0 / negative / null => no limit.
    assert profile_from_dict(_base(timeout=0)).timeout is None
    assert profile_from_dict(_base(timeout=-5)).timeout is None
    assert profile_from_dict(_base(timeout=None)).timeout is None
    # String-but-numeric coerces; non-numeric => None.
    assert profile_from_dict(_base(timeout="900")).timeout == 900
    assert profile_from_dict(_base(timeout="nope")).timeout is None


def test_engines_off_by_default():
    prof = profile_from_dict(_base())
    assert prof.graphify.enabled is False
    assert prof.code_review_graph.enabled is False
    assert prof.engine_settings() == {}  # nothing seeded when off


def test_graphify_and_crg_parse_and_seed():
    prof = profile_from_dict(
        _base(
            graphify={"enabled": True, "mode": "full"},
            code_review_graph="structural",  # bare-string shorthand enables it
        )
    )
    assert prof.graphify.enabled and prof.graphify.mode == "full"
    assert prof.code_review_graph.enabled
    assert prof.code_review_graph.mode == "structural"
    assert prof.engine_settings() == {
        "graphify": {"enabled": True, "mode": "full"},
        "code_review_graph": {"enabled": True, "mode": "structural"},
    }
    assert prof.graphify.label == "full"
    assert prof.code_review_graph.label == "structural"


def test_unknown_benchmark_rejected():
    with pytest.raises(ProfileError):
        profile_from_dict(_base(benchmark="nope"))


def test_unknown_grade_mode_rejected():
    with pytest.raises(ProfileError):
        profile_from_dict(_base(grade={"mode": "wat"}))


def test_valid_grade_modes_per_benchmark():
    assert valid_grade_modes("swe-bench-verified") == {
        "stub", "sb-cli", "local-docker", "modal"}
    assert valid_grade_modes("commit0") == {"stub", "local-docker", "modal"}


def test_commit0_rejects_sb_cli_grade_mode():
    """sb-cli is SWE-bench-only — a commit0 profile asking for it must fail loud."""
    with pytest.raises(ProfileError, match="not valid for benchmark 'commit0'"):
        profile_from_dict({
            "name": "c0", "benchmark": "commit0",
            "selection": {"instances_file": "x.json"},
            "grade": {"mode": "sb-cli"},
        })


def test_commit0_accepts_modal_and_local_docker():
    for mode in ("modal", "local-docker", "stub"):
        prof = profile_from_dict({
            "name": "c0", "benchmark": "commit0",
            "selection": {"instances_file": "x.json"},
            "grade": {"mode": mode},
        })
        assert prof.grade.mode == mode


def test_selection_required():
    with pytest.raises(ProfileError):
        profile_from_dict({"name": "x", "benchmark": "commit0", "selection": {}})


def test_reps_must_be_positive():
    with pytest.raises(ProfileError):
        profile_from_dict(_base(reps=0))


def test_template_map_glob_resolution():
    prof = profile_from_dict(_base(
        template="builtin:feature",
        template_map={"django__*": "project:django-tuned"},
    ))
    assert prof.template_for("django__django-11099") == "project:django-tuned"
    assert prof.template_for("astropy__astropy-1") == "builtin:feature"


def test_worca_ref_string_form():
    prof = profile_from_dict(_base(worca="master"))
    assert prof.worca.ref == "master"
    assert prof.worca.is_local is False


def test_mock_true_enables_default_mock():
    prof = profile_from_dict(_base(mock=True))
    assert prof.mock is not None
    assert prof.mock.scenario is None


def test_load_profile_from_json(tmp_path):
    p = tmp_path / "prof.json"
    p.write_text(json.dumps(_base(name="jsonprof")), encoding="utf-8")
    prof = load_profile(p)
    assert prof.name == "jsonprof"


def test_load_profile_from_yaml(tmp_path):
    p = tmp_path / "prof.yaml"
    p.write_text(
        "name: y\nbenchmark: commit0\nselection:\n  instances_file: x.json\n",
        encoding="utf-8",
    )
    prof = load_profile(p)
    assert prof.benchmark == "commit0"
    assert prof.selection.instances_file == "x.json"
