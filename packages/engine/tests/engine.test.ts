import { describe, expect, it } from "vitest";
import type { ArenaMap, MovementInput, TileType } from "@bubble/shared";
import { areSpawnsConnected, Game, generateMap, movePlayer } from "../src/index.js";

const idle: MovementInput = { up: false, down: false, left: false, right: false };
const movement = { speed: 10, playerRadius: 1, timestepSeconds: 1 };
function openMap(): ArenaMap {
  return { width: 7, height: 7, tileSize: 10, tiles: Array.from({ length: 7 }, (_, y) => Array.from({ length: 7 }, (_, x) => ({ x, y, type: "floor" as TileType }))) };
}
const player = { id: "p", x: 25, y: 25, status: "alive" as const, trappedSeconds: 0 };

describe("map generation", () => {
  it("creates the configured grid and an indestructible border", () => {
    const { map } = generateMap({ width: 17, height: 11 });
    expect(map.tiles).toHaveLength(11);
    expect(map.tiles.every(row => row.length === 17)).toBe(true);
    for (const row of map.tiles) for (const tile of row) {
      if (tile.x === 0 || tile.y === 0 || tile.x === 16 || tile.y === 10) expect(tile.type).toBe("indestructible");
    }
  });
  it("is seeded and generates both kinds of interior wall", () => {
    const result = generateMap({ seed: 123 });
    expect(generateMap({ seed: 123 })).toEqual(result);
    expect(generateMap({ seed: 124 }).map).not.toEqual(result.map);
    expect(result.usedFallback).toBe(false);
    const interior = result.map.tiles.slice(1, -1).flatMap(row => row.slice(1, -1));
    expect(interior.some(t => t.type === "indestructible")).toBe(true);
    expect(interior.some(t => t.type === "destructible")).toBe(true);
  });
  it("reserves distinct safe spawn areas and connects them across many seeds", () => {
    for (let seed = 0; seed < 100; seed++) {
      const { map, spawns } = generateMap({ seed, playerCount: 8 });
      expect(new Set(spawns.map(p => `${p.x},${p.y}`)).size).toBe(8);
      expect(areSpawnsConnected(map, spawns)).toBe(true);
      for (const { x, y } of spawns) {
        expect(map.tiles[y][x].type).toBe("floor");
        const exits = [[x + 1,y], [x - 1,y], [x,y + 1], [x,y - 1]];
        expect(exits.some(([ex, ey]) => map.tiles[ey][ex].type === "floor")).toBe(true);
      }
    }
  });
  it("uses a deterministic connected fallback after retries are exhausted", () => {
    const config = { seed: 42, playerCount: 8, maxAttempts: 0 };
    const result = generateMap(config);
    expect(result.usedFallback).toBe(true);
    expect(areSpawnsConnected(result.map, result.spawns)).toBe(true);
    expect(generateMap(config)).toEqual(result);
    const blocked = generateMap({ ...config, maxAttempts: 2, indestructibleDensity: 1, destructibleDensity: 0 });
    expect(blocked.usedFallback).toBe(true);
    expect(areSpawnsConnected(blocked.map, blocked.spawns)).toBe(true);
  });
  it("rejects invalid configuration", () => {
    expect(() => generateMap({ playerCount: 9 })).toThrow();
    expect(() => generateMap({ width: 8 })).toThrow();
    expect(() => generateMap({ destructibleDensity: 2 })).toThrow();
  });
});

describe("movement", () => {
  it("moves cardinally and normalizes diagonal speed", () => {
    const map = openMap();
    const right = movePlayer(player, { ...idle, right: true }, map, movement);
    const diagonal = movePlayer(player, { ...idle, right: true, down: true }, map, movement);
    expect(right.x).toBe(35);
    expect(right.y).toBe(25);
    expect(Math.hypot(diagonal.x - 25, diagonal.y - 25)).toBeCloseTo(10);
    expect(diagonal.x - 25).toBeCloseTo(diagonal.y - 25);
    expect(movePlayer(player, { ...idle, left: true, right: true }, map, movement)).toEqual(player);
  });
  it.each(["indestructible", "destructible"] as const)("stops at %s walls", type => {
    const map = openMap(); map.tiles[2][3].type = type;
    expect(movePlayer(player, { ...idle, right: true }, map, movement).x).toBe(29);
  });
  it("prevents crossing map edges even with an open border", () => {
    const map = openMap();
    expect(movePlayer(player, { ...idle, left: true }, map, { ...movement, speed: 1000 }).x).toBe(1);
    expect(movePlayer(player, { ...idle, up: true }, map, { ...movement, speed: 1000 }).y).toBe(1);
  });
  it("does not tunnel through walls at high speed in either direction", () => {
    const map = openMap(); map.tiles[2][3].type = "indestructible";
    expect(movePlayer(player, { ...idle, right: true }, map, { ...movement, speed: 1000 }).x).toBe(29);
    expect(movePlayer({ ...player, x: 55 }, { ...idle, left: true }, map, { ...movement, speed: 1000 }).x).toBe(41);
  });
  it("slides along a wall on diagonal input", () => {
    const map = openMap(); map.tiles[2][3].type = "indestructible"; map.tiles[3][3].type = "indestructible";
    const result = movePlayer(player, { ...idle, right: true, down: true }, map, movement);
    expect(result.x).toBe(29);
    expect(result.y).toBeGreaterThan(25);
  });
});

describe("game", () => {
  it("advances fixed ticks, retains input and returns detached snapshots", () => {
    const game = new Game(["a", "b"], { seed: 3 }, { speed: 30, timestepSeconds: 1 / 30 });
    const start = game.getSnapshot();
    game.setInput("a", { ...idle, right: true });
    game.step();
    const snapshot = game.getSnapshot();
    expect(snapshot.tick).toBe(1);
    expect(snapshot.players[0].x).toBe(start.players[0].x + 1);
    snapshot.players[0].x = -999;
    snapshot.map.tiles[0][0].type = "floor";
    expect(game.getSnapshot().players[0].x).not.toBe(-999);
    expect(game.getSnapshot().map.tiles[0][0].type).toBe("indestructible");
    expect(() => game.setInput("unknown", idle)).toThrow();
  });
});
