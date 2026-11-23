import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { io, type Socket } from "socket.io-client";
import type { ClientEvents, ServerEvents, JoinInfo, GameState, Reply } from "@bubble/shared";
import { createGameServer, type Session } from "../src/server.js";
import { supplyMarkers } from "../../../frontend/src/visual-model.js";

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
  it("delivers the same authoritative supply locations to players, spectators, and late joins", async () => {
    const session = server.create("ffa", 4), player = await client(), spectator = await client();
    await join(player, session); await join(spectator, session, "spectator");
    const seenPlayer: GameState[] = [], seenSpectator: GameState[] = [];
    player.on("snapshot", s => seenPlayer.push(s)); spectator.on("snapshot", s => seenSpectator.push(s));
    const state = (session.game as unknown as { state: GameState }).state;
    state.tick = 5369; state.elapsedSeconds = 5369 / 30;
    expect(session.game.getSnapshot().supplyPreview).toBeNull();
    steps(session, 1); await vi.waitFor(() => expect(seenPlayer.at(-1)?.supplyPreview?.scheduledAt).toBe(180));
    await vi.waitFor(() => expect(seenSpectator.at(-1)?.supplyPreview?.scheduledAt).toBe(180));
    const markers = supplyMarkers(seenPlayer.at(-1)!);
    expect(markers.length).toBeGreaterThanOrEqual(4); expect(supplyMarkers(seenSpectator.at(-1)!)).toEqual(markers);
    const late = await join(await client(), session, "spectator");
    expect(late.ok && supplyMarkers(late.value.snapshot)).toEqual(markers);
    expect(seenPlayer.at(-1)!.supplyPreview!.tiles.every(tile => Object.keys(tile).sort().join(",") === "x,y")).toBe(true);
    expect(seenPlayer.at(-1)!.items.some(item => item.supplyDroppedAt === 180)).toBe(false);
    steps(session, 30); expect(supplyMarkers(session.game.getSnapshot())).toEqual([]);
    expect(session.game.getSnapshot().items.filter(item => item.supplyDroppedAt === 180).map(item => ({ x: item.x, y: item.y }))).toEqual(seenPlayer.at(-1)!.supplyPreview!.tiles);
  });
  it("gives bots the same public preview as human clients without hidden item types", () => {
    const session = server.create("ffa", 4, 1);
    const state = (session.game as unknown as { state: GameState }).state;
    const bot = session.slots.find(slot => slot.bot)!.bot!;
    const update = vi.spyOn(bot, "update");
    state.tick = 5369; state.elapsedSeconds = 5369 / 30;
    steps(session, 1);
    expect(update.mock.calls[0][0].supplyPreview).toBeNull();
    const publicSnapshot = session.game.getSnapshot();
    expect(publicSnapshot.supplyPreview?.scheduledAt).toBe(180);
    steps(session, 1);
    const botSnapshot = update.mock.calls[1][0];
    expect(botSnapshot).toEqual(publicSnapshot);
    expect(botSnapshot.supplyPreview!.tiles.every(tile => Object.keys(tile).sort().join(",") === "x,y")).toBe(true);
    expect(botSnapshot.items.some(item => item.supplyDroppedAt === 180)).toBe(false);
  });
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
  it.each([["ffa", 4], ["ffa", 5], ["ffa", 7], ["team", 4], ["team", 6], ["team", 8]] as const)("synchronizes %s with %i connected players", async (mode, count) => {
    const session = server.create(mode, count), clients = await Promise.all(Array.from({ length: count }, () => client()));
    const joins = await Promise.all(clients.map(socket => join(socket, session)));
    expect(joins.every(result => result.ok)).toBe(true);
    const ids = joins.map(result => result.ok ? result.value.playerId : null);
    expect(new Set(ids).size).toBe(count);
    const snapshots: GameState[] = [];
    for (const socket of clients) socket.once("snapshot", snapshot => snapshots.push(snapshot));
    steps(session, 1);
    await vi.waitFor(() => expect(snapshots).toHaveLength(count));
    expect(snapshots.every(snapshot => JSON.stringify(snapshot) === JSON.stringify(snapshots[0]))).toBe(true);
    const finishes: unknown[] = []; clients.forEach(socket => socket.once("finished", result => finishes.push(result)));
    const state = (session.game as unknown as { state: GameState }).state; state.tick = 17999; state.elapsedSeconds = 17999 / 30;
    steps(session, 1); await vi.waitFor(() => expect(finishes).toHaveLength(count));
    expect(finishes.every(result => JSON.stringify(result) === JSON.stringify({ kind: "draw" }))).toBe(true);
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
    steps(a, 3); await vi.waitFor(() => expect(seen.at(-1)?.tick).toBe(3));
    expect(seen.at(-1)!.players.find(p => p.id === joined.value.playerId)!.x).not.toBe(joined.value.snapshot.players.find(p => p.id === joined.value.playerId)!.x);
    expect(leaked).toHaveLength(0);
    expect((await command(player, "bomb", { seq: 0 })).ok).toBe(true); steps(a, 1); await vi.waitFor(() => expect(seen.at(-1)?.bombs).toHaveLength(1));
    steps(a, 89); await vi.waitFor(() => expect(seen.some(s => s.explosions.length > 0)).toBe(true), { timeout: 5000 });
    expect(leaked).toHaveLength(0); steps(b, 1); await vi.waitFor(() => expect(leaked).toHaveLength(1)); expect(leaked.at(-1)!.players.every(p => !joined.value.snapshot.players.some(q => q.id === p.id))).toBe(true);
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
    a.status = "trapped"; a.trappedSeconds = 10; steps(session, 1); await vi.waitFor(() => expect(snapshots1.at(-1)?.players[0].status).toBe("alive"));
    const current = (session.game as unknown as { state: GameState }).state; current.players[0].status = "trapped"; current.players[0].trappedSeconds = 0.01; steps(session, 1); await vi.waitFor(() => expect(snapshots1.at(-1)?.players[0].status).toBe("eliminated"));
    const updated = (session.game as unknown as { state: GameState }).state; updated.tick = 5399; updated.elapsedSeconds = 5399 / 30; steps(session, 1); await vi.waitFor(() => expect(snapshots1.at(-1)?.balloon?.startedAt).toBe(180));
    await vi.waitFor(() => expect(snapshots2.at(-1)?.balloon?.startedAt).toBe(180));
    expect(snapshots1.at(-1)!.balloon?.startedAt).toBe(180);
    expect(snapshots1.at(-1)!.items.some(i => i.supplyDroppedAt === 180)).toBe(true);
    expect(snapshots1.at(-1)).toEqual(snapshots2.at(-1));
  });
  it("synchronizes a bomb trapping and timing out its owner", async () => {
    const session = server.create("ffa", 4), player = await client(), spectator = await client();
    const joined = await join(player, session); if (!joined.ok) throw new Error(joined.error);
    await join(spectator, session, "spectator"); const seen: GameState[] = []; spectator.on("snapshot", s => seen.push(s));
    expect((await command(player, "bomb", { seq: 0 })).ok).toBe(true);
    steps(session, 90);
    await vi.waitFor(() => expect(seen.some(s => s.explosions.length > 0 && s.players.find(p => p.id === joined.value.playerId)?.status === "trapped")).toBe(true), { timeout: 5000 });
    steps(session, 300);
    await vi.waitFor(() => expect(seen.at(-1)?.players.find(p => p.id === joined.value.playerId)?.status).toBe("eliminated"), { timeout: 5000 });
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
    steps(session, 1); await vi.waitFor(() => expect(result).toEqual({ kind: "winner", teamId: joined.value.teamId }));
  });
  it("runs the default automatic fixed-step loop", async () => {
    const automatic = createGameServer();
    try { const session = automatic.create("ffa", 4); await new Promise(resolve => setTimeout(resolve, 120)); expect(session.game.getSnapshot().tick).toBeGreaterThanOrEqual(2); }
    finally { await automatic.close(); }
  });
  it("expires abandoned sessions, preserves connected sessions, and cleans completed sessions", async () => {
    const active = server.create("ffa", 4), abandoned = server.create("ffa", 4);
    const watcher = await client(); await join(watcher, active, "spectator");
    clock += 120001; server.cleanup();
    expect(server.sessions.has(abandoned.id)).toBe(false); expect(server.sessions.has(active.id)).toBe(true);
    const state = (active.game as unknown as { state: GameState }).state;
    state.players.slice(1).forEach(p => { p.status = "eliminated"; }); steps(active, 1);
    const tick = active.game.getSnapshot().tick; steps(active, 10); expect(active.game.getSnapshot().tick).toBe(tick);
    clock += 300001; server.cleanup(); expect(server.sessions.has(active.id)).toBe(false);
    await vi.waitFor(() => expect(watcher.connected).toBe(false));
  });
  it("enforces resource limits and message rate limits", async () => {
    const limited = createGameServer({ autoTick: false, maxSessions: 1 });
    try { limited.create("ffa", 4); expect(() => limited.create("ffa", 4)).toThrow("capacity"); } finally { await limited.close(); }
    const session = server.create("ffa", 4), socket = await client(); await join(socket, session);
    for (let i = 0; i < 89; i++) expect((await command(socket, "move", { seq: i, input: idle })).ok).toBe(true);
    expect((await command(socket, "move", { seq: 89, input: idle })).ok).toBe(false);
  });
  it("rejects non-local origins and invalid sessions", async () => {
    const response = await fetch(`${url}/dev/sessions`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://example.com" }, body: JSON.stringify({ mode: "ffa", players: 4 }) });
    expect(response.status).toBe(403);
    const socket = await client(); const reply: Reply<JoinInfo> = await new Promise(resolve => socket.emit("join", { sessionId: "invalid", role: "player" }, resolve));
    expect(reply.ok).toBe(false);
  });
  it("disconnects oversized and unknown packets and rejects spectator escalation", async () => {
    const session = server.create("ffa", 4), watcher = await client(); await join(watcher, session, "spectator");
    expect((await command(watcher, "bomb", { seq: 0, playerId: session.slots[0].id })).ok).toBe(false);
    (watcher.emit as (...args: unknown[]) => void)("invented", {});
    await vi.waitFor(() => expect(watcher.connected).toBe(false));
    const attacker = await client(); await join(attacker, session);
    (attacker.emit as (...args: unknown[]) => void)("move", { seq: 0, input: idle, padding: "x".repeat(2048) }, () => {});
    await vi.waitFor(() => expect(attacker.connected).toBe(false));
  });
  it("keeps combat running safely when a player disconnects", async () => {
    const session = server.create("ffa", 4), player = await client(), spectator = await client();
    const joined = await join(player, session); if (!joined.ok) throw new Error(joined.error); await join(spectator, session, "spectator");
    const seen: GameState[] = []; spectator.on("snapshot", snapshot => seen.push(snapshot));
    expect((await command(player, "bomb", { seq: 0 })).ok).toBe(true); player.disconnect();
    await vi.waitFor(() => expect(session.slots[0].socketId).toBeUndefined()); steps(session, 90);
    await vi.waitFor(() => expect(seen.some(s => s.explosions.length > 0)).toBe(true), { timeout: 5000 });
    expect(session.game.getSnapshot().players.find(p => p.id === joined.value.playerId)?.status).toBe("trapped");
  });
  it("cleans up rapid connection churn without releasing claimed identities", async () => {
    const session = server.create("ffa", 4), ids: (string | null)[] = [];
    for (let i = 0; i < 4; i++) { const socket = await client(), result = await join(socket, session); if (result.ok) ids.push(result.value.playerId); socket.disconnect(); await vi.waitFor(() => expect(session.members.size).toBe(0)); }
    expect(new Set(ids).size).toBe(4); expect((await join(await client(), session)).ok).toBe(false);
  });
  it("disables the development server in production", () => { expect(() => createGameServer({ environment: "production" })).toThrow(); });
});
