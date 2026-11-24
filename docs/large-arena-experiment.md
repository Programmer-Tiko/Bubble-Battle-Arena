# Large arena experiment ? not integration ready

The measurements below are historical local experiments, not a capacity certification. Unless a seed and command are given, exact inputs and source revisions were not retained, so those results cannot be reproduced exactly. Results depend on the host and competing workloads. The later sections specify the seeds and fixture conditions where recorded.

This branch is based on PR #11 and leaves that branch unchanged. The default map is 30 ? 26 tiles at the existing tile size (780 tiles, exactly four times the old 195-tile map). The outer boundary remains indestructible, spawn candidates are spread along the edges, and isolated initial floor pockets are converted to breakable blocks after spawn connectivity is checked. Tests sample 20 eight-player seeds, verify border/spawn safety, and check that all initially traversable floor tiles are connected.

The local camera follows the player; spectators and eliminated players can pan with WASD or arrows. The terrain minimap shows only the local player's position, never opponents or unrevealed supply locations. The viewport remains 15 ? 13 tiles, not a zoomed-out view of the full map. The first minimap overlay obscured a spawn and was moved below the arena. [Camera and minimap](screenshots/experimental-arena-camera.png) ? [Four-player bot session](screenshots/experimental-four-bots.png) ? [Eight-player controlled fixture](screenshots/experimental-eight-fixture.png).

Trapped countdowns are absent from the normal label and public network snapshots; the authoritative engine and bots retain them. Elimination drops now shuffle eligible floor tiles, without changing quantities or kinds. The balloon's visual interpolation moves at two thirds its old speed, and the one-second supply preview uses ground shadows. A controlled two-client fixture verified matching locations, hidden types, and unchanged landing; it briefly paused simulation for the [shadow screenshot](screenshots/experimental-supply-shadow.png).

## Character work is incomplete

The eight named [concept previews](screenshots/experimental-character-concepts.png) are isolated development sketches. They do **not** select a character in gameplay and are not eight completed designs. Four-direction bodies/mounts, movement and bomb-placement animation, all eight themed bomb skins, trusted server-side appearance selection, and owner-based bomb rendering are not implemented. The proposed integration should assign a server-validated appearance per player, include it in the public snapshot, and derive a bomb's skin from its authoritative owner. Coordinate that contract with the future lobby; no teammate-owned lobby code is changed here.

## Measurements and limitations

A short local comparison on Node v26.13.1 / Windows / Ryzen 5 6600H used the same experimental build configured for each map size. Twenty-five eight-player map generations averaged 0.57 ms (15 ? 13) versus 2.42 ms (30 ? 26), with p95 1.93 versus 4.76 ms and no fallbacks. Public JSON snapshots were 9,443 versus 29,033 bytes. A 300-tick, eight-Normal-bot synchronous sample averaged 2.71 versus 7.80 ms per tick, p95 4.91 versus 15.98 ms; search budget exhaustions were 17 versus 283. Pairs within three Manhattan tiles were observed in 12.2% versus 0% of sampled pair-ticks. Neither 10-second sample completed a match, so this is not a match-duration or stuck-rate conclusion.

The standard larger-map `benchmark:bot` run (with browser QA also running, so system load was not isolated) reported 4 sessions ? 8 bots at 40.53 ms mean and 70.48 ms p95 per batch, with 185 of 300 batches above the 33.3 ms tick interval. Its short real-time probe advanced 79?82 ticks versus about 98 expected, with 294.6 ms event-loop p99. These results show a performance risk, not acceptable capacity. One-bot and single eight-bot real-time probes advanced 89 ticks in roughly three seconds. No bot strategy or search budget was changed.

A headless Chrome, software-rendered five-second comparison measured 145 frames for 15 ? 13 and 147 for 30 ? 26; both were roughly 29 fps under this setup and are not representative of hardware-accelerated or mobile performance. The large-map local-only probe also measured about 29 fps. The map renderer and network snapshot size need profiling under sustained real client load.

