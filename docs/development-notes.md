# Development notes

## Phase 1B local prototype

The single-player browser prototype runs the headless engine locally, at the engine's fixed timestep. It is for rendering and controls development; it is not a multiplayer server or an authentication implementation. A future server adapter must receive authoritative snapshots and send input rather than simulate authoritative state in the browser.

The existing map dimensions, densities, spawn spacing, movement speed, and player radius remain temporary engine defaults. Player-to-player collision is unresolved. The prototype drops excess elapsed time after a long browser pause to avoid a catch-up burst.

## Remaining rule decisions

Bomb capacity and caps, explosion visual duration, propagation beyond destructible walls, repeated explosions on trapped players, item-drop probability, scattering of inventory charges, and supply drops on occupied player tiles are unresolved in the README and must be configurable temporary defaults when implemented.

## Phase 2 bomb defaults

Bombs start with capacity 1 and range 1, with provisional capacity and range caps of 8. Blasts last 0.3 seconds visually and stop after destroying the first destructible wall. Further explosions have no effect on an already trapped player by default; `repeatedHit` can instead reset the timer or eliminate them. These values are temporary; bomb settings are supplied through `BombConfig`. Bomb-to-player trapping is in place.

## Phase 3 match defaults

A match can be created with an explicit FFA or team roster. With no match configuration, the one-player local prototype is an open-ended sandbox. Trapped players count as survivors; simultaneous enemy and teammate contact gives enemy contact priority. Eliminated players remain in snapshots for a future spectator client, but cannot move or place bombs. Client spectator controls and networking arrive in a later phase.

## Phase 4 item defaults

The initial floor supply contains four boots and two pickups of each other type, placed deterministically away from spawn areas; the non-boot quantities and placement are provisional; `ItemConfig.initialOtherPerType` configures the non-boot supply. Capacity and range use the Phase 2 caps; a capped pickup remains on the ground. Inventory has no stack limit; if all slots are occupied, a new type remains on the ground. Each unused charge becomes one hazard on elimination by default; `ItemConfig.chargesPerHazard` configures this provisional conversion. Drops use nearest available floor tiles in a deterministic order, avoiding bombs, items, and living players; if there are more drops than free tiles, drops share those tiles. If no valid floor tile exists, drops cannot be placed. A banana uses the current movement direction (or the last direction when stationary); its slide ends on the first obstruction and is interrupted by trapping. These unresolved details are temporary defaults.

## Phase 5 balloon defaults

The headless engine uses a supply-specific random stream derived from the map seed. Each visit lasts 20 simulation seconds; all supply items are placed at the scheduled start, with a cosmetic landing effect. Occupied player tiles are excluded pending a design decision. If fewer than four valid tiles are available, the balloon appears but drops nothing; with four or five tiles it drops at most the number available. The open-ended local sandbox also shows the three scheduled visits. These defaults can be revisited when multiplayer and supply presentation are finalized.

## Phase 6 network development boundary

The development server creates server-issued session and player IDs, assigns FFA teams or fixed pairs, and runs one headless Game per session. A join assigns the first never-claimed player slot; spectators have no slot. Disconnected slots are not reassigned or eliminated and reconnection is disabled; stale input stops after `INPUT_STALE_MS` (default 500 ms). These are temporary policies pending authenticated identities and a product decision. Sessions start immediately and unclaimed roster entries stand idle. There is no matchmaking, persistence, room lifecycle, or real authentication.

WebSocket messages are `join`, `move`, `bomb`, and `item`, each acknowledged with success or error. The server emits `snapshot` and `finished`; connect and disconnect errors use Socket.IO lifecycle events. Movement and action sequence numbers are independent. Runtime checks reject unknown fields, invalid types, duplicate sequences, unauthorized spectator actions, and excessive messages. Payloads are capped at 1 KiB. Full authoritative snapshots include map changes and are emitted at a configurable rate (default 10 Hz); no browser physics or timers decide network gameplay. For production, replace the local launcher and join boundary with verified authentication and room authorization, retain the session/game boundary, and add lifecycle/resource limits before exposing any service.

## Phase 7 development limits and future integration

The development server expires sessions after 120 seconds with no connected members or five minutes after completion. Defaults are at most 32 sessions, 256 concurrent WebSocket connections, and 24 members per session; an unjoined socket is disconnected after 10 seconds. `MAX_SESSIONS`, `MAX_CONNECTIONS`, `MAX_SESSION_CONNECTIONS`, `EMPTY_SESSION_MS`, and `COMPLETED_SESSION_MS` configure the launcher limits. Disconnecting still stops input and permanently reserves that development slot for the life of the session. Closed/completed session timers are stopped; cleanup closes any remaining sockets. These limits and the policy are temporary, not a production room lifecycle.

The server checks loopback address, Host and browser Origin, caps incoming payloads at 1 KiB, limits known event rates, disconnects unknown events, validates exact message fields and sequences, and never accepts a client player ID or team. WebSocket per-message compression reduces repeated full snapshots when the client negotiates it. Joins, including late spectators, receive a complete map and snapshot. Full snapshots keep wall changes and resynchronization correct. The server uses a monotonic fixed-step accumulator and limits catch-up to five ticks to avoid a long blocking burst after a pause; excess elapsed time can be dropped under sustained overload.

For a production adapter, the future authentication boundary must verify the signed, unexpired JWT and expected algorithm using the auth server public key **before** accepting a socket; derive a stable subject solely from the verified token. A separate room authorization boundary must map that subject to an existing roster slot or spectator permission and team assigned by the trusted room service. Only then attach that immutable server-side identity to a socket and route it into the authoritative session. Deny missing, expired, forged, wrong-algorithm or unauthorized joins; never trust client player IDs, team IDs, or result claims. Replace and disable the development launcher entirely, add authenticated reconnect and bounded lifecycle policies, and use WSS through the production proxy. No JWT verifier is implemented in this development-only service.

## Phase 7 local performance sample

Reproduce with `npm.cmd run typecheck` followed by `node --expose-gc scripts/benchmark.mjs`. A short local run on Windows, Node v26.13.1, Ryzen 5 6600H (12 logical CPUs), used idle players and loopback Socket.IO clients; it is not a production capacity test. Each run lasted approximately three seconds. Before the accumulator fix, the same machine advanced about 65 ticks in three seconds; after it, one eight-player session and four concurrent eight-player sessions each advanced 91 ticks. One observed client received 30 snapshots in each run, averaging 100.1 ms (one session) and 100.0 ms (four sessions); observed interval ranges were 90.7?111.5 ms and 71.2?121.2 ms respectively. One input-to-observed-snapshot sample was 112.6 ms and 47.0 ms respectively; these are single samples, not latency percentiles.

An eight-player snapshot event serialized to 10,149 bytes of JSON; a standalone raw-deflate estimate was 1,279?1,281 bytes. This estimate is not a measurement of actual WebSocket wire bytes and depends on content and negotiated compression. The map alone was 6,576 bytes of a 9,558-byte snapshot before event framing. With forced garbage collection, 16 idle eight-player sessions increased the measured V8 heap by 834,400 bytes, about 52,150 bytes per session in this run; this excludes other process/native memory and connected socket costs and is not a capacity guarantee. The benchmark source records its conditions and can be rerun on the target host.
