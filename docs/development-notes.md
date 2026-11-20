# Development notes

## Phase 1B local prototype

The single-player browser prototype runs the headless engine locally, at the engine's fixed timestep. It is for rendering and controls development; it is not a multiplayer server or an authentication implementation. A future server adapter must receive authoritative snapshots and send input rather than simulate authoritative state in the browser.

The existing map dimensions, densities, spawn spacing, movement speed, and player radius remain temporary engine defaults. Player-to-player collision is unresolved. The prototype drops excess elapsed time after a long browser pause to avoid a catch-up burst.

## Remaining rule decisions

Bomb capacity and caps, explosion visual duration, propagation beyond destructible walls, repeated explosions on trapped players, item-drop probability, scattering of inventory charges, and supply drops on occupied player tiles are unresolved in the README and must be configurable temporary defaults when implemented.

## Phase 2 bomb defaults

Bombs start with capacity 1 and range 1, with provisional capacity and range caps of 8. Blasts last 0.3 seconds visually and stop after destroying the first destructible wall. Further explosions have no effect on an already trapped player. These values are temporary; bomb settings are supplied through `BombConfig`. Bomb-to-player trapping is in place; rescue, team rules and match outcomes remain Phase 3 work.
