'use strict';

// Builds a provider from a plain config object, shared by run.js (one model)
// and arena.js (several). Config keys mirror run.js's flags:
//   { provider, model, effort, thinking, baseUrl, apiKeyEnv, extra }
function makeProvider(cfg) {
  const { provider, model } = cfg;
  if (provider === 'anthropic' || provider === 'openai') {
    if (!model) throw new Error(`${provider}: a model is required`);
  }
  if (provider === 'anthropic') {
    return require('./anthropic').anthropicProvider({ model, effort: cfg.effort, thinking: cfg.thinking || 'adaptive' });
  }
  if (provider === 'openai') {
    return require('./openai').openaiProvider({ model, baseUrl: cfg.baseUrl, apiKeyEnv: cfg.apiKeyEnv, extra: cfg.extra || {} });
  }
  if (provider === 'scripted') return require('./scripted').scriptedProvider();
  throw new Error(`provider must be anthropic, openai or scripted (got ${JSON.stringify(provider)})`);
}

// "anthropic:claude-opus-5-5?effort=high&track=tools" -> config object.
// Options go after "?" (query-string style) so model ids may contain ':' or
// '/' and values may be URLs. Kebab-case keys map to camelCase (base-url ->
// baseUrl); `extra` is parsed as JSON.
function parsePlayerSpec(spec) {
  const q = spec.indexOf('?');
  const head = q < 0 ? spec : spec.slice(0, q);
  const first = head.indexOf(':');
  const cfg = { provider: first < 0 ? head : head.slice(0, first) };
  if (first >= 0 && head.slice(first + 1)) cfg.model = head.slice(first + 1);
  if (q >= 0) {
    for (const [k, v] of new URLSearchParams(spec.slice(q + 1))) {
      const key = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      cfg[key] = key === 'extra' ? JSON.parse(v) : v;
    }
  }
  return cfg;
}

module.exports = { makeProvider, parsePlayerSpec };
