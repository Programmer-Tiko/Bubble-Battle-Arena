import { describe, expect, it } from "vitest";
import { Game } from "@bubble/engine";
import { HazardMap } from "../src/hazard.js";
import { findPath } from "../src/pathfinding.js";

function fixture() {
  const game = new Game(["a"], { seed: 1, indestructibleDensity: 0, destructibleDensity: 0 });
  const snapshot = game.getSnapshot(), player = snapshot.players[0], size = snapshot.map.tileSize;
  player.x = 3.5 * size; player.y = 3.5 * size;
  return { snapshot, player };
}

describe("time-expanded pathfinding", () => {
  it("waits for an explosion before entering a tile", () => {
    const { snapshot, player } = fixture();
    snapshot.explosions.push({ id: 1, x: 4, y: 3, remainingSeconds: 0.4 });
    const result = findPath(snapshot, player, { x: 4, y: 3 }, new HazardMap(snapshot));
    expect(result.path.length).toBeGreaterThan(2);
    expect(result.path[1]).toMatchObject({ x: 3, y: 3 });
    expect(result.path.at(-1)?.time).toBeGreaterThan(0.4);
  });
  it("takes a detour around a wall and respects its node budget", () => {
    const { snapshot, player } = fixture(); snapshot.map.tiles[3][4].type = "indestructible";
    const hazards = new HazardMap(snapshot);
    const result = findPath(snapshot, player, { x: 5, y: 3 }, hazards);
    expect(result.path.at(-1)).toMatchObject({ x: 5, y: 3 });
    expect(result.path.some(p => p.x === 4 && p.y === 3)).toBe(false);
    expect(findPath(snapshot, player, { x: 10, y: 10 }, hazards, { maxNodes: 2 }).expanded).toBeLessThanOrEqual(2);
  });
  it("uses upgrades and slowdown for movement timing", () => {
    const { snapshot, player } = fixture(); const hazards = new HazardMap(snapshot);
    const time = () => findPath(snapshot, player, { x: 4, y: 3 }, hazards, { stepSeconds: 0.01 }).path.at(-1)!.time;
    const normal = time(); player.boots = 4; const fast = time(); player.slowSeconds = 1; const slow = time();
    expect(fast).toBeLessThan(normal); expect(slow).toBeGreaterThan(normal);
  });
  it("reports no path through a sealed wall", () => {
    const { snapshot, player } = fixture();
    for (const [x, y] of [[4, 3], [2, 3], [3, 2], [3, 4]]) snapshot.map.tiles[y][x].type = "indestructible";
    expect(findPath(snapshot, player, { x: 5, y: 3 }, new HazardMap(snapshot), { horizonSeconds: 1 }).path).toEqual([]);
  });
});
