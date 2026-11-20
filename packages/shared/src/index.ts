/** Tiles use integer grid coordinates; player positions use world units. */
export type TileType = "floor" | "indestructible" | "destructible";
export interface Tile { x: number; y: number; type: TileType }
export interface ArenaMap { width: number; height: number; tileSize: number; tiles: Tile[][] }
export interface PlayerState { id: string; x: number; y: number; status: "alive" | "trapped" | "eliminated"; trappedSeconds: number }
/** Directional intent suitable for either WASD or arrow keys. */
export interface MovementInput { up: boolean; down: boolean; left: boolean; right: boolean }
export interface BombState { id: number; ownerId: string; x: number; y: number; remainingSeconds: number; range: number }
export interface ExplosionState { x: number; y: number; remainingSeconds: number }
export interface GameState { tick: number; map: ArenaMap; players: PlayerState[]; bombs: BombState[]; explosions: ExplosionState[] }
export interface GameSnapshot extends GameState {}
