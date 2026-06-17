"""Profile config model + YAML loader (requirement 5).

A *profile* is the full reproducible experiment spec: which benchmark, which
instances, which worca ref, which template(s), how many reps, and how to grade.
Profiles live in ``worca-bench/profiles/*.yaml`` (in-repo) or under a target dir.
"""

from __future__ import annotations

import fnmatch
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError:  # pragma: no cover - PyYAML is a hard dep, guard for clarity
    yaml = None

VALID_BENCHMARKS = {"swe-bench-verified", "commit0"}
VALID_GRADE_MODES = {"stub", "sb-cli", "modal", "local-docker"}

# Which grade backends each benchmark actually supports. SWE-bench can grade via
# the hosted sb-cli API, a local Docker harness, or Modal serverless. Commit0 has
# no hosted equivalent — it runs its own tests via ``commit0 test`` on a local
# Docker (``local-docker``) or Modal (``modal``) backend. ``stub`` (plumbing-only,
# no real grade) is valid everywhere.
BENCHMARK_GRADE_MODES = {
    "swe-bench-verified": {"stub", "sb-cli", "local-docker", "modal"},
    "commit0": {"stub", "local-docker", "modal"},
}


def valid_grade_modes(benchmark: str) -> set[str]:
    """Grade modes valid for a benchmark (falls back to the full set if unknown)."""
    return BENCHMARK_GRADE_MODES.get(benchmark, VALID_GRADE_MODES)


class ProfileError(ValueError):
    """Raised when a profile is malformed or references unknown values."""


@dataclass
class WorcaRef:
    """Which worca to install. ``local`` uses the current environment (for tests
    and dev); anything else is a pip-installable ref (branch | tag | commit | version)."""

    ref: str = "local"
    # Explicit source override. When None, ``local`` => current env, otherwise a
    # git ref against the worca-cc repo. Set ``source`` to pin a different origin.
    source: str | None = None

    @property
    def is_local(self) -> bool:
        return self.ref == "local" or (self.source or "").startswith("path:")


@dataclass
class Sample:
    n: int
    stratify_by: str | None = None
    seed: int = 0


@dataclass
class Selection:
    instance_ids: list[str] = field(default_factory=list)
    sample: Sample | None = None
    # Local fixture of instances (bypasses HuggingFace). Used by tests and offline runs.
    instances_file: str | None = None


@dataclass
class GradeConfig:
    mode: str = "stub"
    # sb-cli/local-docker knobs (passed through to the plugin)
    options: dict[str, Any] = field(default_factory=dict)


@dataclass
class Concurrency:
    worca: int = 4
    grade: int = 4


@dataclass
class MockConfig:
    """When present, the runner drives the spawned worca pipeline with the repo's
    mock Claude (``tests/mock_claude/mock_claude.py``) — free + deterministic.
    This powers both e2e tests and a user-facing ``--mock`` dry-run."""

    # Path to a scenario JSON. When None, a built-in all-succeed scenario is used.
    scenario: str | None = None
    # Path to the mock_claude.py to use. When None, resolved from the worca-cc repo.
    mock_bin: str | None = None


@dataclass
class EngineConfig:
    """Optional code-graph engine (graphify / code-review-graph). Both are
    cross-template settings keys, off by default. ``mode`` is engine-specific
    (graphify: structural|full) and only seeded when enabled + provided; extra
    keys (e.g. CRG freshness) pass through ``options``."""

    enabled: bool = False
    mode: str | None = None
    options: dict[str, Any] = field(default_factory=dict)

    def to_settings(self) -> dict[str, Any]:
        out: dict[str, Any] = {"enabled": True}
        if self.mode:
            out["mode"] = self.mode
        out.update(self.options)
        return out

    @property
    def label(self) -> str | None:
        """Compact value for results rows: mode (or 'on') when enabled, else None."""
        if not self.enabled:
            return None
        return self.mode or "on"


@dataclass
class Profile:
    name: str
    benchmark: str
    worca: WorcaRef = field(default_factory=WorcaRef)
    selection: Selection = field(default_factory=Selection)
    template: str = "builtin:feature"
    template_map: dict[str, str] = field(default_factory=dict)
    # Definitions for non-builtin (project:/user:) templates, keyed by bare name.
    # Each value is a template.json-shaped dict ({id, name, config, ...}).
    templates: dict[str, dict[str, Any]] = field(default_factory=dict)
    reps: int = 1
    grade: GradeConfig = field(default_factory=GradeConfig)
    concurrency: Concurrency = field(default_factory=Concurrency)
    # Minimal cross-template settings overlay (model aliases). Secrets go to
    # settings.local.json via the environment, never here. See worca_install.py.
    settings: dict[str, Any] = field(default_factory=dict)
    settings_ref: str | None = None
    mock: MockConfig | None = None
    claude_md_mode: str = "none"
    skip_preflight: bool = True
    pr_defer: bool = True
    # Optional code-graph engines (off by default).
    graphify: EngineConfig = field(default_factory=EngineConfig)
    code_review_graph: EngineConfig = field(default_factory=EngineConfig)

    def engine_settings(self) -> dict[str, Any]:
        """worca.* overlay for any enabled code-graph engine (empty when off)."""
        out: dict[str, Any] = {}
        if self.graphify.enabled:
            out["graphify"] = self.graphify.to_settings()
        if self.code_review_graph.enabled:
            out["code_review_graph"] = self.code_review_graph.to_settings()
        return out

    def template_for(self, instance_id: str) -> str:
        """Resolve the template for an instance via ``template_map`` globs, else
        the profile default (requirement 2)."""
        for glob, tmpl in self.template_map.items():
            if fnmatch.fnmatch(instance_id, glob):
                return tmpl
        return self.template

    def validate(self) -> None:
        if self.benchmark not in VALID_BENCHMARKS:
            raise ProfileError(
                f"unknown benchmark {self.benchmark!r}; expected one of "
                f"{sorted(VALID_BENCHMARKS)}"
            )
        allowed = valid_grade_modes(self.benchmark)
        if self.grade.mode not in allowed:
            raise ProfileError(
                f"grade.mode {self.grade.mode!r} is not valid for benchmark "
                f"{self.benchmark!r}; expected one of {sorted(allowed)}"
            )
        if self.reps < 1:
            raise ProfileError(f"reps must be >= 1, got {self.reps}")
        if not self.selection.instance_ids and not self.selection.sample \
                and not self.selection.instances_file:
            raise ProfileError(
                "selection must set one of: instance_ids, sample, instances_file"
            )


