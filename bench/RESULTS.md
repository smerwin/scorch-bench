# Scorch bench results

Run on 2026-10-09 against a local arena: engine `91afae740461`, suite scorch-bench v1 `436532839f48`, reasoning track (no code execution).

## All models on seed 17

Every model below played the same eight seed-17 matches: seven duels, one against each bot, and one four-player free-for-all. This is the like-for-like comparison. The baseline row is the scripted flat-ground solver, which ignores wind.

| Model | Track | Matches | Win rate (95% CI) | FFA rank | Hit rate | Dmg/shot | Forced passes|
|---|---|---|---|---|---|---|---
| claude-haiku-5-5-subagent | reasoning | 8 | 100% (68%–100%) | 1.0 | 52% | 25.3 | 0%|
| deepseek/deepseek-v4-pro | reasoning | 8 | 100% (68%–100%) | 1.0 | 31% | 11.6 | 0%|
| claude-fable-5-1-subagent | reasoning | 8 | 88% (53%–98%) | 1.0 | 83% | 48.1 | 0%|
| claude-sonnet-5-5-subagent | reasoning | 8 | 88% (53%–98%) | 2.0 | 40% | 20.0 | 0%|
| moonshotai/kimi-k3 | reasoning | 7 (+1 unclean) | 86% (49%–97%) | 2.0 | 31% | 16.3 | 0%|
| claude-opus-5-5-subagent | reasoning | 8 | 75% (41%–93%) | 2.0 | 70% | 47.3 | 0%|
| deepseek/deepseek-v4-flash | reasoning | 8 | 50% (22%–78%) | 3.0 | 31% | 10.4 | 0%|
| openai/gpt-oss-120b | reasoning | 8 | 38% (14%–69%) | 3.0 | 12% | 4.4 | 0%|
| naive-ballistic | reasoning | 8 | 25% (7%–59%) | 4.0 | 6% | 1.0 | 0%|
| google/gemma-4-31b-it | reasoning | 8 | 13% (2%–47%) | 4.0 | 9% | 3.4 | 0%|
| nvidia/nemotron-3-ultra-550b-a55b | reasoning | 8 | 13% (2%–47%) | 4.0 | 8% | 4.1 | 0%|
| qwen/qwen3.5-397b-a17b | reasoning | 8 (+1 unclean) | 13% (2%–47%) | 4.0 | 6% | 1.4 | 0%|
| qwen/qwen3.6-35b-a3b | reasoning | 8 | 13% (2%–47%) | 4.0 | 13% | 4.0 | 0%|

- **How the two groups were run.** Claude models were played by Claude Code subagents through the `relay` provider; see `RESULTS-claude.md`. Open-weight models were called through OpenRouter's API with default settings; see the section below. The prompt, tools, state messages and scoring are identical. The calling setup is not, so treat the Claude rows and the open-weight rows as two related experiments rather than one leaderboard.
- **Small samples.** Eight matches per model gives wide intervals. The top six (four Claude models, DeepSeek V4 Pro and Kimi K3) cannot be separated statistically, and neither can the bottom five.
- **Seed 17 flatters some models.** DeepSeek V4 Pro won 8 of 8 here but 5 of 8 on seed 4242. DeepSeek V4 Flash and gpt-oss-120b also dropped on the second seed. Results for the models that played two seeds are in the section below.
- **Aim separates the top group.** Claude models hit 40% to 83% of their shots; the best open-weight models hit about 31%. Hit rate is the clearest gap in the data, more so than win rate.
- **Missing:** GLM-5.3 forfeited its pilot match on timeouts and has no results. Kimi K3's Chooser duel and one Qwen3.5-397B free-for-all hit provider errors and are excluded as unclean.

## Open-weight models via OpenRouter

- **Date:** 2026-10-09
- **Engine** `91afae740461`; **suite** scorch-bench v1 `436532839f48`; harness 1.0.0; local arena server.
- **Provider:** OpenRouter, Chat Completions, default settings (no `--extra`).
- **Total spent:** $41.45 of a $45 cap (OpenRouter `usage` went from $0.00 to $41.45). Per-model costs below are exact usage deltas, read before and after each serial run; $0.04 fell between reads and is unattributed.

