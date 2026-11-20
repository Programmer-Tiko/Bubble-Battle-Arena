import { describe, expect, it } from "vitest";
import type { GameState } from "@bubble/shared";
import { Game, type MatchConfig } from "../src/index.js";

const ids = ["a", "b", "c", "d"];
const teams = { a: "red", b: "red", c: "blue", d: "blue" };
function fixture(match: MatchConfig = { mode: "team", teams }): { game: Game; state: GameState } {
  const game = new Game(ids, { indestructibleDensity: 0, destructibleDensity: 0 }, { timestepSeconds: 0.1 }, {}, match);
  const state = (game as unknown as { state: GameState }).state;
  state.players.forEach((p, i) => { p.x = (3 + i * 2) * 32; p.y = 5 * 32; });
  return { game, state };
}
describe("match rules", () => {
  it("validates team rosters", () => {
    expect(() => fixture({ mode: "team", teams: { ...teams, b: "blue" } })).toThrow();
    expect(() => new Game(["a", "b"], {}, {}, {}, { mode: "ffa" })).toThrow();
    expect(() => fixture({ mode: "team", teams })).not.toThrow();
    expect(() => fixture({ mode: "ffa", timeLimitSeconds: 601 })).toThrow();
  });
  it("rescues a trapped teammate and eliminates on enemy contact", () => {
    const { game, state } = fixture();
    const [a, b, c] = state.players;
    a.status = "trapped"; a.trappedSeconds = 10; b.x = a.x; b.y = a.y;
    game.step(); expect(game.getSnapshot().players[0].status).toBe("alive");
    const [nextA, nextB, nextC] = state.players;
    nextA.status = "trapped"; nextA.trappedSeconds = 10; nextB.x += 64; nextC.x = nextA.x; nextC.y = nextA.y;
    game.step(); expect(game.getSnapshot().players[0].status).toBe("eliminated");
  });
  it("eliminates a trapped player when the timer expires", () => {
    const { game, state } = fixture();
    state.players[0].status = "trapped"; state.players[0].trappedSeconds = 0.1;
    game.step(); expect(game.getSnapshot().players[0].status).toBe("eliminated");
  });
  it("ends with the last team and freezes further ticks", () => {
    const { game, state } = fixture();
    state.players[2].status = "eliminated"; state.players[3].status = "eliminated";
    game.step();
    expect(game.getSnapshot().result).toEqual({ kind: "winner", teamId: "red" });
    game.step(); expect(game.getSnapshot().tick).toBe(1);
  });
  it("applies the time limit and resolves ties and survivor counts", () => {
    const draw = fixture({ mode: "ffa", timeLimitSeconds: 0.1 });
    draw.game.step(); expect(draw.game.getSnapshot().result).toEqual({ kind: "draw" });
    const winner = fixture({ mode: "team", teams, timeLimitSeconds: 0.1 });
    winner.state.players[2].status = "eliminated";
    winner.game.step(); expect(winner.game.getSnapshot().result).toEqual({ kind: "winner", teamId: "red" });
  });
  it("treats all other players as enemies in FFA", () => {
    const { game, state } = fixture({ mode: "ffa" });
    state.players[0].status = "trapped"; state.players[0].trappedSeconds = 10;
    state.players[1].x = state.players[0].x; state.players[1].y = state.players[0].y;
    game.step();
    expect(game.getSnapshot().players[0].status).toBe("eliminated");
    expect(game.placeBomb("a")).toBe(false);
  });
  it("detects a player passing through a trapped opponent during a tick", () => {
    const game = new Game(ids, { indestructibleDensity: 0, destructibleDensity: 0 }, { timestepSeconds: 1, speed: 100 }, {}, { mode: "ffa" });
    const state = (game as unknown as { state: GameState }).state;
    state.players.forEach((p, i) => { p.x = 100 + i * 64; p.y = 160; });
    state.players[1].status = "trapped"; state.players[1].trappedSeconds = 10;
    game.setInput("a", { up: false, down: false, left: false, right: true });
    game.step();
    expect(game.getSnapshot().players[1].status).toBe("eliminated");
  });

});
