import type { GameSnapshot, PlayerState } from "@bubble/shared";
import { DEFAULT_BOMB_CONFIG } from "@bubble/engine";

/** Gameplay object coordinates are authoritative tile indices, not player positions. */
export const tileCenter = (x: number, y: number, tileSize: number) => ({ x: (x + 0.5) * tileSize, y: (y + 0.5) * tileSize });
/** The normal renderer receives no fuse value and therefore cannot display a countdown. */
export function visibleBombs(snapshot: GameSnapshot) {
  return snapshot.bombs.map(({ id, x, y }) => ({ id, ...tileCenter(x, y, snapshot.map.tileSize) }));
}
export function visibleItems(snapshot: GameSnapshot) {
  return snapshot.items.map(item => ({ ...item, position: tileCenter(item.x, item.y, snapshot.map.tileSize) }));
}
/** Only server-selected upcoming landing tiles are displayed. */
export function supplyMarkers(snapshot: GameSnapshot) {
  return (snapshot.supplyPreview?.tiles ?? []).map((tile, id) => ({ id, ...tileCenter(tile.x, tile.y, snapshot.map.tileSize) }));
}
export function characterStats(player: PlayerState) {
  return { speedPercent: player.slowSeconds > 0 ? 50 : 100 + player.boots * 10, boots: player.boots, capacity: DEFAULT_BOMB_CONFIG.initialCapacity + player.capacityUpgrades, range: 1 + player.rangeUpgrades, inventory: player.inventory };
}
