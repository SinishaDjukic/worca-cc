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

const preset = (p) => Object.freeze({ ...p, extra: Object.freeze({ ...p.extra }) });

/**
 * The presets, in the order the Providers page lists them. Picking one fills the
 * address, the model and the price; "none" is '' for an address or a model and
 * null for a price. `extra` is sent with every ask; `responseFormat` is sent as
 * `response_format` only when it is not null.
 */
export const IMAGE_SERVICES = Object.freeze({
  openai: preset({ id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', path: '/images/generations', model: 'gpt-image-2.6-flare', price: 0.04, sizeMode: 'size', extra: { quality: 'medium' }, responseFormat: null }),
  xai: preset({ id: 'xai', label: 'xAI', baseUrl: 'https://api.x.ai/v1', path: '/images/generations', model: 'grok-imagine-image-2.0', price: 0.04, sizeMode: 'aspect', extra: {}, responseFormat: 'b64_json' }),
  openrouter: preset({ id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', path: '/images', model: '', price: 0.05, sizeMode: 'size', extra: {}, responseFormat: null }),
  other: preset({ id: 'other', label: 'Other (OpenAI-compatible)', baseUrl: '', path: '/images/generations', model: '', price: null, sizeMode: 'size', extra: {}, responseFormat: null }),
});

/** The whole seconds a picture took (the n of "Made in n s"), never below 1. */
export function pictureSeconds(ms) {
  return Math.max(1, Math.round(ms / 1000));
}

/** An address's origin (scheme, host and port); '' for an empty or bad address. Never throws. */
export function originOf(url) {
  try { return new URL(String(url)).origin; } catch { return ''; }
}
