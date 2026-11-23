import { describe, expect, it } from "vitest";
import { Game } from "@bubble/engine";
import type { GameState } from "@bubble/shared";
import { BotController, type BotDifficulty } from "../src/controller.js";
import { HazardMap } from "../src/hazard.js";
import { findPath } from "../src/pathfinding.js";

function fixture(difficulty: BotDifficulty = "normal") {
  const game = new Game(["bot", "human"], { seed: 1, indestructibleDensity: 0, destructibleDensity: 0 });
  const state = (game as unknown as { state: GameState }).state, size = state.map.tileSize;
  state.items = []; state.players[0].x = 1.5 * size; state.players[0].y = 1.5 * size;
  state.players[1].x = 13.5 * size; state.players[1].y = 11.5 * size;
  return { game, state, size, bot: new BotController("bot", 0, difficulty) };
}
function step(game: Game, bot: BotController, count: number) {
  const history = [];
  for (let i = 0; i < count; i++) {
    const snapshot = game.getSnapshot(), command = bot.update(snapshot);
    history.push({ snapshot, command }); game.setInput("bot", command.input);
    if (command.placeBomb) game.placeBomb("bot"); game.step();
  }
  return history;
}

describe("bot recovery", () => {
  it.each(["normal", "hard"] as const)("makes real progress towards a distant reachable opponent at %s", difficulty => {
    const { game, bot } = fixture(difficulty), before = game.getSnapshot().players[0];
    const history = step(game, bot, 180), after = game.getSnapshot().players[0];
    expect(after.status).toBe("alive");
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(2 * game.getSnapshot().map.tileSize);
    expect(history.some(h => h.command.reason.includes("intermediate tile"))).toBe(true);
    expect(bot.metrics().exhausted).toBeGreaterThan(0);
  });
  it("returns a safe bounded partial route only when requested", () => {
    const { game } = fixture(), snapshot = game.getSnapshot(), player = snapshot.players[0], hazard = new HazardMap(snapshot);
    const goal = { x: 13, y: 11 }, partial = findPath(snapshot, player, goal, hazard, { maxNodes: 100, horizonSeconds: 3, allowPartial: true });
    expect(partial.partial).toBe(true); expect(partial.path.length).toBeGreaterThan(1); expect(partial.expanded).toBeLessThanOrEqual(100);
    expect(findPath(snapshot, player, goal, hazard, { maxNodes: 100, horizonSeconds: 3 }).path).toEqual([]);
  });
  it("repositions instead of idling beside a permanently unreachable opponent", () => {
    const { game, state, size, bot } = fixture();
    state.players[0].x = 2.5 * size; state.players[0].y = 2.5 * size;
    state.players[1].x = 5.5 * size; state.players[1].y = 5.5 * size;
    for (const [x, y] of [[4,5],[6,5],[5,4],[5,6]]) state.map.tiles[y][x].type = "indestructible";
    const history = step(game, bot, 360), recent = history.slice(180);
    expect(recent.some(h => h.command.state === "REPOSITION")).toBe(true);
    const positions = new Set(recent.map(h => `${Math.floor(h.snapshot.players[0].x / size)},${Math.floor(h.snapshot.players[0].y / size)}`));
    expect(positions.size).toBeGreaterThan(2);
    expect(game.getSnapshot().players[0].status).toBe("alive");
  });
  it("replans and moves when a previously sealed exit opens", () => {
    const { game, state, bot } = fixture();
    state.map.tiles[1][2].type = "indestructible"; state.map.tiles[2][1].type = "indestructible";
    const blocked = step(game, bot, 60), before = game.getSnapshot().players[0];
    expect(blocked.every(h => !Object.values(h.command.input).some(Boolean))).toBe(true);
    state.map.tiles[1][2].type = "floor";
    const resumed = step(game, bot, 90), after = game.getSnapshot().players[0];
    expect(resumed.some(h => h.command.input.right)).toBe(true);
    expect(after.x).toBeGreaterThan(before.x + 20);
  });
  it("resumes movement after a temporary explosion clears", () => {
    const { game, state, bot } = fixture();
    // The engine removes this fading explosion on the next fixed step.
    state.explosions.push({ id: 900, x: 1, y: 1, remainingSeconds: 0.01 });
    const before = game.getSnapshot().players[0], history = step(game, bot, 90), after = game.getSnapshot().players[0];
    expect(history.some(h => h.command.state === "ESCAPE")).toBe(true);
    expect(after.status).toBe("alive"); expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(20);
  });
  it("never moves or places bombs when trapped or eliminated", () => {
    for (const status of ["trapped", "eliminated"] as const) {
      const { game, state, bot } = fixture(); state.players[0].status = status; state.players[0].trappedSeconds = 10;
      const before = game.getSnapshot().players[0], history = step(game, bot, 30);
      expect(game.getSnapshot().players[0]).toMatchObject({ x: before.x, y: before.y });
      expect(history.every(h => !h.command.placeBomb && !Object.values(h.command.input).some(Boolean))).toBe(true);
    }
  });
});
