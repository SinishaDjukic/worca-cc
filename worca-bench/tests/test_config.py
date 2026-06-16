from __future__ import annotations

import json

import pytest

from worca_bench.config import (
    ProfileError,
    load_profile,
    profile_from_dict,
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


def test_unknown_benchmark_rejected():
    with pytest.raises(ProfileError):
        profile_from_dict(_base(benchmark="nope"))


def test_unknown_grade_mode_rejected():
    with pytest.raises(ProfileError):
        profile_from_dict(_base(grade={"mode": "wat"}))


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
