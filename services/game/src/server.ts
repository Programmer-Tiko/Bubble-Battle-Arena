import express from "express";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Server } from "socket.io";
import { DEFAULT_MOVEMENT_CONFIG, Game } from "@bubble/engine";
import { BotController, type BotCommand, type BotDifficulty } from "@bubble/bot";
import type { ClientEvents, ServerEvents, MovementInput, SessionMode, Reply, GameSnapshot } from "@bubble/shared";

const idle: MovementInput = { up: false, down: false, left: false, right: false };
const tickMs = DEFAULT_MOVEMENT_CONFIG.timestepSeconds * 1000;
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const exact = (x: Record<string, unknown>, keys: string[]) => Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
const seqValid = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const localOrigin = (origin: string | undefined) => !origin || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
const loopback = (address: string | undefined) => address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
const localHost = (host: string | undefined) => !!host && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);

export interface ServerOptions { snapshotEveryTicks?: number; staleInputMs?: number; autoTick?: boolean; now?: () => number; environment?: string; maxSessions?: number; maxConnections?: number; maxMembersPerSession?: number; emptySessionMs?: number; completedSessionMs?: number; cleanupIntervalMs?: number; joinTimeoutMs?: number; botDebug?: boolean }
interface Slot { id: string; claimed: boolean; socketId?: string; lastInputAt: number; bot?: BotController; botCommand?: BotCommand }
export interface Session { id: string; game: Game; slots: Slot[]; timer?: ReturnType<typeof setInterval>; completed: boolean; completedAt?: number; emptySince: number; members: Set<string>; snapshot: GameSnapshot }