Actual browser checks covered local play, one human with three bots, a team/bot session, spectator panning, a 390px-wide layout with no horizontal overflow, the controlled eight-player fixture, and the supply preview fixture. They are not an eight-human playtest. At the time of these checks, initial collectible placement followed row-major order; the follow-up below changes that placement. Full ten-minute match duration, encounter rate, bot stuck behavior, all requested animations/skins, and sustained load remain unverified. Existing player/bomb collision semantics are unchanged.

## Follow-up: preliminary optimization, not capacity approval

The latest local changes replace row-major initial pickup placement with a separate seeded random stream and spatially separated floor tiles. The four boots and other item counts remain the same; balloon randomness uses its existing independent stream. A time-expanded search now indexes active hazards and bombs once per search. Hypothetical bomb prediction no longer clones the entire snapshot, and newly armed hazards invalidate the controller's route. Escape search budgets and safety predicates are unchanged. These are targeted code-level findings, not a complete CPU profile; full-map signatures, repeated goal searches and map-sized snapshots still need investigation.

With no browser QA running, the standard 300-tick benchmark on Node v26.13.1 / Windows / Ryzen 5 6600H reported four eight-Normal-bot sessions at mean/p95/p99 52.04/91.98/112.09 ms before and 36.45/49.06/58.91 ms after. Budget exhaustion was 1,133 before and 655 after. The real-time probe advanced 79–82 of about 97 expected ticks before, and 76–80 of about 99 after, with event-loop p99 336.6 and 251.1 ms respectively. The sessions use unseeded item layouts and therefore are not paired trials; the results cannot isolate individual changes. The 36.45 ms mean remains over the 33.3 ms budget. Neither this short probe nor its heap readings establish sustained capacity or memory stability. Raw outputs are local scratch artifacts and are not version-controlled; the exact intermediate source states were not retained.

The controlled threat evaluation remained 24/24 escapes, and the short arena evaluation returned to 1/24 self-traps after removing an attempted queue-deduplication optimization that produced 3/24. This small sample does not prove safety. Full-match pacing comparisons, longer-running memory and load tests, actual browser checks after these changes, and a controlled 15 × 13 versus 30 × 26 comparison remain outstanding. Continue investigating the smaller map or a different planning architecture if four-session throughput cannot meet the budget without compromising escape safety. Do not treat this follow-up as integration-ready.

## Seeded investigation and server snapshot reuse

On Node v26.13.1, Windows, Ryzen 5 6600H, with browser QA stopped, a CPU profile of four eight-Normal-bot games for 300 synchronous ticks assigned 5,317 of 6,585 samples (80.7% self samples) to `structuredClone`; the garbage collector accounted for 75 (1.1%). Explicit timers measured 8.55 s in 10,800 `Game.getSnapshot` calls, 1.33 s in `BotController.update`, 0.21 s in `Game.step`, and 0.05 s serializing the public projection during a 10.21 s wall run. These timers include instrumentation overhead; the profile does not independently time each `HazardMap` constructor, goal selection, or Socket.IO encoding and is not a network-client load test. The call path showed a full detached snapshot for every bot even when previous bots only changed inputs.

The server now reuses a detached view until a successful bomb placement, immediately refreshing before later bots decide. Input changes do not mutate game state before `step`. An integration test checks the refresh and clone count; the unchanged 24-seed controlled bot evaluation yielded 24/24 threat escapes and 1/24 arena self-traps both before and after. The previously rejected search-queue deduplication is still absent. Actual bot decisions and travel were identical between seeded current-code proxy runs with and without reuse. This does not cover every safety situation.

The following table gives the range across three independent 300-tick runs, each with four games and eight Normal bots, seeds 1, 11 and 21 (four game seeds per run). Baseline means the committed `52da992` source; current includes the pre-existing local item and bot changes. Small and large maps differ, and baseline versus current initial items differ, so only current with/without reuse is a paired gameplay comparison. Timings include simulated public JSON serialization every third tick but no connected sockets; p95/p99 are per-run batch percentiles, not pooled.

