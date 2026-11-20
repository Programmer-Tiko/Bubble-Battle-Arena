/** Tiles use integer grid coordinates; player positions use world units. */
export type TileType = "floor" | "indestructible" | "destructible";
export interface Tile { x: number; y: number; type: TileType }
export interface ArenaMap { width: number; height: number; tileSize: number; tiles: Tile[][] }
export interface PlayerState { id: string; x: number; y: number }
/** Directional intent suitable for either WASD or arrow keys. */
export interface MovementInput { up: boolean; down: boolean; left: boolean; right: boolean }
export interface GameState { tick: number; map: ArenaMap; players: PlayerState[] }
export interface GameSnapshot { tick: number; map: ArenaMap; players: PlayerState[] }
