// src/core/bridge/translate/schema-keywords.mjs
// Some OpenAI-compatible upstreams compile tool parameter schemas into a decoding
// grammar that knows only part of JSON Schema, and refuse the whole request over
// one validation keyword (OpenRouter's ModelRun on qwen3.8-27b:free: `tool
// "ListAgents" parameter schema: parameter "channel": unsupported schema keyword
// "maxLength"`). The CLI's own tools carry such keywords and worca cannot edit
// them, so the bridge learns the keyword from the refusal, drops it from every
// tool schema, and retries. Validation keywords only narrow what the model may
// send; the CLI still validates every tool call against the full schema.

/** The keyword an upstream names when it refuses a tool schema; null otherwise. */
const UNSUPPORTED_KEYWORD_RE = /unsupported (?:json )?schema keyword[:\s]+["'`]?([A-Za-z$][\w$-]*)/i;
export function unsupportedSchemaKeyword(message) {
  const m = UNSUPPORTED_KEYWORD_RE.exec(String(message ?? ''));
  return m ? m[1] : null;
}

// Where sub-schemas live. A `properties` / `$defs` map holds schemas under
// arbitrary names, so a property NAMED like a keyword is never dropped.
const SCHEMA_MAPS = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'];
const SCHEMA_ONE = ['items', 'additionalProperties', 'additionalItems', 'contains', 'not', 'if', 'then', 'else', 'propertyNames', 'unevaluatedProperties', 'unevaluatedItems'];
const SCHEMA_LIST = ['anyOf', 'oneOf', 'allOf', 'prefixItems'];

/** A copy of `schema` without the `drop` keywords, at every depth. */
export function dropSchemaKeywords(schema, drop) {
  if (Array.isArray(schema)) return schema.map((s) => dropSchemaKeywords(s, drop));
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (drop.has(k)) continue;
    if (SCHEMA_MAPS.includes(k) && v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = Object.fromEntries(Object.entries(v).map(([name, s]) => [name, dropSchemaKeywords(s, drop)]));
    } else if (SCHEMA_ONE.includes(k) || SCHEMA_LIST.includes(k)) {
      out[k] = dropSchemaKeywords(v, drop);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * A translated request body with `drop` removed from every tool's parameter
 * schema: chat/completions (`tools[].function.parameters`) and the Responses API
 * (`tools[].parameters`). Never mutates `body`; a body without tools, or an
 * empty `drop`, comes back as is.
 */
export function withToolSchemaKeywordsDropped(body, drop) {
  if (!body || !Array.isArray(body.tools) || !drop || !drop.size) return body;
  const tools = body.tools.map((t) => {
    if (t && t.function && t.function.parameters) {
      return { ...t, function: { ...t.function, parameters: dropSchemaKeywords(t.function.parameters, drop) } };
    }
    if (t && t.parameters) return { ...t, parameters: dropSchemaKeywords(t.parameters, drop) };
    return t;
  });
  return { ...body, tools };
}
