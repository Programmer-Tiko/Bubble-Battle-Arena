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