| Model | Seeds | Clean matches | Cost (USD) | Notes |
|---|---|---|---|---|
| deepseek/deepseek-v4-pro | 17, 4242 | 16 | 9.73 | |
| moonshotai/kimi-k3 | 17 | 7 (+1 unclean) | 12.93 | `duel-chooser-17` hit one truncated provider response, so the harness marks it unclean. Kimi won that match, but the table leaves it out. One replay was killed by the cost guard ($1.68, unfinished). |
| deepseek/deepseek-v4-flash | 17, 4242 | 16 | 2.21 | |
| openai/gpt-oss-120b | 17, 4242 | 16 | 1.22 | |
| google/gemma-4-31b-it | 17, 4242 | 16 | 1.82 | Almost no reasoning: about 30 output tokens per turn. |
| nvidia/nemotron-3-ultra-550b-a55b | 17 | 8 | 2.52 | |
| qwen/qwen3.5-397b-a17b | 17 | 8 (+1 unclean) | 8.82 | The first `ffa1-17` got four 200 responses with no `choices` in round 3, so it was replayed cleanly. The old unclean record stays in the file. |
| qwen/qwen3.6-35b-a3b | 17 | 8 | 1.83 | |
| z-ai/glm-5.3 | — | 0 | 0.33 | **Failed.** In the pilot (`duel-cyborg-17`) it missed the 600 s move deadline three times in a row and forfeited in round 1. The harness then hung on a request and was killed, so no match line was written. Not retried. |
| naive-ballistic (scripted baseline) | all 5 | 40 | 0 | |

### Reading the results

- **Two clear tiers.** DeepSeek V4 Pro (81% over 16 matches, 95% CI 57–93%) and Kimi K3 (86% over 7, CI 49–97%) beat every bot at least once, Cyborg included. DeepSeek V4 Pro also won the seed-17 FFA outright. Hit rate was about 31% for both. Every other model sits at or near the no-LLM baseline.
- **Middle:** DeepSeek V4 Flash (44%, CI 23–67%) reliably beats the weak bots and sometimes a mid-tier one, but not Chooser or Cyborg. gpt-oss-120b (25%) mostly beats only Moron and Shooter.
- **Baseline-level:** Gemma 4 31B (2 of 16), Nemotron 3 Ultra, Qwen3.5-397B and Qwen3.6-35B (1 of 8 each) won only against Moron or Shooter. The scripted flat-ground solver (no wind) won 2 of 8 on seed 17 and 0 of 8 on seed 4242.
- **Caveat:** these are tiny samples, one or two seeds (8–16 matches) per model, and the confidence intervals overlap heavily everywhere except at the top. Kimi vs DeepSeek V4 Pro is not separable. Neither is anything in the bottom group. Baseline numbers cover all 5 seeds, the models only seeds 17 (+4242). Match length, and so cost, varies a lot by opponent: a pilot against Cyborg underestimated per-match cost by up to 3×.
- Results from the Claude subagent runs are in `RESULTS-claude.md`; this table leaves them out.

| Model | Track | Matches | Win rate (95% CI) | vs Moron | vs Shooter | vs Poolshark | vs Tosser | vs Chooser | vs Spoiler | vs Cyborg | FFA rank | Hit rate | Dmg/shot | Forced passes | Out tok/turn | s/turn |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| moonshotai/kimi-k3 | reasoning | 7 (+1 unclean) | 86% (49%–97%) | 100% | 100% | 100% | 100% | – | 100% | 100% | 2.0 | 31% | 16.3 | 0% | 2020 | 22.9 |
| deepseek/deepseek-v4-pro | reasoning | 16 | 81% (57%–93%) | 100% | 100% | 50% | 100% | 100% | 50% | 50% | 1.0 | 31% | 11.7 | 0% | 2205 | 22.6 |
| deepseek/deepseek-v4-flash | reasoning | 16 | 44% (23%–67%) | 100% | 100% | 50% | 50% | 0% | 50% | 0% | 3.0 | 24% | 8.3 | 0% | 4678 | 42.2 |
| openai/gpt-oss-120b | reasoning | 16 | 25% (10%–49%) | 100% | 50% | 0% | 50% | 0% | 0% | 0% | 3.5 | 9% | 3.1 | 0% | 1129 | 38.3 |
| google/gemma-4-31b-it | reasoning | 16 | 13% (3%–36%) | 100% | 0% | 0% | 0% | 0% | 0% | 0% | 4.0 | 6% | 2.2 | 0% | 29 | 3.8 |
| naive-ballistic | reasoning | 40 | 13% (5%–26%) | 80% | 20% | 0% | 0% | 0% | 0% | 0% | 4.0 | 6% | 1.3 | 0% | 0 | 0.0 |
| nvidia/nemotron-3-ultra-550b-a55b | reasoning | 8 | 13% (2%–47%) | 100% | 0% | 0% | 0% | 0% | 0% | 0% | 4.0 | 8% | 4.1 | 0% | 992 | 13.7 |
| qwen/qwen3.5-397b-a17b | reasoning | 8 (+1 unclean) | 13% (2%–47%) | 0% | 100% | 0% | 0% | 0% | 0% | 0% | 4.0 | 6% | 1.4 | 0% | 804 | 12.6 |
| qwen/qwen3.6-35b-a3b | reasoning | 8 | 13% (2%–47%) | 100% | 0% | 0% | 0% | 0% | 0% | 0% | 4.0 | 13% | 4.0 | 0% | 1212 | 12.9 |

Engine 91afae740461; suite scorch-bench v1 436532839f48.
