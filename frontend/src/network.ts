import { io, type Socket } from "socket.io-client";
import type { ClientEvents, ServerEvents, GameSnapshot, MovementInput, JoinInfo, Reply } from "@bubble/shared";
import type { GameAdapter } from "./adapter";

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);
/** Reject malformed server messages before exposing them to the renderer. */
export function isSnapshot(value: unknown): value is GameSnapshot {
  if (!record(value) || !finite(value.tick) || !finite(value.elapsedSeconds) || !record(value.map) || !finite(value.map.width) || !finite(value.map.height) || !finite(value.map.tileSize) || !Array.isArray(value.map.tiles) || !Array.isArray(value.players) || !Array.isArray(value.bombs) || !Array.isArray(value.explosions) || !Array.isArray(value.items)) return false;
  if (!value.map.tiles.every(row => Array.isArray(row) && row.every(tile => record(tile) && finite(tile.x) && finite(tile.y) && ["floor", "destructible", "indestructible"].includes(String(tile.type))))) return false;
  if (!value.players.every(p => record(p) && typeof p.id === "string" && typeof p.teamId === "string" && finite(p.x) && finite(p.y) && ["alive", "trapped", "eliminated"].includes(String(p.status)) && finite(p.trappedSeconds) && Array.isArray(p.inventory) && p.inventory.every((s: unknown) => s === null || (record(s) && ["banana", "slowdown"].includes(String(s.type)) && finite(s.charges))))) return false;
  if (!value.bombs.every(b => record(b) && finite(b.x) && finite(b.y)) || !value.explosions.every(e => record(e) && finite(e.x) && finite(e.y))) return false;
  if (!value.items.every(i => record(i) && finite(i.x) && finite(i.y) && ["boots", "capacity", "range", "banana", "slowdown"].includes(String(i.type)) && ["pickup", "hazard", "trap"].includes(String(i.kind)) && typeof i.active === "boolean" && (i.supplyDroppedAt === undefined || finite(i.supplyDroppedAt)))) return false;
  if (value.balloon !== null && (!record(value.balloon) || !finite(value.balloon.startedAt) || !finite(value.balloon.durationSeconds) || (value.balloon.durationSeconds as number) <= 0)) return false;
  return value.result === null || (record(value.result) && (value.result.kind === "draw" || (value.result.kind === "winner" && typeof value.result.teamId === "string")));
}

/** Network mode holds only snapshots received from the authoritative server. */
export class NetworkGameAdapter implements GameAdapter {
  readonly playerId: string;
  readonly teamId: string | null;
  status = "connected";
  private moveSeq = 0;
  private actionSeq = 0;
  private pendingMs = 100;
  private input: MovementInput = { up: false, down: false, left: false, right: false };
  private current: GameSnapshot;
  private constructor(private socket: Socket<ServerEvents, ClientEvents>, info: JoinInfo) {
    this.playerId = info.playerId ?? ""; this.teamId = info.teamId; this.current = info.snapshot;
    socket.on("snapshot", snapshot => { if (isSnapshot(snapshot)) this.current = snapshot; else { socket.disconnect(); this.status = "invalid server snapshot"; } });
    socket.on("finished", result => { if (!result || (result.kind !== "draw" && (result.kind !== "winner" || typeof result.teamId !== "string"))) { socket.disconnect(); this.status = "invalid server result"; } });
    socket.on("disconnect", reason => { this.status = `disconnected: ${reason}`; });
    socket.on("connect_error", error => { this.status = `connection error: ${error.message}`; });
  }
  static connect(url: string, sessionId: string, role: "player" | "spectator"): Promise<NetworkGameAdapter> {
    return new Promise((resolve, reject) => {
      const socket: Socket<ServerEvents, ClientEvents> = io(url, { transports: ["websocket"], reconnection: false, timeout: 5000 });
      socket.once("connect_error", error => { socket.disconnect(); reject(error); });
      socket.once("connect", () => socket.timeout(5000).emit("join", { sessionId, role }, (error: Error | null, result: Reply<JoinInfo>) => {
        if (error || !result?.ok) { socket.disconnect(); reject(error ?? new Error(result && !result.ok ? result.error : "Join failed")); return; }
        if (!record(result.value) || !(result.value.playerId === null || typeof result.value.playerId === "string") || !(result.value.teamId === null || typeof result.value.teamId === "string") || !isSnapshot(result.value.snapshot)) { socket.disconnect(); reject(new Error("Invalid join response")); return; }
        resolve(new NetworkGameAdapter(socket, result.value as unknown as JoinInfo));
      }));
    });
  }
  setInput(input: MovementInput): void { this.input = { ...input }; }
  placeBomb(): void { if (this.playerId && this.socket.connected) this.socket.emit("bomb", { seq: this.actionSeq++ }, () => {}); }
  useItem(slot: number): void { if (this.playerId && this.socket.connected) this.socket.emit("item", { seq: this.actionSeq++, slot }, () => {}); }
  advance(deltaMs: number): void {
    this.pendingMs += Math.max(0, deltaMs);
    if (this.pendingMs >= 100 && this.playerId && this.socket.connected) {
      this.pendingMs = 0; this.socket.emit("move", { seq: this.moveSeq++, input: this.input }, () => {});
    }
  }
  snapshot(): GameSnapshot { return this.current; }
  close(): void { this.socket.disconnect(); }
}
