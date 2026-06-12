"""Declared inter-stage context contract: aliases + reserved keys (W-072).

The prompt context is migrating from ambient flat keys (``plan_approach``)
to a namespaced contract (``stages.plan.approach``) where each flow stage
declares the outputs it publishes (see ``FlowStage.outputs`` in flow.py and
``PromptBuilder.publish_output``).

``CONTEXT_ALIASES`` maps each legacy flat key to its namespaced form. During
the migration window publication dual-writes both forms and lookups fall
through the alias in both directions (see ``overlay._dig``), so templates and
third-party agent overlays referencing either form keep resolving — including
across a resume from a schema-version-1 ``prompt_context.json``. Alias *read*
support is kept indefinitely; flat *publication* is dropped after the
deprecation window (see docs/flow.md).

``RESERVED_CONTEXT_KEYS`` enumerates runtime-provided builtin keys — values
the orchestrator itself injects (work request, branch, run id, guardian PR
variables, work-assignment state). They are not stage outputs, are never
namespaced, and are exempt from the flow consumption lint.
"""

# flat key -> namespaced "stages.<stage>.<output>" key.
# Populated one stage per commit as builtin stages convert (W-072 Phase 3).
CONTEXT_ALIASES: dict = {
    # plan — approach/tasks_outline are declared outputs (flow.py
    # DEFAULT_STAGE_OUTPUTS); file_content is a code-published transform
    # (the materialized plan file read back from disk).
    "plan_approach": "stages.plan.approach",
    "plan_tasks_outline": "stages.plan.tasks_outline",
    "plan_file_content": "stages.plan.file_content",
    # plan_review — all code-published transforms of the revise loop
    # (severity-filtered issues, capped history, loopback mode flag,
    # exhausted-loop carry-forward). The raw issue list is a declared
    # output (stages.plan_review.issues).
    "plan_review_issues": "stages.plan_review.critical_issues",
    "plan_review_history": "stages.plan_review.history",
    "plan_revision_mode": "stages.plan_review.revision_mode",
    "unresolved_plan_issues": "stages.plan_review.unresolved_issues",
    # coordinate — both declared outputs (required schema fields)
    "beads_ids": "stages.coordinate.beads_ids",
    "dependency_graph": "stages.coordinate.dependency_graph",
    # test — passed/coverage_pct/proof_artifacts are declared outputs;
    # failures/failure_history are code-published fix-loop transforms.
    "test_passed": "stages.test.passed",
    "test_coverage": "stages.test.coverage_pct",
    "proof_artifacts": "stages.test.proof_artifacts",
    "test_failures": "stages.test.failures",
    "test_failure_history": "stages.test.failure_history",
    # review — code-published fix-loop transforms (severity-filtered issues,
    # capped history). The raw issue list is a declared output
    # (stages.review.issues).
    "review_issues": "stages.review.critical_issues",
    "review_history": "stages.review.history",
}


def alias_for(flat_key: str):
    """Namespaced form of a legacy flat key, or None when unaliased."""
    return CONTEXT_ALIASES.get(flat_key)


def flat_for(namespaced_key: str):
    """Legacy flat form of a namespaced key, or None when unaliased.

    Linear scan — the table is small (~30 entries) and this only runs on a
    lookup miss, never on the hot direct-hit path.
    """
    for flat, namespaced in CONTEXT_ALIASES.items():
        if namespaced == namespaced_key:
            return flat
    return None


# Runtime-provided builtin context keys (W-072 §3). Injected by the
# orchestrator or computed by PromptBuilder.build_context for every stage —
# not published by any stage, so the consumption lint exempts them.
RESERVED_CONTEXT_KEYS = frozenset({
    # build_context base keys (every stage)
    "work_request",
    "assigned_task",
    "guide_content",
    "has_guide",
    "has_graphify",
    "has_code_review_graph",
    "accumulated_design_notes",
    "has_design_notes",
    # launch-time threading (runner.run_pipeline)
    "plan_file",
    "plan_file_path",
    "run_id",
    "review_base",
    "branch",
    "title",
    "review_comments",
    "has_review_comments",
    # guardian template variables (issue #165, guardian_context.py)
    "defer_pr",
    "revise_pr",
    "pr_title_prefix",
    "pr_footer",
    # work-assignment / orchestration state (implement bead fan-out)
    "assigned_bead_id",
    "assigned_bead_title",
    "assigned_bead_description",
    "implemented_bead_ids",
    "bead_prompt_iteration",
    "all_design_notes",
    "max_beads_override",
    "max_beads_config",
    # learn-stage threading (_run_learn_stage)
    "full_status",
    "termination_type",
    "termination_reason",
    # loop bookkeeping exposed to templates
    "iteration",
    "trigger",
})
