import { describe, expect, it } from "vitest";
import type { GameState } from "@bubble/shared";
import { Game } from "../src/index.js";
function fixture(mode: "ffa" | "team" = "ffa") {
  const game = new Game(["a", "b", "c", "d"], { indestructibleDensity: 0, destructibleDensity: 0 }, { timestepSeconds: 0.1 }, {}, { mode, teams: { a: "red", b: "red", c: "blue", d: "blue" } });
  const state = (game as unknown as { state: GameState }).state;
  state.items = [];
  state.players.forEach((p, i) => { p.x = (3 + i * 2) * 32 + 16; p.y = 5 * 32 + 16; });
  return { game, state };
}
describe("gameplay edge cases", () => {
  it("handles simultaneous detonations and a chain of three bombs", () => {
    const { game, state } = fixture();
    for (const [i, x] of [4, 5, 6].entries()) state.bombs.push({ id: 50 + i, ownerId: state.players[i].id, x, y: 5, range: 1, remainingSeconds: i === 0 ? 0.1 : 2 });
    state.bombs.push({ id: 60, ownerId: "d", x: 10, y: 5, range: 1, remainingSeconds: 0.1 });
    game.step(); const result = game.getSnapshot(); expect(result.bombs).toHaveLength(0); expect(new Set(result.explosions.map(e => e.id)).size).toBe(4);
  });
  it("gives enemy contact priority over simultaneous teammate rescue", () => {
    const { game, state } = fixture("team"); const [target, ally, enemy] = state.players;
    target.status = "trapped"; target.trappedSeconds = 10; ally.x = enemy.x = target.x; ally.y = enemy.y = target.y;
    game.step(); expect(game.getSnapshot().players[0].status).toBe("eliminated");
  });
  it("blocks trap use on occupied item tiles and while trapped", () => {
    const { game, state } = fixture(); const p = state.players[0];
    p.inventory[0] = { type: "banana", charges: 2 };
    state.items.push({ id: 900, type: "boots", kind: "pickup", x: Math.floor(p.x / 32), y: Math.floor(p.y / 32), active: true });
    expect(game.useItem("a", 0)).toBe(false); expect(game.getSnapshot().players[0].inventory[0]?.charges).toBe(2);
    state.items = []; p.status = "trapped"; expect(game.useItem("a", 0)).toBe(false); expect(game.placeBomb("a")).toBe(false);
  });
  it("drops inventory once upon elimination and forbids actions after the match ends", () => {
    const { game, state } = fixture(); state.players[0].inventory[0] = { type: "banana", charges: 2 };
    state.players[0].status = "trapped"; state.players[0].trappedSeconds = 0.1; game.step();
    expect(game.getSnapshot().items.filter(i => i.kind === "hazard")).toHaveLength(2);
    state.players.slice(1, 3).forEach(p => { p.status = "eliminated"; }); game.step();
    expect(game.getSnapshot().result).not.toBeNull(); expect(game.placeBomb("d")).toBe(false); expect(game.useItem("d", 0)).toBe(false);
    expect(game.getSnapshot().items.filter(i => i.kind === "hazard")).toHaveLength(2);
  });
});
