import type { CreateRoomRequest, RoomState } from "@bubble/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Match } from "../src/rooms/match.js";
import { RoomError, RoomManager, type MatchStartRequest, type PlayerIdentity } from "../src/rooms/room-manager.js";

const alice: PlayerIdentity = { subject: "1", username: "alice" };
const bob: PlayerIdentity = { subject: "2", username: "bob" };
const carol: PlayerIdentity = { subject: "3", username: "carol" };
const dave: PlayerIdentity = { subject: "4", username: "dave" };

const ffa = (overrides: Partial<CreateRoomRequest> = {}): CreateRoomRequest => ({
  title: "Room", mode: "ffa", maxPlayers: 4, visibility: "public", bots: 0, botDifficulty: "normal", ...overrides,
});

let starts: MatchStartRequest[];
let states: RoomState[];
let manager: RoomManager;

beforeEach(() => {
  vi.useFakeTimers();
  starts = [];
  states = [];
  manager = new RoomManager({
    onRoomChanged: room => states.push(room),
    onLobbyChanged: () => {},
    onStartMatch: request => starts.push(request),
  });
});
afterEach(() => {
  manager.dispose();
  vi.useRealTimers();
});

describe("room settings", () => {
  it("rejects invalid settings", () => {
    for (const bad of [
      ffa({ title: "   " }), ffa({ title: "x".repeat(41) }), ffa({ maxPlayers: 3 }), ffa({ maxPlayers: 9 }),
      ffa({ mode: "team", maxPlayers: 5 }), ffa({ bots: 4 }), ffa({ bots: -1 }),
      ffa({ visibility: "private" }), ffa({ visibility: "private", password: "abc" }),
      ffa({ botDifficulty: "impossible" as never }), ffa({ mode: "battle" as never }),
    ]) {
      expect(() => manager.create(alice, bad)).toThrow(RoomError);
    }
  });

  it("never sends the room password back", () => {
    const room = manager.create(alice, ffa({ visibility: "private", password: "secret123" }));
    expect(JSON.stringify(room)).not.toContain("secret123");
    expect(JSON.stringify(manager.summaries())).not.toContain("secret123");
  });

  it("checks private room passwords", () => {
    const room = manager.create(alice, ffa({ visibility: "private", password: "secret123" }));
    expect(() => manager.join(bob, { roomId: room.id, role: "player" })).toThrow("Wrong room password");
    expect(() => manager.join(bob, { roomId: room.id, role: "player", password: "nope1234" })).toThrow("Wrong room password");
    expect(manager.join(bob, { roomId: room.id, role: "player", password: "secret123" }).members).toHaveLength(2);
  });
});

