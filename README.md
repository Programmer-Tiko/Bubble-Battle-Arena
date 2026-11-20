# Bubble Battle Arena

**A real-time multiplayer water-balloon battle game inspired by Crazy Arcade (BnB) and classic Bomberman-style arena gameplay.**

> **Status:** A headless engine and Phaser prototype implement movement, bombs, items, inventory, and local development multiplayer. Authentication, the full lobby, and deployment remain planned. This README records the agreed game design and proposed architecture for the University at Buffalo CSE 312 team project.

## 1. Project Overview

Bubble Battle Arena is a browser-based, top-down, 2D multiplayer game. Players navigate a destructible tile-based arena, place water bombs, uncover power-ups, deploy traps, and compete either individually or in two-person teams.

Unlike a conventional elimination game, bomb blasts **trap** players rather than eliminating them immediately. A trapped player can be rescued by a teammate, eliminated early by an opponent, or automatically eliminated when the 10-second trap timer expires. All movement, bombs, collisions, rescues, item events, and match results are intended to be synchronized in real time over WebSockets.

**Target capacity:** 4–8 active players per room, multiple simultaneous rooms, and spectators for in-progress matches. The multi-room and spectator design is intended to help accommodate audience participation during the course presentation; course-staff confirmation of the 8-player-per-match cap is still important.

## 2. Game Lobby and Rooms

### Main lobby

- Authenticated users can browse, create, and join rooms.
- Multiple rooms can exist and run matches at the same time.
- Every room displays its **title**, **game mode**, **current players / capacity**, **status** (`Waiting` or `In Game`), and **visibility** (`Public` or `Private`).
- Private rooms require a password to join; public rooms do not.
- New players cannot join an active match as combatants. They may enter **spectator mode** instead. After the match, spectators can elect to join as players if a slot is available.

### Room creation

The room creator becomes the **host** and chooses:

| Setting | Options |
| --- | --- |
| Room title | Custom text |
| Maximum active players | 4–8 (FFA); 4, 6, or 8 (Team Battle) |
| Mode | Free-for-All or Team Battle |
| Visibility | Public or password-protected Private |
| Password | Required for a Private room |

### Readiness, start, and host transfer

- Each non-host player toggles **Ready / Not Ready**. **The host does not need to ready up.**
- A match becomes start-eligible only if its player count and team composition are valid **and every non-host player is Ready**.
- Once eligible, a **10-second automatic-start countdown** begins.
- During that countdown, the host may click **Start Game** to start immediately; the match otherwise starts when the countdown reaches zero.
- The host cannot bypass readiness or composition requirements with a manual start.
- If someone cancels Ready, the match is no longer start-eligible; a pending countdown should be cancelled.
- If someone leaves before the start, eligibility is recalculated using the remaining players; other players keep their Ready states. If eligible again, start a fresh countdown.
- If the host leaves, the earliest-joined remaining active room player becomes the new host.

## 3. Game Modes and Winning

### Free-for-All (FFA)

- **4–8 players**, including odd counts such as 5 or 7.
- Every player is a separate team; there is no teammate rescue.
- The last surviving player wins.

### Team Battle

- **2 players per team**, with **4 players / 2 teams**, **6 players / 3 teams**, or **8 players / 4 teams**.
- Players **choose their teams**; their team color/appearance updates accordingly.
- A match cannot start if any participating team has fewer or more than 2 players. For example, `2+2+2` is valid while `2+2+1+1` and `2+2+2+1` are invalid.
- The last team with at least one surviving member wins.
- Teammates can rescue trapped teammates. Bombs still affect **everyone**, including the bomb owner and allies (friendly fire is ON).

### Time limit

- Each match lasts **at most 10 minutes**.
- If only one player/team remains alive earlier, the match ends immediately.
- At the 10-minute limit, the player/team with the largest number of surviving members wins.
- If the largest surviving-member count is tied, the result is a **draw**. In FFA, multiple survivors at the time limit therefore draw.
- Eliminated players switch to **spectator mode** and do not re-enter that match.

## 4. Arena and Spawning

