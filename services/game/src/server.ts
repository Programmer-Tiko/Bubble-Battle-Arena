import express from "express";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Server } from "socket.io";
import { DEFAULT_MOVEMENT_CONFIG, Game } from "@bubble/engine";
import type { ClientEvents, ServerEvents, MovementInput, SessionMode, Reply } from "@bubble/shared";

const idle: MovementInput = { up: false, down: false, left: false, right: false };
const tickMs = DEFAULT_MOVEMENT_CONFIG.timestepSeconds * 1000;
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const exact = (x: Record<string, unknown>, keys: string[]) => Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
const seqValid = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const localOrigin = (origin: string | undefined) => !origin || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
const loopback = (address: string | undefined) => address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
const localHost = (host: string | undefined) => !!host && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);

export interface ServerOptions { snapshotEveryTicks?: number; staleInputMs?: number; autoTick?: boolean; now?: () => number; environment?: string }
interface Slot { id: string; claimed: boolean; socketId?: string; lastInputAt: number }
export interface Session { id: string; game: Game; slots: Slot[]; timer?: ReturnType<typeof setInterval>; completed: boolean }

/** Development launcher only. Replace the join boundary with verified identity/room authorization for production. */
export function createGameServer(options: ServerOptions = {}) {
  if (process.env.NODE_ENV === "production" || options.environment === "production") throw new Error("Development game server is disabled in production");
  const snapshotEvery = options.snapshotEveryTicks ?? 3, staleMs = options.staleInputMs ?? 500;
  if (!Number.isInteger(snapshotEvery) || snapshotEvery < 1 || !Number.isFinite(staleMs) || staleMs <= 0) throw new RangeError("Invalid server options");
  const now = options.now ?? Date.now;
  const app = express();
  app.use((req, res, next) => { if (!loopback(req.socket.remoteAddress) || !localHost(req.headers.host) || !localOrigin(req.headers.origin)) { res.sendStatus(403); return; } next(); });
  app.use((req, res, next) => {
    if (req.headers.origin) { res.setHeader("Access-Control-Allow-Origin", req.headers.origin); res.setHeader("Vary", "Origin"); }
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    if (req.method === "OPTIONS") { res.sendStatus(204); return; } next();
  });
  app.use(express.json({ limit: "1kb", strict: true }));
  const http = createServer(app);
  const io = new Server<ClientEvents, ServerEvents>(http, { transports: ["websocket"], maxHttpBufferSize: 1024, cors: { origin: (origin, cb) => cb(null, localOrigin(origin)) }, allowRequest: (req, cb) => cb(null, loopback(req.socket.remoteAddress) && localHost(req.headers.host) && localOrigin(req.headers.origin)) });
  const sessions = new Map<string, Session>();
  const create = (mode: SessionMode, count: number): Session => {
    if ((mode !== "ffa" && mode !== "team") || !Number.isInteger(count) || count < 4 || count > 8 || (mode === "team" && count % 2)) throw new RangeError("Invalid roster");
    const slots: Slot[] = Array.from({ length: count }, () => ({ id: randomUUID(), claimed: false, lastInputAt: 0 }));
    const teams = Object.fromEntries(slots.map((slot, i) => [slot.id, `team-${Math.floor(i / 2) + 1}`]));
    const game = new Game(slots.map(s => s.id), {}, {}, {}, { mode, teams });
    const session: Session = { id: randomUUID(), game, slots, completed: false };
    sessions.set(session.id, session);
    if (options.autoTick !== false) session.timer = setInterval(() => tick(session), tickMs);
    return session;
  };
  const tick = (session: Session) => {
    if (session.completed) return;
    for (const slot of session.slots) if (slot.socketId && now() - slot.lastInputAt > staleMs) session.game.setInput(slot.id, idle);
    session.game.step();
    const snap = session.game.getSnapshot();
    if (snap.tick % snapshotEvery === 0 || snap.result) io.to(session.id).emit("snapshot", snap);
    if (snap.result) { session.completed = true; if (session.timer) clearInterval(session.timer); io.to(session.id).emit("finished", snap.result); }
  };
  app.post("/dev/sessions", (req, res) => {
    const value: unknown = req.body;
    if (!isRecord(value) || !exact(value, ["mode", "players"]) || (value.mode !== "ffa" && value.mode !== "team") || typeof value.players !== "number") { res.status(400).json({ error: "Invalid session request" }); return; }
    try { const session = create(value.mode, value.players); res.status(201).json({ sessionId: session.id }); }
    catch { res.status(400).json({ error: "Invalid roster" }); }
  });
  io.on("connection", socket => {
    let session: Session | undefined, slot: Slot | undefined, lastMove = -1, lastAction = -1, rateStart = now(), messages = 0;
    const limit = () => { const time = now(); if (time - rateStart >= 1000) { rateStart = time; messages = 0; } return ++messages <= 90; };
    const reply = (cb: unknown, result: Reply<unknown>) => { if (typeof cb === "function") cb(result); };
    socket.on("join", (request, cb) => {
      if (!limit() || session || !isRecord(request) || !exact(request, ["sessionId", "role"]) || typeof request.sessionId !== "string" || request.sessionId.length > 64 || (request.role !== "player" && request.role !== "spectator")) { reply(cb, { ok: false, error: "Invalid join" }); return; }
      const found = sessions.get(request.sessionId);
      if (!found) { reply(cb, { ok: false, error: "Unknown session" }); return; }
      const chosen = request.role === "player" ? found.slots.find(s => !s.claimed) : undefined;
      if (request.role === "player" && (!chosen || found.completed)) { reply(cb, { ok: false, error: "No player slot available" }); return; }
      session = found; slot = chosen;
      if (slot) { slot.claimed = true; slot.socketId = socket.id; slot.lastInputAt = now(); }
      socket.join(found.id);
      const snapshot = found.game.getSnapshot();
      reply(cb, { ok: true, value: { playerId: slot?.id ?? null, teamId: snapshot.players.find(p => p.id === slot?.id)?.teamId ?? null, snapshot } });
    });
    const playerReady = () => !!session && !!slot && !session.completed && session.game.getSnapshot().players.find(p => p.id === slot!.id)?.status !== "eliminated";
    socket.on("move", (command, cb) => {
      if (!limit() || !playerReady() || !isRecord(command) || !exact(command, ["seq", "input"]) || !seqValid(command.seq) || command.seq <= lastMove || !isRecord(command.input) || !exact(command.input, ["up", "down", "left", "right"]) || Object.values(command.input).some(v => typeof v !== "boolean")) { reply(cb, { ok: false, error: "Invalid or unauthorized movement" }); return; }
      lastMove = command.seq; slot!.lastInputAt = now(); session!.game.setInput(slot!.id, command.input as unknown as MovementInput); reply(cb, { ok: true, value: undefined });
    });
    const action = (command: unknown, cb: unknown, kind: "bomb" | "item") => {
      if (!limit() || !playerReady() || !isRecord(command) || !exact(command, kind === "bomb" ? ["seq"] : ["seq", "slot"]) || !seqValid(command.seq) || command.seq <= lastAction || (kind === "item" && (!Number.isInteger(command.slot) || (command.slot as number) < 0 || (command.slot as number) > 4))) { reply(cb, { ok: false, error: "Invalid or unauthorized action" }); return; }
      lastAction = command.seq;
      const accepted = kind === "bomb" ? session!.game.placeBomb(slot!.id) : session!.game.useItem(slot!.id, command.slot as number);
      reply(cb, accepted ? { ok: true, value: undefined } : { ok: false, error: "Action unavailable" });
    };
    socket.on("bomb", (command, cb) => action(command, cb, "bomb"));
    socket.on("item", (command, cb) => action(command, cb, "item"));
    socket.on("disconnect", () => { if (session && slot) { session.game.setInput(slot.id, idle); slot.socketId = undefined; } });
  });
  return { http, io, sessions, create, tick, close: async () => { for (const s of sessions.values()) if (s.timer) clearInterval(s.timer); await new Promise<void>(resolve => io.close(() => resolve())); } };
}
