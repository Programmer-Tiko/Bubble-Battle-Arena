/** Tiles use integer grid coordinates; player positions use world units. */
export type TileType = "floor" | "indestructible" | "destructible";
export interface Tile { x: number; y: number; type: TileType }
export interface ArenaMap { width: number; height: number; tileSize: number; tiles: Tile[][] }
export type ItemType = "boots" | "capacity" | "range" | "banana" | "slowdown";
export type TrapType = "banana" | "slowdown";
export interface InventorySlot { type: TrapType; charges: number }
export interface GroundItem { id: number; type: ItemType; x: number; y: number; kind: "pickup" | "hazard" | "trap"; ownerId?: string; active: boolean; supplyDroppedAt?: number }
export interface PlayerState { boots: number; capacityUpgrades: number; rangeUpgrades: number; inventory: (InventorySlot | null)[]; slowSeconds: number; slide: MovementInput | null; direction: MovementInput; id: string; teamId: string; x: number; y: number; status: "alive" | "trapped" | "eliminated"; trappedSeconds: number }
export type PublicPlayerState = Omit<PlayerState, "trappedSeconds">;
/** Directional intent suitable for either WASD or arrow keys. */
export interface MovementInput { up: boolean; down: boolean; left: boolean; right: boolean }
export interface BombState { id: number; ownerId: string; x: number; y: number; remainingSeconds: number; range: number }
/** Bomb data safe to send to ordinary players and spectators. */
export type PublicBombState = Omit<BombState, "remainingSeconds">;
export interface ExplosionState { id: number; x: number; y: number; remainingSeconds: number }
export interface BalloonState { startedAt: number; durationSeconds: number }
export type MatchResult = { kind: "winner"; teamId: string } | { kind: "draw" };
export interface SupplyPreview { announcedAt: number; scheduledAt: number; tiles: { x: number; y: number }[] }
export interface GameState { tick: number; elapsedSeconds: number; result: MatchResult | null; map: ArenaMap; players: PlayerState[]; bombs: BombState[]; explosions: ExplosionState[]; items: GroundItem[]; balloon: BalloonState | null; supplyPreview: SupplyPreview | null }
/** Full state is for the authoritative engine and server-side bot only. */
export interface AuthoritativeGameSnapshot extends GameState {}
/** Network snapshots must use a server-side projection, not a type cast. */
export interface GameSnapshot extends Omit<GameState, "bombs" | "players"> { bombs: PublicBombState[]; players: PublicPlayerState[] }

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
