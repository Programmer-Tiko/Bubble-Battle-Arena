import type { ArenaMap, MovementInput, PlayerState } from "@bubble/shared";

export interface MovementConfig { speed: number; playerRadius: number; timestepSeconds: number }
/** Temporary values: units are pixels, seconds, and pixels per second. */
export const DEFAULT_MOVEMENT_CONFIG: MovementConfig = { speed: 100, playerRadius: 10, timestepSeconds: 1 / 30 };

/** Swept axis-aligned collision. Resolving X then Y permits sliding along walls. */
export function movePlayer(player: PlayerState, input: MovementInput, map: ArenaMap, config: MovementConfig): PlayerState {
  const { speed, playerRadius: r, timestepSeconds } = config;
  if (!Number.isFinite(speed) || speed < 0 || !Number.isFinite(r) || r <= 0 || r * 2 >= map.tileSize ||
      !Number.isFinite(timestepSeconds) || timestepSeconds <= 0 || !Number.isFinite(player.x) || !Number.isFinite(player.y)) {
    throw new RangeError("Invalid movement configuration or player position");
  }
  let dx = Number(input.right) - Number(input.left), dy = Number(input.down) - Number(input.up);
  const length = Math.hypot(dx, dy);
  if (length) { dx = dx / length * speed * timestepSeconds; dy = dy / length * speed * timestepSeconds; }
  const size = map.tileSize;
  // Map edges are solid even for a malformed or custom map with an open border.
  let x = Math.max(r, Math.min(map.width * size - r, player.x + dx));
  let y = player.y;
  for (const row of map.tiles) for (const tile of row) {
    if (tile.type === "floor") continue;
    const left = tile.x * size, right = left + size, top = tile.y * size, bottom = top + size;
    if (player.y + r <= top || player.y - r >= bottom) continue;
    if (dx > 0 && player.x + r <= left && x + r > left) x = Math.min(x, left - r);
    if (dx < 0 && player.x - r >= right && x - r < right) x = Math.max(x, right + r);
  }
  y = Math.max(r, Math.min(map.height * size - r, player.y + dy));
  for (const row of map.tiles) for (const tile of row) {
    if (tile.type === "floor") continue;
    const left = tile.x * size, right = left + size, top = tile.y * size, bottom = top + size;
    if (x + r <= left || x - r >= right) continue;
    if (dy > 0 && player.y + r <= top && y + r > top) y = Math.min(y, top - r);
    if (dy < 0 && player.y - r >= bottom && y - r < bottom) y = Math.max(y, bottom + r);
  }
  return { ...player, x, y };
}
