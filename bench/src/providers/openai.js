'use strict';

// Any OpenAI-compatible Chat Completions endpoint: OpenAI, OpenRouter, vLLM,
// Ollama, and so on. Provider-specific options (reasoning effort, token
// limits) go in `extra`, which is merged into every request body.
const STOPS = { tool_calls: 'tool_use', stop: 'end_turn', length: 'max_tokens', content_filter: 'refusal' };

async function post(url, key, body) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    } catch (err) {
      if (attempt >= 6) throw err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    if (res.ok) return res.json();
    const text = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 6) {
      const after = Number(res.headers.get('retry-after'));
      await new Promise((r) => setTimeout(r, (after > 0 ? after : 2 ** attempt) * 1000));
      continue;
    }
    throw new Error(`${res.status} from ${url}: ${text.slice(0, 500)}`);
  }
}

function openaiProvider({ model, baseUrl = 'https://api.openai.com/v1', apiKeyEnv = 'OPENAI_API_KEY', extra = {} }) {
  const key = process.env[apiKeyEnv];
  if (!key) throw new Error(`${apiKeyEnv} is not set`);
  const url = baseUrl.replace(/\/$/, '') + '/chat/completions';
  return {
    describe: { provider: 'openai-compatible', model, baseUrl, extra },
    createConversation({ system, tools }) {
      const toolDefs = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
      const messages = [{ role: 'system', content: system }];
      return {
        async send({ toolResults = [], text }) {
          for (const r of toolResults) messages.push({ role: 'tool', tool_call_id: r.id, content: r.isError ? `ERROR: ${r.text}` : r.text });
          if (text) messages.push({ role: 'user', content: text });
          const t0 = Date.now();
          const res = await post(url, key, { model, messages, tools: toolDefs, tool_choice: 'auto', ...extra });
          const choice = res.choices[0];
          const m = choice.message;
          const toolCalls = m.tool_calls || [];
          messages.push({ role: 'assistant', content: m.content ?? null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
          return {
            calls: toolCalls.map((tc) => {
              try {
                return { id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments || '{}') };
              } catch {
                return { id: tc.id, name: tc.function.name, input: null, error: 'tool arguments were not valid JSON' };
              }
            }),
            stop: STOPS[choice.finish_reason] || choice.finish_reason,
            usage: {
              input: res.usage?.prompt_tokens || 0,
              output: res.usage?.completion_tokens || 0,
              cacheRead: res.usage?.prompt_tokens_details?.cached_tokens || 0,
              cacheWrite: 0,
            },
            ms: Date.now() - t0,
          };
        },
      };
    },
  };
}

module.exports = { openaiProvider };
