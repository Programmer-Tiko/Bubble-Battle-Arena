import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type {
  BotDifficulty, CreateRoomRequest, JoinRoomRequest, MatchResult, RoomRole, RoomSettings,
  RoomState, RoomStatus, RoomSummary, SessionMode, TeamColor,
} from "@bubble/shared";

/** Who is making a request. Always comes from the JWT verified in the WebSocket handshake, never from a message. */
export interface PlayerIdentity { subject: string; username: string }

/** One human in the trusted roster handed to the game when a match starts. */
export interface RosterEntry { subject: string; username: string; teamId: TeamColor | null }
/** One bot seat. In Team Battle the Room Manager decides each bot's team. */
export interface BotSeat { teamId: TeamColor | null; difficulty: BotDifficulty }
export interface MatchStartRequest { roomId: string; matchId: string; mode: SessionMode; players: RosterEntry[]; bots: BotSeat[] }

export interface RoomManagerOptions {
  /** Send room:state to everyone in this room. */
  onRoomChanged: (room: RoomState) => void;
  /** Send lobby:rooms to everyone in the lobby. */
  onLobbyChanged: (rooms: RoomSummary[]) => void;
  /** Start the game. Called exactly once per matchId. */
  onStartMatch: (request: MatchStartRequest) => void;
  /** Called when a room is deleted (its last member left). */
  onRoomDeleted?: (roomId: string) => void;
  countdownMs?: number;
  resultsMs?: number;
  now?: () => number;
}

/** An error whose message is safe to show to the player. */
export class RoomError extends Error {}

export const TEAM_COLORS: readonly TeamColor[] = ["red", "blue", "green", "yellow"];
const DIFFICULTIES: readonly BotDifficulty[] = ["easy", "normal", "hard"];
const MAX_ROOMS = 50;
const MAX_SPECTATORS = 16;

interface Member {
  subject: string;
  username: string;
  role: RoomRole;
  teamId: TeamColor | null;
  ready: boolean;
  joinedAt: number;
  connected: boolean;
}

interface Room {
  id: string;
  settings: RoomSettings;
  password: { salt: Buffer; hash: Buffer } | null;
  status: RoomStatus;
  members: Member[];            // in join order, so the earliest member is first
  hostSubject: string;
  countdownEndsAt: number | null;
  countdownTimer?: ReturnType<typeof setTimeout>;
  resultsTimer?: ReturnType<typeof setTimeout>;
  matchId: string | null;
  lastResult: MatchResult | null;
}

