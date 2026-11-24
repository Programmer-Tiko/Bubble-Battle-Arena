import { describe, expect, it } from "vitest";
import { Game } from "@bubble/engine";
import { isSnapshot } from "../src/network";

describe("network snapshot validation", () => {
  it("accepts an engine snapshot and rejects malformed rendering data", () => {
    const snapshot = new Game(["a"]).getSnapshot();
    expect(isSnapshot(snapshot)).toBe(true);
    expect(isSnapshot({ ...snapshot, players: [{ id: "spoof" }] })).toBe(false);
    expect(isSnapshot({ ...snapshot, items: [{ type: "unknown", x: 1, y: 1 }] })).toBe(false);
    expect(isSnapshot({ ...snapshot, balloon: { startedAt: 0, durationSeconds: 0 } })).toBe(false);
    expect(isSnapshot({ ...snapshot, supplyPreview: { announcedAt: 177, scheduledAt: 180, tiles: [{ x: -1, y: 0 }] } })).toBe(false);
    const game = new Game(["a"]); game.placeBomb("a");
    const internal = game.getSnapshot();
    expect(isSnapshot(internal)).toBe(false);
    const { remainingSeconds: _hidden, ...publicBomb } = internal.bombs[0];
    expect(isSnapshot({ ...internal, bombs: [publicBomb] })).toBe(true);
    expect(isSnapshot(null)).toBe(false);
  });
});
