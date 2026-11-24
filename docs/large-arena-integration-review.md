# Large-arena integration review

**Status update:** The review below records the earlier isolated investigation. The experiment was subsequently checkpointed in `16bfc4b1dfa44d8d2101121172a25731cba47eb0`, and main was merged locally without conflicts in `7d40bb9b8fa120bdb37a329639e6352afffe9492`. `@bubble/bot` now imports and re-exports the shared `BotDifficulty` type. The performance figures remain historical measurements and do not establish production capacity.

The measurements used Node v26.13.1 on Windows with a Ryzen 5 6600H. The scenarios, seeds, commands and known fixture limitations are described below; exact timing is host-dependent, and the historical experiment included uncommitted source changes. Results from later source revisions need not match.

At the time of this review, no PR was merged and no existing working-tree file was replaced. The local experiment HEAD is `52da99232bfb02e290b17332b954c3c1db901705`; fetched `origin/main` is `e11b2e0c4de2f9ecae304b68a0975ff1f8f73615`, the merge of PR #10. PR #11 and PR #12 were drafts when inspected.

## Main compatibility

PR #10 added the Lobby and Room type declarations to `packages/shared/src/index.ts`. Both branches changed that file, but `git merge-tree` found no textual conflict. An isolated copy composed of the experiment commit, its modified source and tests, the new chain test, and the three-way-merged shared types passed typecheck, 129 tests, 49 integration tests, build, demo and bot benchmark. This is a compatibility check, not a merge of the dirty branch.

The experiment separates public `GameSnapshot` from `AuthoritativeGameSnapshot`; main's `MatchStart.snapshot` refers to `GameSnapshot`. Once the changes are combined, future match-start code must call the runtime `publicSnapshot` projection. TypeScript's structural typing can accept an authoritative object where the public type is expected without removing fields. The current projection strips bomb `remainingSeconds` and player `trappedSeconds` for ordinary join and broadcast snapshots; bot debug remains an explicitly enabled authoritative diagnostic. Player projection currently spreads remaining fields, so additions of future private player fields require a projection review. At the time of this review, main and `@bubble/bot` independently declared the same three `BotDifficulty` values; the shared type is now the single source of truth. The Room Manager, room lifecycle, authentication, match-start authorization and reconnect implementation do not exist in this experiment and remain teammate-owned work.

## Snapshot reuse correctness

`Game.getSnapshot` detaches the state; the bot snapshot is recursively frozen, and it is refreshed immediately after a successful bot bomb placement. Failed placement does not change the shared snapshot. Tests cover nested mutation attempts, successful and failed placement, public countdown redaction, chain reactions and hazard prediction. The additional `services/game/tests/snapshot-reuse-chain.test.ts` checks the combined sequence: a later bot predicts an early chain detonation of a bomb placed by an earlier bot, and the engine actually executes that chain. A future controller that tries to mutate a frozen view throws; the server does not currently isolate that exception from its tick loop.

## Separate-process 60-second load

`scripts/arena-soak-validation.mjs` uses the actual game server in a child process and Socket.IO clients in the parent, with four sessions, two spectators per game, seeds 7–10, and a controlled adjacent-bomb chain fixture. In mixed sessions, two scripted player sockets and six bots participate; inventories are seeded to exercise item commands. A 10 ms monotonic accumulator drives `server.tick`, matching the fixed-step/catch-up approach but using one central harness timer rather than the server's independent production timers. Each row is one trial; results include local client and host scheduling effects. A finished match stops producing ticks and snapshots. Batch timing uses active sessions only, so early completions reduce the workload and make comparisons imperfect. `broadcastMs` is synchronous Socket.IO emit/encoding/enqueue time, not end-to-end delivery.

| Arena / scenario | Ticks completed (expected) | Batch mean / p95 / p99 ms | Event-loop p95 / p99 ms | CPU s | RSS start → end MiB |
| --- | --- | ---: | ---: | ---: | ---: |
| 30 × 26, 8 bots | 1800, **1383 finished**, 1800, 1800 (1800.34) | 8.46 / 13.79 / 21.88 | 30.18 / 35.42 | 19.09 | 81.2 → 139.0 |
| 30 × 26, 6 bots + 2 sockets | 1792 each (1802.82) | 15.26 / 27.62 / 47.40 | 32.80 / 58.65 | 30.53 | 83.1 → 128.0 |
| 24 × 22, 8 bots | 1800 each (1800.54) | 10.67 / 17.89 / 32.17 | 34.18 / 44.99 | 19.92 | 79.3 → 118.1 |
| 24 × 22, 6 bots + 2 sockets | 1800, **1254 finished**, 1800, 1800 (1800.77) | 9.00 / 15.54 / 26.47 | 29.33 / 34.64 | 23.49 | 83.0 → 103.6 |

