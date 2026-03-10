"""Tests for worca.utils.token_usage — token extraction, aggregation, and cost estimation."""

import json

from worca.utils.token_usage import (
    extract_token_usage,
    aggregate_token_usage,
    aggregate_by_model,
    estimate_cost,
    load_pricing,
    get_model_pricing,
)


# --- extract_token_usage ---

def test_extract_complete_envelope():
    raw = {
        "type": "result",
        "total_cost_usd": 0.42,
        "duration_ms": 45200,
        "num_turns": 12,
        "_resolved_model": "claude-sonnet-4-20250514",
        "usage": {
            "input_tokens": 28500,
            "output_tokens": 4200,
            "cache_creation_input_tokens": 12000,
            "cache_read_input_tokens": 8500,
        },
    }
    result = extract_token_usage(raw)
    assert result["input_tokens"] == 28500
    assert result["output_tokens"] == 4200
    assert result["cache_creation_input_tokens"] == 12000
    assert result["cache_read_input_tokens"] == 8500
    assert result["total_cost_usd"] == 0.42
    assert result["duration_ms"] == 45200
    assert result["num_turns"] == 12
    assert result["model"] == "claude-sonnet-4-20250514"


def test_extract_missing_usage():
    raw = {"type": "result", "total_cost_usd": 0.1}
    result = extract_token_usage(raw)
    assert result["input_tokens"] == 0
    assert result["output_tokens"] == 0
    assert result["cache_creation_input_tokens"] == 0
    assert result["cache_read_input_tokens"] == 0
    assert result["total_cost_usd"] == 0.1


def test_extract_partial_usage():
    raw = {
        "type": "result",
        "usage": {"input_tokens": 1000, "output_tokens": 500},
        "total_cost_usd": 0.05,
        "num_turns": 3,
        "duration_ms": 5000,
    }
    result = extract_token_usage(raw)
    assert result["input_tokens"] == 1000
    assert result["output_tokens"] == 500
    assert result["cache_creation_input_tokens"] == 0
    assert result["cache_read_input_tokens"] == 0


def test_extract_none_values_treated_as_zero():
    raw = {
        "type": "result",
        "usage": {"input_tokens": None, "output_tokens": None},
        "total_cost_usd": None,
        "num_turns": None,
    }
    result = extract_token_usage(raw)
    assert result["input_tokens"] == 0
    assert result["output_tokens"] == 0
    assert result["total_cost_usd"] == 0
    assert result["num_turns"] == 0


def test_extract_non_dict_returns_zeroes():
    result = extract_token_usage("not a dict")
    assert result["input_tokens"] == 0
    assert result["output_tokens"] == 0
    assert result["total_cost_usd"] == 0


def test_extract_model_from_model_field():
    raw = {"type": "result", "model": "claude-opus-4-20250514", "usage": {}}
    result = extract_token_usage(raw)
    assert result["model"] == "claude-opus-4-20250514"


def test_extract_prefers_resolved_model():
    raw = {
        "type": "result",
        "_resolved_model": "claude-sonnet-4-20250514",
        "model": "fallback",
        "usage": {},
    }
    result = extract_token_usage(raw)
    assert result["model"] == "claude-sonnet-4-20250514"


# --- aggregate_token_usage ---

def test_aggregate_multiple_records():
    usages = [
        {
            "input_tokens": 1000,
            "output_tokens": 200,
            "cache_creation_input_tokens": 500,
            "cache_read_input_tokens": 300,
            "total_cost_usd": 0.10,
            "duration_ms": 5000,
            "num_turns": 3,
        },
        {
            "input_tokens": 2000,
            "output_tokens": 400,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": 600,
            "total_cost_usd": 0.20,
            "duration_ms": 8000,
            "num_turns": 5,
        },
    ]
    result = aggregate_token_usage(usages)
    assert result["input_tokens"] == 3000
    assert result["output_tokens"] == 600
    assert result["cache_creation_input_tokens"] == 500
    assert result["cache_read_input_tokens"] == 900
    assert abs(result["total_cost_usd"] - 0.30) < 1e-9
    assert result["duration_ms"] == 13000
    assert result["num_turns"] == 8
    assert result["iteration_count"] == 2


def test_aggregate_empty_list():
    result = aggregate_token_usage([])
    assert result["input_tokens"] == 0
    assert result["output_tokens"] == 0
    assert result["total_cost_usd"] == 0
    assert result["iteration_count"] == 0


def test_aggregate_single_record():
    usages = [{"input_tokens": 500, "output_tokens": 100, "total_cost_usd": 0.05}]
    result = aggregate_token_usage(usages)
    assert result["input_tokens"] == 500
    assert result["output_tokens"] == 100
    assert result["iteration_count"] == 1


def test_aggregate_handles_missing_fields():
    usages = [{"input_tokens": 100}, {"output_tokens": 200}]
    result = aggregate_token_usage(usages)
    assert result["input_tokens"] == 100
    assert result["output_tokens"] == 200
    assert result["iteration_count"] == 2


