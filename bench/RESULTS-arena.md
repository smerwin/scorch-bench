# Arena: top models head to head

One five-player match on the public arena (`https://scorch.smerwin.com`), 2026-10-10, seed 17, reasoning track (no code execution), suite settings (3 rounds, simultaneous turns, gusts 0.25, 600 s deadlines). Match `dc359f400b`; replay at `https://scorch.smerwin.com/?watch=dc359f400b`. Seeded, so unrated. Raw data: `results/arena-top-models-seed17.jsonl`.

## Players

| Seat | Player | Served by |
|---|---|---|
| 0 | claude-fable-5.1 | Claude Code subagent (`fable` alias) via the `relay` provider, one per round |
| 1 | claude-opus-5.5 | Claude Code subagent (`opus` alias) via the `relay` provider, one per round |
| 2 | gpt-5.6-sol | OpenRouter `openai/gpt-5.6-sol`, default settings |
| 3 | gemini-3.1-pro | OpenRouter `google/gemini-3.1-pro-preview`, default settings |
| 4 | deepseek-v4-pro | OpenRouter `deepseek/deepseek-v4-pro`, default settings |

Left out: `x-ai/grok-4.7` spent 236 s and 27k output tokens on a one-turn smoke test without calling the `fire` tool, which would have blown the move deadline and the budget; `moonshotai/kimi-k3` was skipped for budget ($8.5 of OpenRouter credit was left). OpenRouter spend for the match: $1.12 (plus $0.30 of smoke tests). Subagent seats cost no API credit and are not the Anthropic-API configuration; see `RESULTS-claude.md` for that caveat.

## Final standings

| Rank | Player | Score | Round wins | Kills | Cash left |
|---|---|---|---|---|---|
| 1 | claude-fable-5.1 | 3091 | 2 | 6 | $30,581 |
| 2 | gemini-3.1-pro | 996 | 0 | 3 | $5,206 |
| 3 | claude-opus-5.5 | 478 | 0 | 1 | $5,469 |
| 4 | gpt-5.6-sol | 300 | 0 | 0 | $3,953 |
| 5 | deepseek-v4-pro | 284 | 0 | 1 | $8,096 |

## Harness report

| Player | Track | Rating | Matches | Win rate (95% CI) | Mean rank | Hit rate | Dmg/shot | Forced passes | Out tok/turn | s/turn |
|---|---|---|---|---|---|---|---|---|---|---|
| claude-fable-5.1 | reasoning | 1662 | 1 | 100% (21%–100%) | 1.00 | 12% | 7.7 | 0% | 0 | 18.1 |
| gemini-3.1-pro | reasoning | 1578 | 1 | 0% (0%–79%) | 2.00 | 80% | 49.2 | 0% | 6511 | 58.5 |
| claude-opus-5.5 | reasoning | 1500 | 1 | 0% (0%–79%) | 3.00 | 8% | 3.1 | 0% | 0 | 8.7 |
| gpt-5.6-sol | reasoning | 1422 | 1 | 0% (0%–79%) | 4.00 | 57% | 42.9 | 0% | 306 | 7.0 |
| deepseek-v4-pro | reasoning | 1338 | 1 | 0% (0%–79%) | 5.00 | 22% | 3.8 | 0% | 3668 | 57.9 |

Head to head (row beat column; ties count half):

|  | claude-fable-5.1 | gemini-3.1-pro | claude-opus-5.5 | gpt-5.6-sol | deepseek-v4-pro |
|---|---|---|---|---|---|
| claude-fable-5.1 | — | 100% (1) | 100% (1) | 100% (1) | 100% (1) |
| gemini-3.1-pro | 0% (1) | — | 100% (1) | 100% (1) | 100% (1) |
| claude-opus-5.5 | 0% (1) | 0% (1) | — | 100% (1) | 100% (1) |
| gpt-5.6-sol | 0% (1) | 0% (1) | 0% (1) | — | 100% (1) |
| deepseek-v4-pro | 0% (1) | 0% (1) | 0% (1) | 0% (1) | — |

Engine 91afae740461; suite scorch-bench v1 436532839f48; seating rotations: 1.
Rating: Bradley-Terry over every pairwise result, Elo scale (1500 = average), one virtual draw per pair.

Subagent seats report 0 output tokens because the relay does not see usage; their s/turn is wall-clock including subagent overhead.

## How it went

- **Round 1 (72 turns).** Fable killed Gemini on turn 1 and GPT on turn 2, each with a direct baby-nuke hit (100 damage), after GPT's lasers had cut it to 25 hp. Opus hit DeepSeek with every shot it took (two baby nukes, three missiles) and killed it, then blew itself to 44 hp with a baby nuke that clipped the cliff next to it. With both survivors at under 50 hp, max power was capped near 450 and neither could reach the other across 300 px into the wind: 60-odd turns of free baby missiles with no damage until the round ended with both alive. This stalemate is why both Claude hit rates are low (9 of 77 and 6 of 73).
- **Round 2 (3 turns).** Gemini killed Opus and DeepSeek with funky bombs on turn 1 and 2 (95 and 100 damage). Fable took 70 from the opening volley, healed with seven batteries, then killed GPT with a missile plus baby nuke and Gemini with a baby nuke lobbed over the central ridge, taking the round as last tank standing.
- **Round 3 (3 turns).** Fable, firing from the bottom of a pit behind a force shield, killed Opus with its first baby nuke; Gemini's nuke and Opus's baby nuke (93 damage) in the same volley left only GPT, which Fable finished with two more baby nukes. Fable took no damage.
- **Weapon choices.** GPT fired only lasers (4 hits of 7, 75 damage each) and scored no kill. Gemini bought funky bombs, a MIRV and a nuke and hit 4 of 5 shots. DeepSeek dealt 34 damage over 9 shots. Opus and Fable both leaned on baby nukes and batteries; Fable added a force shield in round 3.
- **Sample size.** One match, one seed, one seating. The Bradley-Terry ratings above are from four pairwise results per player plus a virtual draw each, so they are indicative only. Seat 0 (Fable) starts on the left edge of seed 17's map; a full run with `--rotations all` plays every model from every seat.
