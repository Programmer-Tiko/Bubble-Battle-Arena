import { expect, it } from "vitest";
import { Game } from "@bubble/engine";
import { RandomBaseline } from "../src/baseline.js";

it("uses identical seeded initial scenarios for each evaluated policy", () => {
  for (let seed = 1; seed <= 4; seed++) {
    const a = new Game(["bot", "opponent"], { seed }), b = new Game(["bot", "opponent"], { seed });
    expect(a.getSnapshot()).toEqual(b.getSnapshot());
    const first = new RandomBaseline("bot", seed), second = new RandomBaseline("bot", seed);
    expect(first.update(a.getSnapshot())).toEqual(second.update(b.getSnapshot()));
  }
});