| Source and arena | Mean ms | p95 ms | p99 ms | Exhaustions per run | Public bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline 15 × 13 | 9.81–10.60 | 15.29–18.39 | 27.54–30.94 | 53–134 | 9,171–9,885 |
| Baseline 30 × 26 | 36.68–38.75 | 54.44–61.11 | 73.14–80.17 | 805–1,069 | 28,704–29,232 |
| Current 30 × 26, per-bot clones | 32.59–39.21 | 47.47–54.13 | 54.11–67.26 | 333–451 | 29,007–29,256 |
| Current 30 × 26, reuse | 10.55–11.40 | 17.83–20.66 | 26.74–34.76 | 333–451 | 29,007–29,256 |
| Current 24 × 22, reuse | 7.15–7.88 | 13.30–14.32 | 19.83–21.67 | 151–249 | 20,402–20,954 |

In these proxy runs, aggregate player travel was 442–459 tiles per 10-second batch on the large map both with and without reuse. The same unseeded actual-server `npm.cmd run benchmark:bot` sample gave 11.14 ms mean, 21.52 ms p95, 27.44 ms p99 and zero of 300 batches over 33.33 ms for four eight-bot sessions. The separate three-second timer probe advanced all sessions 90 ticks versus 90.36 expected, with 37.16 ms event-loop p99. These are short no-client tests, not proof of sustained 30 Hz with broadcasting, human traffic, GC pressure or long-lived matches. Proxy end-of-run heap ranged roughly 12–43 MiB and is not a leak measurement. CPU seconds were 3.74–4.05 over 3.17–3.42 wall seconds in the paired reuse runs; process CPU accounting can exceed wall time.

`node scripts/arena-network-benchmark.mjs` adds one actual Socket.IO spectator per eight-bot game, with clients and server in the same process. In one unseeded five-second run the games advanced 145–147 ticks versus 150.28 expected, delivered 48–49 snapshots each, and produced 29,467–31,623-byte JSON snapshots. Event-loop p95/p99 were 63.05/164.89 ms, process CPU time was 4.33 s, and ending heap was 22.96 MiB. This includes in-process client processing and is not a measurement of server broadcasting in isolation. The missed progress and latency spikes mean the no-client capacity result does not establish the target under connected-client load.

To repeat the current proxy workload from PowerShell, run `npm.cmd run typecheck`, then set `ARENA_WIDTH`, `ARENA_HEIGHT`, `ARENA_SEED`, `ARENA_TICKS=300`, `ARENA_SESSIONS=4`, `ARENA_PLAYERS=8`, `ARENA_DIFFICULTY=normal`, and `ARENA_REUSE=0` or `1`, and run `node scripts/arena-investigation.mjs`. Use seeds 1, 11 and 21 for the three batches. The historical baseline was commit `52da99232bfb02e290b17332b954c3c1db901705`; historical current measurements included uncommitted changes and cannot be recreated exactly from that commit. The proxy approximates server scheduling and serialization; it does not measure Socket.IO delivery or freeze overhead. Generated archives, results and CPU profiles are local artifacts and should not be committed.

### Match pacing

The same current-code proxy ran full matches for seeds 7, 11 and 21 for every combination of 15 × 13 or 30 × 26, four/eight bots, FFA/team, and Normal/Hard: 24 matches per size. Encounter means opposing alive players within three Manhattan tiles. “Bomb engagement” is a bomb placed with an opponent within that distance, not proof that the blast could reach them. Trapping and elimination are sampled at tick boundaries; a transient trap/rescue within a tick may be missed. Travel is summed across players, and stationary time is the longest consecutive alive interval without measurable displacement, including legitimate waits.

