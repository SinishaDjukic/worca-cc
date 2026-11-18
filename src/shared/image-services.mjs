// src/shared/image-services.mjs
// Design pictures: the image services worca can call (SPEC §9), the shapes a
// picture can take and the bounds the server, the build side and the browser
// share. Pure data and two small helpers: no imports, no module state.

/** The longest description a picture ask may carry, in characters. */
export const IMAGES_MAX_PROMPT = 4000;

/** The shapes a picture can take, in the order the lead names them. */
export const IMAGE_SHAPES = Object.freeze(['wide', 'tall', 'square']);

/** A shape as a `size` (services with sizeMode 'size'). */
export const IMAGE_SIZE = Object.freeze({ wide: '1536x1024', tall: '1024x1536', square: '1024x1024' });

/** A shape as an `aspect_ratio` (services with sizeMode 'aspect'). */
export const IMAGE_ASPECT = Object.freeze({ wide: '3:2', tall: '2:3', square: '1:1' });

const preset = (p) => Object.freeze({ ...p, models: Object.freeze([...(p.models || [])]), extra: Object.freeze({ ...p.extra }) });

/**
 * The presets, in the order the Providers page lists them. Picking one fills the
 * address, the model and the price; "none" is '' for an address or a model and
 * null for a price. `extra` is sent with every ask; `responseFormat` is sent as
 * `response_format` only when it is not null. `models` is the service's current
 * image-model ids, the default `model` first when there is one; `other` has none.
 * Read on 2026-11-17 from https://developers.openai.com/api/docs/models,
 * https://docs.x.ai/developers/models (aliases left out) and
 * https://openrouter.ai/api/v1/models (image output on the images endpoint; no
 * routers, previews of a listed model or models with an expiration date).
 */
export const IMAGE_SERVICES = Object.freeze({
  openai: preset({ id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', path: '/images/generations', model: 'gpt-image-2.6-flare', models: ['gpt-image-2.6-flare', 'gpt-image-2.6-sunburst', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare'], price: 0.04, sizeMode: 'size', extra: { quality: 'medium' }, responseFormat: null }),
  xai: preset({ id: 'xai', label: 'xAI', baseUrl: 'https://api.x.ai/v1', path: '/images/generations', model: 'grok-imagine-image-2.0', models: ['grok-imagine-image-2.0', 'grok-imagine-image'], price: 0.04, sizeMode: 'aspect', extra: {}, responseFormat: 'b64_json' }),
  openrouter: preset({ id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', path: '/images', model: '', models: ['google/gemini-nano-banana-2.1', 'google/gemini-3.1-flash-lite-image', 'google/gemini-3.1-flash-image', 'google/gemini-3-pro-image', 'openai/gpt-5.4-image-2', 'google/gemini-2.5-flash-image'], price: 0.05, sizeMode: 'size', extra: {}, responseFormat: null }),
  other: preset({ id: 'other', label: 'Other (OpenAI-compatible)', baseUrl: '', path: '/images/generations', model: '', models: [], price: null, sizeMode: 'size', extra: {}, responseFormat: null }),
});

/** The whole seconds a picture took (the n of "Made in n s"), never below 1. */
export function pictureSeconds(ms) {
  return Math.max(1, Math.round(ms / 1000));
}

/** An address's origin (scheme, host and port); '' for an empty or bad address. Never throws. */
export function originOf(url) {
  try { return new URL(String(url)).origin; } catch { return ''; }
}