/**
 * All lobby rules: creating/joining rooms, passwords, teams, ready, the start countdown,
 * host transfer, bot seats, and the results phase. It has no networking; the Socket.IO
 * layer calls these methods with the verified identity and broadcasts what the callbacks give it.
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly countdownMs: number;
  private readonly resultsMs: number;
  private readonly now: () => number;

  constructor(private readonly options: RoomManagerOptions) {
    this.countdownMs = options.countdownMs ?? 10_000;
    this.resultsMs = options.resultsMs ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  // ---------- Reading ----------

  summaries(): RoomSummary[] {
    return [...this.rooms.values()].map(room => ({
      id: room.id,
      title: room.settings.title,
      mode: room.settings.mode,
      visibility: room.settings.visibility,
      status: room.status,
      players: this.players(room).length + room.settings.bots,
      maxPlayers: room.settings.maxPlayers,
      spectators: room.members.filter(m => m.role === "spectator").length,
    }));
  }

  /** The room this account is in, if any. */
  roomOf(subject: string): RoomState | null {
    const room = this.findRoomOf(subject);
    return room ? this.state(room) : null;
  }

  /** This account's role in a room (null if not a member). Used to authorize watching or playing its match. */
  memberRole(roomId: string, subject: string): RoomRole | null {
    return this.rooms.get(roomId)?.members.find(m => m.subject === subject)?.role ?? null;
  }

  // ---------- Actions (identity is always the verified one) ----------

  create(identity: PlayerIdentity, request: CreateRoomRequest): RoomState {
    const { settings, password } = validateSettings(request);
    if (this.rooms.size >= MAX_ROOMS) throw new RoomError("Too many rooms right now, try again later");
    this.leaveCurrentRoom(identity.subject);

    const room: Room = {
      id: randomUUID(),
      settings,
      password: password === null ? null : hashPassword(password),
      status: "waiting",
      members: [],
      hostSubject: identity.subject,
      countdownEndsAt: null,
      matchId: null,
      lastResult: null,
    };
    this.rooms.set(room.id, room);
    this.addMember(room, identity, "player");
    this.changed(room);
    return this.state(room);
  }

  join(identity: PlayerIdentity, request: JoinRoomRequest): RoomState {
    const room = this.rooms.get(request.roomId);
    if (!room) throw new RoomError("That room no longer exists");

    // Already a member (e.g. coming back from the game page): just mark them connected again
    const existing = room.members.find(m => m.subject === identity.subject);
    if (existing) {
      existing.connected = true;
      if (request.role !== existing.role) this.changeRole(room, existing, request.role);
      this.changed(room);
      return this.state(room);
    }

    if (room.password && !checkPassword(request.password, room.password)) throw new RoomError("Wrong room password");
    if (request.role === "player" && room.status !== "waiting" && room.status !== "countdown") {
      throw new RoomError("A match is in progress. Join as a spectator.");
    }
    if (request.role === "player" && this.players(room).length >= this.humanSeats(room)) throw new RoomError("This room is full. Join as a spectator.");
    if (request.role === "spectator" && room.members.filter(m => m.role === "spectator").length >= MAX_SPECTATORS) {
      throw new RoomError("Too many spectators in this room");
    }

    this.leaveCurrentRoom(identity.subject);
    this.addMember(room, identity, request.role);
    this.changed(room);
    return this.state(room);
  }

  leave(subject: string): void {
    this.leaveCurrentRoom(subject);
  }

  setTeam(subject: string, teamId: TeamColor): void {
    const { room, member } = this.requireMember(subject);
    if (room.settings.mode !== "team") throw new RoomError("Teams are only used in Team Battle");
    if (member.role !== "player") throw new RoomError("Spectators don't have a team");
    if (room.status !== "waiting" && room.status !== "countdown") throw new RoomError("Teams are locked during a match");
    if (!this.teamColors(room).includes(teamId)) throw new RoomError("That team isn't available in this room");
    if (member.teamId === teamId) return;
    if (this.players(room).filter(p => p.teamId === teamId).length >= 2) throw new RoomError("That team is full");
    member.teamId = teamId;
    this.changed(room);
  }

  setReady(subject: string, ready: boolean): void {
    const { room, member } = this.requireMember(subject);
    if (member.role !== "player") throw new RoomError("Spectators don't ready up");
    if (room.status !== "waiting" && room.status !== "countdown") throw new RoomError("The match already started");
    member.ready = ready;
    this.changed(room);
  }

  /** Host's Start button: skips the rest of the countdown, but only when the room is eligible. */
  start(subject: string): void {
    const { room } = this.requireMember(subject);
    if (room.hostSubject !== subject) throw new RoomError("Only the host can start the match");
    if (room.status !== "waiting" && room.status !== "countdown") throw new RoomError("The match already started");
    if (!this.eligible(room)) throw new RoomError("Not ready yet: the room must be full and every player ready");
    this.beginMatch(room);
  }

  /** A player's last lobby connection closed. Before a match they leave; during one they stay in the room. */
  disconnected(subject: string): void {
    const room = this.findRoomOf(subject);
    if (!room) return;
    if (room.status === "waiting" || room.status === "countdown") {
      this.leaveCurrentRoom(subject);
      return;
    }
    const member = room.members.find(m => m.subject === subject)!;
    member.connected = false;
    this.changed(room);
  }

  /**
   * Called by the game when a match ends. Idempotent: only the first call for the room's
   * current matchId counts; duplicates and old/unknown matchIds are ignored (returns false).
   */
  finishMatch(roomId: string, matchId: string, result: MatchResult): boolean {
    const room = this.rooms.get(roomId);
    if (!room || room.status !== "in_game" || room.matchId !== matchId) return false;
    room.status = "results";
    room.lastResult = result;
    this.changed(room);
    // Keep the result on screen, then reopen the room for the next match
    room.resultsTimer = setTimeout(() => this.reopen(room), this.resultsMs);
    return true;
  }

  /** Stops all timers (server shutdown and tests). */
  dispose(): void {
    for (const room of this.rooms.values()) this.clearTimers(room);
    this.rooms.clear();
  }

  // ---------- Internal rules ----------

  private beginMatch(room: Room): void {
    // Guard against the countdown timer and the host's Start button firing at the same time
    if (room.status !== "waiting" && room.status !== "countdown") return;
    if (!this.eligible(room)) {
      this.changed(room);
      return;
    }
    this.clearTimers(room);
    room.status = "in_game";
    room.countdownEndsAt = null;
    room.matchId = randomUUID();
    room.lastResult = null;

    const players = this.players(room).map(p => ({ subject: p.subject, username: p.username, teamId: p.teamId }));
    this.options.onStartMatch({
      roomId: room.id,
      matchId: room.matchId,
      mode: room.settings.mode,
      players,
      bots: this.botSeats(room, players),
    });
    this.changed(room);
  }

  /** After the results phase: back to waiting, everyone un-readies, members who never came back are removed. */
  private reopen(room: Room): void {
    if (room.status !== "results") return;
    room.resultsTimer = undefined;
    room.status = "waiting";
    room.matchId = null;
    for (const member of room.members) member.ready = false;
    for (const member of room.members.filter(m => !m.connected)) this.removeMember(room, member.subject);
    if (this.rooms.has(room.id)) this.changed(room);
  }

  /** Full room (humans + bots = max players) and every non-host player is ready. */
  private eligible(room: Room): boolean {
    const players = this.players(room);
    if (players.length === 0 || players.length !== this.humanSeats(room)) return false;
    if (room.settings.mode === "team" && players.some(p => p.teamId === null)) return false;
    return players.every(p => p.subject === room.hostSubject || p.ready);
  }

  /** Bots fill the remaining seats. In Team Battle they fill each team to exactly 2, in color order. */
  private botSeats(room: Room, players: RosterEntry[]): BotSeat[] {
    const difficulty = room.settings.botDifficulty;
    if (room.settings.mode === "ffa") return Array.from({ length: room.settings.bots }, () => ({ teamId: null, difficulty }));
    const seats: BotSeat[] = [];
    for (const color of this.teamColors(room)) {
      const humans = players.filter(p => p.teamId === color).length;
      for (let i = humans; i < 2; i++) seats.push({ teamId: color, difficulty });
    }
    return seats;
  }

  /** Runs after every change: starts or cancels the countdown, then broadcasts. */
  private changed(room: Room): void {
    if (room.status === "waiting" && this.eligible(room)) {
      room.status = "countdown";
      room.countdownEndsAt = this.now() + this.countdownMs;
      room.countdownTimer = setTimeout(() => this.beginMatch(room), this.countdownMs);
    } else if (room.status === "countdown" && !this.eligible(room)) {
      this.clearTimers(room);
      room.status = "waiting";
      room.countdownEndsAt = null;
    }
    this.options.onRoomChanged(this.state(room));
    this.options.onLobbyChanged(this.summaries());
  }

  private addMember(room: Room, identity: PlayerIdentity, role: RoomRole): void {
    room.members.push({
      subject: identity.subject,
      username: identity.username,
      role,
      teamId: role === "player" ? this.openTeam(room) : null,
      ready: false,
      joinedAt: this.now(),
      connected: true,
    });
  }

  private changeRole(room: Room, member: Member, role: RoomRole): void {
    if (role === "player") {
      if (room.status !== "waiting" && room.status !== "countdown") throw new RoomError("A match is in progress");
      if (this.players(room).length >= this.humanSeats(room)) throw new RoomError("This room is full");
      member.teamId = this.openTeam(room);
    } else {
      member.teamId = null;
    }
    member.role = role;
    member.ready = false;
  }

  private leaveCurrentRoom(subject: string): void {
    const room = this.findRoomOf(subject);
    if (!room) return;
    this.removeMember(room, subject);
    if (this.rooms.has(room.id)) this.changed(room);
  }

  private removeMember(room: Room, subject: string): void {
    room.members = room.members.filter(m => m.subject !== subject);
    if (room.members.length === 0) {
      // An empty room is deleted, unless its match is still running (bots keep playing until the result)
      if (room.status === "in_game") return;
      this.clearTimers(room);
      this.rooms.delete(room.id);
      this.options.onRoomDeleted?.(room.id);
      this.options.onLobbyChanged(this.summaries());
      return;
    }
    if (room.hostSubject === subject) {
      // New host: the earliest-joined remaining player, or the earliest member if only spectators remain
      const next = room.members.find(m => m.role === "player") ?? room.members[0];
      room.hostSubject = next.subject;
    }
  }

  private findRoomOf(subject: string): Room | undefined {
    for (const room of this.rooms.values()) if (room.members.some(m => m.subject === subject)) return room;
    return undefined;
  }

  private requireMember(subject: string): { room: Room; member: Member } {
    const room = this.findRoomOf(subject);
    const member = room?.members.find(m => m.subject === subject);
    if (!room || !member) throw new RoomError("You are not in a room");
    return { room, member };
  }

  private players(room: Room): Member[] {
    return room.members.filter(m => m.role === "player");
  }

  private humanSeats(room: Room): number {
    return room.settings.maxPlayers - room.settings.bots;
  }

  private teamColors(room: Room): readonly TeamColor[] {
    return TEAM_COLORS.slice(0, room.settings.maxPlayers / 2);
  }

  /** First team with fewer than 2 human players (null in FFA). */
  private openTeam(room: Room): TeamColor | null {
    if (room.settings.mode !== "team") return null;
    const players = this.players(room);
    return this.teamColors(room).find(color => players.filter(p => p.teamId === color).length < 2) ?? null;
  }

  private clearTimers(room: Room): void {
    if (room.countdownTimer) clearTimeout(room.countdownTimer);
    if (room.resultsTimer) clearTimeout(room.resultsTimer);
    room.countdownTimer = undefined;
    room.resultsTimer = undefined;
  }

  private state(room: Room): RoomState {
    return {
      id: room.id,
      settings: { ...room.settings },
      status: room.status,
      members: room.members.map(m => ({
        username: m.username,
        role: m.role,
        teamId: m.teamId,
        ready: m.ready,
        isHost: m.subject === room.hostSubject,
        connected: m.connected,
      })),
      countdownEndsAt: room.countdownEndsAt,
      matchId: room.matchId,
      lastResult: room.lastResult,
    };
  }
}

