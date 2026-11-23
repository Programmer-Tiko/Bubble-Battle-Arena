# Intelligent game bot — proposed Objective 4

This feature is proposed for Objective 4; course eligibility requires instructor confirmation. A shortest spatial path can lead a player through a tile that is safe now but dangerous when the player arrives, or leave no exit after a bomb is placed. The bot accounts for explosion timing and replans as the arena changes.

## Architecture and algorithms

The authoritative server gives each bot a reserved player slot and a `BotController`. It reads detached game snapshots and sends ordinary `setInput` and `placeBomb` commands to the same engine used for human actions. Bots cannot be claimed by clients. The development launcher is loopback-only and disabled in production; a future authenticated Room Manager must allocate and authorize roster entries itself.

`HazardMap` predicts active explosion intervals and known bomb fuses. It follows chain reactions in engine order and updates its detached wall map when blasts destroy walls, sharing the engine's blast traversal. It cannot predict future bombs or player choices. A time-expanded A* state is `(x, y, t)`, with cardinal movement and waiting transitions. Edges cost elapsed time; Manhattan distance times discretized tile traversal time is an admissible heuristic for a fixed destination, and the escape search uses zero heuristic. Both endpoint tiles must remain safe during a transition. Current movement speed, boots, slowdown, active ground hazards, conservative bomb obstacles, and initial centering time are considered. Forced slides are left to the engine.

The strategy prioritizes escaping predicted danger, collects useful passive items, approaches opponents, and considers bombing opponents or adjacent destructible walls. Before placement, it adds a hypothetical bomb to the predictor and requires a route to safety through its blast; it avoids deliberately bombing a teammate's current tile. Hard also considers adjacent floor tiles the teammate might enter. Future actions can still invalidate a plan or cause friendly fire. The controller executes waypoints using actual world positions and replans when bombs, explosions, or walls change.

Easy, Normal, and Hard use different replan intervals, horizons, target counts, and bounded node budgets; no difficulty changes engine speed, inventory, range, or capacity. Searches are complete only for their restricted discretized graph if the budget and horizon suffice. Conservative occupancy can reject feasible routes. The server allows at most one bot per session to run a replan per tick. Other bots pause on a changed arena until their turn, up to seven ticks with eight bots. Execution occurs each tick; there is no hard real-time guarantee across sessions.

## Run and demonstrate

1. From the repository root run `npm.cmd install`.
2. In PowerShell start the loopback development server with `$env:BOT_DEBUG='1'; npm.cmd run server`. Debug data is disabled unless explicitly enabled; the development server refuses to run with `NODE_ENV=production`.
3. In a second terminal run `npm.cmd run dev` and open its Vite URL, normally `http://127.0.0.1:5173/`.
4. Select **FFA**, **4** total players, **3** bots, and a difficulty. Click **Create test session**, then **Join** as Player promptly; the game starts at creation. Use WASD or arrows and Space. Open a second local window with the session ID and join as Spectator. For Team Battle, four players with two bots makes two valid pairs.
5. Turn on **Bot debug** and select a bot. Red tiles are the server's current predicted danger intervals; their labels give seconds until danger starts. The yellow ring marks the selected bot, yellow lines show its remaining waypoints, and the square marks its destination. The text shows the controller's actual latest state and reason. Updates are polled approximately every 300 ms, so the display can lag the simulation. A bomb placed by a human can provide an escape example; because player and bomb positions vary, repeat the match if necessary.
6. Watch the result under normal match rules. Debug data is an opt-in local HTTP endpoint, not part of the shared multiplayer snapshot; the frontend hides development controls in production builds.

For a deterministic fallback run `npm.cmd run demo:bot`. This headless fixture initializes an open arena with a known bomb threat, then advances the real engine using controller commands. It prints the controller's state, path, danger interval, position, and final status. It changes fixture positions only during setup, not during bot execution.

A two-minute presentation can introduce why timing matters (20 seconds), show a live bot and enable the danger/path overlay (35 seconds), place a bomb and explain its retreat (25 seconds), show safe bot placement if it occurs (15 seconds), and present the controlled comparison below (25 seconds). Use the headless fallback if the live match does not produce a clear threat.

## Controlled baseline evaluation

Run `npm.cmd run benchmark:bot`; set `BOT_TRIALS` to change the default of 24 trials. `scripts/bot-evaluation.mjs` compares the intelligent controller against seeded random cardinal movement with basic wall avoidance and occasional random bombing at a nearby wall or adjacent enemy. Both use the same real engine, player stats, seeded initial map, rotated central layout, starting positions, items, and opponent inputs for each paired seed. The first scenario starts with a known opponent bomb and runs for four simulated seconds. The second runs for ten seconds against a scripted opponent; it is a controlled arena scenario, not a full match or a win-rate measurement. A participant is counted as surviving only while alive; escape is survival to the end of the threat scenario. Self-trapping counts a transition to trapped on an owned explosion. Collected items count passive upgrades acquired, including those held before elimination. A valid attack placement means an accepted bomb placed beside a destructible wall or adjacent opponent; this does not prove an opponent was hit. Decision time includes every policy update, including ticks without replanning.