- The game uses a top-down **tile-based** arena.
- The **entire outer border** consists of indestructible walls.
- A small number of **indestructible walls** are also distributed randomly inside the map.
- Other walls may be **destructible**, opening paths when destroyed; destroying a wall may reveal an item.
- Players spawn at randomly assigned **valid, safe** spawn positions.
- The map generator/validator should avoid placing players inside walls or in completely inaccessible positions.

## 5. Bombs and Explosions

- Players place bombs at their current tile. Each bomb has a **3-second fuse**.
- The initial blast radius is **1 tile in each cardinal direction**, plus the bomb tile itself: a cross-shaped area of up to **5 tiles**.
- For a bomb placed at `(1, 1)`, the unobstructed blast affects `(1,1)`, `(0,1)`, `(2,1)`, `(1,0)`, and `(1,2)`.
- Blast Range power-ups extend the cross along the four directions.
- Explosions destroy destructible walls and cannot destroy indestructible walls.
- **Chain reactions are enabled**: an explosion reaching another bomb may detonate it immediately.
- A blast can trap any player, regardless of who placed the bomb.
- The server—not the client—decides bomb placement validity, blast propagation, collisions, wall destruction, and player status.

**Details to finalize:** blast visual duration; exactly how blast propagation behaves after hitting destructible walls; initial bomb capacity and power-up caps; collision rules for two players occupying one tile.

## 6. Trapping, Rescue, and Elimination

1. A player hit by a blast enters the **Trapped** state for **10 seconds**.
2. While trapped, the player **cannot move, place bombs, or use items**.
3. In Team Battle, a **teammate touching/passing through** the trapped player rescues them.
4. An **opponent touching/passing through** the trapped player eliminates them immediately.
5. If nobody rescues the player before the 10-second timer expires, the player is eliminated automatically.
6. In FFA, all other players are opponents, so no rescue is possible.
7. Eliminated players become spectators; their remaining items are dropped according to the rules below.

**Detail to finalize:** whether a second explosion while already trapped has no effect, resets the timer, or immediately eliminates the player.

## 7. Items, Power-Ups, and Inventory

### Passive power-ups — apply immediately on pickup

| Item | Effect |
| --- | --- |
| **Speed Boots** | Each pair adds **10% of base movement speed**, stacking additively: `speed = baseSpeed × (1 + 0.10 × boots)` when not slowed. |
| **Bomb Capacity Upgrade** | Increases the number of bombs the player can have active simultaneously. |
| **Blast Range Upgrade** | Extends bomb blast distance in each cardinal direction. |

The **initial map item supply contains 4 pairs of Speed Boots across the entire arena**. Additional boots delivered by the hot-air balloon **do not count toward this initial four-pair supply**, so the total number of boots introduced in a match can exceed four.

### Placeable consumable traps

| Item | Charges per pickup | Triggered effect |
| --- | ---: | --- |
| **Banana Peel** | **2 placements** | Forces the player to slide uncontrollably in their current movement direction until obstructed by a destructible wall, indestructible wall, or bomb. A bomb explosion during the slide can still trap the player. |
| **Slowdown Trap** | **5 placements** | Sets movement speed to **50% of base speed for 10 seconds**, ignoring all Speed Boots during the debuff. When the timer ends, speed returns to the current boots-adjusted value. |

- Only placeable consumables occupy the **five-slot inventory**; passive power-ups apply immediately.
- Slots map to number keys **1–5**. Using a slot places one trap at the player's current position and consumes **one charge**.
- Repeated pickups of the **same trap type stack in the existing slot**. For example, Banana Peel `×1` plus another pickup (`+2`) becomes `×3`, not a new slot.
- A placed trap becomes active **only after its owner leaves its tile for the first time**.
- Once active, **any player, including the owner**, can trigger it.
- A trap **disappears after its first trigger**.
- An inventory slot becomes available again when its remaining charge count reaches zero.

### Elimination drops

When a player is eliminated:

- The player's **Speed Boots**, **Bomb Capacity Upgrades**, and **Blast Range Upgrades** scatter onto valid map positions and remain **collectible**.
- The player's unused **Banana Peel** and **Slowdown Trap** items also scatter, but become **non-collectible ground hazards**: stepping on one triggers its effect immediately instead of adding charges to the inventory.
- Drop tiles must be valid; the exact conversion of remaining stacked trap charges into world objects is still to be finalized.

