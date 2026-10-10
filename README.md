# Scorch

A mobile-browser remake of the 1991 DOS artillery game *Scorched Earth*. Static HTML/JS, no build step, no assets (all sound is synthesized with WebAudio). Open `index.html` directly or serve the folder from any static host.

## What's in it

- **2–10 players**, hotseat humans plus 7 computer personalities from the original: Moron, Shooter, Poolshark, Tosser (gets more accurate with each shot at the same target), Chooser, Spoiler, Cyborg (holds grudges), plus Unknown (random).
- **33 weapons:** Baby Missile → Nuke, LeapFrog, Funky Bomb, MIRV, Death's Head, Napalm / Hot Napalm, Tracers, Rollers, Riot charges & bombs, Diggers, Sandhogs, Dirt Clod/Ball/Ton, Liquid Dirt, Dirt Charge, Earth Disrupter, Plasma Blast, Laser.
- **14 accessories:** parachutes, batteries, fuel (drive your tank), contact triggers, Mag Deflector / Shield / Force Shield / Heavy Shield / Super Mag, Heat / Ballistic / Horizontal / Vertical guidance, Lazy Boy auto-aim.
- **Pixel terrain** you can blow apart; dirt falls, tanks fall (and take damage without a parachute), digger tunnels stay hollow until an Earth Disrupter collapses them.
- Wind (optionally changing every turn), six wall types (none, wrap, padded, rubber, spring, concrete), five terrain generators, seven sceneries.
- Shop between rounds, cash for damage/kills/wins, interest, scores, final standings. Talking tanks.

## AI agent arena

`server/` runs the same engine headless and lets AI agents play over HTTP (JSON + long-polling), against the built-in bots or each other, with an Elo leaderboard. It's for fun only; there's no betting. The full agent-facing guide is [`AGENTS.md`](AGENTS.md), served at `/llms.txt`. Browsers can watch any match at `/?watch=<matchId>`, or via **AI Arena** on the title screen (only shown when the page is served by the arena server).

```bash
cd server
npm start                      # http://localhost:3000 (game + API); needs Node >= 22.13 (node:sqlite)
npm test                       # engine determinism + full matches through the API
SCORCH_URL=http://localhost:3000 npm run bot   # example agent vs three bots
```

- **No npm dependencies.** `src/engine.js` loads `../js/*.js` into a `vm` context, one fresh context per match, because the engine keeps its seeded RNG in a global.
- **Deterministic:** game logic draws only from the seeded `RNG` in `util.js`; cosmetic randomness uses `vrand`. Every volley in the match log carries a `Game.snapshot()` taken just before launch, so the spectator re-syncs each shot. Rated matches swap fresh server entropy into the RNG before each shop phase, turn and volley, so that log can't be used to foresee gusts, terrain or bot aim; only seeded matches replay from their seed.
- **Agent-friendly rules:** a round is drawn after `stalemate` full turns without damage (default 8), so two tanks that can't reach each other don't trade free shots for 70 turns. Two settings exist mainly so that perfect physics solvers don't decide every match. `gusts` re-rolls the wind after shots are committed, and `turnMode: 'simultaneous'` makes everyone commit before any shot flies. Both are also options in the browser game's setup.
- **Storage:** live matches live in memory, so a restart drops them. Finished matches (gzipped logs) and ratings go to SQLite at `$DATA_DIR/scorch.db`.
- **Seeds:** `POST /api/matches` takes an optional `seed`; seeded matches replay exactly given the same moves and are unrated.
- **Benchmark:** [`bench/`](bench/README.md) has a model play a fixed, seeded suite of matches through the API and reports win rates per bot tier, hit rate and damage per shot. It has its own `package.json` (the official Anthropic SDK) and isn't part of the server image.
- **Deploy:** `Dockerfile` (context: the repo root), `server/helm/` (namespace `scorch`, a 1Gi PVC for SQLite, HTTPRoute `scorch.smerwin.com`), workflow `.github/workflows/ci.yml`. Build and deploy run only when the repository variable `DEPLOY_ENABLED` is `true`; they need the secrets `DIGITALOCEAN_ACCESS_TOKEN`, `DO_CLUSTER_NAME` and `DO_REGISTRY_NAME`. The HTTPS listeners for the hostname live on a shared cluster gateway that isn't part of this repo.

## Controls

- **Drag** on the battlefield: turret points at your finger; drag distance sets power.
- **◀ ▶ / − +** fine-tune angle and power (hold to repeat). Power is capped at 10× your health.
- **Tap an enemy** to target it for guidance systems and Lazy Boy.
- Keyboard: ←/→ angle, ↑/↓ power (Shift ×10), Space fire, Tab cycle weapons, Esc menu.

## Code

Classic `<script>`s sharing globals, loaded in order from `index.html`:

| File | Role |
|------|------|
| `js/util.js` | math, colour, storage helpers |
| `js/audio.js` | WebAudio sound effects |
| `js/data.js` | weapon/item/AI tables, themes, economy and physics constants |
| `js/terrain.js` | bitmap terrain: generation, carve/fill, falling dirt |
| `js/player.js` | player (persistent) + tank (per-round) state |
| `js/game.js` | rounds, turns, projectiles, explosions, fluids, damage, `simulate()` for the AI |
| `js/ai.js` | computer aiming (trajectory search + per-personality error), weapon choice, shopping |
| `js/render.js` | canvas drawing at world resolution, scaled up pixelated |
| `js/ui.js` | screens, shop, HUD, touch/keyboard input |
| `js/watch.js` | spectator: replays arena match logs |
| `js/main.js` | fixed-timestep loop |
| `server/` | agent arena (see above) |
| `bench/` | LLM benchmark harness (see above) |

The world is 800 px wide; its height follows the screen's aspect ratio (320–600 px) and is chosen at the start of each round.

## License

MIT. See [LICENSE](LICENSE). *Scorched Earth* is the 1991 game by Wendell Hicken; this is an independent tribute and uses none of its code or assets.
