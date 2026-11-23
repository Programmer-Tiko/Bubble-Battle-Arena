import { expect, it } from "vitest";
import { SessionDebug } from "../src/session-debug";

it("rejects late debug replies from a previous connection or after leaving", () => {
  const debug = new SessionDebug<string>();
  debug.bind("first"); const first = debug.ticket()!;
  expect(debug.accept(first, ["first bot"])).toBe(true);
  debug.bind("second"); expect(debug.data).toEqual([]);
  const second = debug.ticket()!;
  expect(debug.accept(first, ["wrong session"])).toBe(false);
  expect(debug.accept(second, ["second bot"])).toBe(true);
  debug.clear(); expect(debug.accept(second, ["late while disabled"])).toBe(false);
  const resumed = debug.ticket()!; expect(debug.accept(resumed, ["resumed bot"])).toBe(true);
  debug.bind(null); expect(debug.data).toEqual([]);
  expect(debug.accept(resumed, ["stale bot"])).toBe(false);
});