## 8. Hot-Air Balloon Supply Event

- At **3:00, 6:00, and 9:00** of a 10-minute match, a hot-air balloon slowly floats across the screen.
- On each visit, it drops **4–6 randomly selected items** at random valid positions in the arena.
- All existing item types are eligible (boots, capacity, blast range, banana peel, slowdown).
- A drop may repeat item types, but **cannot consist entirely of one type**: each visit must contain **at least two distinct item types**.
- Items land only on **walkable tiles without a bomb or another item**. Newly chosen drop tiles must also be distinct from one another.
- Any boots delivered by the balloon are **additional** to the original four-pair map supply.
- Supply events, item selection, valid drop positions, and collection are decided on the server and broadcast to clients.

**Detail to finalize:** whether a supply item can land on an occupied player tile, and whether that causes immediate pickup.

## 9. Planned User Experience

1. **Register / log in** and enter the lobby.
2. **Create or join** a public/password-protected room.
3. **Choose a team** (if applicable), and non-host players mark themselves Ready.
4. When the roster is valid and all non-host players are ready, the **10-second countdown** begins. The host may start sooner.
5. **Play in real time:** move, place bombs, destroy walls, pick up items, use traps, rescue teammates, and eliminate opponents.
6. **Watch supply balloons** at 3-minute intervals and compete over the new items.
7. **Win, lose, or draw**; eliminated users and late arrivals can spectate.
8. Return to the room to play again; spectators may join as players when spaces are available.

## 10. Proposed Technical Architecture (Not Yet Implemented)

| Layer | Proposed technology | Responsibility |
| --- | --- | --- |
| Browser frontend | **TypeScript + Phaser 3** | 2D tile rendering, controls, animations, lobby, inventory and spectator UI |
| Web application / game server | **Node.js + TypeScript + Express** | HTTP APIs, rooms, game loop, authoritative physics and rules |
| Real-time transport | **Socket.IO over WebSockets** | Room-scoped events, player inputs, state snapshots, spectator updates |
| Authentication server | **Separate Node.js service** | `/register`, `/login`, `/logout`, password hashing, RS256 JWT issuing |
| Database | **PostgreSQL in its own container** | Users, room metadata if needed, optional match history |
| Reverse proxy | **nginx** | Route auth requests to Auth Server, app traffic to Game Server, proxy WebSocket upgrades |
| Local orchestration | **Docker Compose** | Launch nginx, frontend/app, auth server, and database |
| Production | **Public host + domain + valid HTTPS** | TLS, HTTP-to-HTTPS redirect, WSS connections |

**Illustrative request flow:**

```text
Browser (HTTP / HTTPS + WS / WSS)
              |
            nginx
           /     \
  /register,      Other HTTP routes + WebSocket upgrade
  /login,             |
  /logout             v
     |           Game / App Server
     v           - rooms and matchmaking
  Auth Server     - authoritative tick loop
  - password DB  - bomb/trap/game rules
  - private key  - verify JWT with public key
  - issue JWT              |
       |                    |
       +-------- PostgreSQL +
                 (internal network)
```

### Authentication requirements

- Auth operations go directly from nginx to an **independent auth container** and must **never pass through the game/app container**.
- Auth issues JWTs signed with a **private asymmetric key** (planned: **RS256**); only the auth server can access that private key.
- The game server verifies JWTs using the **public key locally**, without contacting the auth server or database to verify identity.
- JWTs have an `exp` claim. Reject expired, incorrectly signed, and wrong-algorithm tokens.
- The game server verifies the JWT **before accepting the WebSocket connection**. Player identity is taken from the verified token, **never from a user-supplied username field**.
- Persist account data, signing keys, and auth state appropriately across container restarts.

### Multiplayer networking principles

