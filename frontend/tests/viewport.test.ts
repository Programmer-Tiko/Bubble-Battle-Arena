import { describe, expect, it } from "vitest";
import { generateMap } from "@bubble/engine";
import { cameraCenter, minimapPoint } from "../src/viewport";

describe("large arena viewport", () => {
  const map = generateMap({ width: 30, height: 26 }).map;
  it("clamps the camera at map edges and follows interior positions", () => {
    expect(cameraCenter(map, 0, 0)).toEqual({ x: 240, y: 208 });
    expect(cameraCenter(map, 10000, 10000)).toEqual({ x: 720, y: 624 });
    expect(cameraCenter(map, 500, 400)).toEqual({ x: 500, y: 400 });
  });
  it("maps world coordinates into a bounded minimap", () => {
    expect(minimapPoint(map, 480, 416, 150, 130)).toEqual({ x: 75, y: 65 });
    expect(minimapPoint(map, -10, 9000, 150, 130)).toEqual({ x: 0, y: 130 });
  });
});
