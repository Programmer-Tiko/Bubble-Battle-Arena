import { describe, expect, it } from "vitest";
import type { GameState, ItemType } from "@bubble/shared";
import { Game } from "../src/index.js";

function fixture(seed = 1, match = false) {
  const game = new Game(match ? ["a", "b", "c", "d"] : ["a"],
    { seed, indestructibleDensity: 0, destructibleDensity: 0 },
    { timestepSeconds: 1, speed: 0 }, { fuseSeconds: 1000 }, match ? { mode: "ffa" } : undefined);
  const state = (game as unknown as { state: GameState }).state;
  return { game, state };
}
function steps(game: Game, count: number) { for (let i = 0; i < count; i++) game.step(); }
const supply = (state: GameState) => state.items.filter(item => item.supplyDroppedAt !== undefined);

describe("balloon supply", () => {
  it("visits exactly at 3, 6 and 9 minutes of simulation time", () => {
    const { game } = fixture(1, true);
    steps(game, 179); expect(game.getSnapshot().balloon).toBeNull();
    game.step(); expect(game.getSnapshot().balloon?.startedAt).toBe(180);
    steps(game, 20); expect(game.getSnapshot().balloon).toBeNull();
    steps(game, 159); expect(game.getSnapshot().balloon).toBeNull();
    game.step(); expect(game.getSnapshot().balloon?.startedAt).toBe(360);
    steps(game, 180); expect(game.getSnapshot().balloon?.startedAt).toBe(540);
    steps(game, 60); expect(game.getSnapshot().result).not.toBeNull();
    const end = game.getSnapshot(); steps(game, 400); expect(game.getSnapshot()).toEqual(end);
  });
  it("does not spawn on or after a tick ending the match", () => {
    const { game, state } = fixture(2, true); steps(game, 179);
    for (const player of state.players.slice(1)) { player.status = "trapped"; player.trappedSeconds = 0.5; }
    game.step(); expect(game.getSnapshot().result).not.toBeNull();
    expect(game.getSnapshot().balloon).toBeNull(); expect(supply(game.getSnapshot())).toHaveLength(0);
    steps(game, 400); expect(game.getSnapshot().balloon).toBeNull();
  });
  it("selects 4–6 diverse categories on distinct free floor tiles across seeds", () => {
    const counts = new Set<number>(), types = new Set<ItemType>();
    for (let seed = 0; seed < 40; seed++) {
      const { game, state } = fixture(seed);
      const blocked = state.map.tiles.flat().find(t => t.type === "floor" && !state.items.some(i => i.x === t.x && i.y === t.y) && !state.players.some(p => Math.floor(p.x / 32) === t.x && Math.floor(p.y / 32) === t.y))!;
      state.bombs.push({ id: 999, ownerId: "a", x: blocked.x, y: blocked.y, range: 1, remainingSeconds: 1000 });
      const existing = new Set(state.items.map(i => `${i.x},${i.y}`));
      steps(game, 180); const drops = supply(game.getSnapshot()); counts.add(drops.length);
      expect(drops.length).toBeGreaterThanOrEqual(4); expect(drops.length).toBeLessThanOrEqual(6);
      expect(new Set(drops.map(i => i.type)).size).toBeGreaterThanOrEqual(2);
      expect(new Set(drops.map(i => `${i.x},${i.y}`)).size).toBe(drops.length);
      for (const item of drops) {
        types.add(item.type); expect(state.map.tiles[item.y][item.x].type).toBe("floor");
        expect(existing.has(`${item.x},${item.y}`)).toBe(false);
        expect(item.x === blocked.x && item.y === blocked.y).toBe(false);
      }
    }
    expect([...counts].sort()).toEqual([4, 5, 6]);
    expect([...types].sort()).toEqual(["banana", "boots", "capacity", "range", "slowdown"]);
  });
  it("adds boots beyond the initial four and uses normal pickup effects", () => {
    const seen = new Set<ItemType>();
    for (let seed = 0; seed < 30 && seen.size < 5; seed++) {
      const { game, state } = fixture(seed);
      expect(state.items.filter(i => i.type === "boots")).toHaveLength(4);
      steps(game, 180);
      const drops = supply(state);
      if (drops.some(i => i.type === "boots")) expect(state.items.filter(i => i.type === "boots").length).toBeGreaterThan(4);
      for (const item of [...drops]) {
        const p = state.players[0]; p.x = (item.x + 0.5) * 32; p.y = (item.y + 0.5) * 32;
        const before = game.getSnapshot().players[0]; game.step(); const after = game.getSnapshot().players[0];
        expect(game.getSnapshot().items.some(i => i.id === item.id)).toBe(false);
        if (item.type === "boots") expect(after.boots).toBe(before.boots + 1);
        if (item.type === "capacity") expect(after.capacityUpgrades).toBe(before.capacityUpgrades + 1);
        if (item.type === "range") expect(after.rangeUpgrades).toBe(before.rangeUpgrades + 1);
        if (item.type === "banana" || item.type === "slowdown") {
          const charges = (player: typeof after) => player.inventory.find(slot => slot?.type === item.type)?.charges ?? 0;
          expect(charges(after) - charges(before)).toBe(item.type === "banana" ? 2 : 5);
        }
        seen.add(item.type);
      }
    }
    expect(seen.size).toBe(5);
  });
  it("safely skips drops with fewer than four free tiles and uses four when exactly four are free", () => {
    for (const free of [0, 3, 4]) {
      const { game, state } = fixture(12); state.items = [];
      const candidates = state.map.tiles.flat().filter(t => t.type === "floor" && !state.players.some(p => Math.floor(p.x / 32) === t.x && Math.floor(p.y / 32) === t.y));
      for (const tile of candidates.slice(free)) state.items.push({ id: 1000 + state.items.length, type: "boots", x: tile.x, y: tile.y, kind: "pickup", active: true });
      steps(game, 180); const drops = supply(state);
      expect(state.balloon?.startedAt).toBe(180); expect(drops).toHaveLength(free === 4 ? 4 : 0);
      if (drops.length) expect(new Set(drops.map(i => i.type)).size).toBeGreaterThan(1);
    }
  });
  it("reproduces event contents and positions from the seed", () => {
    const a = fixture(88), b = fixture(88), c = fixture(89);
    steps(a.game, 540); steps(b.game, 540); steps(c.game, 540);
    expect(supply(a.game.getSnapshot())).toEqual(supply(b.game.getSnapshot()));
    expect(supply(a.game.getSnapshot())).not.toEqual(supply(c.game.getSnapshot()));
  });
});