- Maintain **separate authoritative game state per room**, with several rooms active simultaneously.
- Clients send **player inputs**, not claims that a hit, rescue, item pickup, or win occurred.
- The server validates movement, timers, collisions, pickups, bombs, rescue/elimination, and victory.
- Broadcast room-scoped snapshots/events at a stable tick rate; use client-side interpolation where helpful.
- Late spectators receive a full state snapshot before live updates.
- The same app must support **local WS over HTTP** and **production WSS over HTTPS**.

### Proposed repository structure

```text
Bubble-Battle-Arena/
├── README.md
├── compose.yaml                  # Planned: local Docker Compose
├── frontend/                     # Planned: TypeScript + Phaser game and lobby
├── services/
│   ├── game/                     # Planned: rooms, WebSockets, game state, rules
│   └── auth/                     # Planned: registration, login, JWT issuer
├── infra/
│   └── nginx/                    # Planned: reverse-proxy configuration
├── docs/                          # Planned: protocol / game-rules documentation
└── tests/                         # Planned: integration and game-logic tests
```

This tree is a **proposal**, not a claim that these files currently exist.

## 11. CSE 312 Objectives and Acceptance Plan

### Objective 1 — Deployment

- Use a real **web framework**, Docker and **Docker Compose**, and **nginx reverse proxy**.
- `docker compose up` must make the app accessible at **http://localhost:8080/**, including a `/` homepage.
- Run the database in its **own container**, not as a host-local SQLite instance.
- Deploy publicly with **domain name**, **valid HTTPS certificate**, and **HTTP port 80 → HTTPS port 443** redirects.
- Include a real deployed URL and complete local/production setup instructions in this README **when implementation exists**.

### Objective 2 — Authentication

- Register, log in, log out; visually identify the logged-in user.
- Separate auth container routed by nginx, asymmetric signed JWT, independent verification by app server, expiry enforcement, and persistent login across restarts.

### Objective 3 — Real-Time Shared Space

- Simultaneous players in a visually shared arena; bombs, movement, traps, rescues, and eliminations genuinely need low-latency WebSockets.
- Verify JWT identity at WebSocket handshake; no impersonation via payloads.
- Support both local WS and production WSS, with spectators and parallel rooms.
- **Open confirmation:** course staff should confirm that 4–8 active players per arena, with multiple simultaneous rooms and spectators, satisfies the presentation/audience participation criteria.

### Objective 4 — Beyond-Course Feature (Proposed; Final Choice Pending)

**Preferred candidate:** a custom **intelligent game bot** using pathfinding plus prediction of timed explosion-danger zones to move, escape traps, and place bombs. The implementation should demonstrate an algorithm beyond material covered in CSE 312 and connect directly to multiplayer gameplay.

**Alternative:** nontrivial procedural map generation with safety/connectivity constraints. The team must choose and implement an eligible feature, document it under this section, and demonstrate evidence during the presentation. A basic use of a different web framework or database alone does not satisfy Objective 4.

### Presentation and individual contribution

- Prepare an **8–10 minute live demo from the publicly deployed HTTPS app**; each team member must attend and speak.
- Let the classroom audience test the app simultaneously without severe failures.
- Each team member must **author their own code commits**, with the relevant commits reaching the repo's **default branch** before the deadline.
- Each team member must submit their **own report and peer evaluation** and link relevant default-branch commits.
- The repository must remain **public** for the Team Details submission.

## 12. Security Checklist

- [ ] Never expose PostgreSQL to the public Internet in production (no public `5432:5432` binding).
- [ ] Never commit private signing keys, TLS private keys, passwords, API keys, or real `.env` secrets.
- [ ] Store auth private key only where the auth container can read it; share **only** the public key with the game server.
- [ ] Hash passwords with a suitable password hashing library.
- [ ] Validate all client messages on the server; enforce input limits and room membership.
- [ ] Handle HTML/script injection, SQL injection, XSRF, secure cookie flags, and other relevant CSE 312 security requirements.
- [ ] Verify JWT signature, expected algorithm, expiry, and identity before accepting WebSockets.
- [ ] Apply safe rate limits for login, registration, and player actions.
- [ ] Test local deployment from a **fresh clone** with `docker compose up`.

> The CSE 312 assignment states that explicit security-concern violations can result in a **0/80 across the four objectives**, subject to the course's security-essay recovery policy.