| Aggregate across 24 matches | Small | Large |
| --- | ---: | ---: |
| Mean first encounter / nearby bomb (s) | 0.52 / 1.53 | 10.73 / 14.24 |
| Mean first observed trap / elimination (s) | 11.23 / 16.15 | 17.64 / 22.79 |
| Mean match completion (s) | 121.4 | 99.3 |
| Matches reaching 600 s | 1 / 24 | 0 / 24 |
| Longest stationary interval (s) | 2.73 | 2.60 |
| Mean total travel (tiles) / exhausted searches | 634 / 35 | 550 / 384 |

Mean first encounter and completion time in seconds for each three-seed configuration:

| Mode, players, difficulty | Small encounter / finish | Large encounter / finish |
| --- | ---: | ---: |
| FFA, 4, Normal | 0.6 / 59 | 9.9 / 103 |
| FFA, 4, Hard | 0.6 / 70 | 10.2 / 54 |
| Team, 4, Normal | 0.6 / 54 | 11.6 / 68 |
| Team, 4, Hard | 0.6 / 39 | 15.2 / 82 |
| FFA, 8, Normal | 0.5 / 135 | 7.1 / 135 |
| FFA, 8, Hard | 0.5 / 412 | 16.0 / 93 |
| Team, 8, Normal | 0.5 / 69 | 7.4 / 86 |
| Team, 8, Hard | 0.5 / 133 | 8.4 / 174 |

Each individual configuration has only three matches, and the results do not establish population balance or causal effects. Teams consist of pairs; eight-player Team Battle therefore has four teams under the current rules. Longer first encounters and much more exhausted search work on the large map deserve further study; no movement, bomb, time-limit or map-size rules were changed.

### Item and browser checks

`node scripts/arena-items-audit.mjs` checks 200 explicit seeds with eight players. All had four boots and two of each other item, unique reachable floor pickups and deterministic item layouts; aggregate quadrant counts were 615, 594, 592 and 599. Mean shortest floor-path distance to the nearest boots varied from 11.86 to 15.08 tiles across the eight spawn locations; the worst within-match difference between closest and farthest spawn was 42 tiles. This sample does not establish a systematic advantage, but the large individual disparity warrants a fairness design and further testing. The balloon stream remains separate.

After the timing work, a headless Chrome session joined four-player FFA with three bots, Team Battle with three bots, a spectator view, and an eight-slot FFA with seven bots. The canvas, minimap, items and a placed bomb rendered; no JavaScript exceptions were captured. Screenshots: [FFA](screenshots/investigation-ffa.png), [spectator](screenshots/investigation-spectator.png), [team](screenshots/investigation-team.png), [eight slots](screenshots/investigation-eight.png). These are controlled bot sessions, not an eight-human test. The automated pass sent a spectator pan input but did not independently verify camera displacement or minimap alignment; camera follow, explosion timing, supply shadows, trapping, rescue, and elimination were not fully rechecked in this pass. Earlier screenshots above remain historical evidence only.

The 30 × 26 map is reasonable for continued experimentation given the short-run headroom, but PR #12 should remain draft. The 24 × 22 option uses 528 tiles versus 780 and reduces snapshot and proxy costs, at the cost of less space; its encounter pacing has not been measured in the match matrix. Choose a final size only after broader fairness, pacing, real-client and sustained-load tests.

## Follow-up validation: immutable snapshots, fairness and separate clients

The shared per-tick bot snapshot is now recursively frozen after `Game.getSnapshot` detaches it. A failed placement leaves that frozen view unchanged; a successful placement refreshes it before the next bot. The engine and public projection remain separate. Regression tests exercise nested mutation attempts, failed placement, successful placement and later-bot visibility; existing engine and Socket.IO tests cover chain reactions, item interactions, player states and exclusion of bomb and trapped countdowns from public snapshots. A controller attempting to mutate the view will throw; the current controllers do not mutate it. Freezing has a measurable cost and the tests are not a proof of all future controller behavior.

