import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";
import type { ClientEvents, ServerEvents, JoinInfo, GameState, Reply } from "@bubble/shared";
import { createGameServer, type Session } from "../src/server.js";

let clock = 1000;
let server: ReturnType<typeof createGameServer>;
let url: string;
let sockets: Socket<ServerEvents, ClientEvents>[];
const idle = { up: false, down: false, left: false, right: false };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function client(): Promise<Socket<ServerEvents, ClientEvents>> {
  const socket: Socket<ServerEvents, ClientEvents> = io(url, { transports: ["websocket"], reconnection: false });
  sockets.push(socket); await new Promise<void>((resolve, reject) => { socket.once("connect", () => resolve()); socket.once("connect_error", reject); }); return socket;
}
async function join(socket: Socket<ServerEvents, ClientEvents>, session: Session, role: "player" | "spectator" = "player"): Promise<Reply<JoinInfo>> {
  return new Promise(resolve => socket.emit("join", { sessionId: session.id, role }, resolve));
}
async function command(socket: Socket<ServerEvents, ClientEvents>, event: "move" | "bomb" | "item", payload: unknown): Promise<Reply> {
  return new Promise(resolve => (socket.emit as (...args: unknown[]) => void)(event, payload, resolve));
}
function steps(session: Session, count: number) { for (let i = 0; i < count; i++) server.tick(session); }
beforeEach(async () => {
  clock = 1000; sockets = []; server = createGameServer({ autoTick: false, snapshotEveryTicks: 1, staleInputMs: 500, now: () => clock });
  await new Promise<void>(resolve => server.http.listen(0, "127.0.0.1", resolve));
  const address = server.http.address(); if (!address || typeof address === "string") throw new Error("No address"); url = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => { for (const socket of sockets) socket.disconnect(); await server.close(); });

describe("Socket.IO authoritative sessions", () => {
  it("joins four FFA players and four two-team players with consistent initial state", async () => {
    for (const mode of ["ffa", "team"] as const) {
      const session = server.create(mode, 4), infos: JoinInfo[] = [];
      for (let i = 0; i < 4; i++) { const result = await join(await client(), session); expect(result.ok).toBe(true); if (result.ok) infos.push(result.value); }
      expect(new Set(infos.map(i => i.playerId)).size).toBe(4);
      expect(infos.every(i => JSON.stringify(i.snapshot) === JSON.stringify(infos[0].snapshot))).toBe(true);
      const teams = infos.map(i => i.teamId); expect(new Set(teams).size).toBe(mode === "ffa" ? 4 : 2);
      if (mode === "team") expect([...new Set(teams)].every(t => teams.filter(team => team === t).length === 2)).toBe(true);
    }
  });
  it("validates four, six, eight and odd FFA rosters, and rejects invalid counts", () => {
    for (const count of [4, 6, 8]) expect(server.create("team", count).slots).toHaveLength(count);
    expect(server.create("ffa", 5).slots).toHaveLength(5);
    for (const count of [3, 5, 7, 9]) expect(() => server.create("team", count)).toThrow();
    expect(() => server.create("ffa", 9)).toThrow();
  });
  it("rejects a ninth player and spectators cannot control the match", async () => {
    const session = server.create("ffa", 8);
    for (let i = 0; i < 8; i++) expect((await join(await client(), session)).ok).toBe(true);
    expect((await join(await client(), session)).ok).toBe(false);
    const spectator = await client(); const result = await join(spectator, session, "spectator");
    expect(result.ok && result.value.playerId).toBeNull();
    expect((await command(spectator, "move", { seq: 0, input: { ...idle, right: true } })).ok).toBe(false);
    expect((await command(spectator, "bomb", { seq: 0 })).ok).toBe(false);
    expect((await command(spectator, "item", { seq: 1, slot: 0 })).ok).toBe(false);
  });
  it("isolates simultaneous sessions and broadcasts movement, bombs and explosions", async () => {
    const a = server.create("ffa", 4), b = server.create("ffa", 4), player = await client(), observer = await client(), other = await client();
    const joined = await join(player, a); expect(joined.ok).toBe(true); if (!joined.ok) return;
    await join(observer, a, "spectator"); await join(other, b, "spectator");
    const seen: GameState[] = [], leaked: GameState[] = [];
    observer.on("snapshot", s => seen.push(s)); other.on("snapshot", s => leaked.push(s));
    expect((await command(player, "move", { seq: 0, input: { ...idle, right: true } })).ok).toBe(true);
    steps(a, 3); await pause();
    expect(seen.at(-1)!.players.find(p => p.id === joined.value.playerId)!.x).not.toBe(joined.value.snapshot.players.find(p => p.id === joined.value.playerId)!.x);
    expect(leaked).toHaveLength(0);
    expect((await command(player, "bomb", { seq: 0 })).ok).toBe(true); steps(a, 1); await pause(); expect(seen.at(-1)!.bombs).toHaveLength(1);
    steps(a, 89); await pause(); expect(seen.some(s => s.explosions.length > 0)).toBe(true);
    expect(leaked).toHaveLength(0); steps(b, 1); await pause(); expect(leaked.at(-1)!.players.every(p => !joined.value.snapshot.players.some(q => q.id === p.id))).toBe(true);
  });
  it("stops stale and disconnected movement and never reassigns the identity", async () => {
    const session = server.create("ffa", 4), socket = await client(); const joined = await join(socket, session); if (!joined.ok) throw new Error(joined.error);
    await command(socket, "move", { seq: 0, input: { ...idle, right: true } }); steps(session, 2);
    clock += 501; steps(session, 1); const x = session.game.getSnapshot().players.find(p => p.id === joined.value.playerId)!.x;
    steps(session, 4); expect(session.game.getSnapshot().players.find(p => p.id === joined.value.playerId)!.x).toBe(x);
    socket.disconnect(); await pause(); const replacement = await join(await client(), session);
    expect(replacement.ok && replacement.value.playerId).not.toBe(joined.value.playerId);
    steps(session, 4); expect(session.game.getSnapshot().players.find(p => p.id === joined.value.playerId)!.x).toBe(x);
  });
  it("rejects malformed, spoofed, duplicate and out-of-order commands", async () => {
    const session = server.create("ffa", 4), socket = await client(); await join(socket, session);
    expect((await command(socket, "move", { seq: 0, input: { ...idle, x: 999 } })).ok).toBe(false);
    expect((await command(socket, "move", { seq: 1, input: idle, playerId: "spoof" })).ok).toBe(false);
    expect((await command(socket, "move", { seq: 2, input: idle })).ok).toBe(true);
    expect((await command(socket, "move", { seq: 2, input: idle })).ok).toBe(false);
    expect((await command(socket, "bomb", { seq: 0 })).ok).toBe(true);
    expect((await command(socket, "bomb", { seq: 0 })).ok).toBe(false);
    expect((await command(socket, "item", { seq: 1, slot: 9 })).ok).toBe(false);
  });
  it("broadcasts trapping, rescue, elimination, item and balloon state from the engine", async () => {
    const session = server.create("team", 4), one = await client(), two = await client(); await join(one, session, "spectator"); await join(two, session, "spectator");
    const snapshots1: GameState[] = [], snapshots2: GameState[] = []; one.on("snapshot", s => snapshots1.push(s)); two.on("snapshot", s => snapshots2.push(s));
    const state = (session.game as unknown as { state: GameState }).state;
    const [a, ally, enemy] = state.players; a.x = ally.x = 160; a.y = ally.y = 160; enemy.x = 300; enemy.y = 300;
    a.status = "trapped"; a.trappedSeconds = 10; steps(session, 1); await pause(); expect(snapshots1.at(-1)!.players[0].status).toBe("alive");
    const current = (session.game as unknown as { state: GameState }).state; current.players[0].status = "trapped"; current.players[0].trappedSeconds = 0.01; steps(session, 1); await pause(); expect(snapshots1.at(-1)!.players[0].status).toBe("eliminated");
    const updated = (session.game as unknown as { state: GameState }).state; updated.tick = 5399; updated.elapsedSeconds = 5399 / 30; steps(session, 1); await pause();
    expect(snapshots1.at(-1)!.balloon?.startedAt).toBe(180);
    expect(snapshots1.at(-1)!.items.some(i => i.supplyDroppedAt === 180)).toBe(true);
    expect(snapshots1.at(-1)).toEqual(snapshots2.at(-1));
  });
  it("synchronizes a bomb trapping and timing out its owner", async () => {
    const session = server.create("ffa", 4), player = await client(), spectator = await client();
    const joined = await join(player, session); if (!joined.ok) throw new Error(joined.error);
    await join(spectator, session, "spectator"); const seen: GameState[] = []; spectator.on("snapshot", s => seen.push(s));
    expect((await command(player, "bomb", { seq: 0 })).ok).toBe(true);
    steps(session, 90); await pause();
    expect(seen.some(s => s.explosions.length > 0 && s.players.find(p => p.id === joined.value.playerId)?.status === "trapped")).toBe(true);
    steps(session, 300); await pause();
    expect(seen.at(-1)!.players.find(p => p.id === joined.value.playerId)?.status).toBe("eliminated");
    expect((await command(player, "bomb", { seq: 1 })).ok).toBe(false);
  });
  it("validates the local launcher HTTP request and returns an unguessable session ID", async () => {
    const request = (body: unknown) => fetch(`${url}/dev/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    expect((await request({ mode: "team", players: 5 })).status).toBe(400);
    expect((await request({ mode: "ffa", players: 9 })).status).toBe(400);
    expect((await request({ mode: "ffa", players: 4, teams: ["fake"] })).status).toBe(400);
    const response = await request({ mode: "team", players: 4 });
    expect(response.status).toBe(201); const body = await response.json(); expect(server.sessions.has(body.sessionId)).toBe(true);
  });
  it("gives late spectators the current snapshot and reports match completion", async () => {
    const session = server.create("ffa", 4), player = await client(); const joined = await join(player, session);
    if (!joined.ok) throw new Error(joined.error);
    steps(session, 10); const spectator = await client(); const info = await join(spectator, session, "spectator");
    expect(info.ok && info.value.snapshot.tick).toBe(10);
    const state = (session.game as unknown as { state: GameState }).state;
    for (const p of state.players.slice(1)) { p.status = "trapped"; p.trappedSeconds = 0.01; }
    let result: unknown; spectator.on("finished", value => { result = value; });
    steps(session, 1); await pause(); expect(result).toEqual({ kind: "winner", teamId: joined.value.teamId });
  });
  it("runs the default automatic fixed-step loop", async () => {
    const automatic = createGameServer();
    try { const session = automatic.create("ffa", 4); await new Promise(resolve => setTimeout(resolve, 120)); expect(session.game.getSnapshot().tick).toBeGreaterThanOrEqual(2); }
    finally { await automatic.close(); }
  });
  it("disables the development server in production", () => { expect(() => createGameServer({ environment: "production" })).toThrow(); });
});
