import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { io, type Socket } from "socket.io-client";
import type { ClientEvents, GameState, GameSnapshot, JoinInfo, Reply, ServerEvents } from "@bubble/shared";
import { createGameServer, publicSnapshot, type Session } from "../src/server.js";

let server: ReturnType<typeof createGameServer>, url: string;
let sockets: Socket<ServerEvents, ClientEvents>[];
const steps = (session: Session, count: number) => { for (let i = 0; i < count; i++) server.tick(session); };
const state = (session: Session) => (session.game as unknown as { state: GameState }).state;
async function connect(session: Session, role: "player" | "spectator") {
  const socket: Socket<ServerEvents, ClientEvents> = io(url, { transports: ["websocket"], reconnection: false });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => { socket.once("connect", () => resolve()); socket.once("connect_error", reject); });
  const reply: Reply<JoinInfo> = await new Promise(resolve => socket.emit("join", { sessionId: session.id, role }, resolve));
  return { socket, reply };
}
function openArena(session: Session) {
  const s = state(session), size = s.map.tileSize;
  for (const row of s.map.tiles) for (const t of row) t.type = t.x === 0 || t.y === 0 || t.x === s.map.width - 1 || t.y === s.map.height - 1 ? "indestructible" : "floor";
  s.items = [];
  s.players.forEach((p, i) => { p.x = (1.5 + i * 2) * size; p.y = 1.5 * size; });
  return s;
}
beforeEach(async () => {
  sockets = []; server = createGameServer({ autoTick: false, snapshotEveryTicks: 1 });
  await new Promise<void>(resolve => server.http.listen(0, "127.0.0.1", resolve));
  const addr = server.http.address(); if (!addr || typeof addr === "string") throw new Error("No address");
  url = `http://127.0.0.1:${addr.port}`;
});
afterEach(async () => { sockets.forEach(s => s.disconnect()); await server.close(); });

