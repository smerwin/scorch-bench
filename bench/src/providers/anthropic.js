'use strict';

// Claude via the official SDK. Server-side refusal fallbacks are deliberately
// left off: they would hand the turn to a different model and the result
// would be credited to the wrong one.
const sdk = require('@anthropic-ai/sdk');

const Anthropic = sdk.default || sdk;

function anthropicProvider({ model, effort, thinking = 'adaptive', maxTokens = 64000, client = new Anthropic({ maxRetries: 6 }) }) {
  return {
    describe: { provider: 'anthropic', model, effort: effort || null, thinking },
    createConversation({ system, tools }) {
      // Eager streaming skips server-side validation of tool inputs; the
      // harness validates every call itself (and the game server does too).
      const toolDefs = tools.map((t) => ({ ...t, eager_input_streaming: true }));
      const messages = [];
      return {
        async send({ toolResults = [], text }) {
          const content = toolResults.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.text, ...(r.isError ? { is_error: true } : {}) }));
          if (text) content.push({ type: 'text', text });
          // A failed request leaves a trailing user turn; extend it rather than
          // sending two user turns in a row.
          const last = messages[messages.length - 1];
          if (last && last.role === 'user') last.content.push(...content);
          else messages.push({ role: 'user', content });

          const params = { model, max_tokens: maxTokens, system, tools: toolDefs, messages, cache_control: { type: 'ephemeral' } };
          if (thinking === 'adaptive') params.thinking = { type: 'adaptive' };
          if (effort) params.output_config = { effort };

          const t0 = Date.now();
          let msg;
          for (let attempt = 0; ; attempt++) {
            try {
              msg = await client.messages.stream(params).finalMessage();
              break;
            } catch (err) {
              // Only an unparseable streamed tool input is retried here; API
              // errors were already retried by the client.
              if (err instanceof Anthropic.APIError || attempt >= 2) throw err;
            }
          }
          if (msg.content.length) messages.push({ role: 'assistant', content: msg.content });
          return {
            calls: msg.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, input: b.input })),
            stop: msg.stop_reason,
            usage: {
              input: msg.usage.input_tokens || 0,
              output: msg.usage.output_tokens || 0,
              cacheRead: msg.usage.cache_read_input_tokens || 0,
              cacheWrite: msg.usage.cache_creation_input_tokens || 0,
            },
            ms: Date.now() - t0,
          };
        },
      };
    },
  };
}

module.exports = { anthropicProvider };