/** Development launcher only. Replace the join boundary with verified identity/room authorization for production. */
export function createGameServer(options: ServerOptions = {}) {
  if (process.env.NODE_ENV === "production" || options.environment === "production") throw new Error("Development game server is disabled in production");
  const snapshotEvery = options.snapshotEveryTicks ?? 3, staleMs = options.staleInputMs ?? 500;
  if (!Number.isInteger(snapshotEvery) || snapshotEvery < 1 || !Number.isFinite(staleMs) || staleMs <= 0) throw new RangeError("Invalid server options");
  const maxSessions = options.maxSessions ?? 32, maxConnections = options.maxConnections ?? 256, maxMembers = options.maxMembersPerSession ?? 24;
  const emptyMs = options.emptySessionMs ?? 120_000, completedMs = options.completedSessionMs ?? 300_000, cleanupMs = options.cleanupIntervalMs ?? 10_000, joinMs = options.joinTimeoutMs ?? 10_000;
  if (![maxSessions, maxConnections, maxMembers].every(n => Number.isInteger(n) && n > 0) || ![emptyMs, completedMs, cleanupMs, joinMs].every(n => Number.isFinite(n) && n > 0)) throw new RangeError("Invalid resource limits");
  const now = options.now ?? Date.now;
  const app = express();
  app.use((req, res, next) => { if (!loopback(req.socket.remoteAddress) || !localHost(req.headers.host) || !localOrigin(req.headers.origin)) { res.sendStatus(403); return; } next(); });
  app.use((req, res, next) => {
    if (req.headers.origin) { res.setHeader("Access-Control-Allow-Origin", req.headers.origin); res.setHeader("Vary", "Origin"); }
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") { res.sendStatus(204); return; } next();
  });
  app.use(express.json({ limit: "1kb", strict: true }));
  const http = createServer(app);
  const io = new Server<ClientEvents, ServerEvents>(http, { transports: ["websocket"], maxHttpBufferSize: 1024, perMessageDeflate: { threshold: 1024 }, cors: { origin: (origin, cb) => cb(null, localOrigin(origin)) }, allowRequest: (req, cb) => cb(null, loopback(req.socket.remoteAddress) && localHost(req.headers.host) && localOrigin(req.headers.origin) && io.engine.clientsCount < maxConnections) });
  const sessions = new Map<string, Session>();
  const create = (mode: SessionMode, count: number, botCount = 0, difficulty: BotDifficulty = "normal"): Session => {
    if ((mode !== "ffa" && mode !== "team") || !Number.isInteger(count) || count < 4 || count > 8 || (mode === "team" && count % 2)) throw new RangeError("Invalid roster");
    if (!Number.isInteger(botCount) || botCount < 0 || botCount > count) throw new RangeError("Invalid bot count");
    if (!["easy", "normal", "hard"].includes(difficulty)) throw new RangeError("Invalid bot difficulty");
    if (sessions.size >= maxSessions) throw new Error("Session capacity reached");
    const slots: Slot[] = Array.from({ length: count }, () => ({ id: randomUUID(), claimed: false, lastInputAt: 0 }));
    slots.forEach((slot, i) => { if (i >= count - botCount) { slot.claimed = true; slot.bot = new BotController(slot.id, i, difficulty); } });
    const teams = Object.fromEntries(slots.map((slot, i) => [slot.id, `team-${Math.floor(i / 2) + 1}`]));
    const game = new Game(slots.map(s => s.id), {}, {}, {}, { mode, teams });
    const session: Session = { id: randomUUID(), game, slots, completed: false, emptySince: now(), members: new Set(), snapshot: game.getSnapshot() };
    sessions.set(session.id, session);
    if (options.autoTick !== false) {
      // Use a monotonic accumulator: Windows timer granularity can make a 33 ms interval run much slower than 30 Hz.
      let previous = performance.now(), accumulated = 0;
      session.timer = setInterval(() => {
        const time = performance.now(); accumulated += Math.min(time - previous, tickMs * 5); previous = time;
        let steps = 0;
        while (accumulated >= tickMs && steps++ < 5 && !session.completed) { tick(session); accumulated -= tickMs; }
        if (steps >= 5) accumulated = Math.min(accumulated, tickMs);
      }, 10);
    }
    return session;
  };
  const tick = (session: Session) => {
    if (session.completed) return;
    for (const slot of session.slots) if (slot.socketId && now() - slot.lastInputAt > staleMs) session.game.setInput(slot.id, idle);
    // Re-read after each action so later bots see bombs placed earlier in this tick.
    const bots = session.slots.filter(slot => slot.bot);
    for (let i = 0; i < bots.length; i++) {
      const slot = bots[i];
      const decision = slot.bot!.update(session.game.getSnapshot(), session.snapshot.tick % bots.length === i);
      slot.botCommand = decision;
      session.game.setInput(slot.id, decision.input);
      if (decision.placeBomb) session.game.placeBomb(slot.id);
    }
    session.game.step();
    const snap = session.snapshot = session.game.getSnapshot();
    if (snap.tick % snapshotEvery === 0 || snap.result) io.to(session.id).emit("snapshot", snap);
    if (snap.result) { session.completed = true; session.completedAt = now(); if (session.timer) clearInterval(session.timer); io.to(session.id).emit("finished", snap.result); }
  };
  const cleanup = () => {
    for (const session of sessions.values()) {
      if ((session.completedAt !== undefined && now() - session.completedAt >= completedMs) || (!session.members.size && now() - session.emptySince >= emptyMs)) {
        if (session.timer) clearInterval(session.timer);
        sessions.delete(session.id);
        io.in(session.id).disconnectSockets(true);
      }
    }
  };
  const cleanupTimer = setInterval(cleanup, cleanupMs);
  cleanupTimer.unref();
  app.post("/dev/sessions", (req, res) => {
    const value: unknown = req.body;
    if (!isRecord(value) || Object.keys(value).some(k => !["mode", "players", "bots", "difficulty"].includes(k)) || (value.mode !== "ffa" && value.mode !== "team") || typeof value.players !== "number" || (value.bots !== undefined && typeof value.bots !== "number") || (value.difficulty !== undefined && !["easy", "normal", "hard"].includes(String(value.difficulty)))) { res.status(400).json({ error: "Invalid session request" }); return; }
    if (sessions.size >= maxSessions) { res.status(503).json({ error: "Session capacity reached" }); return; }
    try { const session = create(value.mode, value.players, value.bots as number | undefined, value.difficulty as BotDifficulty | undefined); res.status(201).json({ sessionId: session.id }); }
    catch { res.status(400).json({ error: "Invalid roster" }); }
  });
  if (options.botDebug === true) app.get("/dev/sessions/:id/bot-debug", (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) { res.sendStatus(404); return; }
    const snapshot = session.game.getSnapshot();
    res.json(session.slots.filter(s => s.bot && s.botCommand).map(s => s.bot!.debug(snapshot, s.botCommand!)));
  });
  io.on("connection", socket => {
    const joinTimer = setTimeout(() => socket.disconnect(true), joinMs); joinTimer.unref();
    let session: Session | undefined, slot: Slot | undefined, lastMove = -1, lastAction = -1, rateStart = now(), messages = 0;
    const limit = () => { const time = now(); if (time - rateStart >= 1000) { rateStart = time; messages = 0; } return ++messages <= 90; };
    const reply = (cb: unknown, result: Reply<unknown>) => { if (typeof cb === "function") cb(result); };
    socket.onAny(event => { if (!["join", "move", "bomb", "item"].includes(event)) socket.disconnect(true); });
    socket.on("join", (request, cb) => {
      if (!limit() || typeof cb !== "function" || session || !isRecord(request) || !exact(request, ["sessionId", "role"]) || typeof request.sessionId !== "string" || request.sessionId.length > 64 || (request.role !== "player" && request.role !== "spectator")) { reply(cb, { ok: false, error: "Invalid join" }); return; }
      const found = sessions.get(request.sessionId);
      if (!found) { reply(cb, { ok: false, error: "Unknown session" }); return; }
      if (found.members.size >= maxMembers) { reply(cb, { ok: false, error: "Session connection limit reached" }); return; }
      const chosen = request.role === "player" ? found.slots.find(s => !s.claimed) : undefined;
      if (request.role === "player" && (!chosen || found.completed)) { reply(cb, { ok: false, error: "No player slot available" }); return; }
      clearTimeout(joinTimer); session = found; slot = chosen; found.members.add(socket.id);
      if (slot) { slot.claimed = true; slot.socketId = socket.id; slot.lastInputAt = now(); }
      socket.join(found.id);
      const snapshot = found.game.getSnapshot();
      reply(cb, { ok: true, value: { playerId: slot?.id ?? null, teamId: snapshot.players.find(p => p.id === slot?.id)?.teamId ?? null, snapshot } });
    });
    const playerReady = () => !!session && !!slot && !session.completed && session.snapshot.players.find(p => p.id === slot!.id)?.status !== "eliminated";
    socket.on("move", (command, cb) => {
      if (!limit() || typeof cb !== "function" || !playerReady() || !isRecord(command) || !exact(command, ["seq", "input"]) || !seqValid(command.seq) || command.seq <= lastMove || !isRecord(command.input) || !exact(command.input, ["up", "down", "left", "right"]) || Object.values(command.input).some(v => typeof v !== "boolean")) { reply(cb, { ok: false, error: "Invalid or unauthorized movement" }); return; }
      lastMove = command.seq; slot!.lastInputAt = now(); session!.game.setInput(slot!.id, command.input as unknown as MovementInput); reply(cb, { ok: true, value: undefined });
    });
    const action = (command: unknown, cb: unknown, kind: "bomb" | "item") => {
      if (!limit() || typeof cb !== "function" || !playerReady() || !isRecord(command) || !exact(command, kind === "bomb" ? ["seq"] : ["seq", "slot"]) || !seqValid(command.seq) || command.seq <= lastAction || (kind === "item" && (!Number.isInteger(command.slot) || (command.slot as number) < 0 || (command.slot as number) > 4))) { reply(cb, { ok: false, error: "Invalid or unauthorized action" }); return; }
      lastAction = command.seq;
      const accepted = kind === "bomb" ? session!.game.placeBomb(slot!.id) : session!.game.useItem(slot!.id, command.slot as number);
      reply(cb, accepted ? { ok: true, value: undefined } : { ok: false, error: "Action unavailable" });
    };
    socket.on("bomb", (command, cb) => action(command, cb, "bomb"));
    socket.on("item", (command, cb) => action(command, cb, "item"));
    socket.on("disconnect", () => { clearTimeout(joinTimer); if (session) { if (slot) { session.game.setInput(slot.id, idle); slot.socketId = undefined; } session.members.delete(socket.id); if (!session.members.size) session.emptySince = now(); } });
  });
  return { http, io, sessions, create, tick, cleanup, close: async () => { clearInterval(cleanupTimer); for (const s of sessions.values()) if (s.timer) clearInterval(s.timer); await new Promise<void>(resolve => io.close(() => resolve())); } };
}
