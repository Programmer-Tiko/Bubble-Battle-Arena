import { describe, expect, it } from "vitest";
import { Game, DEFAULT_BOMB_CONFIG } from "@bubble/engine";
import type { GameState } from "@bubble/shared";
import { HazardMap } from "../src/hazard.js";

function fixture() {
  const game = new Game(["a", "b"], { seed: 1, indestructibleDensity: 0, destructibleDensity: 0 }, { timestepSeconds: 0.1 });
  const state = (game as unknown as { state: GameState }).state;
  state.players[0].x = 5.5 * state.map.tileSize; state.players[0].y = 5.5 * state.map.tileSize;
  state.players[1].x = 6.5 * state.map.tileSize; state.players[1].y = 5.5 * state.map.tileSize;
  return { game, state };
}

describe("hazard prediction", () => {
  it("matches real engine blast and explosion timing", () => {
    const { game } = fixture(); game.placeBomb("a");
    const hazard = new HazardMap(game.getSnapshot(), DEFAULT_BOMB_CONFIG, 0.1);
    expect(hazard.isDangerous(5, 5, 2.9)).toBe(false);
    for (let tick = 1; tick <= 34; tick++) {
      game.step(); const snapshot = game.getSnapshot();
      for (let y = 3; y <= 7; y++) for (let x = 3; x <= 7; x++) {
        expect(hazard.isDangerous(x, y, tick * 0.1)).toBe(snapshot.explosions.some(e => e.x === x && e.y === y));
      }
    }
    expect(hazard.getSafeIntervals(5, 5, 4)).toEqual([{ start: 0, end: 3 }, { start: 3.3000000000000003, end: 4 }]);
  });
  it("follows chains and respects both wall types", () => {
    const { game, state } = fixture();
    game.upgradeBomb("a", "range"); game.placeBomb("a");
    for (let i = 0; i < 10; i++) game.step();
    game.placeBomb("b");
    state.map.tiles[5][4].type = "destructible"; state.map.tiles[4][5].type = "indestructible";
    const hazard = new HazardMap(game.getSnapshot(), DEFAULT_BOMB_CONFIG, 0.1);
    expect(hazard.detonationTimes.get(1)).toBe(2);
    expect(hazard.isDangerous(4, 5, 2)).toBe(true);
    expect(hazard.isDangerous(3, 5, 2)).toBe(false);
    expect(hazard.isDangerous(5, 4, 2)).toBe(false);
    expect(hazard.isDangerous(7, 5, 2)).toBe(true);
    for (let i = 0; i < 20; i++) game.step();
    const snapshot = game.getSnapshot();
    for (let y = 1; y < 10; y++) for (let x = 1; x < 10; x++) {
      expect(hazard.isDangerous(x, y, 2)).toBe(snapshot.explosions.some(e => e.x === x && e.y === y));
    }
  });
  it("combines overlapping explosions and does not mutate the snapshot", () => {
    const { game } = fixture(); game.placeBomb("a"); game.placeBomb("b");
    const snapshot = game.getSnapshot(), before = structuredClone(snapshot);
    const hazard = new HazardMap(snapshot, DEFAULT_BOMB_CONFIG, 0.1);
    expect(hazard.isDangerous(6, 5, 3)).toBe(true);
    expect(hazard.isDangerous(6, 5, 3.4)).toBe(false);
    expect(snapshot).toEqual(before);
  });
});