Initial boots now use BFS distances over currently walkable floor from each spawn. A bounded search reduces the worst nearest-boots distance and the gap between spawns; random candidate order breaks ties reproducibly. Other pickups retain their quantities and spatial spreading, and balloon selection uses its existing independent stream. `node scripts/arena-items-audit.mjs` on the same 200 seeds and eight spawns gave:

| Measure | Previous local placement | Revised placement |
| --- | ---: | ---: |
| Worst within-match gap in nearest-boots walking distance | 42 tiles | 15 tiles |
| Mean nearest-boots distance by spawn, range | 11.86–15.08 tiles | 8.62–10.15 tiles |
| Invalid counts, unreachable checks, nondeterministic layouts | 0 / 0 / 0 | 0 / 0 / 0 |
| Item counts across quadrants | 615, 594, 592, 599 | 623, 611, 593, 573 |

Residual spawn differences and the observed 15-tile individual gap remain balance risks. The bounded optimizer is heuristic and the seed sample does not establish fairness for every map. The earlier first attempt minimized only the worst distance and reached a 17-tile worst gap; increasing the gap weight beyond the retained setting did not improve the 200-seed result. Item distribution changes can affect bot behavior and match pacing.

### Separate-process load

`scripts/arena-connected-load.mjs` runs the actual server in a child process and Socket.IO clients in the parent. It creates seeded maps, uses a 10 ms monotonic accumulator with bounded catch-up around `server.tick`, and measures individual session ticks and full batches. For each scenario three ten-second trials used seeds 7, 11 and 21. Each game had two spectators; the mixed scenario replaced two bots with scripted player sockets and seeded those players with consumables as a controlled item-use fixture. It is a local load test, not a human playtest. `broadcastEmitMs` measures synchronous Socket.IO `emit` time, including encoding/enqueue work, not end-to-end delivery; player acknowledgment round trips include both processes and local transport.

| Scenario | Tick mean / p95 / p99 (ms), range | Batch mean / p95 / p99 (ms), range | Server event-loop p99 (ms) |
| --- | ---: | ---: | ---: |
| 1 game, 8 bots | 3.68–3.97 / 7.03–9.28 / 16.10–17.47 | 3.68–3.98 / 7.04–9.29 / 16.10–17.48 | 23.63–31.11 |
| 4 games, 8 bots each | 2.91–3.18 / 4.93–7.09 / 9.83–12.44 | 11.66–12.71 / 19.15–24.16 / 30.05–33.81 | 27.87–37.88 |
| 4 games, 6 bots + 2 scripted players each | 3.05–3.10 / 5.30–6.06 / 9.61–10.99 | 12.20–12.41 / 20.29–21.56 / 30.93–31.26 | 27.80–44.89 |

Every session advanced 300 ticks against 300.16–300.94 expected, with no client disconnects. The harness counted 99 deliveries per game across its connected clients, not per spectator; mixed games had four clients each. Across the mixed trials, 52 bombs and 64 item uses were accepted and explosion snapshots were observed. Mean player command acknowledgment was 9.36–11.52 ms, p95 22.98–35.05 ms and p99 42.52–64.08 ms. Synchronous broadcast emit averaged 0.43–0.50 ms in four-game runs, and snapshots averaged about 29–30 kB. Server CPU was 4.50–6.06 seconds per ten-second four-game trial, ending RSS 132.7–140.7 MiB and heap 24.0–42.3 MiB. These endpoint memory readings do not establish long-run stability. Six earlier trials using an intermediate item-placement candidate saw two four-game batch p95 values exceed 33.33 ms, so the final short sample should not be treated as a guarantee under different layouts or workloads.

Reproduce with PowerShell, for example: `$env:LOAD_SESSIONS='4'; $env:LOAD_HUMANS='2'; $env:LOAD_SPECTATORS='2'; $env:LOAD_SEED='7'; $env:LOAD_SECONDS='10'; node scripts/arena-connected-load.mjs`. Repeat with seeds 11 and 21, `LOAD_HUMANS=0`, and `LOAD_SESSIONS=1` for the other cases. Run without browser QA or other benchmark workloads. Raw output and browser profiles are local temporary files and must not be committed.

