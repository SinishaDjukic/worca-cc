// server/settings-validator.js
const VALID_AGENTS = ['planner', 'coordinator', 'implementer', 'tester', 'guardian'];
const VALID_STAGES = ['plan', 'coordinate', 'implement', 'test', 'review', 'pr'];
const VALID_MODELS = ['opus', 'sonnet', 'haiku'];
const VALID_LOOPS = ['implement_test', 'pr_changes', 'restart_planning'];
const VALID_MILESTONES = ['plan_approval', 'pr_approval', 'deploy_approval'];
const VALID_GUARDS = ['block_rm_rf', 'block_env_write', 'block_force_push', 'restrict_git_commit'];
const VALID_PRICING_MODELS = ['opus', 'sonnet'];
const VALID_PRICING_FIELDS = ['input_per_mtok', 'output_per_mtok', 'cache_write_per_mtok', 'cache_read_per_mtok'];

export function validateSettingsPayload(body) {
  const details = [];

  if (body.worca !== undefined) {
    if (typeof body.worca !== 'object' || body.worca === null || Array.isArray(body.worca)) {
      details.push('worca must be an object');
      return { valid: false, details };
    }
    const w = body.worca;

    // agents
    if (w.agents !== undefined) {
      if (typeof w.agents !== 'object' || w.agents === null || Array.isArray(w.agents)) {
        details.push('worca.agents must be an object');
      } else {
        for (const [name, cfg] of Object.entries(w.agents)) {
          if (!VALID_AGENTS.includes(name)) {
            details.push(`Unknown agent name: "${name}"`);
            continue;
          }
          if (cfg.model !== undefined && !VALID_MODELS.includes(cfg.model)) {
            details.push(`Invalid model "${cfg.model}" for agent "${name}"`);
          }
          if (cfg.max_turns !== undefined) {
            if (!Number.isInteger(cfg.max_turns) || cfg.max_turns < 1 || cfg.max_turns > 500) {
              details.push(`max_turns for "${name}" must be an integer between 1 and 500`);
            }
          }
        }
      }
    }

    // stages
    if (w.stages !== undefined) {
      if (typeof w.stages !== 'object' || w.stages === null || Array.isArray(w.stages)) {
        details.push('worca.stages must be an object');
      } else {
        for (const [name, cfg] of Object.entries(w.stages)) {
          if (!VALID_STAGES.includes(name)) {
            details.push(`Unknown stage name: "${name}"`);
            continue;
          }
          if (cfg.agent !== undefined && !VALID_AGENTS.includes(cfg.agent)) {
            details.push(`Invalid agent "${cfg.agent}" for stage "${name}"`);
          }
          if (cfg.enabled !== undefined && typeof cfg.enabled !== 'boolean') {
            details.push(`enabled for stage "${name}" must be a boolean`);
          }
        }
      }
    }

    // loops
    if (w.loops !== undefined) {
      if (typeof w.loops !== 'object' || w.loops === null || Array.isArray(w.loops)) {
        details.push('worca.loops must be an object');
      } else {
        for (const [key, val] of Object.entries(w.loops)) {
          if (!VALID_LOOPS.includes(key)) {
            details.push(`Unknown loop key: "${key}"`);
            continue;
          }
          if (!Number.isInteger(val) || val < 0 || val > 100) {
            details.push(`Loop "${key}" must be a non-negative integer, max 100`);
          }
        }
      }
    }

    // plan_path_template
    if (w.plan_path_template !== undefined) {
      if (typeof w.plan_path_template !== 'string' || w.plan_path_template.length === 0) {
        details.push('plan_path_template must be a non-empty string');
      } else if (w.plan_path_template.length > 500) {
        details.push('plan_path_template must be at most 500 characters');
      }
    }

    // defaults
    if (w.defaults !== undefined) {
      if (typeof w.defaults !== 'object' || w.defaults === null || Array.isArray(w.defaults)) {
        details.push('defaults must be an object');
      } else {
        if (w.defaults.msize !== undefined) {
          if (!Number.isInteger(w.defaults.msize) || w.defaults.msize < 1 || w.defaults.msize > 10) {
            details.push('defaults.msize must be an integer between 1 and 10');
          }
        }
        if (w.defaults.mloops !== undefined) {
          if (!Number.isInteger(w.defaults.mloops) || w.defaults.mloops < 1 || w.defaults.mloops > 10) {
            details.push('defaults.mloops must be an integer between 1 and 10');
          }
        }
      }
    }

    // pricing
    if (w.pricing !== undefined) {
      if (typeof w.pricing !== 'object' || w.pricing === null || Array.isArray(w.pricing)) {
        details.push('pricing must be an object');
      } else {
        const p = w.pricing;
        if (p.models !== undefined) {
          if (typeof p.models !== 'object' || p.models === null || Array.isArray(p.models)) {
            details.push('pricing.models must be an object');
          } else {
            for (const [model, costs] of Object.entries(p.models)) {
              if (!VALID_PRICING_MODELS.includes(model)) {
                details.push(`Unknown pricing model: "${model}"`);
                continue;
              }
              if (typeof costs !== 'object' || costs === null || Array.isArray(costs)) {
                details.push(`pricing.models.${model} must be an object`);
                continue;
              }
              for (const [field, val] of Object.entries(costs)) {
                if (!VALID_PRICING_FIELDS.includes(field)) {
                  details.push(`Unknown pricing field "${field}" for model "${model}"`);
                  continue;
                }
                if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) {
                  details.push(`pricing.models.${model}.${field} must be a non-negative finite number`);
                }
              }
            }
          }
        }
        if (p.currency !== undefined && typeof p.currency !== 'string') {
          details.push('pricing.currency must be a string');
        }
        if (p.last_updated !== undefined && typeof p.last_updated !== 'string') {
          details.push('pricing.last_updated must be a string');
        }
      }
    }

    // milestones
    if (w.milestones !== undefined) {
      if (typeof w.milestones !== 'object' || w.milestones === null || Array.isArray(w.milestones)) {
        details.push('worca.milestones must be an object');
      } else {
        for (const [key, val] of Object.entries(w.milestones)) {
          if (!VALID_MILESTONES.includes(key)) {
            details.push(`Unknown milestone key: "${key}"`);
            continue;
          }
          if (typeof val !== 'boolean') {
            details.push(`Milestone "${key}" must be a boolean`);
          }
        }
      }
    }

    // governance
    if (w.governance !== undefined) {
      if (typeof w.governance !== 'object' || w.governance === null || Array.isArray(w.governance)) {
        details.push('worca.governance must be an object');
      } else {
        const g = w.governance;
        if (g.guards !== undefined) {
          if (typeof g.guards !== 'object' || g.guards === null || Array.isArray(g.guards)) {
            details.push('governance.guards must be an object');
          } else {
            for (const [key, val] of Object.entries(g.guards)) {
              if (!VALID_GUARDS.includes(key)) {
                details.push(`Unknown guard key: "${key}"`);
                continue;
              }
              if (typeof val !== 'boolean') {
                details.push(`Guard "${key}" must be a boolean`);
              }
            }
          }
        }
        if (g.test_gate_strikes !== undefined) {
          if (!Number.isInteger(g.test_gate_strikes) || g.test_gate_strikes < 1 || g.test_gate_strikes > 20) {
            details.push('test_gate_strikes must be an integer between 1 and 20');
          }
        }
        if (g.dispatch !== undefined) {
          if (typeof g.dispatch !== 'object' || g.dispatch === null || Array.isArray(g.dispatch)) {
            details.push('governance.dispatch must be an object');
          } else {
            for (const [key, val] of Object.entries(g.dispatch)) {
              if (!VALID_AGENTS.includes(key)) {
                details.push(`Unknown dispatch agent: "${key}"`);
                continue;
              }
              if (!Array.isArray(val)) {
                details.push(`Dispatch for "${key}" must be an array`);
                continue;
              }
              for (const v of val) {
                if (!VALID_AGENTS.includes(v)) {
                  details.push(`Unknown agent "${v}" in dispatch for "${key}"`);
                }
              }
            }
          }
        }
      }
    }
  }

  // permissions
  if (body.permissions !== undefined) {
    if (typeof body.permissions !== 'object' || body.permissions === null || Array.isArray(body.permissions)) {
      details.push('permissions must be an object');
    } else if (body.permissions.allow !== undefined) {
      if (!Array.isArray(body.permissions.allow)) {
        details.push('permissions.allow must be an array');
      } else {
        for (let i = 0; i < body.permissions.allow.length; i++) {
          const v = body.permissions.allow[i];
          if (typeof v !== 'string' || v.length === 0) {
            details.push(`permissions.allow[${i}] must be a non-empty string`);
          }
        }
      }
    }
  }

  return details.length ? { valid: false, details } : { valid: true };
}
