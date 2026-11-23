import type { ArenaMap, TileType } from "@bubble/shared";
import { seededRandom } from "./random.js";

export interface GridPosition { x: number; y: number }
export interface MapConfig {
  width: number; height: number; tileSize: number; playerCount: number;
  indestructibleDensity: number; destructibleDensity: number; maxAttempts: number; seed: number;
}
/** Temporary gameplay defaults; dimensions, densities and spacing are not final rules. */
export const DEFAULT_MAP_CONFIG: MapConfig = {
  width: 30, height: 26, tileSize: 32, playerCount: 4,
  indestructibleDensity: 0.06, destructibleDensity: 0.22, maxAttempts: 100, seed: 1,
};
export interface GeneratedMap { map: ArenaMap; spawns: GridPosition[]; usedFallback: boolean }
const key = (x: number, y: number) => `${x},${y}`;
const neighbors = (p: GridPosition): GridPosition[] => [
  { x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y },
  { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 },
];
function validateConfig(c: MapConfig): void {
  if (!Number.isInteger(c.width) || !Number.isInteger(c.height) || c.width < 9 || c.height < 9 ||
      !Number.isFinite(c.tileSize) || c.tileSize <= 0 || !Number.isInteger(c.playerCount) || c.playerCount < 1 || c.playerCount > 8 ||
      !Number.isInteger(c.maxAttempts) || c.maxAttempts < 0 || !Number.isInteger(c.seed) ||
      !Number.isFinite(c.indestructibleDensity) || !Number.isFinite(c.destructibleDensity) ||
      c.indestructibleDensity < 0 || c.destructibleDensity < 0 || c.indestructibleDensity + c.destructibleDensity > 1) {
    throw new RangeError("Invalid map configuration");
  }
}
/** All spawn tiles must be floor, have an exit, and share one walkable component. */
export function areSpawnsConnected(map: ArenaMap, spawns: GridPosition[]): boolean {
  if (!spawns.length || new Set(spawns.map(p => key(p.x, p.y))).size !== spawns.length) return false;
  const floor = (p: GridPosition) => map.tiles[p.y]?.[p.x]?.type === "floor";
  if (spawns.some(p => !floor(p) || !neighbors(p).some(floor))) return false;
  const seen = new Set([key(spawns[0].x, spawns[0].y)]);
  const queue = [spawns[0]];
  for (let i = 0; i < queue.length; i++) {
    for (const next of neighbors(queue[i])) {
      const k = key(next.x, next.y);
      if (floor(next) && !seen.has(k)) { seen.add(k); queue.push(next); }
    }
  }
  return spawns.every(p => seen.has(key(p.x, p.y)));
}
/** Remove isolated floor pockets so every initially traversable tile is reachable. */
function sealDisconnectedFloors(map: ArenaMap, start: GridPosition): void {
  const seen = new Set([key(start.x, start.y)]), queue = [start];
  for (let i = 0; i < queue.length; i++) for (const next of neighbors(queue[i])) {
    const k = key(next.x, next.y);
    if (map.tiles[next.y]?.[next.x]?.type === "floor" && !seen.has(k)) { seen.add(k); queue.push(next); }
  }
  for (const tile of map.tiles.flat()) if (tile.type === "floor" && !seen.has(key(tile.x, tile.y))) tile.type = "destructible";
}
/** Build a reproducible map, falling back to an open interior after bounded retries. */
export function generateMap(overrides: Partial<MapConfig> = {}): GeneratedMap {
  const c = { ...DEFAULT_MAP_CONFIG, ...overrides };
  validateConfig(c);
  const random = seededRandom(c.seed);
  const midX = Math.floor(c.width / 2), midY = Math.floor(c.height / 2);
  const candidates: GridPosition[] = [
    { x: 1, y: 1 }, { x: c.width - 2, y: c.height - 2 },
    { x: c.width - 2, y: 1 }, { x: 1, y: c.height - 2 },
    { x: midX, y: 1 }, { x: midX, y: c.height - 2 },
    { x: 1, y: midY }, { x: c.width - 2, y: midY },
  ];
  // Shuffle candidates to avoid giving the same roster the same corners every match.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const spawns = candidates.slice(0, c.playerCount);
  const reserved = new Set<string>();
  for (const spawn of spawns) for (const p of [spawn, ...neighbors(spawn)]) reserved.add(key(p.x, p.y));
  const build = (fallback: boolean): ArenaMap => ({
    width: c.width, height: c.height, tileSize: c.tileSize,
    tiles: Array.from({ length: c.height }, (_, y) => Array.from({ length: c.width }, (_, x) => {
      let type: TileType = "floor";
      if (x === 0 || y === 0 || x === c.width - 1 || y === c.height - 1) type = "indestructible";
      else if (!fallback && !reserved.has(key(x, y))) {
        const roll = random();
        if (roll < c.indestructibleDensity) type = "indestructible";
        else if (roll < c.indestructibleDensity + c.destructibleDensity) type = "destructible";
      }
      return { x, y, type };
    })),
  });
  for (let i = 0; i < c.maxAttempts; i++) {
    const map = build(false);
    if (areSpawnsConnected(map, spawns)) { sealDisconnectedFloors(map, spawns[0]); return { map, spawns, usedFallback: false }; }
  }
  return { map: build(true), spawns, usedFallback: true };
}
