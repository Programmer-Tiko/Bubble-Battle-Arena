import { describe, expect, expectTypeOf, it } from "vitest";
import type { BotDifficulty as SharedDifficulty } from "@bubble/shared";
import { BotController, type BotDifficulty as BotDifficultyExport } from "../src/index.js";

describe("bot difficulty contract", () => {
  it("re-exports the shared type and accepts each supported difficulty", () => {
    expectTypeOf<BotDifficultyExport>().toEqualTypeOf<SharedDifficulty>();
    for (const difficulty of ["easy", "normal", "hard"] satisfies SharedDifficulty[]) {
      expect(new BotController("bot", 0, difficulty).difficulty).toBe(difficulty);
    }
  });
});