## 13. Development Workflow

- **Default branch:** `main` (planned).
- Each contributor works on a dedicated branch, commits using their own GitHub identity, and opens a pull request.
- Review and merge finished changes into `main`. **Unmerged branch-only commits do not meet the individual report's default-branch requirement.**
- Suggested initial workstreams: (1) lobby / frontend, (2) game rules / server simulation, (3) auth + persistence, (4) Docker/nginx/deployment + testing, with cross-review and shared integration.
- Keep separate functional tests for readiness/team formation, bomb chains, traps, rescue/elimination, item drops, balloon placement, and match endings.
- Credit any third-party assets/code and observe licenses. Any plan to fork or substantially reuse a pre-existing game should be cleared with course staff.

## 14. Open Design Decisions

The following were **not yet decided** and should not be treated as finalized rules:

- Final arena size, procedural-versus-fixed generation, spawn spacing, and item drop probabilities.
- Default bomb capacity, maximum bomb capacity/range, blast animation duration, and blast propagation past destructible walls.
- How repeated explosions affect an already trapped player.
- Whether supply drops can land on a player's occupied tile and trigger immediate pickup.
- Exact representation of unused inventory charges when a player is eliminated.
- Detailed collision interactions involving forced banana sliding, other players, and chained blasts.
- Inventory full behavior, maximum stack counts, private room password handling, and room lifecycle after matches.
- Final choice and evaluation method for Objective 4.

## 15. Setup and Deployment (To Be Added)

**Local movement prototype:** install Node.js 20.19+ or 22.12+ and run:

```bash
npm install
npm run dev
```

Open the local Vite URL shown in the terminal. Move with WASD or the arrow keys place a bomb with Space, and use inventory slots with 1?5. This is a single-player prototype, not the multiplayer or authentication system. Run `npm test`, `npm run typecheck`, and `npm run build` for verification. See [development notes](docs/development-notes.md) for temporary decisions.

The future deployment must specify any additional configuration and support the following required local workflow:

```bash
git clone <REPOSITORY_CLONE_URL>
cd Bubble-Battle-Arena
docker compose up
# Open http://localhost:8080/
```

**Live URL:** `TBD — add deployed HTTPS domain before submission`

---

**Course:** University at Buffalo — CSE 312 Team Project  
**Team:** Contributors to be added  
**Inspiration:** Crazy Arcade (BnB) / Bomberman-style arena gameplay. This is an original student project concept; no third-party game code is included in this planning README.

## Local multiplayer development (Phase 6)

Use Node.js 20.19+ or 22.12+. Install dependencies with `npm.cmd install`. In two PowerShell terminals run:

```powershell
npm.cmd run server
npm.cmd run dev
```

Open the Vite URL in four separate browser windows. In the first, choose FFA and 4 players, click **Create test session**, copy the session ID, then click **Join** as Player. Paste that ID in each of the other windows and join as Player. Move with WASD or arrows, place a bomb with Space, and use slots 1?5. Movement and bombs should appear in the other windows. A fifth window can join as Spectator and observe but cannot control a player. To check isolation, create a second session and join it in another window. Team Battle accepts 4, 6, or 8 players; teams are assigned in pairs by join order. Unclaimed slots are stationary simulated players. Select **Local mode** to return to the single-player prototype.

Run `npm.cmd test`, `npm.cmd run test:integration`, `npm.cmd run typecheck`, and `npm.cmd run build` to verify. The server listens only on `127.0.0.1:3001`, rejects non-loopback requests and non-local browser origins, and refuses to start with `NODE_ENV=production`. The development launcher is unauthenticated and must not be exposed publicly. It is not the final lobby or identity system.

The server advances the existing engine at 30 ticks per second and sends full snapshots every three ticks. Set `SNAPSHOT_EVERY_TICKS` and `INPUT_STALE_MS` before starting the server to adjust snapshot frequency and stale-input timeout. A disconnected player's input is cleared; their slot stays reserved and their character remains in the match under normal engine rules. Reconnection and disconnect elimination are not implemented. Reloading a player window claims a different unclaimed slot, if any; create a new session to restart.
