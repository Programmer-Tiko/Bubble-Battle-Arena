import { describe, expect, it } from "vitest";
import { Game } from "@bubble/engine";
import type { GameState } from "@bubble/shared";
import { bombAppearance, characterStats, displayItems, supplyMarkers, tileCenter, visibleBombs, visibleItems } from "../src/visual-model";

describe("authoritative visual projection", () => {
  it("keeps a bomb visible above a player and cycles a co-located trap into view", () => {
    const game = new Game(["a"]), state = (game as unknown as { state: GameState }).state;
    const player = state.players[0], size = state.map.tileSize, x = Math.floor(player.x / size), y = Math.floor(player.y / size);
    state.items = [{ id: 100, type: "banana", kind: "trap", active: true, x, y }];
    game.placeBomb("a"); const snapshot = game.getSnapshot(), bomb = visibleBombs(snapshot)[0];
    expect(bomb).toMatchObject(tileCenter(x, y, size));
    expect(bombAppearance(snapshot, bomb, 0)).toMatchObject({ depth: 14, scale: .7 });
    expect(bombAppearance(snapshot, bomb, Math.PI * 225).alpha).toBeGreaterThan(bombAppearance(snapshot, bomb, Math.PI * 675).alpha);
    snapshot.players[0].x += 2 * size;
    expect(bombAppearance(snapshot, bomb, 0)).toEqual({ depth: 6, scale: .87, alpha: 1 });
  });
  it("cycles overlapping item icons at the tile centre while retaining bomb and player visibility", () => {
    const game = new Game(["a"]), state = (game as unknown as { state: GameState }).state;
    const p = state.players[0], x = Math.floor(p.x / state.map.tileSize), y = Math.floor(p.y / state.map.tileSize);
    state.items = [
      { id: 100, type: "boots", kind: "pickup", active: true, x, y },
      { id: 101, type: "banana", kind: "trap", active: true, x, y },
    ];
    game.placeBomb("a"); const snapshot = game.getSnapshot();
    const first = displayItems(snapshot, 0)[0], second = displayItems(snapshot, 650)[0];
    expect(first).toMatchObject({ count: 2, crowded: true, item: { id: 100 } });
    expect(second.item.id).toBe(101);
    expect(first.item.position).toEqual(tileCenter(x, y, state.map.tileSize));
    expect(second.item.position).toEqual(first.item.position);
    expect(visibleBombs(snapshot)[0]).toMatchObject(first.item.position);
  });
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
  it("shows server-selected supply locations before landing", () => {
    const game = new Game(["a"], { indestructibleDensity: 0, destructibleDensity: 0 }, { speed: 0, timestepSeconds: 1 });
    const state = (game as unknown as { state: GameState }).state;
    state.tick = 178; state.elapsedSeconds = 178;
    expect(supplyMarkers(game.getSnapshot())).toEqual([]);
    game.step(); const preview = game.getSnapshot();
    expect(preview.supplyPreview?.scheduledAt).toBe(180);
    expect(preview.items.filter(i => i.supplyDroppedAt === 180)).toHaveLength(0);
    expect(supplyMarkers(preview)).toEqual(preview.supplyPreview!.tiles.map((tile, id) => ({ id, ...tileCenter(tile.x, tile.y, preview.map.tileSize) })));
    expect(supplyMarkers(preview).length).toBeGreaterThanOrEqual(4);
    game.step(); const landed = game.getSnapshot();
    expect(supplyMarkers(landed)).toEqual([]);
    expect(landed.items.filter(i => i.supplyDroppedAt === 180).length).toBeGreaterThanOrEqual(4);
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