describe("joining, ready, countdown, and starting", () => {
  it("starts after a 10 second countdown once the room is full and everyone else is ready", () => {
    const room = manager.create(alice, ffa({ bots: 2 })); // 2 human seats
    manager.join(bob, { roomId: room.id, role: "player" });
    expect(manager.roomOf("1")!.status).toBe("waiting"); // bob isn't ready
    manager.setReady("2", true);
    expect(manager.roomOf("1")!.status).toBe("countdown");
    vi.advanceTimersByTime(9_999);
    expect(starts).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(starts).toHaveLength(1);
    expect(starts[0].players.map(p => p.username)).toEqual(["alice", "bob"]);
    expect(starts[0].bots).toHaveLength(2);
    expect(manager.roomOf("1")!.status).toBe("in_game");
  });

  it("does not need the host to be ready, and a solo host with bots counts down right away", () => {
    manager.create(alice, ffa({ bots: 3 }));
    expect(manager.roomOf("1")!.status).toBe("countdown");
  });

  it("cancels the countdown when someone un-readies or leaves", () => {
    const room = manager.create(alice, ffa({ bots: 2 }));
    manager.join(bob, { roomId: room.id, role: "player" });
    manager.setReady("2", true);
    manager.setReady("2", false);
    expect(manager.roomOf("1")!.status).toBe("waiting");
    manager.setReady("2", true);
    manager.leave("2");
    expect(manager.roomOf("1")!.status).toBe("waiting");
    vi.advanceTimersByTime(20_000);
    expect(starts).toHaveLength(0);
  });

  it("starts a matchId only once when the host's Start and the countdown happen together", () => {
    manager.create(alice, ffa({ bots: 3 }));
    manager.start("1");
    expect(() => manager.start("1")).toThrow(RoomError);
    vi.advanceTimersByTime(20_000);
    expect(starts).toHaveLength(1);
  });

  it("only lets the host start, and only when eligible", () => {
    const room = manager.create(alice, ffa({ bots: 2 }));
    manager.join(bob, { roomId: room.id, role: "player" });
    expect(() => manager.start("2")).toThrow("Only the host");
    expect(() => manager.start("1")).toThrow("Not ready yet");
  });

  it("rejects players when the room is full, but allows spectators", () => {
    const room = manager.create(alice, ffa({ bots: 3 }));
    expect(() => manager.join(bob, { roomId: room.id, role: "player" })).toThrow("full");
    expect(manager.join(bob, { roomId: room.id, role: "spectator" }).members).toHaveLength(2);
  });

  it("only allows spectators to join during a match", () => {
    const room = manager.create(alice, ffa({ bots: 3 }));
    manager.start("1");
    expect(() => manager.join(bob, { roomId: room.id, role: "player" })).toThrow("spectator");
    expect(manager.join(bob, { roomId: room.id, role: "spectator" }).status).toBe("in_game");
  });

  it("keeps each account in at most one room", () => {
    const first = manager.create(alice, ffa());
    manager.create(alice, ffa({ title: "Second" }));
    expect(manager.summaries().map(r => r.title)).toEqual(["Second"]);
    expect(manager.summaries().some(r => r.id === first.id)).toBe(false); // the empty first room was deleted
  });
});

describe("host transfer and leaving", () => {
  it("gives host to the earliest-joined remaining player and keeps ready states", () => {
    const room = manager.create(alice, ffa());
    manager.join(bob, { roomId: room.id, role: "player" });
    manager.join(carol, { roomId: room.id, role: "player" });
    manager.setReady("3", true);
    manager.leave("1");
    const state = manager.roomOf("2")!;
    expect(state.members.find(m => m.isHost)!.username).toBe("bob");
    expect(state.members.find(m => m.username === "carol")!.ready).toBe(true);
  });

  it("deletes a room when its last member leaves", () => {
    manager.create(alice, ffa());
    manager.leave("1");
    expect(manager.summaries()).toHaveLength(0);
  });

  it("removes a disconnected member before a match, but keeps them during one", () => {
    const room = manager.create(alice, ffa({ bots: 2 }));
    manager.join(bob, { roomId: room.id, role: "player" });
    manager.disconnected("2");
    expect(manager.roomOf("2")).toBeNull();
    manager.join(bob, { roomId: room.id, role: "player" });
    manager.setReady("2", true);
    manager.start("1");
    manager.disconnected("2");
    expect(manager.roomOf("2")!.members.find(m => m.username === "bob")!.connected).toBe(false);
  });
});

describe("Team Battle", () => {
  it("auto-assigns teams, limits each team to 2, and fills each team to exactly 2 with bots", () => {
    const room = manager.create(alice, ffa({ mode: "team", maxPlayers: 6, bots: 3 }));
    manager.join(bob, { roomId: room.id, role: "player" });
    let state = manager.roomOf("1")!;
    expect(state.members.map(m => m.teamId)).toEqual(["red", "red"]);
    manager.join(carol, { roomId: room.id, role: "player" });
    expect(manager.roomOf("3")!.members.find(m => m.username === "carol")!.teamId).toBe("blue");
    expect(() => manager.setTeam("3", "red")).toThrow("That team is full");
    expect(() => manager.setTeam("3", "yellow")).toThrow("isn't available"); // 6 players = 3 teams
    manager.setTeam("3", "green");
    manager.setReady("2", true);
    manager.setReady("3", true);
    manager.start("1");
    const start = starts[0];
    const counts: Record<string, number> = {};
    for (const seat of [...start.players, ...start.bots]) counts[seat.teamId!] = (counts[seat.teamId!] ?? 0) + 1;
    expect(counts).toEqual({ red: 2, blue: 2, green: 2 });
  });
});