# --- aggregate_by_model ---

def test_aggregate_by_model_mixed():
    usages = [
        {
            "model": "claude-sonnet-4-20250514",
            "input_tokens": 1000,
            "output_tokens": 200,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": 0,
            "total_cost_usd": 0.10,
            "num_turns": 3,
        },
        {
            "model": "claude-opus-4-20250514",
            "input_tokens": 2000,
            "output_tokens": 500,
            "cache_creation_input_tokens": 100,
            "cache_read_input_tokens": 50,
            "total_cost_usd": 0.50,
            "num_turns": 5,
        },
        {
            "model": "claude-sonnet-4-20250514",
            "input_tokens": 1500,
            "output_tokens": 300,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": 0,
            "total_cost_usd": 0.15,
            "num_turns": 4,
        },
    ]
    result = aggregate_by_model(usages)
    assert "claude-sonnet-4-20250514" in result
    assert "claude-opus-4-20250514" in result

    sonnet = result["claude-sonnet-4-20250514"]
    assert sonnet["input_tokens"] == 2500
    assert sonnet["output_tokens"] == 500
    assert sonnet["cost_usd"] == 0.25
    assert sonnet["invocations"] == 2

    opus = result["claude-opus-4-20250514"]
    assert opus["input_tokens"] == 2000
    assert opus["output_tokens"] == 500
    assert opus["cost_usd"] == 0.50
    assert opus["invocations"] == 1


def test_aggregate_by_model_empty_model_uses_unknown():
    usages = [{"model": "", "input_tokens": 100, "total_cost_usd": 0.01}]
    result = aggregate_by_model(usages)
    assert "unknown" in result


def test_aggregate_by_model_empty_list():
    result = aggregate_by_model([])
    assert result == {}


# --- estimate_cost ---

def test_estimate_cost_opus():
    usage = {
        "input_tokens": 1_000_000,
        "output_tokens": 100_000,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
    }
    pricing = {
        "input_per_mtok": 15.00,
        "output_per_mtok": 75.00,
        "cache_write_per_mtok": 18.75,
        "cache_read_per_mtok": 1.50,
    }
    cost = estimate_cost(usage, pricing)
    # 1M * 15/1M + 100K * 75/1M = 15 + 7.5 = 22.5
    assert abs(cost - 22.5) < 0.001


def test_estimate_cost_with_cache():
    usage = {
        "input_tokens": 500_000,
        "output_tokens": 50_000,
        "cache_creation_input_tokens": 200_000,
        "cache_read_input_tokens": 300_000,
    }
    pricing = {
        "input_per_mtok": 3.00,
        "output_per_mtok": 15.00,
        "cache_write_per_mtok": 3.75,
        "cache_read_per_mtok": 0.30,
    }
    cost = estimate_cost(usage, pricing)
    # 500K*3/1M + 50K*15/1M + 200K*3.75/1M + 300K*0.30/1M
    # = 1.5 + 0.75 + 0.75 + 0.09 = 3.09
    assert abs(cost - 3.09) < 0.001


def test_estimate_cost_empty_usage():
    cost = estimate_cost({}, {"input_per_mtok": 15.0})
    assert cost == 0.0


def test_estimate_cost_empty_pricing():
    usage = {"input_tokens": 1000, "output_tokens": 500}
    cost = estimate_cost(usage, {})
    assert cost == 0.0


# --- load_pricing ---

def test_load_pricing_valid(tmp_path):
    settings = {
        "worca": {
            "pricing": {
                "models": {
                    "opus": {"input_per_mtok": 15.0},
                    "sonnet": {"input_per_mtok": 3.0},
                }
            }
        }
    }
    path = tmp_path / "settings.json"
    path.write_text(json.dumps(settings))
    result = load_pricing(str(path))
    assert "opus" in result
    assert "sonnet" in result
    assert result["opus"]["input_per_mtok"] == 15.0


def test_load_pricing_missing_file():
    result = load_pricing("/nonexistent/settings.json")
    assert result == {}


def test_load_pricing_no_pricing_section(tmp_path):
    path = tmp_path / "settings.json"
    path.write_text(json.dumps({"worca": {}}))
    result = load_pricing(str(path))
    assert result == {}


# --- get_model_pricing ---

def test_get_model_pricing_matches_substring():
    pricing = {
        "opus": {"input_per_mtok": 15.0},
        "sonnet": {"input_per_mtok": 3.0},
    }
    result = get_model_pricing("claude-opus-4-20250514", pricing)
    assert result["input_per_mtok"] == 15.0


def test_get_model_pricing_no_match():
    pricing = {"opus": {"input_per_mtok": 15.0}}
    result = get_model_pricing("claude-haiku-4-20250514", pricing)
    assert result is None


def test_get_model_pricing_empty():
    assert get_model_pricing("", {}) is None
    assert get_model_pricing("model", {}) is None
    assert get_model_pricing("", {"opus": {}}) is None