One local run, 24 paired seeds per scenario:

| Scenario and policy | Survival | Escape | Self-trapped | Mean survival | Mean items | Valid placements | Mean decision time |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Threat, random | 16/24 | 16/24 | 4/24 | 3.675 s | 0.375 | 18 | 0.0045 ms |
| Threat, intelligent | 24/24 | 24/24 | 0/24 | 4.000 s | 1.750 | 6 | 0.1064 ms |
| Arena, random | 18/24 | — | 6/24 | 8.683 s | 0.500 | 29 | 0.0020 ms |
| Arena, intelligent | 23/24 | — | 1/24 | 9.967 s | 2.958 | 32 | 0.0482 ms |

These are small, controlled preliminary samples, not evidence of statistical significance or a guarantee of survival. The centre layout has four rotations, and much of the map variation lies outside the controlled area. Results depend on the baseline policy, chosen scenarios, and machine load. The self-trap in the arena run illustrates that reactivity and escape checks cannot guarantee safety against future actions.

## Performance measurement

The same benchmark runs `scripts/bot-performance.mjs`. The recorded run used Node v26.13.1 on Windows 10.0.26200 x64, AMD Ryzen 5 6600H, Normal difficulty, 300 fixed 30 Hz simulation ticks (10 simulated seconds), eight active slots per session, no network clients, and synchronous execution as fast as possible. Other local work was running. Decision samples include idle updates, not just A* searches. A session batch is one tick in each listed session; its distribution is not a measurement of live timer jitter or production capacity. Heap usage is an approximate process snapshot, not a peak.

| Sessions × bots | Decision mean / p95 / p99 (ms) | Batch tick mean / p95 / p99 / max (ms) | Batches > 33.3 ms | Searches / nodes / budget exhaustions | Heap MB | CPU seconds |
| --- | --- | --- | ---: | --- | ---: | ---: |
| 1 × 1 | 0.349 / 0.328 / 5.567 | 0.849 / 3.188 / 6.161 / 34.574 | 1 | 60 / 21000 / 60 | 19.5 | 0.343 |
| 1 × 4 | 0.068 / 0.178 / 0.937 | 1.454 / 2.377 / 3.575 / 12.504 | 0 | 102 / 4722 / 5 | 15.7 | 0.625 |
| 1 × 8 | 0.081 / 0.157 / 1.193 | 2.653 / 5.536 / 8.966 / 13.995 | 0 | 240 / 28718 / 69 | 20.9 | 0.954 |
| 4 × 8 | 0.065 / 0.155 / 1.025 | 11.175 / 18.966 / 23.168 / 33.905 | 1 | 854 / 82400 / 172 | 29.6 | 3.343 |

One-bot target selection hit its search budget repeatedly in this run; the four-session batch also exceeded one 30 Hz frame once. Long-tail stalls, many simultaneous sessions, different maps, and real socket traffic need further profiling. The limits bound individual searches, but they do not guarantee frame deadlines.

The script also runs a separate three-second wall-clock probe with the real automatic server timers. In a subsequent local run, the 1-, 4-, and 8-bot single sessions advanced 89, 90, and 90 ticks respectively (about 90 expected); four simultaneous eight-bot sessions each advanced 89 ticks. Event-loop p99 delays were 22.7, 16.7, 16.8, and 48.5 ms respectively, with a 56.4 ms maximum in the four-session case. The event-loop monitor used a 10 ms sampling resolution. These short, client-free probes show that the simulation approximately kept its tick count in this run while event-loop stalls remained possible; they are not a sustained load test.

## Verification and limitations

Run `npm.cmd test`, `npm.cmd run test:integration`, `npm.cmd run typecheck`, `npm.cmd run build`, `npm.cmd run demo:bot`, and `npm.cmd run benchmark:bot`. Integration tests cover engine behavior, human/spectator sessions, status restrictions, team safety, debugging opt-in, and difficulty preserving engine stats. The Vite build may report its existing large-bundle warning.

The bot has finite horizons, conservative collision assumptions, no rescue targeting or consumable strategy, and limited ability to anticipate moving opponents. Difficulty and debug options are development integration points, not a replacement for trusted lobby/authentication. A live game may not show every desired behavior during a short presentation.
