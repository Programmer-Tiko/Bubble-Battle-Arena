# Integration handoff

This guide describes the code on `main` after Phases 1A–7 and a proposed boundary for the teammate-owned services. **Only the APIs explicitly marked existing are implemented.** The current game server is a loopback-only, unauthenticated development service; it rejects production startup. It is not a production room manager, authentication service, or reconnect implementation. Confirmed game rules remain in [README.md](../README.md); temporary defaults and measurements are in [development notes](development-notes.md).

## Current architecture and authority

```text
Browser: Phaser -> GameAdapter -> Socket.IO (WebSocket)
                                      |
Local-only Express/Socket.IO server -> one Game instance per development session
                                      |
                              room-scoped full snapshots
```

- **Existing `packages/engine`** owns map generation, movement/collision, bombs and explosions, traps/rescues/elimination, items/inventory, balloon events, match time, and results. `Game.step()` advances one fixed simulation tick; `getSnapshot()` returns a detached state copy. The default timestep is 1/30 second. No Phaser or networking code decides gameplay outcomes.
- **Existing `services/game`** creates isolated sessions and drives each engine on a bounded fixed-step accumulator. It validates intents, sequences and session roles, clears stale or disconnected movement, broadcasts full snapshots every three ticks by default, and stops a completed game. Limits and cleanup are development defaults, not a production lifecycle.
- **Existing `frontend`** has a `LocalGameAdapter` that runs an engine only for isolated local testing and a `NetworkGameAdapter` that sends inputs and renders received snapshots. `frontend/src/main.ts` currently connects to `VITE_GAME_SERVER` or `http://127.0.0.1:3001`; a production adapter must use the deployed origin/path and authenticated handshake. There is no client-side authoritative simulation in network mode.
- **Existing `packages/shared/src/index.ts`** defines the event types, snapshots and gameplay state. Integration tests use real local Socket.IO clients in `services/game/tests/socket.test.ts`.

The current map generator, item distribution and other provisional behavior are documented separately. Sessions, IDs and state are in memory; server restart loses them. Full snapshots include the current map, including destroyed walls. Compression is negotiated per WebSocket; it does not alter state semantics.

## Existing development entry points

`createGameServer(options)` in `services/game/src/server.ts` returns `{ http, io, sessions, create, tick, cleanup, close }`. **Existing** `create(mode, count)` validates 4–8 FFA players, or 4/6/8 team players, generates random player IDs, assigns fixed pairs in team mode, creates a `Game`, and starts the session immediately. It does **not** accept a verified roster or a Room Manager's chosen teams. The engine itself already accepts trusted IDs and team assignments:

```ts
// Existing engine API; illustrative server-side values, not a production endpoint.
import { Game } from "@bubble/engine";

const playerIds = ["match-player-a", "match-player-b", "match-player-c", "match-player-d"];
const game = new Game(playerIds, {}, {}, {}, {
  mode: "team",
  teams: { "match-player-a": "red", "match-player-b": "red", "match-player-c": "blue", "match-player-d": "blue" },
});
```

`Game` validates distinct nonempty IDs, the match roster, and exactly two players per team; FFA assigns each player their own team. The game server's current `POST /dev/sessions` accepts exactly `{ "mode": "ffa" | "team", "players": number }` and returns `{ "sessionId": string }` on success. Its `join` handler assigns the first never-claimed player slot or accepts a spectator based only on the requested role and session ID. No account or membership is verified. Unclaimed roster entries stay idle. Disconnect clears input and leaves the claimed slot reserved; reconnect is disabled. These are **development behavior only**.

## Existing Socket.IO contract

All current events use the WebSocket transport and require acknowledgement callbacks for client commands. The shared types below are implemented in `packages/shared/src/index.ts`; the server enforces exact keys and types. `seq` is a nonnegative safe integer. Movement and actions have separate monotonically increasing sequences; bomb and item share the action sequence. A sequence must be greater than the previous validated one for that stream. A valid action consumes its sequence even when the requested action is unavailable.