describe("match results", () => {
  it("accepts the first result for the current matchId only, shows results, then reopens with a new matchId", () => {
    const room = manager.create(alice, ffa({ bots: 3 }));
    manager.start("1");
    const matchId = starts[0].matchId;
    expect(manager.finishMatch(room.id, "some-other-match", { kind: "draw" })).toBe(false);
    expect(manager.finishMatch(room.id, matchId, { kind: "winner", teamId: "x" })).toBe(true);
    expect(manager.finishMatch(room.id, matchId, { kind: "draw" })).toBe(false); // duplicate
    expect(manager.roomOf("1")).toMatchObject({ status: "results", lastResult: { kind: "winner", teamId: "x" } });
    vi.advanceTimersByTime(10_000);
    expect(manager.roomOf("1")!.status).toBe("countdown"); // solo host + bots: eligible again
    manager.start("1");
    expect(starts).toHaveLength(2);
    expect(starts[1].matchId).not.toBe(matchId);
  });

  it("removes members who never came back after the match", () => {
    const room = manager.create(alice, ffa({ bots: 2 }));
    manager.join(bob, { roomId: room.id, role: "player" });
    manager.setReady("2", true);
    manager.start("1");
    manager.disconnected("2");
    manager.finishMatch(room.id, starts[0].matchId, { kind: "draw" });
    vi.advanceTimersByTime(10_000);
    expect(manager.roomOf("1")!.members.map(m => m.username)).toEqual(["alice"]);
  });
});

describe("match runner", () => {
  const request = (overrides: Partial<MatchStartRequest> = {}): MatchStartRequest => ({
    roomId: "room", matchId: "match", mode: "ffa",
    players: [{ subject: "1", username: "alice", teamId: null }, { subject: "2", username: "bob", teamId: null }],
    bots: [{ teamId: null, difficulty: "easy" }, { teamId: null, difficulty: "easy" }],
    ...overrides,
  });

  it("maps accounts to opaque engine IDs and ignores accounts not in the roster", () => {
    const match = new Match(request(), { onSnapshot: () => {}, onFinished: () => {} }, { autoTick: false });
    const seat = match.seatOf("1")!;
    expect(seat.playerId).not.toBe("1");
    expect(match.snapshot().players).toHaveLength(4);
    expect(match.seatOf(dave.subject)).toBeNull();
    expect(match.setInput(dave.subject, { up: true, down: false, left: false, right: false })).toBe(false);
    expect(match.setInput("1", { up: true, down: false, left: false, right: false })).toBe(true);
  });

  it("builds Team Battle teams from the roster", () => {
    const match = new Match(request({
      mode: "team",
      players: [{ subject: "1", username: "alice", teamId: "red" }, { subject: "2", username: "bob", teamId: "blue" }],
      bots: [{ teamId: "red", difficulty: "easy" }, { teamId: "blue", difficulty: "easy" }],
    }), { onSnapshot: () => {}, onFinished: () => {} }, { autoTick: false });
    expect(match.seatOf("1")!.teamId).toBe("red");
    expect(match.snapshot().players.filter(p => p.teamId === "blue")).toHaveLength(2);
  });

  it("reports the result exactly once and then ignores input", () => {
    const results: unknown[] = [];
    let snapshots = 0;
    const match = new Match(request(), { onSnapshot: () => snapshots++, onFinished: result => results.push(result) }, { autoTick: false, timeLimitSeconds: 1 });
    for (let i = 0; i < 200 && !match.isFinished; i++) match.tick();
    match.tick();
    expect(results).toHaveLength(1);
    expect(snapshots).toBeGreaterThan(0);
    expect(match.placeBomb("1")).toBe(false);
  });
});