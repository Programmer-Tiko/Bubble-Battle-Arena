import { describe, expect, it, vi } from "vitest";
import type { GameState, GroundItem, MovementInput } from "@bubble/shared";
import { Game } from "../src/index.js";

const idle: MovementInput = { up: false, down: false, left: false, right: false };
const right = { ...idle, right: true };
function fixture() {
  const game = new Game(["a", "b"], { indestructibleDensity: 0, destructibleDensity: 0 }, { speed: 32, timestepSeconds: 0.25 }, { fuseSeconds: 100 });
  const state = (game as unknown as { state: GameState }).state;
  state.items = [];
  state.players[0].x = 5.5 * 32; state.players[0].y = 5.5 * 32;
  state.players[1].x = 10.5 * 32; state.players[1].y = 9.5 * 32;
  return { game, state, a: state.players[0] };
}
function add(state: GameState, type: GroundItem["type"], x = 5, y = 5, kind: GroundItem["kind"] = "pickup") {
  state.items.push({ id: 1000 + state.items.length, type, x, y, kind, active: true });
}
function steps(game: Game, count: number) { for (let i = 0; i < count; i++) game.step(); }

describe("items and inventory", () => {
  it("spreads seeded initial pickups over reachable floor while preserving types", () => {
    const make = (seed: number) => new Game(["a", "b", "c", "d", "e", "f", "g", "h"], { seed }).getSnapshot();
    const first = make(42);
    expect(make(42).items).toEqual(first.items);
    expect(make(43).items.map(i => [i.x, i.y])).not.toEqual(first.items.map(i => [i.x, i.y]));
    expect(first.items.filter(i => i.type === "boots")).toHaveLength(4);
    for (const type of ["capacity", "range", "banana", "slowdown"]) expect(first.items.filter(i => i.type === type)).toHaveLength(2);
    expect(first.items.every(i => i.kind === "pickup" && i.active && first.map.tiles[i.y][i.x].type === "floor")).toBe(true);
    expect(new Set(first.items.map(i => `${i.x},${i.y}`)).size).toBe(first.items.length);
    expect(new Set(first.items.map(i => `${Number(i.x >= first.map.width / 2)},${Number(i.y >= first.map.height / 2)}`)).size).toBe(4);
    expect(first.items.every(i => first.players.every(p => Math.abs(i.x - Math.floor(p.x / first.map.tileSize)) + Math.abs(i.y - Math.floor(p.y / first.map.tileSize)) > 1))).toBe(true);
  });
  it("keeps nearest boots reasonably balanced by walkable distance across seeded eight-player maps", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = new Game(["a", "b", "c", "d", "e", "f", "g", "h"], { seed }).getSnapshot();
      const boots = new Set(s.items.filter(i => i.type === "boots").map(i => `${i.x},${i.y}`));
      const nearest = s.players.map(p => {
        const x = Math.floor(p.x / s.map.tileSize), y = Math.floor(p.y / s.map.tileSize);
        const queue = [{ x, y, d: 0 }], seen = new Set([`${x},${y}`]);
        for (let i = 0; i < queue.length; i++) {
          const q = queue[i]; if (boots.has(`${q.x},${q.y}`)) return q.d;
          for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const nx = q.x + dx, ny = q.y + dy, key = `${nx},${ny}`;
            if (s.map.tiles[ny]?.[nx]?.type === "floor" && !seen.has(key)) { seen.add(key); queue.push({ x: nx, y: ny, d: q.d + 1 }); }
          }
        }
        return Infinity;
      });
      expect(Math.max(...nearest)).toBeLessThan(Infinity);
      expect(Math.max(...nearest) - Math.min(...nearest)).toBeLessThanOrEqual(20);
    }
  });
  it("randomizes elimination drop locations while preserving item quantities", () => {
    const random = vi.spyOn(globalThis.crypto, "getRandomValues");
    try {
      const drop = (value: number) => {
        random.mockImplementation(array => { (array as Uint32Array)[0] = value; return array; });
        const { game, state } = fixture();
        state.players[0].boots = 2; state.players[0].inventory[0] = { type: "banana", charges: 2 };
        state.players[0].status = "trapped"; state.players[0].trappedSeconds = .1; game.step();
        return game.getSnapshot().items;
      };
      const a = drop(0), b = drop(0xffffffff);
      expect(a.map(i => [i.type, i.kind]).sort()).toEqual(b.map(i => [i.type, i.kind]).sort());
      expect(a).toHaveLength(4); expect(b).toHaveLength(4);
      expect(a.map(i => [i.x, i.y])).not.toEqual(b.map(i => [i.x, i.y]));
    } finally { random.mockRestore(); }
  });
  it("starts with exactly four collectible boots and detached snapshots", () => {
    const game = new Game(["a"]);
    const snapshot = game.getSnapshot();
    expect(snapshot.items.filter(i => i.type === "boots" && i.kind === "pickup")).toHaveLength(4);
    snapshot.items.length = 0;
    expect(game.getSnapshot().items.length).toBeGreaterThan(4);
  });
  it("stacks boots additively and applies capacity and range pickups", () => {
    const { game, state } = fixture();
    add(state, "boots"); add(state, "boots"); add(state, "capacity"); add(state, "range"); game.step();
    let p = game.getSnapshot().players[0];
    expect([p.boots, p.capacityUpgrades, p.rangeUpgrades]).toEqual([2, 1, 1]);
    game.setInput("a", right); game.step();
    p = game.getSnapshot().players[0]; expect(p.x).toBeCloseTo(176 + 9.6);
    expect(game.placeBomb("a")).toBe(true);
    expect(game.getSnapshot().bombs[0].range).toBe(2);
    state.players[0].x += 32;
    expect(game.placeBomb("a")).toBe(true);
  });
  it("stacks consumables in five slots, consumes charges and rejects invalid use", () => {
    const { game, state } = fixture();
    add(state, "banana"); add(state, "banana"); add(state, "slowdown"); game.step();
    expect(game.getSnapshot().players[0].inventory).toEqual([{ type: "banana", charges: 4 }, { type: "slowdown", charges: 5 }, null, null, null]);
    expect(game.useItem("a", 0)).toBe(true); expect(game.useItem("a", 0)).toBe(false);
    expect(game.getSnapshot().players[0].inventory[0]?.charges).toBe(3);
    expect(() => game.useItem("a", 5)).toThrow();
    state.players[0].status = "trapped"; expect(game.useItem("a", 1)).toBe(false);
  });
  it("arms only after the owner leaves, then can be triggered by the owner", () => {
    const { game, state } = fixture(); add(state, "slowdown"); game.step();
    expect(game.useItem("a", 0)).toBe(true); game.step();
    expect(game.getSnapshot().items[0].active).toBe(false);
    game.setInput("a", right); steps(game, 3);
    expect(game.getSnapshot().items[0].active).toBe(true);
    game.setInput("a", { ...idle, left: true }); steps(game, 2);
    expect(game.getSnapshot().items).toHaveLength(0);
    expect(game.getSnapshot().players[0].slowSeconds).toBe(10);
  });
  it("allows another player to trigger an armed trap and frees an emptied slot", () => {
    const { game, state } = fixture(); add(state, "banana"); game.step();
    state.players[0].inventory[0]!.charges = 1;
    expect(game.useItem("a", 0)).toBe(true);
    expect(game.getSnapshot().players[0].inventory[0]).toBeNull();
    game.setInput("a", right); steps(game, 3);
    state.players[1].x = 5.5 * 32; state.players[1].y = 5.5 * 32;
    game.setInput("b", right); game.step();
    expect(game.getSnapshot().items).toHaveLength(0);
    expect(game.getSnapshot().players[1].slide).toEqual(right);
  });
  it("slows to half base speed for ten seconds, then restores boots speed", () => {
    const { game, state } = fixture(); add(state, "boots"); game.step(); add(state, "slowdown", 5, 5, "hazard"); game.step();
    game.setInput("a", right); const start = game.getSnapshot().players[0].x; game.step();
    expect(game.getSnapshot().players[0].x - start).toBeCloseTo(4);
    steps(game, 39); expect(game.getSnapshot().players[0].slowSeconds).toBe(0);
    const before = game.getSnapshot().players[0].x; game.setInput("a", { ...idle, left: true }); game.step();
    expect(before - game.getSnapshot().players[0].x).toBeCloseTo(8.8);
  });
  it("slides against input until a wall or bomb and can be trapped during a slide", () => {
    const { game, state } = fixture(); state.map.tiles[5][8].type = "destructible";
    game.setInput("a", right); add(state, "banana", 5, 5, "hazard"); game.step();
    game.setInput("a", { ...idle, left: true }); steps(game, 8);
    let p = game.getSnapshot().players[0]; expect(p.x).toBe(8 * 32 - 10); expect(p.slide).toBeNull();
    state.players[0].x = 5.5 * 32; state.players[0].slide = right;
    state.bombs.push({ id: 900, ownerId: "b", x: 7, y: 5, remainingSeconds: 100, range: 1 });
    steps(game, 5); p = game.getSnapshot().players[0]; expect(p.x).toBe(7 * 32 - 10); expect(p.slide).toBeNull();
    state.players[0].slide = right; state.explosions.push({ id: 901, x: 6, y: 5, remainingSeconds: 1 }); game.step();
    expect(game.getSnapshot().players[0].status).toBe("trapped"); expect(game.getSnapshot().players[0].slide).toBeNull();
  });
  it("drops passive upgrades as pickups and each unused charge as a hazard on elimination", () => {
    const { game, state } = fixture(); add(state, "boots"); add(state, "capacity"); add(state, "range"); add(state, "banana"); add(state, "slowdown"); game.step();
    state.players[0].status = "trapped"; state.players[0].trappedSeconds = 0.1; game.step();
    const snapshot = game.getSnapshot();
    expect(snapshot.items.filter(i => i.kind === "pickup").map(i => i.type).sort()).toEqual(["boots", "capacity", "range"]);
    expect(snapshot.items.filter(i => i.kind === "hazard" && i.type === "banana")).toHaveLength(2);
    expect(snapshot.items.filter(i => i.kind === "hazard" && i.type === "slowdown")).toHaveLength(5);
    expect(snapshot.items.every(i => snapshot.map.tiles[i.y][i.x].type === "floor")).toBe(true);
    expect(snapshot.players[0].inventory.every(s => s === null)).toBe(true);
  });
});