| Direction | Event and payload | Existing behavior |
| --- | --- | --- |
| Client → server | `join: { sessionId: string, role: "player" \| "spectator" }` | One join per connection. Ack is `Reply<JoinInfo>`: success contains `{ playerId: string \| null, teamId: string \| null, snapshot: GameSnapshot }`; spectator IDs are null. |
| Client → server | `move: { seq: number, input: { up: boolean, down: boolean, left: boolean, right: boolean } }` | Sets the server-side player's input. |
| Client → server | `bomb: { seq: number }` | Requests bomb placement. |
| Client → server | `item: { seq: number, slot: number }` | Requests use of zero-based inventory slot 0–4. |
| Server → joined session | `snapshot: GameSnapshot` | Public projection of the current state; exact bomb and trapped-player countdowns are omitted. A new join's acknowledgement contains the same public projection. |
| Server → joined session | `finished: MatchResult` | Once, when a game ends: `{ kind: "winner", teamId: string }` or `{ kind: "draw" }`. The final snapshot is also broadcast. |

An ack is `{ ok: true, value: ... }` or `{ ok: false, error: string }`; a successful command's `undefined` value may be omitted by JSON serialization. Connection errors and disconnections use Socket.IO lifecycle events rather than custom gameplay events. The server rejects unknown events, unauthorized spectator actions, invalid or extra fields, duplicate/out-of-order sequences, and oversized payloads. The default incoming payload limit is 1 KiB and the per-socket known-event limit is 90 messages per second. A client supplies no position, team, identity, inventory count or result.

There is **no explicit resync event** today: the full join snapshot and periodic full snapshots supply current state. A production integration should specify authenticated resync and reconnection semantics before changing this contract. The current `finished` event is a client broadcast, has no session ID in its payload, and is not a durable Room Manager notification.

## Proposed trusted Room Manager boundary — not implemented

The Room Manager must authenticate and authorize its own server-to-server call. It should validate that the room is start-eligible: 4–8 FFA players or 4/6/8 team players; exactly two players per team; all non-host players ready; and an eligible automatic countdown or host start. Player-selected teams must be frozen in the roster at start. The host cannot bypass eligibility. It should allocate a match once, with an idempotency key, then hand the game service a trusted roster and map stable account subjects to opaque match player IDs. The game service must validate the roster again and construct `Game` with its IDs and `MatchConfig`; it must not route this request through the current `create(mode, count)`, which generates different IDs and pairs.

The following are **proposed interfaces**, not exports or implemented endpoints:

The shared `MatchStart.snapshot` uses the public `GameSnapshot` contract. Future match-start serialization must call the server's `publicSnapshot()` projection before sending it: a TypeScript type annotation or cast does not remove authoritative `remainingSeconds` or `trappedSeconds` at runtime. Keep `AuthoritativeGameSnapshot` for the engine and server-side bots, and test match-start redaction for players, spectators, and late joins when that boundary is implemented.

```ts
import type { MatchResult, SessionMode } from "@bubble/shared";

type VerifiedSubject = string; // supplied only by a successful server-side verification
interface TrustedRosterEntry {
  subject: VerifiedSubject;     // stable verified account ID; never trust a client claim
  playerId: string;             // opaque ID chosen by the trusted match service
  teamId: string;               // distinct for FFA; exactly two roster entries per team otherwise
}
interface StartMatchRequest {
  roomId: string;
  matchId: string;              // stable idempotency key for this match
  mode: SessionMode;
  roster: readonly TrustedRosterEntry[];
}
interface RoomGameBoundary {
  startMatch(request: StartMatchRequest): Promise<{ sessionId: string }>;
  reportFinished(event: { roomId: string; matchId: string; result: MatchResult }): Promise<void>;
}
```

The actual service boundary, transport, persistence and ownership of `playerId` are unresolved. Protect the internal boundary against untrusted callers. Reject duplicate subjects/IDs, invalid sizes or teams, conflicting repeats of a match ID, and starts for a room that is no longer eligible. Define how retries, crashes and duplicate completion notifications are handled; do not treat the current transient Socket.IO `finished` broadcast as durable delivery. A trusted server-side completion hook should emit one idempotent match result with room/match identity to the Room Manager and store or retry it according to the agreed lifecycle.

## Proposed identity, authorization and reconnection — not implemented

The independent auth service should issue RS256 JWTs with an expiry, signed only by its private key. The game service must verify the token locally with the configured public key and an explicit RS256 allowlist, validate expiry and the agreed issuer/audience and subject, and reject invalid signatures, expired tokens and wrong algorithms. Key distribution, rotation, issuer/audience, cookie policy and revocation behavior need agreement. Do not call the auth server or database per token verification, and never accept a username, player ID or team sent by the browser as proof of identity.

