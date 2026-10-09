# Scorch bench

A benchmark harness for Scorch. It has a model play a fixed, seeded suite of matches against the built-in bots through the arena's HTTP API, then scores the results. Every model gets the same rules (`../AGENTS.md`), the same prompt, the same tools and the same scenarios, so results are comparable across models and reproducible.

## The suite

`suite.json` pins the match settings and lists the scenarios. For each of 5 seeds there are:

- **7 duels**, one against each bot, from `moron` (weakest) to `cyborg` (strongest);
- **1 free-for-all** against `poolshark`, `chooser` and `cyborg`.

That's 40 matches, each 3 rounds. A seed fixes the terrain, walls, wind, gusts, turn order and bot behaviour, so a given model sees exactly the same battlefields as every other model, and the same moves replay the same match. Seeded matches are unrated in the arena, so benchmark runs never touch the public Elo.

Changing `suite.json` changes its hash, which is recorded with every result. The report warns when results from different suites or engine versions are put side by side.

## Tracks

- **`reasoning`**: the model has only the `fire` and `shop` action tools, so it has to estimate shots without running anything.
- **`tools`**: the model also gets `run_javascript`, which runs code in a child Node process under `node --permission`, with an empty environment, a 10 s limit and a 256 MB heap. That process has no network, file, child-process or worker access. The latest state is in the global `STATE`. The rules document the physics exactly, so a model can write its own trajectory solver here. The harness refuses to run this track if the lock-down self-check fails, and it needs Node 25 or later.

Report the two tracks separately. The gap between them is a result in its own right.

## Running

Start an arena server locally. Results don't depend on which server runs the match (the engine hash is recorded), and a local one keeps runs off production:

```bash
cd projects/scorch/server && npm start
```

Then, from `projects/scorch/bench`:

```bash
npm install
node run.js --provider anthropic --model claude-opus-5-5 --effort high
node run.js --provider anthropic --model claude-opus-5-5 --effort high --track tools
node run.js --provider openai --model gpt-5 --extra '{"reasoning_effort":"high"}'
node run.js --provider openai --base-url https://openrouter.ai/api/v1 --api-key-env OPENROUTER_API_KEY --model <vendor>/<model>
node run.js --provider scripted        # no-LLM baseline: flat-ground ballistics, no wind
node report.js                         # Markdown table of every results/*.jsonl
```

- `anthropic` uses the official SDK and reads `ANTHROPIC_API_KEY`. Adaptive thinking is on unless you pass `--thinking off` (Haiku 4.5 needs that). Server-side refusal fallbacks are deliberately left off, because they would let a different model play the turn.
- `openai` covers any OpenAI-compatible Chat Completions endpoint. Provider-specific options such as reasoning effort or token limits go in `--extra`.
- `--seeds 1` runs one seed (8 matches) for a quick check, and `--only duel-cyborg` runs matching scenarios.
- Up to 3 matches run at once, the arena's per-agent limit. The harness also paces its own requests to stay under the arena's 240 requests/minute.

Results go to `results/<model>-<track>[-<effort>].jsonl`: one metadata line (harness version, suite hash, engine hash, provider settings), then one line per match. Rerunning the same command resumes: finished scenarios are skipped, and matches spoiled by a provider error (`clean: false`) are played again. The arena key for each agent name is kept in `.keys.json`.

## What's measured

Per match, from the final standings and the public match log:

| Metric | Meaning |
|---|---|
| Win rate | 1 for an outright win, 0.5 for a share of first place, else 0; reported with a 95% Wilson interval |
| vs *bot* | Win rate in the duels against that bot |
| FFA rank | Mean finishing place in the free-for-alls (1 is best, 4 is last) |
| Hit rate | Share of the model's shots that damaged or killed an enemy |
| Dmg/shot | Enemy damage dealt per shot fired |
| Forced passes | Share of decisions where the harness had to pass for the model: no action after nudges, 3 rejected actions, a refusal, or missing the 600 s deadline |
| Out tok/turn, s/turn | Output tokens and model latency per decision |

Damage is attributed exactly. A tank's score rises by the damage it deals to others plus 250 per kill, and the round winner gets 500 at the end, so the score change across a volley is that volley's damage.

How a decision works: the harness shows the model its state and waits for an action tool call. If there's no call, the model is nudged; if the server rejects an action, the model sees the error and can retry. Each round is one conversation, and the next round starts a fresh one with the scores so far. Within a decision, the reasoning track allows 4 model calls and the tools track allows 16 (sandbox runs count toward that).

## Tests

```bash
npm test
```

The tests cover the sandbox lock-down, shot attribution, seeded replays through the harness, recovery from a model that stalls or sends bad moves, the tools track, and the shape of the requests the Claude adapter sends. None of them call a real model.
