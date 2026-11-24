# Gameplay bug hunt

## Confirmed issue and fix

Three separate `new Game(["a"])` matches, advanced to tick 5370, announced identical first supply coordinates: `(12,6), (12,4), (6,2), (11,6), (1,3)`. The engine used the fixed default map seed to initialize its supply PRNG, so ordinary development sessions repeated the same schedule. Default matches now sample fresh randomness using Web Crypto where available (falling back to `Math.random`); an explicit map seed still creates a reproducible simulation. A regression test controls the entropy source and verifies different unseeded selections and identical explicitly seeded selections. The event times, eligible tiles, sampling without replacement, and announced landing positions remain unchanged.

## Browser checks

- Local one-player: movement key, bomb key, and 390px layout; no page errors.
- Four-player FFA: four separate player clients and a spectator joined; bomb snapshots omitted fuse values. Normal and Hard three-bot sessions showed autonomous movement, bombing, item collection and session-specific debug data.
- Team Battle: one human, two bots, and a spectator joined a four-slot session. [Team/bot screenshot](screenshots/gameplay-team-bots.png). A separate controlled team fixture observed trapped ? alive rescue and then the [team winner display](screenshots/gameplay-team-result.png).
- Supply: controlled server advanced to 179 seconds, with one player and one spectator. Their locations matched across 76 comparable snapshots, preview tiles contained only x/y, both observed the unchanged landing, and no bomb fuse values appeared in captured snapshots. [Supply screenshot](screenshots/gameplay-supply.png).
- The eight-client browser attempt was not completed in this environment. Existing engine/socket tests cover eight slots; the earlier [eight-player screenshot](screenshots/chibi-eight-after.png) is a controlled fixture, not eight human players. Inventory/pickup and bomb/trap overlap are covered by existing tests and earlier [loadout](screenshots/chibi-loadout-after.png) and [overlap](screenshots/qa-bomb-overlap.png) fixtures.

## Performance observations

The standard 24-trial benchmark before and after the change gave the same outcomes: intelligent threat survival 24/24, arena survival 24/24, and 0 self-traps in each scenario. In the 300-tick synchronous four-session/eight-bot probe, batch mean/p95 were 12.24/20.35 ms before and 12.89/19.18 ms after, with 2 and 1 batches respectively over 33.3 ms. These are short runs with variable system load and do not establish a significant change. The final three-second, client-free real-time probe advanced 90 ticks per session (90.55 expected), with 46.3 ms p99 event-loop delay. A separate concurrent browser-load run advanced only 81?82 ticks in 3.43 seconds (102.75 expected) and had a 331.9 ms p99 delay; it is not an isolated benchmark and warrants further load testing.

A controlled 30-bomb chain with 1,000 ground items detonated all bombs into 137 explosion cells, retained all 1,000 items, and took 2.76 ms for the first simulation tick; the following 300 ticks averaged 0.056 ms with p95 0.182 ms. Heap snapshots and short probes do not prove the absence of leaks or establish production capacity.

## Integration limits

PR #10 is types-only. Its proposed `MatchStart.snapshot` uses the public snapshot type, but the future match-start serializer must call `publicSnapshot()` at runtime. The bot and proposed shared package currently each define `BotDifficulty`; consolidate on the shared type after integration. Room reset/new match IDs and JWT expiry enforcement remain future teammate-owned work. Player-player collision and some other game rules remain documented as unresolved. Bot Debug exposes predicted timing only when explicitly enabled in the local development server; observed placements can still let clients infer fuse timing.
