"""worca-bench — config-evaluation harness for worca pipelines (W-075).

A version-agnostic orchestrator that evaluates any worca version/branch/commit
against external coding benchmarks (SWE-bench Verified, Commit0). It NEVER imports
worca — it provisions an isolated venv per ref and shells out to that venv's
``run_pipeline``. See docs/plans/W-075-worca-bench.md.
"""

__version__ = "0.1.0"

RESULTS_SCHEMA_VERSION = 1
