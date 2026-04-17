// server/settings-validator.js
import { STAGE_ORDER } from '../app/utils/stage-order.js';

const VALID_AGENTS = [
  'planner',
  'plan_reviewer',
  'coordinator',
  'implementer',
  'tester',
  'reviewer',
  'guardian',
  'learner',
];
const VALID_STAGES = STAGE_ORDER;
const VALID_MODELS = ['opus', 'sonnet', 'haiku'];
const VALID_LOOPS = [
  'implement_test',
  'pr_changes',
  'restart_planning',
  'plan_review',
];
const VALID_MILESTONES = ['plan_approval', 'pr_approval', 'deploy_approval'];
const VALID_GUARDS = [
  'block_rm_rf',
  'block_env_write',
  'block_force_push',
  'restrict_git_commit',
];
const VALID_PRICING_MODELS = ['opus', 'sonnet'];
const VALID_PRICING_FIELDS = [
  'input_per_mtok',
  'output_per_mtok',
  'cache_write_per_mtok',
  'cache_read_per_mtok',
];

export function validateSettingsPayload(body) {
  const details = [];

  if (body.worca !== undefined) {
    if (
      typeof body.worca !== 'object' ||
      body.worca === null ||
      Array.isArray(body.worca)
    ) {
      details.push('worca must be an object');
      return { valid: false, details };
    }
    const w = body.worca;

    // agents
    if (w.agents !== undefined) {
      if (
        typeof w.agents !== 'object' ||
        w.agents === null ||
        Array.isArray(w.agents)
      ) {
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
            if (
              !Number.isInteger(cfg.max_turns) ||
              cfg.max_turns < 1 ||
              cfg.max_turns > 500
            ) {
              details.push(
                `max_turns for "${name}" must be an integer between 1 and 500`,
              );
            }
          }
        }
      }
    }

    // stages
    if (w.stages !== undefined) {
      if (
        typeof w.stages !== 'object' ||
        w.stages === null ||
        Array.isArray(w.stages)
      ) {
        details.push('worca.stages must be an object');
      } else {
        for (const [name, cfg] of Object.entries(w.stages)) {
          if (!VALID_STAGES.includes(name)) {
            details.push(`Unknown stage name: "${name}"`);
            continue;
          }
          if (cfg.enabled !== undefined && typeof cfg.enabled !== 'boolean') {
            details.push(`enabled for stage "${name}" must be a boolean`);
          }
          if (name === 'preflight') {
            if (
              cfg.script !== undefined &&
              (typeof cfg.script !== 'string' || cfg.script.length === 0)
            ) {
              details.push('preflight.script must be a non-empty string');
            }
            if (cfg.require !== undefined && !Array.isArray(cfg.require)) {
              details.push('preflight.require must be an array');
            }
          } else {
            if (cfg.agent !== undefined && !VALID_AGENTS.includes(cfg.agent)) {
              details.push(`Invalid agent "${cfg.agent}" for stage "${name}"`);
            }
          }
        }
      }
    }

    // loops
    if (w.loops !== undefined) {
      if (
        typeof w.loops !== 'object' ||
        w.loops === null ||
        Array.isArray(w.loops)
      ) {
        details.push('worca.loops must be an object');
      } else {
        for (const [key, val] of Object.entries(w.loops)) {
          if (!VALID_LOOPS.includes(key)) {
            details.push(`Unknown loop key: "${key}"`);
            continue;
          }
          if (!Number.isInteger(val) || val < 0 || val > 100) {
            details.push(
              `Loop "${key}" must be a non-negative integer, max 100`,
            );
          }
        }
      }
    }

    // plan_path_template
    if (w.plan_path_template !== undefined) {
      if (
        typeof w.plan_path_template !== 'string' ||
        w.plan_path_template.length === 0
      ) {
        details.push('plan_path_template must be a non-empty string');
      } else if (w.plan_path_template.length > 500) {
        details.push('plan_path_template must be at most 500 characters');
      }
    }

    // defaults
    if (w.defaults !== undefined) {
      if (
        typeof w.defaults !== 'object' ||
        w.defaults === null ||
        Array.isArray(w.defaults)
      ) {
        details.push('defaults must be an object');
      } else {
        if (w.defaults.msize !== undefined) {
          if (
            !Number.isInteger(w.defaults.msize) ||
            w.defaults.msize < 1 ||
            w.defaults.msize > 10
          ) {
            details.push('defaults.msize must be an integer between 1 and 10');
          }
        }
        if (w.defaults.mloops !== undefined) {
          if (
            !Number.isInteger(w.defaults.mloops) ||
            w.defaults.mloops < 1 ||
            w.defaults.mloops > 10
          ) {
            details.push('defaults.mloops must be an integer between 1 and 10');
          }
        }
      }
    }

    // pricing
    if (w.pricing !== undefined) {
      if (
        typeof w.pricing !== 'object' ||
        w.pricing === null ||
        Array.isArray(w.pricing)
      ) {
        details.push('pricing must be an object');
      } else {
        const p = w.pricing;
        if (p.models !== undefined) {
          if (
            typeof p.models !== 'object' ||
            p.models === null ||
            Array.isArray(p.models)
          ) {
            details.push('pricing.models must be an object');
          } else {
            for (const [model, costs] of Object.entries(p.models)) {
              if (!VALID_PRICING_MODELS.includes(model)) {
                details.push(`Unknown pricing model: "${model}"`);
                continue;
              }
              if (
                typeof costs !== 'object' ||
                costs === null ||
                Array.isArray(costs)
              ) {
                details.push(`pricing.models.${model} must be an object`);
                continue;
              }
              for (const [field, val] of Object.entries(costs)) {
                if (!VALID_PRICING_FIELDS.includes(field)) {
                  details.push(
                    `Unknown pricing field "${field}" for model "${model}"`,
                  );
                  continue;
                }
                if (
                  typeof val !== 'number' ||
                  !Number.isFinite(val) ||
                  val < 0
                ) {
                  details.push(
                    `pricing.models.${model}.${field} must be a non-negative finite number`,
                  );
                }
              }
            }
          }
        }
        if (p.currency !== undefined && typeof p.currency !== 'string') {
          details.push('pricing.currency must be a string');
        }
        if (
          p.last_updated !== undefined &&
          typeof p.last_updated !== 'string'
        ) {
          details.push('pricing.last_updated must be a string');
        }
      }
    }

    // milestones
    if (w.milestones !== undefined) {
      if (
        typeof w.milestones !== 'object' ||
        w.milestones === null ||
        Array.isArray(w.milestones)
      ) {
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
      if (
        typeof w.governance !== 'object' ||
        w.governance === null ||
        Array.isArray(w.governance)
      ) {
        details.push('worca.governance must be an object');
      } else {
        const g = w.governance;
        if (g.guards !== undefined) {
          if (
            typeof g.guards !== 'object' ||
            g.guards === null ||
            Array.isArray(g.guards)
          ) {
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
          if (
            !Number.isInteger(g.test_gate_strikes) ||
            g.test_gate_strikes < 1 ||
            g.test_gate_strikes > 20
          ) {
            details.push(
              'test_gate_strikes must be an integer between 1 and 20',
            );
          }
        }
        if (g.dispatch !== undefined) {
          if (
            typeof g.dispatch !== 'object' ||
            g.dispatch === null ||
            Array.isArray(g.dispatch)
          ) {
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
                if (typeof v !== 'string') {
                  details.push(`Dispatch entry for "${key}" must be a string`);
                }
              }
            }
          }
        }
        if (g.subagent_dispatch !== undefined) {
          if (
            typeof g.subagent_dispatch !== 'object' ||
            g.subagent_dispatch === null ||
            Array.isArray(g.subagent_dispatch)
          ) {
            details.push('governance.subagent_dispatch must be an object');
          } else {
            for (const [key, val] of Object.entries(g.subagent_dispatch)) {
              if (!VALID_AGENTS.includes(key)) {
                details.push(`Unknown subagent_dispatch agent: "${key}"`);
                continue;
              }
              if (!Array.isArray(val)) {
                details.push(`subagent_dispatch for "${key}" must be an array`);
                continue;
              }
              for (const v of val) {
                if (typeof v !== 'string') {
                  details.push(
                    `subagent_dispatch entry for "${key}" must be a string`,
                  );
                }
              }
            }
          }
        }
      }
    }

    // events
    if (w.events !== undefined) {
      if (
        typeof w.events !== 'object' ||
        w.events === null ||
        Array.isArray(w.events)
      ) {
        details.push('events must be an object');
      } else {
        const ev = w.events;
        if (ev.enabled !== undefined && typeof ev.enabled !== 'boolean') {
          details.push('events.enabled must be a boolean');
        }
        if (
          ev.agent_telemetry !== undefined &&
          typeof ev.agent_telemetry !== 'boolean'
        ) {
          details.push('events.agent_telemetry must be a boolean');
        }
        if (
          ev.hook_events !== undefined &&
          typeof ev.hook_events !== 'boolean'
        ) {
          details.push('events.hook_events must be a boolean');
        }
        if (ev.rate_limit_ms !== undefined) {
          if (!Number.isInteger(ev.rate_limit_ms) || ev.rate_limit_ms < 0) {
            details.push('events.rate_limit_ms must be a non-negative integer');
          }
        }
      }
    }

    // budget
    if (w.budget !== undefined) {
      if (
        typeof w.budget !== 'object' ||
        w.budget === null ||
        Array.isArray(w.budget)
      ) {
        details.push('budget must be an object');
      } else {
        const b = w.budget;
        if (b.max_cost_usd !== undefined) {
          if (
            typeof b.max_cost_usd !== 'number' ||
            !Number.isFinite(b.max_cost_usd) ||
            b.max_cost_usd <= 0
          ) {
            details.push(
              'budget.max_cost_usd must be a positive finite number',
            );
          }
        }
        if (b.warning_pct !== undefined) {
          if (
            typeof b.warning_pct !== 'number' ||
            !Number.isFinite(b.warning_pct) ||
            b.warning_pct < 0 ||
            b.warning_pct > 100
          ) {
            details.push(
              'budget.warning_pct must be a number between 0 and 100',
            );
          }
        }
      }
    }

    // webhooks
    if (w.webhooks !== undefined) {
      if (!Array.isArray(w.webhooks)) {
        details.push('webhooks must be an array');
      } else {
        for (let i = 0; i < w.webhooks.length; i++) {
          const wh = w.webhooks[i];
          const pfx = `webhooks[${i}]`;
          if (typeof wh !== 'object' || wh === null || Array.isArray(wh)) {
            details.push(`${pfx} must be an object`);
            continue;
          }
          // url — required
          if (
            wh.url === undefined ||
            typeof wh.url !== 'string' ||
            wh.url.trim().length === 0
          ) {
            details.push(`${pfx}.url must be a non-empty string`);
          } else {
            try {
              const parsed = new URL(wh.url);
              if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                details.push(`${pfx}.url must use http or https protocol`);
              }
            } catch {
              details.push(`${pfx}.url is not a valid URL`);
            }
          }
          if (wh.secret !== undefined && typeof wh.secret !== 'string') {
            details.push(`${pfx}.secret must be a string`);
          }
          if (wh.events !== undefined) {
            if (!Array.isArray(wh.events)) {
              details.push(`${pfx}.events must be an array`);
            } else {
              for (let j = 0; j < wh.events.length; j++) {
                if (
                  typeof wh.events[j] !== 'string' ||
                  wh.events[j].length === 0
                ) {
                  details.push(
                    `${pfx}.events[${j}] must be a non-empty string`,
                  );
                }
              }
            }
          }
          if (wh.timeout_ms !== undefined) {
            if (!Number.isInteger(wh.timeout_ms) || wh.timeout_ms < 1) {
              details.push(`${pfx}.timeout_ms must be a positive integer`);
            }
          }
          if (wh.max_retries !== undefined) {
            if (
              !Number.isInteger(wh.max_retries) ||
              wh.max_retries < 0 ||
              wh.max_retries > 10
            ) {
              details.push(
                `${pfx}.max_retries must be an integer between 0 and 10`,
              );
            }
          }
          if (wh.rate_limit_ms !== undefined) {
            if (!Number.isInteger(wh.rate_limit_ms) || wh.rate_limit_ms < 0) {
              details.push(
                `${pfx}.rate_limit_ms must be a non-negative integer`,
              );
            }
          }
          if (wh.control !== undefined && typeof wh.control !== 'boolean') {
            details.push(`${pfx}.control must be a boolean`);
          }
        }
      }
    }
  }

  // permissions
  if (body.permissions !== undefined) {
    if (
      typeof body.permissions !== 'object' ||
      body.permissions === null ||
      Array.isArray(body.permissions)
    ) {
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

const VALID_WEBHOOK_OUT_FORMATS = [
  'generic-json',
  'slack-compatible',
  'discord-compatible',
  'teams-card',
  'ntfy',
  'plain-text',
];

export function validateIntegrationsConfig(cfg) {
  const details = [];

  if (cfg.schema_version === undefined || cfg.schema_version !== 1) {
    details.push('schema_version must be present and equal to 1');
  }

  if (cfg.enabled !== undefined && typeof cfg.enabled !== 'boolean') {
    details.push('enabled must be a boolean');
  }

  if (cfg.webhook_secret_env !== undefined) {
    if (
      typeof cfg.webhook_secret_env !== 'string' ||
      cfg.webhook_secret_env.length === 0
    ) {
      details.push('webhook_secret_env must be a non-empty string');
    }
  }

  if (cfg.webhook_secrets_env !== undefined) {
    if (
      typeof cfg.webhook_secrets_env !== 'string' ||
      cfg.webhook_secrets_env.length === 0
    ) {
      details.push('webhook_secrets_env must be a non-empty string');
    }
  }

  if (
    cfg.strict_inbox_verification !== undefined &&
    typeof cfg.strict_inbox_verification !== 'boolean'
  ) {
    details.push('strict_inbox_verification must be a boolean');
  }

  // telegram
  if (cfg.telegram !== undefined) {
    if (
      typeof cfg.telegram !== 'object' ||
      cfg.telegram === null ||
      Array.isArray(cfg.telegram)
    ) {
      details.push('telegram must be an object');
    } else {
      const tg = cfg.telegram;
      if (tg.enabled !== undefined && typeof tg.enabled !== 'boolean') {
        details.push('telegram.enabled must be a boolean');
      }
      if (
        tg.bot_token_env === undefined ||
        typeof tg.bot_token_env !== 'string' ||
        tg.bot_token_env.length === 0
      ) {
        details.push('telegram.bot_token_env must be a non-empty string');
      }
      if (
        tg.chat_id === undefined ||
        (typeof tg.chat_id !== 'string' && typeof tg.chat_id !== 'number')
      ) {
        details.push('telegram.chat_id must be a string or number');
      }
      if (tg.events === undefined || !Array.isArray(tg.events)) {
        details.push('telegram.events must be an array');
      } else {
        for (let i = 0; i < tg.events.length; i++) {
          if (typeof tg.events[i] !== 'string' || tg.events[i].length === 0) {
            details.push(`telegram.events[${i}] must be a non-empty string`);
          }
        }
      }
      if (tg.rate_limit_per_min !== undefined) {
        if (
          !Number.isInteger(tg.rate_limit_per_min) ||
          tg.rate_limit_per_min < 1
        ) {
          details.push(
            'telegram.rate_limit_per_min must be a positive integer',
          );
        }
      }
    }
  }

  // discord
  if (cfg.discord !== undefined) {
    if (
      typeof cfg.discord !== 'object' ||
      cfg.discord === null ||
      Array.isArray(cfg.discord)
    ) {
      details.push('discord must be an object');
    } else {
      const dc = cfg.discord;
      if (dc.enabled !== undefined && typeof dc.enabled !== 'boolean') {
        details.push('discord.enabled must be a boolean');
      }
      if (
        dc.bot_token_env === undefined ||
        typeof dc.bot_token_env !== 'string' ||
        dc.bot_token_env.length === 0
      ) {
        details.push('discord.bot_token_env must be a non-empty string');
      }
      if (
        dc.channel_id === undefined ||
        typeof dc.channel_id !== 'string' ||
        dc.channel_id.length === 0
      ) {
        details.push('discord.channel_id must be a non-empty string');
      }
      if (dc.events !== undefined && !Array.isArray(dc.events)) {
        details.push('discord.events must be an array');
      } else if (Array.isArray(dc.events)) {
        for (let i = 0; i < dc.events.length; i++) {
          if (typeof dc.events[i] !== 'string' || dc.events[i].length === 0) {
            details.push(`discord.events[${i}] must be a non-empty string`);
          }
        }
      }
    }
  }

  // slack
  if (cfg.slack !== undefined) {
    if (
      typeof cfg.slack !== 'object' ||
      cfg.slack === null ||
      Array.isArray(cfg.slack)
    ) {
      details.push('slack must be an object');
    } else {
      const sl = cfg.slack;
      if (sl.enabled !== undefined && typeof sl.enabled !== 'boolean') {
        details.push('slack.enabled must be a boolean');
      }
      if (
        sl.webhook_url_env === undefined ||
        typeof sl.webhook_url_env !== 'string' ||
        sl.webhook_url_env.length === 0
      ) {
        details.push('slack.webhook_url_env must be a non-empty string');
      }
      if (sl.events !== undefined && !Array.isArray(sl.events)) {
        details.push('slack.events must be an array');
      } else if (Array.isArray(sl.events)) {
        for (let i = 0; i < sl.events.length; i++) {
          if (typeof sl.events[i] !== 'string' || sl.events[i].length === 0) {
            details.push(`slack.events[${i}] must be a non-empty string`);
          }
        }
      }
    }
  }

  // webhook_out
  if (cfg.webhook_out !== undefined) {
    if (
      typeof cfg.webhook_out !== 'object' ||
      cfg.webhook_out === null ||
      Array.isArray(cfg.webhook_out)
    ) {
      details.push('webhook_out must be an object');
    } else {
      const wo = cfg.webhook_out;
      if (wo.enabled !== undefined && typeof wo.enabled !== 'boolean') {
        details.push('webhook_out.enabled must be a boolean');
      }
      if (wo.endpoints !== undefined) {
        if (!Array.isArray(wo.endpoints)) {
          details.push('webhook_out.endpoints must be an array');
        } else {
          for (let i = 0; i < wo.endpoints.length; i++) {
            const ep = wo.endpoints[i];
            const pfx = `webhook_out.endpoints[${i}]`;
            if (typeof ep !== 'object' || ep === null || Array.isArray(ep)) {
              details.push(`${pfx} must be an object`);
              continue;
            }
            if (
              ep.url === undefined ||
              typeof ep.url !== 'string' ||
              ep.url.trim().length === 0
            ) {
              details.push(`${pfx}.url must be a non-empty string`);
            } else {
              try {
                const parsed = new URL(ep.url);
                if (
                  parsed.protocol !== 'http:' &&
                  parsed.protocol !== 'https:'
                ) {
                  details.push(`${pfx}.url must use http or https protocol`);
                }
              } catch {
                details.push(`${pfx}.url is not a valid URL`);
              }
            }
            if (ep.format !== undefined) {
              if (!VALID_WEBHOOK_OUT_FORMATS.includes(ep.format)) {
                details.push(
                  `${pfx}.format must be one of: ${VALID_WEBHOOK_OUT_FORMATS.join(', ')}`,
                );
              }
            }
            if (ep.headers !== undefined) {
              if (
                typeof ep.headers !== 'object' ||
                ep.headers === null ||
                Array.isArray(ep.headers)
              ) {
                details.push(`${pfx}.headers must be an object`);
              }
            }
            if (ep.events !== undefined && !Array.isArray(ep.events)) {
              details.push(`${pfx}.events must be an array`);
            } else if (Array.isArray(ep.events)) {
              for (let j = 0; j < ep.events.length; j++) {
                if (
                  typeof ep.events[j] !== 'string' ||
                  ep.events[j].length === 0
                ) {
                  details.push(
                    `${pfx}.events[${j}] must be a non-empty string`,
                  );
                }
              }
            }
          }
        }
      }
    }
  }

  return details.length ? { valid: false, details } : { valid: true };
}
