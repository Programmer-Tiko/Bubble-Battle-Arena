import { describe, expect, it, vi } from "vitest";
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
  it("uses fresh entropy for default matches while explicit seeds stay reproducible", () => {
    let value = 0;
    const random = vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(array => {
      (array as Uint32Array)[0] = value;
      return array;
    });
    try {
      const preview = (seed?: number) => {
        const game = new Game(["a"], seed === undefined ? {} : { seed });
        const state = (game as unknown as { state: GameState }).state;
        state.tick = 5369; state.elapsedSeconds = 5369 / 30; game.step();
        return game.getSnapshot().supplyPreview!.tiles;
      };
      const first = preview(); value = 0xffffffff; const second = preview();
      expect(first).not.toEqual(second);
      const calls = random.mock.calls.length;
      expect(preview(17)).toEqual(preview(17));
      expect(random).toHaveBeenCalledTimes(calls);
    } finally { random.mockRestore(); }
  });

  it("announces at 179 seconds and lands unchanged even when tiles are occupied", () => {
    const { game, state } = fixture(33);
    steps(game, 178); expect(game.getSnapshot().supplyPreview).toBeNull();
    game.step(); const preview = game.getSnapshot().supplyPreview!;
    expect(preview).toMatchObject({ announcedAt: 179, scheduledAt: 180 });
    expect(preview.tiles.length).toBeGreaterThanOrEqual(4);
    expect(preview.tiles.every(tile => Object.keys(tile).sort().join(",") === "x,y")).toBe(true);
    expect(supply(game.getSnapshot())).toHaveLength(0);
    const tile = preview.tiles[0];
    state.bombs.push({ id: 999, ownerId: "a", ...tile, range: 1, remainingSeconds: 1000 });
    state.items.push({ id: 1000, type: "banana", ...tile, kind: "trap", active: true });
    state.items.push({ id: 1001, type: "boots", ...tile, kind: "pickup", active: true });
    state.explosions.push({ id: 77, ...tile, remainingSeconds: 10 });
    game.step(); const landed = game.getSnapshot();
    expect(landed.supplyPreview).toBeNull();
    expect(supply(landed).map(({ x, y }) => ({ x, y }))).toEqual(preview.tiles);
    expect(landed.bombs.some(b => b.id === 999)).toBe(true);
    expect(landed.explosions.some(e => e.id === 77)).toBe(true);
    expect(landed.items.filter(i => i.x === tile.x && i.y === tile.y)).toHaveLength(3);
    const player = state.players[0]; player.x = (tile.x + .5) * 32; player.y = (tile.y + .5) * 32;
    game.step(); expect(game.getSnapshot().players[0].status).toBe("trapped");
    expect(supply(game.getSnapshot()).some(i => i.x === tile.x && i.y === tile.y)).toBe(true);
  });
  it("collects stacked pickups normally on the tick after they land on a player", () => {
    const { game, state } = fixture(45); steps(game, 179);
    const tile = game.getSnapshot().supplyPreview!.tiles[0], player = state.players[0];
    player.x = (tile.x + .5) * 32; player.y = (tile.y + .5) * 32;
    state.items.push({ id: 1001, type: "boots", ...tile, kind: "pickup", active: true });
    state.items.push({ id: 1002, type: "slowdown", ...tile, kind: "trap", active: true });
    game.step(); expect(supply(game.getSnapshot()).some(i => i.x === tile.x && i.y === tile.y)).toBe(true);
    state.items.push({ id: 1003, type: "boots", ...tile, kind: "pickup", active: true });
    const before = game.getSnapshot(); game.step(); const after = game.getSnapshot();
    expect(after.players[0].boots).toBeGreaterThan(before.players[0].boots);
    expect(after.items.some(i => i.id === 1003)).toBe(false);
    expect(after.items.some(i => i.supplyDroppedAt === 180 && i.x === tile.x && i.y === tile.y)).toBe(false);
    expect(before.players[0].slowSeconds).toBeGreaterThan(0);
  });
  it("ignores bombs, players, traps, pickups and explosions when selecting", () => {
    const a = fixture(67), b = fixture(67); b.state.items = [];
    for (const [index, tile] of b.state.map.tiles.flat().filter(t => t.type === "floor").entries()) {
      b.state.bombs.push({ id: 1000 + index, ownerId: "a", x: tile.x, y: tile.y, range: 1, remainingSeconds: 1000 });
      b.state.items.push({ id: 2000 + index, type: index % 2 ? "banana" : "boots", x: tile.x, y: tile.y, kind: index % 2 ? "trap" : "pickup", active: true });
      b.state.explosions.push({ id: 3000 + index, x: tile.x, y: tile.y, remainingSeconds: 1000 });
    }
    b.state.players[0].x = 4.5 * 32; b.state.players[0].y = 4.5 * 32;
    const select = (game: Game) => (game as unknown as { selectSupplyTiles(): {x: number; y: number}[] }).selectSupplyTiles();
    expect(select(a.game)).toEqual(select(b.game));
  });
  it("samples every eligible floor tile uniformly and excludes both kinds of wall", () => {
    const { game, state } = fixture();
    const tiles = state.map.tiles.flat().filter(t => t.type === "floor");
    tiles[0].type = "destructible"; tiles[1].type = "indestructible";
    const eligible = state.map.tiles.flat().filter(t => t.type === "floor");
    const internals = game as unknown as { supplyRandom: () => number; selectSupplyTiles(): {x: number; y: number}[] };
    for (let target = 0; target < eligible.length; target++) {
      let call = 0; internals.supplyRandom = () => call++ === 0 ? 0 : call === 2 ? (target + .5) / eligible.length : 0;
      const result = internals.selectSupplyTiles();
      expect(result[0]).toEqual({ x: eligible[target].x, y: eligible[target].y });
      expect(new Set(result.map(t => `${t.x},${t.y}`)).size).toBe(result.length);
      expect(result.every(t => state.map.tiles[t.y][t.x].type === "floor")).toBe(true);
    }
    tiles[0].type = "floor";
    internals.supplyRandom = () => 0;
    expect(internals.selectSupplyTiles()).toContainEqual({ x: tiles[0].x, y: tiles[0].y });
  });
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
    expect(game.getSnapshot().balloon).toBeNull(); expect(game.getSnapshot().supplyPreview).toBeNull(); expect(supply(game.getSnapshot())).toHaveLength(0);
    steps(game, 400); expect(game.getSnapshot().balloon).toBeNull();
  });
  it("selects 4-6 diverse items on distinct floor tiles across seeds", () => {
    const counts = new Set<number>(), types = new Set<ItemType>();
    for (let seed = 0; seed < 40; seed++) {
      const { game, state } = fixture(seed); steps(game, 180);
      const drops = supply(state); counts.add(drops.length);
      expect(drops.length).toBeGreaterThanOrEqual(4); expect(drops.length).toBeLessThanOrEqual(6);
      expect(new Set(drops.map(i => i.type)).size).toBeGreaterThanOrEqual(2);
      expect(new Set(drops.map(i => `${i.x},${i.y}`)).size).toBe(drops.length);
      for (const item of drops) { types.add(item.type); expect(state.map.tiles[item.y][item.x].type).toBe("floor"); }
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
  it("reproduces event contents and positions from the seed", () => {
    const a = fixture(88), b = fixture(88), c = fixture(89);
    steps(a.game, 540); steps(b.game, 540); steps(c.game, 540);
    expect(supply(a.game.getSnapshot())).toEqual(supply(b.game.getSnapshot()));
    expect(supply(a.game.getSnapshot())).not.toEqual(supply(c.game.getSnapshot()));
  });
});
