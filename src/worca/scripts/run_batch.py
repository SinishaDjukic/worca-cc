# /// script
# requires-python = ">=3.8"
# ///
"""Run multiple work requests through the worca-cc pipeline."""
import argparse
import json
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from worca.orchestrator.work_request import normalize
from worca.orchestrator.batch import run_batch, CircuitBreakerError


def main():
    parser = argparse.ArgumentParser(description="Run worca-cc batch pipeline")
    parser.add_argument("--sources", nargs="+", required=True,
                        help="Source references (gh:issue:42 gh:issue:43 ...)")
    parser.add_argument("--settings", default=".claude/settings.json",
                        help="Path to settings.json")
    parser.add_argument("--max-failures", type=int, default=3,
                        help="Circuit breaker threshold")

    args = parser.parse_args()

    # Normalize all inputs
    requests = []
    for source in args.sources:
        if source.startswith("gh:"):
            requests.append(normalize("source", source))
        elif source.startswith("bd:"):
            requests.append(normalize("source", source))
        else:
            requests.append(normalize("prompt", source))

    print(f"Batch processing {len(requests)} work requests")

    try:
        results = run_batch(
            requests,
            settings_path=args.settings,
            max_failures=args.max_failures,
        )
        print(json.dumps(results, indent=2, default=str))
    except CircuitBreakerError as e:
        print(f"Circuit breaker tripped: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
