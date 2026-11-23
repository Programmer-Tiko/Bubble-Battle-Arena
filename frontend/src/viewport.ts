import type { ArenaMap } from "@bubble/shared";

/** Clamp a world-space camera centre to the map while retaining the chosen zoom. */
export function cameraCenter(map: ArenaMap, x: number, y: number, width = 480, height = 416) {
  const w = map.width * map.tileSize, h = map.height * map.tileSize;
  return { x: Math.max(Math.min(width / 2, w / 2), Math.min(w - width / 2, x)),
    y: Math.max(Math.min(height / 2, h / 2), Math.min(h - height / 2, y)) };
}

/** Only the local player's world position is mapped to the minimap. */
export function minimapPoint(map: ArenaMap, x: number, y: number, width: number, height: number) {
  return { x: Math.max(0, Math.min(width, x / (map.width * map.tileSize) * width)),
    y: Math.max(0, Math.min(height, y / (map.height * map.tileSize) * height)) };
}
