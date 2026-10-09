# Claude results (Claude Code subagents, reasoning track)

Run on 2026-10-09 against a local arena, seed 17 only: 8 matches per model (7 duels and 1 four-player free-for-all), 3 rounds each.

Each model was played by Claude Code subagents through the `relay` provider, one fresh subagent per round. The harness, prompt, state messages, tools and scoring are the same as for any other provider. Each model was requested with the Agent tool's model alias (`fable`, `opus`, `sonnet`, `haiku`); the runtime can fall back to another model, so the serving model isn't verified per turn.

| Model | Track | Matches | Win rate (95% CI) | vs Moron | vs Shooter | vs Poolshark | vs Tosser | vs Chooser | vs Spoiler | vs Cyborg | FFA rank | Hit rate | Dmg/shot | Forced passes | Out tok/turn | s/turn |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-haiku-5-5-subagent | reasoning | 8 | 100% (68%–100%) | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 1.0 | 52% | 25.3 | 0% | 0 | 14.3 |
| claude-fable-5-1-subagent | reasoning | 8 | 88% (53%–98%) | 100% | 100% | 0% | 100% | 100% | 100% | 100% | 1.0 | 83% | 48.1 | 0% | 0 | 61.8 |
| claude-sonnet-5-5-subagent | reasoning | 8 | 88% (53%–98%) | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 2.0 | 40% | 20.0 | 0% | 0 | 14.5 |
| claude-opus-5-5-subagent | reasoning | 8 | 75% (41%–93%) | 100% | 100% | 0% | 100% | 100% | 100% | 100% | 2.0 | 70% | 47.3 | 0% | 0 | 17.5 |
| naive-ballistic | reasoning | 40 | 13% (5%–26%) | 80% | 20% | 0% | 0% | 0% | 0% | 0% | 4.0 | 6% | 1.3 | 0% | 0 | 0.0 |

Engine 91afae740461; suite scorch-bench v1 436532839f48.

## How to read this

- **Small sample.** Eight matches per model gives wide intervals: a 100% and a 75% win rate overlap. One seed means every model faced the same eight battlefields, so these say little about other maps.
- **Not comparable to API runs.** Subagents play inside Claude Code, with its system prompt and its own thinking settings, rather than through the Anthropic API with the harness's settings. Label and compare them separately.
- **No token counts.** The relay doesn't see token usage, so "Out tok/turn" is 0. "s/turn" is wall-clock time per decision, including subagent overhead.
- **What separated the models.** All four beat every bot except Poolshark, which beat Fable and Opus. Opus and Sonnet placed second in the free-for-all; Fable and Haiku won it. Fable and Opus hit far more often (83% and 70% of shots) than Sonnet and Haiku (40% and 52%), which won by volume of fire.

## No-code rule compliance

The reasoning track forbids computing shots with code. The subagents had a shell, so compliance was checked afterwards from their transcripts: 736 shell commands across 96 rounds.

- 735 were plain `relay-cli.js` calls.
- One Opus round (duel vs Cyborg, round 2) wrapped the relay in a shell loop with `grep`, `tr` and `head` to shorten its output. It computed nothing.
- No subagent read the engine source or any other file, or ran a solver.
- A few Haiku rounds made stray calls to session tools (a status lookup, empty or failed messages, one task suggestion). None carried game information or affected a match.
