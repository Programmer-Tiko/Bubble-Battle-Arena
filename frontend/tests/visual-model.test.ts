import { describe, expect, it } from "vitest";
import { Game } from "@bubble/engine";
import type { GameState } from "@bubble/shared";
import { characterStats, supplyMarkers, tileCenter, visibleBombs, visibleItems } from "../src/visual-model";

describe("authoritative visual projection", () => {
  it("never passes bomb fuse information to the normal player or spectator renderer", () => {
    const game = new Game(["a"]); game.placeBomb("a");
    const playerSnapshot = game.getSnapshot(), spectatorSnapshot = structuredClone(playerSnapshot);
    spectatorSnapshot.bombs[0].remainingSeconds = 0.2;
    expect(visibleBombs(playerSnapshot)).toEqual(visibleBombs(spectatorSnapshot));
    expect(Object.keys(visibleBombs(playerSnapshot)[0]).sort()).toEqual(["id", "x", "y"]);
  });
  it.each(["banana", "slowdown"] as const)("centres a placed %s and bomb on the engine-selected tile", type => {
    const game = new Game(["a"], { indestructibleDensity: 0, destructibleDensity: 0 });
    const state = (game as unknown as { state: GameState }).state, p = state.players[0], size = state.map.tileSize;
    p.x = 5 * size + 3; p.y = 6 * size + 27; p.inventory[0] = { type, charges: 1 };
    expect(game.useItem("a", 0)).toBe(true); expect(game.placeBomb("a")).toBe(true);
    const snapshot = game.getSnapshot(), center = tileCenter(5, 6, size);
    expect(visibleBombs(snapshot)[0]).toMatchObject(center);
    expect(visibleItems(snapshot).find(item => item.kind === "trap")?.position).toEqual(center);
    const multiplayerSnapshot = structuredClone(snapshot);
    multiplayerSnapshot.players[0].x += 7; multiplayerSnapshot.players[0].y -= 5;
    expect(visibleBombs(multiplayerSnapshot)).toEqual(visibleBombs(snapshot));
    expect(visibleItems(multiplayerSnapshot)).toEqual(visibleItems(snapshot));
  });
  it("shows only recent server-selected supply drops, aligned to their tiles", () => {
    const game = new Game(["a"], { indestructibleDensity: 0, destructibleDensity: 0 }, { speed: 0, timestepSeconds: 1 });
    const state = (game as unknown as { state: GameState }).state;
    state.tick = 179; state.elapsedSeconds = 179;
    expect(supplyMarkers(game.getSnapshot())).toEqual([]);
    game.step(); const snapshot = game.getSnapshot(), drops = snapshot.items.filter(i => i.supplyDroppedAt === 180);
    expect(drops.length).toBeGreaterThanOrEqual(4);
    expect(supplyMarkers(snapshot)).toEqual(drops.map(i => ({ id: i.id, ...tileCenter(i.x, i.y, snapshot.map.tileSize) })));
    expect(supplyMarkers(structuredClone(snapshot))).toEqual(supplyMarkers(snapshot));
    game.step(); game.step(); game.step(); expect(supplyMarkers(game.getSnapshot())).toEqual([]);
  });
  it("projects collected passive upgrades into stats and only consumables into slots", () => {
    const game = new Game(["a"], { indestructibleDensity: 0, destructibleDensity: 0 });
    const state = (game as unknown as { state: GameState }).state, p = state.players[0], size = state.map.tileSize;
    state.items = (["boots", "capacity", "range", "banana", "slowdown"] as const).map((type, id) => ({ id: 100 + id, type, kind: "pickup", active: true, x: Math.floor(p.x / size), y: Math.floor(p.y / size) }));
    game.step(); const stats = characterStats(game.getSnapshot().players[0]);
    expect(stats).toMatchObject({ speedPercent: 110, capacity: 2, range: 2 });
    expect(stats.inventory.filter(Boolean).map(slot => slot?.type)).toEqual(["banana", "slowdown"]);
  });
});
