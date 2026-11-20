/** Tiles use integer grid coordinates; player positions use world units. */
export type TileType = "floor" | "indestructible" | "destructible";
export interface Tile { x: number; y: number; type: TileType }
export interface ArenaMap { width: number; height: number; tileSize: number; tiles: Tile[][] }
export type ItemType = "boots" | "capacity" | "range" | "banana" | "slowdown";
export type TrapType = "banana" | "slowdown";
export interface InventorySlot { type: TrapType; charges: number }
export interface GroundItem { id: number; type: ItemType; x: number; y: number; kind: "pickup" | "hazard" | "trap"; ownerId?: string; active: boolean }
export interface PlayerState { boots: number; capacityUpgrades: number; rangeUpgrades: number; inventory: (InventorySlot | null)[]; slowSeconds: number; slide: MovementInput | null; direction: MovementInput; id: string; teamId: string; x: number; y: number; status: "alive" | "trapped" | "eliminated"; trappedSeconds: number }
/** Directional intent suitable for either WASD or arrow keys. */
export interface MovementInput { up: boolean; down: boolean; left: boolean; right: boolean }
export interface BombState { id: number; ownerId: string; x: number; y: number; remainingSeconds: number; range: number }
export interface ExplosionState { id: number; x: number; y: number; remainingSeconds: number }
export type MatchResult = { kind: "winner"; teamId: string } | { kind: "draw" };
export interface GameState { tick: number; elapsedSeconds: number; result: MatchResult | null; map: ArenaMap; players: PlayerState[]; bombs: BombState[]; explosions: ExplosionState[]; items: GroundItem[] }
export interface GameSnapshot extends GameState {}
