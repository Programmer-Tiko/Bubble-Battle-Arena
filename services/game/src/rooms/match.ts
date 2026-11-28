import { randomUUID } from "node:crypto";
import { BotController } from "@bubble/bot";
import { DEFAULT_MOVEMENT_CONFIG, Game } from "@bubble/engine";
import type { GameSnapshot, MatchResult, MovementInput } from "@bubble/shared";
import type { MatchStartRequest } from "./room-manager.js";

const IDLE: MovementInput = { up: false, down: false, left: false, right: false };
const TICK_MS = DEFAULT_MOVEMENT_CONFIG.timestepSeconds * 1000;

export interface MatchCallbacks {
  /** Broadcast a snapshot to everyone watching this match. */
  onSnapshot: (snapshot: GameSnapshot) => void;
  /** The match ended. Called exactly once. */
  onFinished: (result: MatchResult) => void;
}

export interface MatchOptions {
  snapshotEveryTicks?: number;
  /** A player who sends no movement for this long stops moving (e.g. a closed tab). */
  staleInputMs?: number;
  /** false in tests, which call tick() themselves. */
  autoTick?: boolean;
  timeLimitSeconds?: number;
  now?: () => number;
}

interface Seat { playerId: string; teamId: string; lastInputAt: number }

/**
 * Runs one match for a trusted roster from the Room Manager: maps each account (subject) to an
 * engine player ID, adds the bots, and drives the authoritative engine at a fixed tick rate.
 * Browsers only ever send inputs; the server decides everything that happens.
 */
export class Match {
  readonly id: string;
  readonly roomId: string;
  private readonly game: Game;
  private readonly seats = new Map<string, Seat>(); // by account subject
  private readonly bots: { playerId: string; controller: BotController }[] = [];
  private readonly snapshotEvery: number;
  private readonly staleMs: number;
  private readonly now: () => number;
  private timer?: ReturnType<typeof setInterval>;
  private current: GameSnapshot;
  private finished = false;

  constructor(request: MatchStartRequest, private readonly callbacks: MatchCallbacks, options: MatchOptions = {}) {
    this.id = request.matchId;
    this.roomId = request.roomId;
    this.snapshotEvery = options.snapshotEveryTicks ?? 3;
    this.staleMs = options.staleInputMs ?? 500;
    this.now = options.now ?? Date.now;

    const ids: string[] = [];
    const teams: Record<string, string> = {};
    for (const player of request.players) {
      if (this.seats.has(player.subject)) throw new RangeError("Duplicate player in roster");
      const playerId = randomUUID(); // opaque engine ID, never the account ID
      ids.push(playerId);
      teams[playerId] = player.teamId ?? playerId;
      this.seats.set(player.subject, { playerId, teamId: teams[playerId], lastInputAt: 0 });
    }
    request.bots.forEach((bot, index) => {
      const playerId = randomUUID();
      ids.push(playerId);
      teams[playerId] = bot.teamId ?? playerId;
      this.bots.push({ playerId, controller: new BotController(playerId, request.players.length + index, bot.difficulty) });
    });

    // The engine validates the roster again (distinct IDs, exactly two per team in Team Battle)
    this.game = new Game(ids, {}, {}, {}, {
      mode: request.mode,
      ...(request.mode === "team" ? { teams } : {}),
      ...(options.timeLimitSeconds !== undefined ? { timeLimitSeconds: options.timeLimitSeconds } : {}),
    });
    this.current = this.game.getSnapshot();
    if (options.autoTick !== false) this.startLoop();
  }

  /** The engine player ID and team of an account, or null for spectators. */
  seatOf(subject: string): { playerId: string; teamId: string } | null {
    const seat = this.seats.get(subject);
    return seat ? { playerId: seat.playerId, teamId: seat.teamId } : null;
  }

  snapshot(): GameSnapshot {
    return this.current;
  }

  get isFinished(): boolean {
    return this.finished;
  }

  setInput(subject: string, input: MovementInput): boolean {
    const seat = this.activeSeat(subject);
    if (!seat) return false;
    seat.lastInputAt = this.now();
    this.game.setInput(seat.playerId, input);
    return true;
  }

  placeBomb(subject: string): boolean {
    const seat = this.activeSeat(subject);
    return seat ? this.game.placeBomb(seat.playerId) : false;
  }

  useItem(subject: string, slot: number): boolean {
    const seat = this.activeSeat(subject);
    return seat ? this.game.useItem(seat.playerId, slot) : false;
  }

  /** Stop the character when its connection closes or is replaced (no stuck movement). */
  clearInput(subject: string): void {
    const seat = this.seats.get(subject);
    if (seat && !this.finished) this.game.setInput(seat.playerId, IDLE);
  }

  /** Advance one fixed step. Public so tests can drive the match without timers. */
  tick(): void {
    if (this.finished) return;
    for (const seat of this.seats.values()) {
      if (this.now() - seat.lastInputAt > this.staleMs) this.game.setInput(seat.playerId, IDLE);
    }
    // Re-read the state for each bot so later bots see bombs placed earlier in this tick
    this.bots.forEach((bot, index) => {
      const decision = bot.controller.update(this.game.getSnapshot(), this.current.tick % this.bots.length === index);
      this.game.setInput(bot.playerId, decision.input);
      if (decision.placeBomb) this.game.placeBomb(bot.playerId);
    });
    this.game.step();
    const snapshot = this.current = this.game.getSnapshot();
    if (snapshot.tick % this.snapshotEvery === 0 || snapshot.result) this.callbacks.onSnapshot(snapshot);
    if (snapshot.result) {
      this.finished = true;
      this.stop();
      this.callbacks.onFinished(snapshot.result);
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private activeSeat(subject: string): Seat | null {
    const seat = this.seats.get(subject);
    if (!seat || this.finished) return null;
    const player = this.current.players.find(p => p.id === seat.playerId);
    return player && player.status !== "eliminated" ? seat : null;
  }

  /** Fixed-step loop with an accumulator, like the development server (timers on Windows are coarse). */
  private startLoop(): void {
    let previous = performance.now();
    let accumulated = 0;
    this.timer = setInterval(() => {
      const time = performance.now();
      accumulated += Math.min(time - previous, TICK_MS * 5);
      previous = time;
      let steps = 0;
      while (accumulated >= TICK_MS && steps++ < 5 && !this.finished) {
        this.tick();
        accumulated -= TICK_MS;
      }
      if (steps >= 5) accumulated = Math.min(accumulated, TICK_MS);
    }, 10);
  }
}