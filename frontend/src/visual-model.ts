import type { GameSnapshot, PublicPlayerState } from "@bubble/shared";
import { DEFAULT_BOMB_CONFIG } from "@bubble/engine";

/** Gameplay object coordinates are authoritative tile indices, not player positions. */
export const tileCenter = (x: number, y: number, tileSize: number) => ({ x: (x + 0.5) * tileSize, y: (y + 0.5) * tileSize });
/** Cosmetic flight speed is two thirds of the former interpolation speed. */
export const balloonFlightX = (start: number, destination: number, progress: number) => start + (destination - start) * progress * (2 / 3);
/** The normal renderer receives no fuse value and therefore cannot display a countdown. */
export function visibleBombs(snapshot: GameSnapshot) {
  return snapshot.bombs.map(({ id, x, y }) => ({ id, ...tileCenter(x, y, snapshot.map.tileSize) }));
}
/** Keep a bomb above a player on its tile and cycle visibility over a co-located item. */
export function bombAppearance(snapshot: GameSnapshot, bomb: { x: number; y: number }, now: number) {
  const size = snapshot.map.tileSize, x = Math.floor(bomb.x / size), y = Math.floor(bomb.y / size);
  const player = snapshot.players.some(p => p.status !== "eliminated" && Math.floor(p.x / size) === x && Math.floor(p.y / size) === y);
  const item = snapshot.items.some(i => i.x === x && i.y === y);
  return { depth: player ? 14 : 6, scale: player ? .7 : .87, alpha: player && item ? .7 + .3 * Math.sin(now / 450) : 1 };
}
export function visibleItems(snapshot: GameSnapshot) {
  return snapshot.items.map(item => ({ ...item, position: tileCenter(item.x, item.y, snapshot.map.tileSize) }));
}
/** Cycle stacked icons while keeping every displayed object at its tile centre. */
export function displayItems(snapshot: GameSnapshot, now: number) {
  const items = visibleItems(snapshot), groups = new Map<string, typeof items>();
  for (const item of items) {
    const key = `${item.x},${item.y}`, group = groups.get(key) ?? [];
    group.push(item); groups.set(key, group);
  }
  return [...groups.values()].map(group => {
    const item = group[Math.floor(now / 650) % group.length];
    const overlapsBomb = snapshot.bombs.some(b => b.x === item.x && b.y === item.y);
    const overlapsPlayer = snapshot.players.some(p => p.status !== "eliminated" && Math.floor(p.x / snapshot.map.tileSize) === item.x && Math.floor(p.y / snapshot.map.tileSize) === item.y);
    return { item, count: group.length, crowded: group.length > 1 || overlapsBomb || overlapsPlayer };
  });
}
/** Only server-selected upcoming landing tiles are displayed. */
export function supplyMarkers(snapshot: GameSnapshot) {
  return (snapshot.supplyPreview?.tiles ?? []).map((tile, id) => ({ id, ...tileCenter(tile.x, tile.y, snapshot.map.tileSize) }));
}
export function characterStats(player: PublicPlayerState) {
  return { speedPercent: player.slowSeconds > 0 ? 50 : 100 + player.boots * 10, boots: player.boots, capacity: DEFAULT_BOMB_CONFIG.initialCapacity + player.capacityUpgrades, range: 1 + player.rangeUpgrades, inventory: player.inventory };
}
