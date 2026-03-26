"""Rebuild cumulative stats from archived run results.

Usage:
    python -m worca.utils.rebuild_stats [--results-dir .worca/results] [--stats-path .worca/stats/cumulative.json]
"""

import argparse

from worca.utils.stats import rebuild_from_results


def main():
    parser = argparse.ArgumentParser(
        description="Rebuild cumulative stats from archived run results."
    )
    parser.add_argument(
        "--results-dir",
        default=".worca/results",
        help="Path to the results directory (default: .worca/results)",
    )
    parser.add_argument(
        "--stats-path",
        default=".worca/stats/cumulative.json",
        help="Path to the cumulative stats file (default: .worca/stats/cumulative.json)",
    )
    args = parser.parse_args()

    stats = rebuild_from_results(args.results_dir, args.stats_path)

    total_runs = stats.get("total_runs", 0)
    total_cost = stats.get("total_cost_usd", 0)
    total_input = stats.get("total_input_tokens", 0)
    total_output = stats.get("total_output_tokens", 0)

    print(f"Rebuilt stats from {total_runs} runs")
    print(f"  Total cost: ${total_cost:.2f}")
    print(f"  Total tokens: {total_input + total_output:,} ({total_input:,} in / {total_output:,} out)")
    print(f"  Written to: {args.stats_path}")


if __name__ == "__main__":
    main()