def _coerce_worca(raw: Any) -> WorcaRef:
    if raw is None:
        return WorcaRef()
    if isinstance(raw, str):
        return WorcaRef(ref=raw)
    return WorcaRef(ref=raw.get("ref", "local"), source=raw.get("source"))


def _coerce_engine(raw: Any) -> EngineConfig:
    if raw is None:
        return EngineConfig()
    if isinstance(raw, bool):
        return EngineConfig(enabled=raw)
    if isinstance(raw, str):  # shorthand: a bare mode string enables it
        return EngineConfig(enabled=True, mode=raw)
    enabled = bool(raw.get("enabled", False))
    mode = raw.get("mode")
    options = {k: v for k, v in raw.items() if k not in ("enabled", "mode")}
    return EngineConfig(enabled=enabled, mode=mode, options=options)


def _coerce_selection(raw: Any) -> Selection:
    raw = raw or {}
    sample = None
    if raw.get("sample"):
        s = raw["sample"]
        sample = Sample(n=int(s["n"]), stratify_by=s.get("stratify_by"), seed=int(s.get("seed", 0)))
    return Selection(
        instance_ids=list(raw.get("instance_ids", []) or []),
        sample=sample,
        instances_file=raw.get("instances_file"),
    )


def profile_from_dict(data: dict[str, Any]) -> Profile:
    """Build a validated Profile from a parsed dict."""
    if "name" not in data:
        raise ProfileError("profile is missing required key 'name'")
    if "benchmark" not in data:
        raise ProfileError("profile is missing required key 'benchmark'")

    grade_raw = data.get("grade") or {}
    if isinstance(grade_raw, str):
        grade_raw = {"mode": grade_raw}
    conc_raw = data.get("concurrency") or {}
    mock_raw = data.get("mock")
    mock = None
    if mock_raw is not None:
        if mock_raw is True:
            mock = MockConfig()
        elif isinstance(mock_raw, dict):
            mock = MockConfig(scenario=mock_raw.get("scenario"), mock_bin=mock_raw.get("mock_bin"))

    profile = Profile(
        name=data["name"],
        benchmark=data["benchmark"],
        worca=_coerce_worca(data.get("worca")),
        selection=_coerce_selection(data.get("selection")),
        template=data.get("template", "builtin:feature"),
        template_map=dict(data.get("template_map", {}) or {}),
        templates=dict(data.get("templates", {}) or {}),
        reps=int(data.get("reps", 1)),
        grade=GradeConfig(mode=grade_raw.get("mode", "stub"), options=grade_raw.get("options", {}) or {}),
        concurrency=Concurrency(
            worca=int(conc_raw.get("worca", 4)),
            grade=int(conc_raw.get("grade", 4)),
        ),
        settings=dict(data.get("settings", {}) or {}),
        settings_ref=data.get("settings_ref"),
        mock=mock,
        claude_md_mode=data.get("claude_md_mode", "none"),
        skip_preflight=bool(data.get("skip_preflight", True)),
        pr_defer=bool(data.get("pr_defer", True)),
        graphify=_coerce_engine(data.get("graphify")),
        code_review_graph=_coerce_engine(data.get("code_review_graph")),
    )
    profile.validate()
    return profile


def load_profile(path: str | Path) -> Profile:
    """Load and validate a profile from a YAML (or JSON) file."""
    p = Path(path)
    if not p.exists():
        raise ProfileError(f"profile file not found: {p}")
    text = p.read_text(encoding="utf-8")
    if p.suffix in (".json",):
        data = json.loads(text)
    else:
        if yaml is None:  # pragma: no cover
            raise ProfileError("PyYAML is required to load .yaml profiles")
        data = yaml.safe_load(text)
    if not isinstance(data, dict):
        raise ProfileError(f"profile {p} did not parse to a mapping")
    return profile_from_dict(data)


def find_profile(name: str, search_dirs: list[Path]) -> Profile:
    """Find ``<name>.yaml`` / ``<name>.json`` across the given dirs (first match wins)."""
    for d in search_dirs:
        for ext in (".yaml", ".yml", ".json"):
            candidate = d / f"{name}{ext}"
            if candidate.exists():
                return load_profile(candidate)
    raise ProfileError(
        f"profile {name!r} not found in: {', '.join(str(d) for d in search_dirs)}"
    )
