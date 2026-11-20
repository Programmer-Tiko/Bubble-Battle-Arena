import { describe, expect, it } from "vitest";
import type { GameState, MovementInput } from "@bubble/shared";
import { Game } from "../src/index.js";

const idle: MovementInput = { up: false, down: false, left: false, right: false };
function fixture(): { game: Game; state: GameState } {
  const game = new Game(["a", "b"], { seed: 1, indestructibleDensity: 0, destructibleDensity: 0 }, { timestepSeconds: 0.1 });
  // Arrange specific tile layouts and player locations; assertions use public snapshots.
  const state = (game as unknown as { state: GameState }).state;
  state.players[0].x = 5.5 * state.map.tileSize; state.players[0].y = 5.5 * state.map.tileSize;
  state.players[1].x = 6.5 * state.map.tileSize; state.players[1].y = 5.5 * state.map.tileSize;
  return { game, state };
}
function steps(game: Game, count: number): void { for (let i = 0; i < count; i++) game.step(); }

describe("bombs", () => {
  it("detonates after three seconds in a five-tile cross", () => {
    const { game } = fixture();
    expect(game.placeBomb("a")).toBe(true);
    expect(game.placeBomb("a")).toBe(false);
    steps(game, 29);
    expect(game.getSnapshot().bombs).toHaveLength(1);
    steps(game, 1);
    const snapshot = game.getSnapshot();
    expect(snapshot.bombs).toHaveLength(0);
    expect(snapshot.explosions.map(e => `${e.x},${e.y}`).sort()).toEqual(["4,5", "5,4", "5,5", "5,6", "6,5"]);
    steps(game, 3);
    expect(game.getSnapshot().explosions).toHaveLength(0);
  });
  it("blocks blasts on indestructible walls and destroys destructible walls without propagating past them", () => {
    const { game, state } = fixture();
    state.map.tiles[5][6].type = "indestructible";
    state.map.tiles[5][4].type = "destructible";
    game.upgradeBomb("a", "range");
    game.placeBomb("a"); steps(game, 30);
    const snapshot = game.getSnapshot();
    expect(snapshot.map.tiles[5][6].type).toBe("indestructible");
    expect(snapshot.map.tiles[5][4].type).toBe("floor");
    expect(snapshot.explosions.some(e => e.x === 6 && e.y === 5)).toBe(false);
    expect(snapshot.explosions.some(e => e.x === 4 && e.y === 5)).toBe(true);
    expect(snapshot.explosions.some(e => e.x === 3 && e.y === 5)).toBe(false);
  });
  it("chains another player's bomb before its fuse expires", () => {
    const { game } = fixture();
    game.placeBomb("a"); steps(game, 10); game.placeBomb("b"); steps(game, 20);
    expect(game.getSnapshot().bombs).toHaveLength(0);
    expect(game.getSnapshot().explosions.some(e => e.x === 7 && e.y === 5)).toBe(true);
  });
  it("applies capacity and range upgrades within configured caps", () => {
    const { game, state } = fixture();
    game.upgradeBomb("a", "capacity"); game.upgradeBomb("a", "range");
    expect(game.placeBomb("a")).toBe(true);
    state.players[0].x += state.map.tileSize;
    expect(game.placeBomb("a")).toBe(true);
    state.players[0].x += state.map.tileSize;
    expect(game.placeBomb("a")).toBe(false);
    expect(game.getSnapshot().bombs.every(b => b.range === 2)).toBe(true);
    game.setInput("a", idle);
  });
  it("traps the owner and another player in the blast and blocks their actions", () => {
    const { game } = fixture();
    game.placeBomb("a"); steps(game, 30);
    const hit = game.getSnapshot();
    expect(hit.players.map(p => p.status)).toEqual(["trapped", "trapped"]);
    expect(game.placeBomb("a")).toBe(false);
    game.setInput("a", { ...idle, right: true });
    steps(game, 1);
    expect(game.getSnapshot().players[0].x).toBe(hit.players[0].x);
  });

});