describe("server-controlled bots", () => {
  it.each([
    ["ffa", 4, 3, "normal"], ["ffa", 4, 3, "hard"], ["ffa", 4, 4, "normal"],
    ["ffa", 8, 8, "normal"], ["team", 4, 2, "normal"],
  ] as const)("continues authoritative gameplay for %s with %i slots, %i bots, %s", (mode, count, botCount, difficulty) => {
    const session = server.create(mode, count, botCount, difficulty);
    const initial = session.game.getSnapshot(), moved = new Map<string, number>();
    let previous = initial;
    for (let tick = 0; tick < 360 && !session.completed; tick++) {
      server.tick(session); const current = session.game.getSnapshot();
      for (const slot of session.slots.filter(s => s.bot)) {
        const before = previous.players.find(p => p.id === slot.id)!, after = current.players.find(p => p.id === slot.id)!;
        moved.set(slot.id, (moved.get(slot.id) ?? 0) + Math.hypot(after.x - before.x, after.y - before.y));
        if (before.status !== "alive") expect(after).toMatchObject({ x: before.x, y: before.y });
      }
      previous = current;
    }
    expect([...moved.values()].filter(distance => distance > initial.map.tileSize).length).toBeGreaterThanOrEqual(Math.min(botCount, 2));
  }, 15000);
  it("reserves slots and broadcasts autonomous movement to a human and spectator", async () => {
    const session = server.create("ffa", 4, 3), human = await connect(session, "player"), spectator = await connect(session, "spectator");
    expect(human.reply.ok).toBe(true); expect(spectator.reply.ok).toBe(true);
    expect((await connect(session, "player")).reply.ok).toBe(false);
    const spectatorBomb: Reply = await new Promise(resolve => spectator.socket.emit("bomb", { seq: 0 }, resolve));
    expect(spectatorBomb.ok).toBe(false);
    const seen: GameSnapshot[] = []; spectator.socket.on("snapshot", s => seen.push(s));
    const initial = session.game.getSnapshot(); steps(session, 35);
    await vi.waitFor(() => expect(seen.at(-1)?.tick).toBe(35));
    expect(initial.players).toHaveLength(4);
    const moved = session.game.getSnapshot();
    expect(moved.players.slice(1).some((p, i) => Math.hypot(p.x - initial.players[i + 1].x, p.y - initial.players[i + 1].y) > 5)).toBe(true);
    expect(seen.at(-1)).toEqual(JSON.parse(JSON.stringify(publicSnapshot(moved))));
  });
  it("collects a pickup by navigating real movement and avoids walls", () => {
    const session = server.create("ffa", 4, 1), s = openArena(session), bot = s.players[3], size = s.map.tileSize;
    bot.x = 3.5 * size; bot.y = 3.5 * size;
    s.map.tiles[3][4].type = "indestructible";
    s.items.push({ id: 100, x: 5, y: 3, type: "boots", kind: "pickup", active: true });
    steps(session, 120);
    const p = session.game.getSnapshot().players[3];
    expect(p.boots).toBe(1);
    expect(session.game.getSnapshot().map.tiles[Math.floor(p.y / size)][Math.floor(p.x / size)].type).toBe("floor");
    expect(p.x).toBeGreaterThan(size); expect(p.x).toBeLessThan((s.map.width - 1) * size);
  });
  it("places a normal bomb near a wall and escapes its blast", () => {
    const session = server.create("ffa", 4, 1), s = openArena(session), bot = s.players[3], size = s.map.tileSize;
    bot.x = 5.5 * size; bot.y = 5.5 * size; s.map.tiles[5][6].type = "destructible";
    steps(session, 1); expect(session.game.getSnapshot().bombs.some(b => b.ownerId === bot.id)).toBe(true);
    steps(session, 100); const result = session.game.getSnapshot();
    expect(result.map.tiles[5][6].type).toBe("floor");
    expect(result.players[3].status).toBe("alive");
  });
  it("broadcasts bot bombs to human players and spectators", async () => {
    const session = server.create("ffa", 4, 1), s = openArena(session), bot = s.players[3], size = s.map.tileSize;
    bot.x = 5.5 * size; bot.y = 5.5 * size; s.map.tiles[5][6].type = "destructible";
    const human = await connect(session, "player"), spectator = await connect(session, "spectator");
    const seenHuman: GameSnapshot[] = [], seenSpectator: GameSnapshot[] = [];
    human.socket.on("snapshot", v => seenHuman.push(v)); spectator.socket.on("snapshot", v => seenSpectator.push(v));
    steps(session, 1);
    await vi.waitFor(() => expect(seenHuman.at(-1)?.bombs.some(b => b.ownerId === bot.id)).toBe(true));
    await vi.waitFor(() => expect(seenSpectator.at(-1)).toEqual(seenHuman.at(-1)));
  });
  it("does not deliberately bomb a teammate in its predicted blast", () => {
    const session = server.create("team", 4, 1), s = openArena(session), bot = s.players[3], size = s.map.tileSize;
    bot.x = 5.5 * size; bot.y = 5.5 * size;
    s.players[2].x = 5.5 * size; s.players[2].y = 6.5 * size;
    s.map.tiles[5][6].type = "destructible";
    steps(session, 1); expect(session.game.getSnapshot().bombs).toHaveLength(0);
  });
  it("hard difficulty also protects nearby teammate escape tiles", () => {
    const session = server.create("team", 4, 1, "hard"), s = openArena(session), bot = s.players[3], size = s.map.tileSize;
    bot.x = 5.5 * size; bot.y = 5.5 * size;
    s.players[2].x = 4.5 * size; s.players[2].y = 4.5 * size; s.map.tiles[5][6].type = "destructible";
    steps(session, 1); expect(session.game.getSnapshot().bombs).toHaveLength(0);
  });
  it("refuses an inescapable bomb and never acts while trapped or eliminated", () => {
    const session = server.create("ffa", 4, 1), s = openArena(session), bot = s.players[3], size = s.map.tileSize;
    bot.x = 5.5 * size; bot.y = 5.5 * size;
    for (const [x, y] of [[4,5],[6,5],[5,4],[5,6]]) s.map.tiles[y][x].type = "destructible";
    steps(session, 1); expect(session.game.getSnapshot().bombs).toHaveLength(0);
    const current = state(session).players[3]; current.status = "trapped"; current.trappedSeconds = 1;
    const position = { x: current.x, y: current.y }; steps(session, 5);
    expect(session.game.getSnapshot().players[3]).toMatchObject(position);
    state(session).players[3].status = "eliminated"; steps(session, 5);
    expect(session.game.getSnapshot().players[3]).toMatchObject(position);
  });
  it("responds to a human bomb and keeps sessions independent", () => {
    const a = server.create("ffa", 4, 1), b = server.create("ffa", 4, 1), s = openArena(a), size = s.map.tileSize;
    s.players[3].x = 5.5 * size; s.players[3].y = 5.5 * size;
    s.players[0].x = 5.5 * size; s.players[0].y = 6.5 * size;
    expect(a.game.placeBomb(s.players[0].id)).toBe(true);
    const originalB = b.game.getSnapshot(); steps(a, 90);
    expect(a.game.getSnapshot().players[3].status).toBe("alive");
    expect(b.game.getSnapshot()).toEqual(originalB);
  });
  it("supports team rosters, validates bot counts, and ends bot matches", () => {
    const session = server.create("team", 4, 2), s = openArena(session);
    expect(new Set(s.players.map(p => p.teamId)).size).toBe(2);
    expect(() => server.create("ffa", 4, 5)).toThrow();
    s.players[0].status = s.players[1].status = "eliminated"; steps(session, 1);
    expect(session.game.getSnapshot().result).toEqual({ kind: "winner", teamId: s.players[2].teamId });
  });
  it("validates development launcher bot counts without changing the old request", async () => {
    const request = (body: unknown) => fetch(`${url}/dev/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    expect((await request({ mode: "ffa", players: 4, bots: 3 })).status).toBe(201);
    expect((await request({ mode: "ffa", players: 4 })).status).toBe(201);
    expect((await request({ mode: "ffa", players: 4, bots: 5 })).status).toBe(400);
    expect((await request({ mode: "ffa", players: 4, bots: -1 })).status).toBe(400);
    expect((await request({ mode: "ffa", players: 4, bots: 1.5 })).status).toBe(400);
    expect((await request({ mode: "team", players: 5, bots: 2 })).status).toBe(400);
    expect((await request({ mode: "ffa", players: 4, bots: 1, difficulty: "impossible" })).status).toBe(400);
  });
  it.each(["easy", "normal", "hard"] as const)("uses normal game rules at %s difficulty", difficulty => {
    const session = server.create("ffa", 4, 1, difficulty), s = openArena(session), bot = s.players[3], size = s.map.tileSize;
    bot.x = 5.5 * size; bot.y = 5.5 * size; s.map.tiles[5][6].type = "destructible";
    steps(session, 1); const snapshot = session.game.getSnapshot(), bomb = snapshot.bombs.find(b => b.ownerId === bot.id);
    expect(bomb).toBeDefined(); expect(bomb!.range).toBe(1); expect(bomb!.remainingSeconds).toBeCloseTo(3 - 1 / 30);
    steps(session, 100); expect(session.game.getSnapshot().players[3].status).toBe("alive");
  });
  it("exposes actual controller data only when debug is enabled", async () => {
    const ordinary = server.create("ffa", 4, 1); steps(ordinary, 1);
    expect((await fetch(`${url}/dev/sessions/${ordinary.id}/bot-debug`)).status).toBe(404);
    const debugServer = createGameServer({ autoTick: false, botDebug: true, snapshotEveryTicks: 1 });
    await new Promise<void>(resolve => debugServer.http.listen(0, "127.0.0.1", resolve));
    try {
      const addr = debugServer.http.address(); if (!addr || typeof addr === "string") throw new Error("No address");
      const session = debugServer.create("ffa", 4, 1);
      expect(session.game.placeBomb(session.slots[3].id)).toBe(true);
      const normalUrl = url; url = `http://127.0.0.1:${addr.port}`;
      const spectator = await connect(session, "spectator"); url = normalUrl;
      if (!spectator.reply.ok) throw new Error("Spectator join failed");
      expect(spectator.reply.value.snapshot.bombs[0]).not.toHaveProperty("remainingSeconds");
      const snapshots: GameSnapshot[] = []; spectator.socket.on("snapshot", value => snapshots.push(value));
      debugServer.tick(session);
      await vi.waitFor(() => expect(snapshots.length).toBeGreaterThan(0));
      expect(snapshots[0].bombs[0]).not.toHaveProperty("remainingSeconds");
      const response = await fetch(`http://127.0.0.1:${addr.port}/dev/sessions/${session.id}/bot-debug`);
      const data = await response.json(), slot = session.slots[3], player = session.game.getSnapshot().players[3];
      expect(data).toHaveLength(1); expect(data[0].playerId).toBe(slot.id);
      expect(data[0].state).toBe(slot.botCommand?.state); expect(data[0].reason).toBe(slot.botCommand?.reason);
      expect(data[0].position).toEqual({ x: player.x, y: player.y });
      expect(data[0].path).toEqual(slot.bot!.debug(session.game.getSnapshot(), slot.botCommand!).path);
      expect(data[0].danger.length).toBeGreaterThan(0);
    } finally { await debugServer.close(); }
  });
});
