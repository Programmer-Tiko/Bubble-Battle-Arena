import { describe, expect, it } from "vitest";
import { LocalGameAdapter } from "../src/adapter";

const right = { up: false, down: false, left: false, right: true };
describe("local game adapter", () => {
  it("advances only complete fixed ticks and leaves authority in the engine", () => {
    const adapter = new LocalGameAdapter();
    const initial = adapter.snapshot();
    adapter.setInput(right);
    adapter.advance(10);
    expect(adapter.snapshot().tick).toBe(0);
    adapter.advance(24);
    const next = adapter.snapshot();
    expect(next.tick).toBe(1);
    expect(next.players[0].x).toBeGreaterThan(initial.players[0].x);
    next.players[0].x = -100;
    expect(adapter.snapshot().players[0].x).not.toBe(-100);
  });
  it("limits catch-up after a long pause", () => {
    const adapter = new LocalGameAdapter();
    adapter.advance(10000);
    expect(adapter.snapshot().tick).toBeLessThanOrEqual(8);
  });
});
