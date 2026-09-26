// src/core/auto/runnable.mjs
// The models Auto may design with: the ones this install can actually RUN. A bridged model
// whose provider is not set up never is. With Claude Code signed out (a hosted worca that
// reaches models only through OpenRouter or a gateway), a first-party id is not either — and
// neither is "the default model" a stage without one falls back to, since that is the CLI's
// own. So signed out, only endpoint-routed / bridged models are offered and every stage must
// name one. An unknown sign-in state (mock, a probe that could not run) narrows nothing.

/**
 * @param {Array<{id:string, bridged?:string, needsSignIn?:boolean}>} models  listModels() output
 * @param {{auth:'signed-in'|'signed-out'|'unknown', routed:(id:string)=>boolean}} o
 * @returns {{models:Array, requireModel:boolean, note:(string|null)}}
 */
export function autoModelsFor(models, { auth, routed }) {
  const ready = (Array.isArray(models) ? models : []).filter((m) => m && !m.needsSignIn);
  if (auth !== 'signed-out') return { models: ready, requireModel: false, note: null };
  const usable = ready.filter((m) => routed(m.id));
  if (!usable.length) {
    return {
      models: ready, requireModel: false,
      note: "Claude Code isn't signed in and no endpoint or provider model is set up — the run's first-party models will fail; sign in, or add a model under Settings › Providers.",
    };
  }
  return {
    models: usable, requireModel: true,
    note: `Claude Code isn't signed in — Auto designs with the ${usable.length} model${usable.length === 1 ? '' : 's'} routed through an endpoint or provider, and names one on every stage.`,
  };
}