Per-session tick mean/p95/p99 ms were 2.24/4.25/6.76, 3.81/8.16/15.11, 2.66/4.90/10.05 and 2.43/4.27/8.39 in table order. Synchronous broadcast mean/p95/p99 ms were 0.35/0.54/1.25, 0.70/1.27/4.03, 0.48/0.74/1.77 and 0.52/0.92/1.60. Average public snapshot sizes were 28,986, 29,326, 20,524 and 20,781 bytes. Fixture-bomb explosions and eliminations occurred, and no clients disconnected. The original soak indicator only checked for the second bomb's explosion, not whether it preceded its own fuse; a corrected two-second follow-up observed an early detonation in all four games in each scenario. The dedicated integration regression also verifies the chain. Mixed runs accepted 55/50 player bombs and 17/23 item actions at 30 × 26 / 24 × 22. Command acknowledgment p95/p99 was 405/992 ms on the large mixed run and 20.6/65.1 ms on the medium mixed run. That disparity warrants repeat trials and client/server scheduling profiling; it is not proof that map size alone caused the difference. Endpoint heap was 21.7–50.0 MiB; no leak conclusion follows from one-minute endpoint readings.

Reproduce one case, for example: `$env:SOAK_WIDTH='30'; $env:SOAK_HEIGHT='26'; $env:SOAK_HUMANS='2'; $env:SOAK_SEED='7'; $env:SOAK_SECONDS='60'; node scripts/arena-soak-validation.mjs`. Repeat for dimensions 24 × 22 and `SOAK_HUMANS=0`. The fixed chain and seeded inventory are controlled fixtures. These tests do not establish production capacity, complete full matches, or characterize long-lived memory under real clients.

## Additional FFA pacing and accessibility

For each size, 12 full bot-only FFA matches comprise seeds 7, 11 and 21, four/eight players and Normal/Hard difficulty. Seed 7 comes from the existing final-placement pacing run; seeds 11 and 21 were run for this review. Encounter is an opposing alive pair within three Manhattan tiles. Nearby bomb placement is a proximity proxy for engagement, and encounter episodes are normalized by total match time. One 24 × 22 match ended without meeting the proximity condition; its first-encounter and engagement values are censored and omitted from those means.

| Arena | First encounter mean s | First nearby bomb mean s | Episodes / match-minute | Mean completion s | Draws / time-limit draws | Longest alive stationary interval s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 24 × 22 | 9.15 (11/12 observed) | 11.32 (11/12) | 17.61 | 94.00 | 1 / 0 | 2.73 |
| 30 × 26 | 14.66 (12/12) | 20.53 (12/12) | 16.81 | 134.13 | 0 / 0 | 2.63 |

The small sample is not a win-rate study and does not cover additional Team Battle seeds or humans. Both sizes deserve more seeds and human playtests; the data do not justify changing the game rules.

`node scripts/arena-accessibility-validation.mjs` independently checked 200 eight-player map seeds per size with BFS through floor tiles. Mean nearest-boots walking distance was 7.08 tiles for 24 × 22 and 9.22 for 30 × 26; the worst within-match spawn gap was 14 versus 15 tiles. Every sampled item was reachable from every sampled spawn, and no sampled map had an invalid boots count or an item inside a wall. These are bounded seed samples, not a fairness guarantee.

## Safe next steps

Keep both draft PRs intact. Review and selectively commit documentation, reproducible scripts and useful screenshots. Exclude `.arena-investigation-*`, `.arena-validation-browser-*`, raw CPU profiles, browser profiles and benchmark output text files. The source checkpoint and normal merge of main are now complete; do not merge either draft PR automatically. Further soak trials should use multiple seeds, more than one minute, comparable active-match durations and independent real clients; instrument match-start redaction and authentication when the Room Manager is implemented.
