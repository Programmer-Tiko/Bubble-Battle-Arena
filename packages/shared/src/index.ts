export * from "./appearance.js";

/** Tiles use integer grid coordinates; player positions use world units. */
export type TileType = "floor" | "indestructible" | "destructible";
export interface Tile { x: number; y: number; type: TileType }
export interface ArenaMap { width: number; height: number; tileSize: number; tiles: Tile[][] }
export type ItemType = "boots" | "capacity" | "range" | "banana" | "slowdown";
export type TrapType = "banana" | "slowdown";
export interface InventorySlot { type: TrapType; charges: number }
export interface GroundItem { id: number; type: ItemType; x: number; y: number; kind: "pickup" | "hazard" | "trap"; ownerId?: string; active: boolean; supplyDroppedAt?: number }
export interface PlayerState { boots: number; capacityUpgrades: number; rangeUpgrades: number; inventory: (InventorySlot | null)[]; slowSeconds: number; slide: MovementInput | null; direction: MovementInput; id: string; teamId: string; x: number; y: number; status: "alive" | "trapped" | "eliminated"; trappedSeconds: number }
/** Directional intent suitable for either WASD or arrow keys. */
export interface MovementInput { up: boolean; down: boolean; left: boolean; right: boolean }
export interface BombState { id: number; ownerId: string; x: number; y: number; remainingSeconds: number; range: number }
export interface ExplosionState { id: number; x: number; y: number; remainingSeconds: number }
export interface BalloonState { startedAt: number; durationSeconds: number }
export type MatchResult = { kind: "winner"; teamId: string } | { kind: "draw" };
export interface GameState { tick: number; elapsedSeconds: number; result: MatchResult | null; map: ArenaMap; players: PlayerState[]; bombs: BombState[]; explosions: ExplosionState[]; items: GroundItem[]; balloon: BalloonState | null }
export interface GameSnapshot extends GameState {}

/** Development protocol: clients submit intent only, never gameplay state or identity. */
export type SessionMode = "ffa" | "team";
export interface JoinRequest { sessionId: string; role: "player" | "spectator" }
export interface MoveCommand { seq: number; input: MovementInput }
export interface ActionCommand { seq: number }
export interface ItemCommand extends ActionCommand { slot: number }
export type Reply<T = undefined> = { ok: true; value: T } | { ok: false; error: string };
export interface JoinInfo { playerId: string | null; teamId: string | null; snapshot: GameSnapshot }
export interface ClientEvents {
  join: (request: JoinRequest, reply: (result: Reply<JoinInfo>) => void) => void;
  move: (command: MoveCommand, reply: (result: Reply) => void) => void;
  bomb: (command: ActionCommand, reply: (result: Reply) => void) => void;
  item: (command: ItemCommand, reply: (result: Reply) => void) => void;
}
export interface ServerEvents {
  snapshot: (snapshot: GameSnapshot) => void;
  finished: (result: MatchResult) => void;
}



/* ------------------------------------------------------------------------------------
 * Lobby and rooms (proposed). The Room Manager runs in the same Node process as the
 * game server. Identity always comes from the JWT verified during the WebSocket
 * handshake; no request below carries a username, player ID, or host flag.
 * ---------------------------------------------------------------------------------- */
export type RoomVisibility = "public" | "private";
/** waiting -> countdown -> in_game -> results -> waiting. "results" keeps the result visible before the room resets. */
export type RoomStatus = "waiting" | "countdown" | "in_game" | "results";
export type RoomRole = "player" | "spectator";
/** Team Battle colors chosen in the room. FFA rooms use null (the server gives each player their own team). */
export type TeamColor = "red" | "blue" | "green" | "yellow";
/** Same values as BotDifficulty in @bubble/bot. */
export type BotDifficulty = "easy" | "normal" | "hard";

/** Chosen by the host when creating a room. The server trims and validates every field. */
export interface RoomSettings {
  title: string;               // 1-40 characters
  mode: SessionMode;
  maxPlayers: number;          // FFA 4-8; Team Battle 4, 6, or 8 (humans + bots)
  visibility: RoomVisibility;
  bots: number;                // slots filled by bots when the match starts (0 for none)
  botDifficulty: BotDifficulty;
}
/** password is required for private rooms, ignored for public ones, and never sent back to any client. */
export interface CreateRoomRequest extends RoomSettings { password?: string }
export interface JoinRoomRequest { roomId: string; role: RoomRole; password?: string }
export interface TeamRequest { teamId: TeamColor }
export interface ReadyRequest { ready: boolean }

/** One row of the lobby list. */
export interface RoomSummary {
  id: string; title: string; mode: SessionMode; visibility: RoomVisibility; status: RoomStatus;
  players: number; maxPlayers: number; spectators: number;
}
/** Usernames are user-provided text: render with textContent or Phaser text, never innerHTML. */
export interface RoomMember {
  username: string; role: RoomRole; teamId: TeamColor | null; ready: boolean; isHost: boolean; connected: boolean;
}
/** Everything a client in the room needs to draw the room screen. Sent after every change. */
export interface RoomState {
  id: string; settings: RoomSettings; status: RoomStatus; members: RoomMember[];
  countdownEndsAt: number | null;   // epoch milliseconds while status is "countdown"
  matchId: string | null;           // set once when a match starts; a matchId can start only one game
  lastResult: MatchResult | null;   // shown during "results"
}

/** Sent to each room member when the match begins. Spectators get null IDs. */
export interface MatchStart { roomId: string; matchId: string; playerId: string | null; teamId: string | null; snapshot: GameSnapshot }
/** Sent once per match, before the room leaves "results". */
export interface MatchFinished { roomId: string; matchId: string; result: MatchResult }
/** Why the server is about to close this connection. "replaced" = the same account connected again elsewhere. */
export type SessionEndReason = "logout" | "expired" | "replaced";

export interface LobbyClientEvents {
  "lobby:list": (reply: (result: Reply<RoomSummary[]>) => void) => void;
  "room:create": (request: CreateRoomRequest, reply: (result: Reply<RoomState>) => void) => void;
  "room:join": (request: JoinRoomRequest, reply: (result: Reply<RoomState>) => void) => void;
  "room:leave": (reply: (result: Reply) => void) => void;
  "room:team": (request: TeamRequest, reply: (result: Reply) => void) => void;
  "room:ready": (request: ReadyRequest, reply: (result: Reply) => void) => void;
  "room:start": (reply: (result: Reply) => void) => void;   // host only, and only when start-eligible
}
export interface LobbyServerEvents {
  "lobby:rooms": (rooms: RoomSummary[]) => void;
  "room:state": (room: RoomState) => void;
  "match:start": (start: MatchStart) => void;
  "match:finished": (event: MatchFinished) => void;
  "session:end": (event: { reason: SessionEndReason }) => void;
}
