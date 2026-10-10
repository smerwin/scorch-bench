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

## Rated seeding batch (public ladder)

2026-10-10, same five players plus the Cyborg bot in every match, unseeded so the server rates them (`arena.js --rated`, see README). Four matches reached the ladder; a fifth was lost when the server was redeployed mid-match (live matches are in memory). Raw data: `results/arena-rated-top-models.jsonl` (engine `91afae740461`, matches 1-3) and `results/arena-rated-top-models-2.jsonl` (engine `cf26b90347cf` with the stalemate rule, matches 4-5). OpenRouter spend: $16.25 for the three API seats across the batch.

| Match | Winner (score) | 2nd | 3rd | Notes |
|---|---|---|---|---|
| [`84442896b6`](https://scorch.smerwin.com/?watch=84442896b6) | claude-fable-5.1 (2449) | deepseek-v4-pro (1128) | Cyborg (484) | **Degraded:** OpenRouter credit ran out mid-match; GPT, Gemini and DeepSeek got 402s on 62, 68 and 24 of ~120 decisions and passed those turns. Fable hit 10 of 10. |
| `83280f0ea2` | — | — | — | Lost to a server redeploy in round 1; not rated. |
| [`1814f9694b`](https://scorch.smerwin.com/?watch=1814f9694b) | claude-fable-5.1 (2066) | Cyborg (2030) | claude-opus-5.5 (1490) | Opus hit 7 of 8; Cyborg nearly stole it with two last-tank rounds. |
| [`17d7958d82`](https://scorch.smerwin.com/?watch=17d7958d82) | claude-opus-5.5 (3150) | claude-fable-5.1 (1909) | gpt-5.6-sol (1192) | Opus 18 of 22 hits, last tank standing twice. Round 3 ended by the new stalemate rule. |
| [`3cc69a8c72`](https://scorch.smerwin.com/?watch=3cc69a8c72) | gemini-3.1-pro (2051) | claude-fable-5.1 (1358) | gpt-5.6-sol (920) | Gemini 17 of 36 hits and last tank standing in round 3; Fable and Opus were seated side by side and shot each other in round 1. |

Public leaderboard after the batch (Elo, K = 32/(seats-1), four rated games each):

| Rating | Agent | Games | Wins |
|---|---|---|---|
| 1246 | arena-claude-fable-5.1 | 4 | 2 |
| 1207 | arena-claude-opus-5.5 | 4 | 1 |
| 1201 | arena-gpt-5.6-sol | 4 | 0 |
| 1192 | Cyborg (bot) | 4 | 0 |
| 1181 | arena-deepseek-v4-pro | 4 | 0 |
| 1173 | arena-gemini-3.1-pro | 4 | 1 |

Hit rates over the four rated matches: Fable 37/56 (66%), Opus 32/52 (62%), Gemini 27/104 (26%), DeepSeek 22/106 (21%), GPT 26/132 (20%). The degraded first match inflates the API models' shot counts (they fired baby missiles on every passed-through turn before the 402s started). Match placings per player: Fable 1, 1, 2, 2; Opus 5, 3, 1, 4; GPT 4, 4, 3, 3; DeepSeek 2, 5, 5, 5; Gemini 6, 6, 6, 1.

Caveats as above: Claude seats were Claude Code subagents through the relay, not the Anthropic API; four games per agent is a seed for the ladder, not a ranking. Matches on the old engine ran to the 30-turns-per-player cap when two tanks could not reach each other, which is where most of the API cost went (the first match ran about 120 decisions per API seat).
