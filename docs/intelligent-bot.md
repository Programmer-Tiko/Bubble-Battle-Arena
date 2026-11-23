# Intelligent game bot: playable development MVP

This is a proposed Objective 4 implementation; eligibility for the course's beyond-course requirement requires instructor confirmation. The server-controlled bot is intended for local development, not production matchmaking.

## Local demonstration

1. Run `npm.cmd install` at the repository root.
2. In one terminal run `npm.cmd run server`. The development game server listens only on `127.0.0.1:3001` and refuses to start with `NODE_ENV=production`.
3. In another terminal run `npm.cmd run dev`, then open the Vite URL printed in that terminal (normally `http://127.0.0.1:5173/`).
4. Select **FFA**, **4** total players, and **3** bots. Click **Create test session**, then **Join** as **Player**. The match begins immediately after creation, so join promptly. Use WASD or arrows to move and Space to place a bomb.
5. Copy the session ID into another local browser window and join as **Spectator**. The three bots occupy the other player slots and act without additional browsers. The match ends according to the ordinary engine rules. To test teams, select **Team Battle**, four players and two bots. Two human slots and two bot slots form valid pairs in roster order.

All participants count toward the 4–8 player limit. The loopback-only development endpoint accepts `{"mode":"ffa","players":4,"bots":3}`; omitting `bots` preserves the previous behavior. Human joins cannot claim reserved bot slots. Development controls are hidden by the frontend production build. This launcher is not a production room or authentication interface; a future trusted room manager must authorize and allocate roster entries itself.

## Design and behavior

`BotController` receives a detached authoritative snapshot and emits a movement input and optional bomb command; the server invokes `Game.setInput` and `Game.placeBomb`. No bot edits engine state. A controller and its plan belong to one server session and player. It stops sending movement when trapped or eliminated and waits through forced slides.

`HazardMap` predicts current explosions and known bomb fuse times, chain reactions, and the order of destructible-wall changes using the engine's shared blast traversal. Unknown future bombs and player movements are not predictable. A time-expanded A* search uses `(tile, time)` states with cardinal moves and waits. Its Manhattan-distance heuristic multiplied by the discretized tile traversal time is admissible for its restricted graph; a multi-goal escape search uses zero heuristic. The planner checks continuous hazard intervals over transitions, uses current boots or the slower debuffed speed, and treats both endpoint tiles as occupied during a transition. It conservatively avoids active ground hazards and bombs (the engine only treats bombs as solid during forced slides). The controller estimates time to return to a tile centre, follows waypoints using actual positions, avoids overshooting, and invalidates plans when bombs, explosions, or walls change.

The deterministic strategy prioritizes escaping threatened tiles, seeks useful passive upgrades, approaches opponents, and considers a bomb when an opponent is in its predicted blast or a destructible wall is adjacent. It inserts a hypothetical bomb into the hazard model, rejects attacks that threaten a teammate at their current position, and places it only after finding a route to a tile safe through the blast. Other players can move or place bombs after the decision, so escape and friendly-fire avoidance are not guaranteed. Rescue targeting and consumable use are not implemented.

A search uses a fixed horizon and at most 350 nodes for a goal or 500 for an escape; it is complete only in its restricted discretized graph when neither limit is reached. Conservative occupancy can reject feasible routes. At most one bot per session may replan per tick. When the world changes, other bots stop until their scheduled turn, up to seven ticks for eight bots. Execution still runs every tick. These measures limit work but do not establish a hard real-time guarantee across many sessions. The game engine remains authoritative, including collision, inventory, trapping, rescue, elimination, and winning.

## Verification and remaining work

Run `npm.cmd test`, `npm.cmd run test:integration`, `npm.cmd run typecheck`, and `npm.cmd run build`. Tests include real engine ticks, real Socket.IO human/spectator clients, reserved slots, movement around walls, pickup, a safe bomb and escape, friendly-fire avoidance, a bomb threat, status restrictions, match completion, and separate sessions.

This MVP does not yet provide configurable difficulty, a reasoning visualization, baseline comparison, or a reproducible performance benchmark. Detailed evaluation, final Objective 4 documentation, and trusted lobby integration remain future work. Do not treat this as course approval or as a production security boundary.