### Pacing after the fairness change

One full seed-7 match per combination of three sizes, four/eight players, FFA/team and Normal/Hard was simulated with `scripts/arena-investigation.mjs`: eight matches per size. An encounter episode begins when an opposing alive pair enters three Manhattan tiles; nearby bomb placement is a proximity proxy, not proof of a successful offensive blast. First eliminations are observed at tick boundaries. Episodes are normalized by total match time in the table. These very small samples are descriptive only.

| Arena | First encounter / nearby bomb (mean s) | Encounter episodes / match-minute | First elimination (mean s) | Completion (mean s) | Draws at 600 s |
| --- | ---: | ---: | ---: | ---: | ---: |
| 15 × 13 | 0.53 / 1.08 | 26.54 | 16.96 | 122.94 | 1 / 8 |
| 24 × 22 | 9.59 / 12.76 | 15.91 | 22.20 | 64.10 | 0 / 8 |
| 30 × 26 | 19.28 / 20.61 | 14.04 | 20.51 | 147.93 | 0 / 8 |

The 30 × 26 sample includes a 582.8-second match; no change to the ten-minute rule is justified by this sample. The proxy follows the bot scheduler but does not include network clients or freeze overhead. Use the proxy instructions above and `ARENA_TICKS=18000`, `ARENA_SESSIONS=1`, `ARENA_REUSE=1`, `ARENA_SEED=7`, with each size, mode, roster and difficulty; generated output should remain uncommitted. More seeds and human play are needed before selecting a size.

### Controlled browser verification

A local browser fixture used an actual local server and headless Chrome. Its capture script is excluded because it assumes fixed ports and overwrites screenshots; the original browser setup was not recorded sufficiently for independent reproduction. Positions and statuses were set on the authoritative engine for controlled views; bomb placement was sent through browser input. Movement changed the player's world x from 496 to about 609 pixels and the camera followed; four edge views show the camera bounded at the map edges. The minimap's red marker was within one pixel of the expected position at all four edges. Spectator pan changed the visible scene. A real placed bomb and its explosion were captured; the trapped view showed no visible countdown, moving an ally onto the tile rescued the player, and a later forced trap expiration eliminated the player and scattered two boot pickups and two banana hazards. For that screenshot the fixture confined eligible floor tiles to the visible region. A 390-pixel viewport had five inventory slots and no horizontal overflow. No browser exceptions were captured.

The supply preview is a controlled fixture: the engine selected floor tiles and the simulation was paused during its one-second preview to make capture reliable. The screenshots are not a human multiplayer or unpaused supply-timing test: [left](screenshots/validation-edge-left.png), [right](screenshots/validation-edge-right.png), [top](screenshots/validation-edge-top.png), [bottom](screenshots/validation-edge-bottom.png), [moving](screenshots/validation-moving.png), [bomb](screenshots/validation-bomb.png), [explosion](screenshots/validation-explosion.png), [trapped](screenshots/validation-trapped.png), [rescued](screenshots/validation-rescued.png), [eliminated](screenshots/validation-eliminated.png), [supply shadows](screenshots/validation-supply-shadow.png), [spectator pan](screenshots/validation-spectator-pan.png), and [narrow HUD](screenshots/validation-narrow.png).

The final standard no-client benchmark gave four eight-bot sessions 11.01 ms mean / 19.30 ms p95 / 24.60 ms p99, and a three-second real-time probe advanced 89–90 ticks versus about 90 expected. Keep PR #12 draft. The 30 × 26 map has promising short-run headroom but needs sustained connected load and broader pacing/fairness validation. The 24 × 22 option has lower measured computational cost and earlier encounters in this small sample, but its player-experience advantage is not established.
