from __future__ import annotations

import json
from pathlib import Path

from worca_bench.worca_install import (
    collect_secret_env,
    deep_merge,
    load_overlay,
    seed_settings,
)


def test_deep_merge_nested():
    base = {"worca": {"models": {"opus": "x"}, "stages": {"plan": {"enabled": True}}}}
    overlay = {"worca": {"models": {"sonnet": "y"}, "stages": {"pr": {"defer": True}}}}
    merged = deep_merge(base, overlay)
    assert merged["worca"]["models"] == {"opus": "x", "sonnet": "y"}
    assert merged["worca"]["stages"]["plan"]["enabled"] is True
    assert merged["worca"]["stages"]["pr"]["defer"] is True


def test_deep_merge_skips_underscore_keys():
    merged = deep_merge({"a": 1}, {"_comment": "ignore", "b": 2})
    assert merged == {"a": 1, "b": 2}


def test_load_overlay_default_minimal():
    overlay = load_overlay(None)
    assert isinstance(overlay, dict)  # default ships empty worca overlay


def test_seed_settings_minimal_surface(tmp_path: Path):
    tree = tmp_path / "repo"
    (tree / ".claude").mkdir(parents=True)
    # version self-seeded a base settings.json
    (tree / ".claude" / "settings.json").write_text(
        json.dumps({"worca": {"stages": {"plan": {"enabled": True}}}}),
        encoding="utf-8",
    )
    seed_settings(
        tree,
        overlay={"models": {"opus": "claude-opus-4-8"}},
        extra_settings={"models": {"sonnet": "claude-sonnet-4-6"}},
        pr_defer=True,
        secret_env={"ANTHROPIC_API_KEY": "sk-test"},
    )
    settings = json.loads((tree / ".claude" / "settings.json").read_text())
    # base preserved
    assert settings["worca"]["stages"]["plan"]["enabled"] is True
    # overlay + extra merged
    assert settings["worca"]["models"] == {"opus": "claude-opus-4-8", "sonnet": "claude-sonnet-4-6"}
    # pr.defer injected
    assert settings["worca"]["stages"]["pr"]["defer"] is True
    # secret NOT in settings.json
    assert "ANTHROPIC_API_KEY" not in json.dumps(settings)
    # secret IS in settings.local.json
    local = json.loads((tree / ".claude" / "settings.local.json").read_text())
    assert local["worca"]["_bench_secret_env"]["ANTHROPIC_API_KEY"] == "sk-test"


def test_collect_secret_env_picks_known_keys():
    env = {"ANTHROPIC_API_KEY": "k", "RANDOM": "v", "ANTHROPIC_BASE_URL": "u"}
    got = collect_secret_env(env)
    assert got == {"ANTHROPIC_API_KEY": "k", "ANTHROPIC_BASE_URL": "u"}


def test_collect_secret_env_includes_grader_credentials():
    env = {"SWEBENCH_API_KEY": "swb", "MODAL_TOKEN_ID": "mid",
           "MODAL_TOKEN_SECRET": "msec", "RANDOM": "v"}
    got = collect_secret_env(env)
    assert got == {"SWEBENCH_API_KEY": "swb", "MODAL_TOKEN_ID": "mid",
                   "MODAL_TOKEN_SECRET": "msec"}
