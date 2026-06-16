"""Commit0 plugin (W-075 §3) — greenfield library build with contamination handling.

Decision: **hide the gold tests during the run, grade on a pristine tree.** Before
launch we stash the held-out test paths out of the agent's worktree (its TDD tester
writes its own throwaway tests). We extract a source-only diff (gold tests excluded),
then grade by applying it onto a fresh skeleton that carries the gold tests. A leakage
guard (in the runner, using ``Prepared.gold_test_paths``) fails any rep whose diff
touches a gold-test path.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

from ..config import Profile
from .base import (
    BenchmarkPlugin,
    GradeResult,
    Instance,
    Prepared,
    _git,
    _git_head,
    init_repo_from_local,
    stub_grade,
)


class Commit0Plugin(BenchmarkPlugin):
    name = "commit0"

    def load_instances(self, profile: Profile) -> list[Instance]:
        sel = profile.selection
        if not sel.instances_file:
            raise RuntimeError(
                "commit0 currently requires selection.instances_file (a list of "
                "libraries with skeleton path + gold_test_paths). Run `commit0 setup "
                "lite` and generate the file, or use the offline fixture form."
            )
        raw = Path(sel.instances_file).read_text(encoding="utf-8")
        records = json.loads(raw)
        want = set(sel.instance_ids)
        out: list[Instance] = []
        for r in records:
            if want and r["instance_id"] not in want:
                continue
            out.append(Instance(
                id=r["instance_id"],
                prompt=r.get("spec", r.get("prompt", "")),
                local_repo=r.get("local_repo"),
                base_commit=r.get("base_commit"),
                extra={"gold_test_paths": tuple(r.get("gold_test_paths", []))},
            ))
        return out

    def materialize(self, instance: Instance, dest: Path) -> str:
        if not instance.local_repo:
            raise ValueError(f"commit0 instance {instance.id} needs a local_repo skeleton")
        return init_repo_from_local(instance.local_repo, dest, instance.base_commit)

    def prepare(self, instance: Instance, tree: Path) -> Prepared:
        """Stash the gold tests out of the tree so the agent can't see them."""
        base = _git_head(tree)
        gold = tuple(instance.extra.get("gold_test_paths", ()))
        stash_dir = tree.parent / f"{tree.name}__gold_tests"
        stash_dir.mkdir(parents=True, exist_ok=True)
        moved: list[tuple[Path, Path]] = []
        for rel in gold:
            src = tree / rel
            if src.exists():
                dst = stash_dir / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(src), str(dst))
                moved.append((src, dst))

        def restore() -> None:
            for src, dst in moved:
                src.parent.mkdir(parents=True, exist_ok=True)
                if dst.exists():
                    shutil.move(str(dst), str(src))
            if stash_dir.exists():
                shutil.rmtree(stash_dir, ignore_errors=True)

        return Prepared(
            base_commit=base,
            extra_excludes=gold,
            restore=restore,
            gold_test_paths=gold,
        )

    def grade(self, instance, diff, tree, target_dir, grade, *, prepared) -> GradeResult:
        if grade.mode == "stub":
            return stub_grade(diff, instance)
        # Real grading: apply the source-only diff onto a pristine skeleton that has
        # the gold tests, then run commit0 test. Best-effort (needs commit0 + Docker).
        return self._grade_on_pristine(instance, diff, target_dir, grade, prepared)  # pragma: no cover

    def _grade_on_pristine(self, instance, diff, target_dir, grade, prepared) -> GradeResult:  # pragma: no cover
        pristine = target_dir / "cache" / "commit0" / "pristine" / instance.id
        try:
            init_repo_from_local(instance.local_repo, pristine, instance.base_commit)
            patch = target_dir / "predictions" / f"{instance.id}.patch"
            patch.parent.mkdir(parents=True, exist_ok=True)
            patch.write_text(diff, encoding="utf-8")
            subprocess.run(["git", "-C", str(pristine), "apply", "--whitespace=nowarn",
                            str(patch)], check=True, capture_output=True, text=True)
            _git(["add", "-A"], pristine)
            _git(["-c", "user.email=bench@worca.dev", "-c", "user.name=bench",
                  "commit", "-m", "worca-bench candidate"], pristine)
            lib = instance.extra.get("lib", instance.id)
            proc = subprocess.run(
                ["commit0", "test", lib, "--branch", "HEAD"],
                cwd=str(pristine), capture_output=True, text=True,
            )
            passed, total = _parse_pytest_counts(proc.stdout + proc.stderr)
            score = (passed / total) if total else 0.0
            return GradeResult(status="graded", resolved=(total > 0 and passed == total),
                               score=score, detail=f"commit0 {passed}/{total}")
        except (subprocess.CalledProcessError, OSError) as e:
            return GradeResult(status="error", detail=f"commit0 grade failed: {e}")


def _parse_pytest_counts(text: str) -> tuple[int, int]:  # pragma: no cover
    import re

    passed = failed = 0
    m = re.search(r"(\d+) passed", text)
    if m:
        passed = int(m.group(1))
    m = re.search(r"(\d+) failed", text)
    if m:
        failed = int(m.group(1))
    return passed, passed + failed