Verify identity **before accepting the WebSocket connection**, then attach an immutable verified subject to the server-side connection context. The Socket.IO `auth` payload is delivered after the Engine.IO WebSocket upgrade, so it alone does not satisfy that pre-upgrade requirement. Choose and review a browser-compatible pre-upgrade credential transport, such as an appropriately secured same-origin cookie, at the Engine.IO handshake/upgrade boundary. Apply origin and CSRF protections appropriate to that choice; avoid logging credentials. Authorization is separate: the trusted Room Manager must establish whether that subject is the rostered player or an allowed spectator in the requested match. A session ID and client-requested role are not authorization. Bind the socket to the server-selected match player ID and team; spectators have no player slot and cannot issue gameplay commands. Eliminated players retain authorized observation only.

**Proposed types**, for discussion rather than code that exists:

```ts
interface VerifiedIdentity { readonly subject: string }
type MatchAccess =
  | { role: "player"; matchId: string; playerId: string; teamId: string }
  | { role: "spectator"; matchId: string };
interface MatchAuthorization {
  authorize(identity: VerifiedIdentity, matchId: string): Promise<MatchAccess | null>;
}
```

For reconnect, first decide grace period, duplicate connections, session expiry, and whether a disconnected player can be eliminated. On a new connection, reverify the credential, reauthorize the same subject and match, and atomically bind it to the existing reserved player slot; reject another subject and resolve simultaneous connections according to the agreed policy. Clear stale movement on disconnect and on rebinding, reset or version command sequences per authenticated connection, and send a current full snapshot before live updates. Do not let knowledge of a session ID reclaim a slot. Current development behavior has no reconnect path and deliberately never reassigns a claimed slot.

## Production boundary and nginx — proposed

Disable/remove `POST /dev/sessions`, the browser's development session creation controls, arbitrary `join` role/slot assignment, auto-generated development rosters, and local-only test identities in production. `createGameServer` currently throws when `NODE_ENV=production`, binds to loopback in `services/game/src/index.ts`, and rejects non-loopback/other origins: production integration requires a deliberately separate authenticated entry point or refactor, not simply exposing this process or switching off its checks.

The future nginx reverse proxy should route `/register`, `/login`, and `/logout` directly to the independent auth service; route application and room requests to their appropriate service; and route the Socket.IO path (currently the default `/socket.io/`) to the authenticated game service. Preserve the WebSocket HTTP/1.1 upgrade and connection headers, and choose proxy read/idle timeouts compatible with Socket.IO heartbeats. Terminate valid HTTPS at the proxy, redirect HTTP to HTTPS, and use WSS for the browser. Configure trusted origins, credential forwarding, proxy trust and network isolation explicitly; do not expose the development listener or auth private key. The exact routes, upstream names, ports and nginx configuration are not implemented.

## Integration acceptance tests — future work

These are **requirements**, not claims that the teammate's modules exist:

- Register, log in, log out, reject duplicate or invalid credentials, and confirm persistent login and appropriate password storage.
- Accept a valid RS256 JWT; reject expired, forged, missing, malformed, wrong-algorithm, wrong-issuer/audience and wrong-key tokens at the pre-upgrade boundary. Test key rotation according to the chosen policy.
- Allow authorized room membership and deny unauthorized/private-room access; never accept a supplied account/player/team identity as authority.
- Validate readiness, host transfer, countdown cancellation/restart and team composition; permit host start only after eligibility is met.
- Reject an unauthenticated or unauthorized WebSocket handshake and enforce authorization for player and spectator access on every relevant room transition.
- Start multiple concurrent rooms, prove isolated snapshots/actions/results, and preserve engine gameplay and match outcomes through the trusted roster mapping.
- Admit an authorized late spectator with a full current state; reject unauthorized spectators and all spectator control attempts.
- Test the agreed reconnect policy, identity mismatch, expired credentials, simultaneous reconnects, stale input and command replay; ensure disconnected players cannot be taken over.
- Verify HTTPS, HTTP-to-HTTPS redirects, WSS upgrades, origin/credential behavior and proxy heartbeat timeouts in the deployed topology.
- From a fresh clone, run `docker compose up`, reach `http://localhost:8080/`, and exercise auth, rooms and live gameplay with the database in its own container. Confirm persistence across the agreed restarts.

## Decisions still needed

Agree on match/room identifiers and trusted service transport, idempotent start/result delivery, player-ID mapping, spectator permission, reconnect/disconnect policy, JWT claims/key rotation and credential transport, production session capacity/lifecycle, proxy routes and deployment topology. Gameplay defaults and Objective 4 remain open as listed in the README and development notes.
