import { describe, expect, it, vi } from "vitest";
import type { GameState } from "@bubble/shared";
import { HazardMap } from "@bubble/bot";
import { createGameServer } from "../src/server.js";

describe("shared bot view and chain reactions", () => {
  it("predicts and executes a chain involving a bomb placed earlier in the tick", async () => {
    const server = createGameServer({ autoTick: false });
    try {
      const session = server.create("ffa", 4, 2), state = (session.game as unknown as { state: GameState }).state;
      for (const row of state.map.tiles) for (const tile of row) tile.type = tile.x === 0 || tile.y === 0 || tile.x === state.map.width - 1 || tile.y === state.map.height - 1 ? "indestructible" : "floor";
      state.items = [];
      state.players.forEach((p, i) => { p.x = (5.5 + i * 3) * state.map.tileSize; p.y = 4.5 * state.map.tileSize; });
      // Bot 2 places at (11, 4), beside the already ticking bomb at (10, 4).
      state.bombs.push({ id: 900, ownerId: state.players[0].id, x: 10, y: 4, range: 1, remainingSeconds: .2 });
      const bots = session.slots.filter(slot => slot.bot), idle = { up: false, down: false, left: false, right: false };
      let predicted: number | undefined;
      vi.spyOn(bots[0].bot!, "update").mockReturnValue({ input: idle, placeBomb: true, state: "WAIT", reason: "fixture" });
      vi.spyOn(bots[1].bot!, "update").mockImplementation(view => {
        const placed = view.bombs.find(b => b.ownerId === bots[0].id);
        if (placed && predicted === undefined) predicted = new HazardMap(view).detonationTimes.get(placed.id);
        return { input: idle, placeBomb: false, state: "WAIT", reason: "fixture" };
      });
      server.tick(session);
      expect(predicted).toBeCloseTo(.2);
      for (let i = 0; i < 6; i++) server.tick(session);
      const after = session.game.getSnapshot();
      expect(after.explosions.some(e => e.id === 900)).toBe(true);
      expect(after.explosions.some(e => e.id === 0)).toBe(true);
      expect(after.bombs).toHaveLength(0);
      expect(after.players.find(p => p.id === bots[0].id)?.status).toBe("trapped");
    } finally { await server.close(); }
  });
});
