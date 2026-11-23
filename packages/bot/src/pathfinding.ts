import { DEFAULT_MOVEMENT_CONFIG } from "@bubble/engine";
import type { GameSnapshot, PlayerState } from "@bubble/shared";
import { HazardMap } from "./hazard.js";

export interface Waypoint { x: number; y: number; time: number }
export interface SearchResult { path: Waypoint[]; expanded: number; exhausted: boolean; partial: boolean }
export interface SearchOptions { horizonSeconds?: number; maxNodes?: number; stepSeconds?: number; initialDelaySeconds?: number; goalTest?: (x: number, y: number, time: number) => boolean; allowPartial?: boolean }
interface Node extends Waypoint { tick: number; parent?: Node; score: number }

/** Bounded time-expanded A*. Movement is conservatively treated as occupying
 * both endpoint tiles throughout a move. Plans begin at a tile centre; callers
 * must first account for any offset and replan when the world changes. */
export function findPath(snapshot: GameSnapshot, player: PlayerState, goal: { x: number; y: number }, hazards: HazardMap, options: SearchOptions = {}): SearchResult {
  const dt = options.stepSeconds ?? 0.1, horizon = options.horizonSeconds ?? 6, budget = options.maxNodes ?? 4000;
  const delay = options.initialDelaySeconds ?? 0;
  if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(horizon) || horizon <= 0 || !Number.isInteger(budget) || budget < 1 || !Number.isFinite(delay) || delay < 0) throw new RangeError("Invalid search limits");
  const size = snapshot.map.tileSize, startX = Math.floor(player.x / size), startY = Math.floor(player.y / size);
  const speed = DEFAULT_MOVEMENT_CONFIG.speed * (player.slowSeconds > 0 ? 0.5 : 1 + player.boots * 0.1);
  const moveTicks = Math.max(1, Math.ceil(size / speed / dt));
  const maxTick = Math.floor(horizon / dt);
  const startTick = Math.ceil(delay / dt);
  if (startTick > maxTick || hazards.isDangerousDuring(startX, startY, 0, startTick * dt)) return { path: [], expanded: 0, exhausted: false, partial: false };
  const heuristic = (x: number, y: number) => options.goalTest ? 0 : (Math.abs(goal.x - x) + Math.abs(goal.y - y)) * moveTicks;
  const open: Node[] = [{ x: startX, y: startY, time: startTick * dt, tick: startTick, score: startTick + heuristic(startX, startY) }];
  const compare = (a: Node, b: Node) => a.score - b.score || a.tick - b.tick || a.y - b.y || a.x - b.x;
  const push = (node: Node) => {
    let i = open.length; open.push(node);
    while (i > 0) { const p = (i - 1) >> 1; if (compare(open[p], node) <= 0) break; open[i] = open[p]; i = p; }
    open[i] = node;
  };
  const pop = () => {
    const first = open[0], last = open.pop()!;
    if (open.length) {
      let i = 0;
      while (i * 2 + 1 < open.length) {
        let child = i * 2 + 1;
        if (child + 1 < open.length && compare(open[child + 1], open[child]) < 0) child++;
        if (compare(last, open[child]) <= 0) break;
        open[i] = open[child]; i = child;
      }
      open[i] = last;
    }
    return first;
  };
  const seen = new Set<string>(); let expanded = 0, best: Node | undefined;
  const buildPath = (end: Node) => {
    const path: Waypoint[] = [];
    for (let node: Node | undefined = end; node; node = node.parent) path.push({ x: node.x, y: node.y, time: node.time });
    return path.reverse();
  };
  while (open.length && expanded < budget) {
    const current = pop(), key = `${current.x},${current.y},${current.tick}`;
    if (seen.has(key)) continue;
    seen.add(key); expanded++;
    if (options.goalTest ? options.goalTest(current.x, current.y, current.time) : current.x === goal.x && current.y === goal.y) {
      return { path: buildPath(current), expanded, exhausted: false, partial: false };
    }
    // Only return a partial route if it makes spatial progress and its end is
    // safe long enough for a subsequent replan. Never apply this to escape
    // goal predicates, which require the complete safety condition.
    if (options.allowPartial && !options.goalTest && heuristic(current.x, current.y) < heuristic(startX, startY) &&
        !hazards.isDangerousDuring(current.x, current.y, current.time, current.time + 1) &&
        (!best || heuristic(current.x, current.y) < heuristic(best.x, best.y) ||
          (heuristic(current.x, current.y) === heuristic(best.x, best.y) && current.tick < best.tick))) best = current;
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = current.x + dx, y = current.y + dy, moving = dx !== 0 || dy !== 0;
      if (snapshot.map.tiles[y]?.[x]?.type !== "floor") continue;
      // Avoid active traps and dropped hazards rather than predicting forced slides.
      if (snapshot.items.some(i => i.x === x && i.y === y && i.kind !== "pickup" && i.active)) continue;
      const arrival = current.tick + (moving ? moveTicks : 1);
      if (arrival > maxTick) continue;
      if (snapshot.bombs.some(b => b.x === x && b.y === y && (moving || x !== startX || y !== startY) && current.time < (hazards.detonationTimes.get(b.id) ?? Infinity))) continue;
      const safe = !hazards.isDangerousDuring(current.x, current.y, current.time, arrival * dt) &&
        !hazards.isDangerousDuring(x, y, current.time, arrival * dt);
      if (safe) push({ x, y, tick: arrival, time: arrival * dt, score: arrival + heuristic(x, y), parent: current });
    }
  }
  return { path: best ? buildPath(best) : [], expanded, exhausted: open.length > 0, partial: !!best };
}