/** Checks every field of a create request. The password is never stored in plain text or sent back. */
function validateSettings(request: CreateRoomRequest): { settings: RoomSettings; password: string | null } {
  const title = typeof request.title === "string" ? request.title.trim() : "";
  if (title.length < 1 || title.length > 40) throw new RoomError("Room title must be 1-40 characters");
  if (request.mode !== "ffa" && request.mode !== "team") throw new RoomError("Invalid game mode");
  const max = request.maxPlayers;
  const validMax = request.mode === "ffa" ? Number.isInteger(max) && max >= 4 && max <= 8 : [4, 6, 8].includes(max);
  if (!validMax) throw new RoomError(request.mode === "ffa" ? "Free-for-All rooms have 4-8 players" : "Team Battle rooms have 4, 6, or 8 players");
  if (request.visibility !== "public" && request.visibility !== "private") throw new RoomError("Invalid visibility");
  if (!Number.isInteger(request.bots) || request.bots < 0 || request.bots >= max) throw new RoomError("Bots must leave at least one seat for a person");
  if (!DIFFICULTIES.includes(request.botDifficulty)) throw new RoomError("Invalid bot difficulty");

  let password: string | null = null;
  if (request.visibility === "private") {
    if (typeof request.password !== "string" || request.password.length < 4 || request.password.length > 64) {
      throw new RoomError("Private rooms need a password of 4-64 characters");
    }
    password = request.password;
  }
  return {
    settings: { title, mode: request.mode, maxPlayers: max, visibility: request.visibility, bots: request.bots, botDifficulty: request.botDifficulty },
    password,
  };
}

function hashPassword(password: string): { salt: Buffer; hash: Buffer } {
  const salt = randomBytes(16);
  return { salt, hash: scryptSync(password, salt, 32) };
}

function checkPassword(attempt: string | undefined, stored: { salt: Buffer; hash: Buffer }): boolean {
  if (typeof attempt !== "string" || attempt.length > 64) return false;
  return timingSafeEqual(scryptSync(attempt, stored.salt, 32), stored.hash);
}