import { DEFAULT_BOMB_CONFIG, DEFAULT_MOVEMENT_CONFIG } from "@bubble/engine";
import type { AuthoritativeGameSnapshot as GameSnapshot, MovementInput, PlayerState } from "@bubble/shared";
import { HazardMap } from "./hazard.js";
import { findPath, type SearchOptions, type Waypoint } from "./pathfinding.js";

export type BotState = "ESCAPE" | "COLLECT_ITEM" | "APPROACH_OPPONENT" | "REPOSITION" | "ATTACK" | "WAIT" | "TRAPPED" | "ELIMINATED";
export type BotDifficulty = "easy" | "normal" | "hard";
const levels = {
  easy: { interval: 36, horizon: 3.6, threat: 3.4, escapeUntil: 3.6, goals: 1, nodes: 220, escapeNodes: 350 },
  normal: { interval: 18, horizon: 5, threat: 3.8, escapeUntil: 4, goals: 3, nodes: 350, escapeNodes: 500 },
  hard: { interval: 9, horizon: 6.5, threat: 4.3, escapeUntil: 4.8, goals: 5, nodes: 500, escapeNodes: 700 },
} as const;
export interface BotCommand { input: MovementInput; placeBomb: boolean; state: BotState; reason: string }
const idle = (): MovementInput => ({ up: false, down: false, left: false, right: false });
const tile = (p: { x: number; y: number }, size: number) => ({ x: Math.floor(p.x / size), y: Math.floor(p.y / size) });
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** A controller owns only plans, never game state. The host executes its commands. */
export class BotController {
  private path: Waypoint[] = [];
  private planTick = 0;
  private nextReplan = 0;
  private signature = "";
  private lastPosition?: { x: number; y: number };
  private wasMoving = false;
  private stuck = 0;
  private state: BotState = "WAIT";
  private reason = "Waiting";
  private visits = new Map<string, number>();
  private lastTile = "";
  private counters = { searches: 0, expanded: 0, exhausted: 0 };
  constructor(readonly playerId: string, private readonly phase = 0, readonly difficulty: BotDifficulty = "normal") {
    if (!Object.hasOwn(levels, difficulty)) throw new RangeError("Invalid bot difficulty");
  }

  metrics() { return { ...this.counters }; }

  private search(snapshot: GameSnapshot, player: PlayerState, goal: { x: number; y: number }, hazards: HazardMap, options: SearchOptions) {
    const result = findPath(snapshot, player, goal, hazards, options);
    this.counters.searches++; this.counters.expanded += result.expanded; this.counters.exhausted += Number(result.exhausted);
    return result;
  }

  /** Current execution plan, detached so a debugging consumer cannot mutate it. */
  debug(snapshot: GameSnapshot, command: BotCommand) {
    const player = snapshot.players.find(p => p.id === this.playerId);
    const paused = command.reason === "Waiting for a safe replan" || command.state === "TRAPPED" || command.state === "ELIMINATED";
    const path = paused ? [] : this.path.map(p => ({ ...p }));
    return { playerId: this.playerId, position: player ? { x: player.x, y: player.y } : null,
      state: command.state, reason: command.reason, path, destination: path.at(-1) ?? null,
      danger: new HazardMap(snapshot).intervals(), tick: snapshot.tick };
  }

  private centeringDelay(snapshot: GameSnapshot, player: PlayerState): number {
    const size = snapshot.map.tileSize, here = tile(player, size);
    const speed = DEFAULT_MOVEMENT_CONFIG.speed * (player.slowSeconds > 0 ? 0.5 : 1 + 0.1 * player.boots);
    return (Math.abs(player.x - (here.x + 0.5) * size) + Math.abs(player.y - (here.y + 0.5) * size)) / speed + 2 * DEFAULT_MOVEMENT_CONFIG.timestepSeconds;
  }

  private escape(snapshot: GameSnapshot, player: PlayerState, hazards: HazardMap, safeUntil: number): Waypoint[] {
    const start = tile(player, snapshot.map.tileSize);
    const result = this.search(snapshot, player, start, hazards, {
      horizonSeconds: Math.min(levels[this.difficulty].horizon, safeUntil), maxNodes: levels[this.difficulty].escapeNodes, stepSeconds: 0.1, initialDelaySeconds: this.centeringDelay(snapshot, player),
      goalTest: (x, y, time) => time > 0 && time + 0.3 < safeUntil && !hazards.isDangerousDuring(x, y, time, safeUntil),
    });
    return result.path;
  }

  /** Invoke once per fixed tick with a detached, authoritative snapshot. */
  update(snapshot: GameSnapshot, canReplan = true): BotCommand {
    const p = snapshot.players.find(player => player.id === this.playerId);
    if (!p || snapshot.result || p.status !== "alive") {
      this.path = []; this.lastPosition = undefined; this.wasMoving = false;
      return { input: idle(), placeBomb: false, state: p?.status === "trapped" ? "TRAPPED" : "ELIMINATED", reason: "Cannot act" };
    }
    if (p.slide) { this.path = []; this.signature = ""; this.wasMoving = false; return { input: idle(), placeBomb: false, state: "WAIT", reason: "Forced slide" }; }
    const size = snapshot.map.tileSize, here = tile(p, size), dt = DEFAULT_MOVEMENT_CONFIG.timestepSeconds;
    const hereKey = `${here.x},${here.y}`;
    if (hereKey !== this.lastTile) { this.lastTile = hereKey; this.visits.set(hereKey, snapshot.tick); }
    const signature = snapshot.bombs.map(b => `${b.id}:${b.x},${b.y},${b.range}`).join("|") + ";" +
      snapshot.explosions.map(e => `${e.id}:${e.x},${e.y}`).join("|") + ";" +
      snapshot.items.filter(i => i.kind !== "pickup" && i.active).map(i => `${i.id}:${i.x},${i.y}`).join("|") + ";" +
      snapshot.map.tiles.map(row => row.map(t => t.type[0]).join("")).join("");
    const changed = signature !== this.signature;
    if (this.lastPosition && this.wasMoving && this.path.length && Math.hypot(p.x - this.lastPosition.x, p.y - this.lastPosition.y) < 0.01) this.stuck++;
    else this.stuck = 0;
    this.lastPosition = { x: p.x, y: p.y };
    const speed = DEFAULT_MOVEMENT_CONFIG.speed * (p.slowSeconds > 0 ? 0.5 : 1 + 0.1 * p.boots);
    const tolerance = speed * dt * 0.51 + 0.05;
    const centered = Math.abs(p.x - (here.x + 0.5) * size) <= tolerance && Math.abs(p.y - (here.y + 0.5) * size) <= tolerance;
    // Replan at centres to avoid changing direction mid-tile, except on a changed hazard or obstruction.
    const replan = changed || this.stuck > 12 || (!this.path.length && snapshot.tick >= this.nextReplan) || (centered && snapshot.tick >= this.nextReplan && this.state !== "ESCAPE");
    let placeBomb = false;
    // The session scheduler limits expensive searches to one bot per tick.
    // Stop immediately on an unhandled world change until this bot's turn.
    if (replan && !canReplan && (changed || this.stuck > 12 || !this.path.length)) {
      this.wasMoving = false;
      return { input: idle(), placeBomb: false, state: "WAIT", reason: "Waiting for a safe replan" };
    }
    if (replan && canReplan) {
      const config = levels[this.difficulty];
      this.signature = signature; this.stuck = 0; this.nextReplan = snapshot.tick + config.interval + this.phase % 5;
      const hazards = new HazardMap(snapshot), imminent = hazards.isDangerousDuring(here.x, here.y, 0, config.threat);
      this.path = []; this.state = "WAIT"; this.reason = "No safe goal";
      if (imminent) {
        this.path = this.escape(snapshot, p, hazards, config.escapeUntil);
        this.state = "ESCAPE"; this.reason = this.path.length ? "Bomb danger; moving to safety" : "No safe route found";
      } else {
        // Prediction copies the map internally; only the bomb array changes here.
        const hypothetical = { ...snapshot, bombs: [...snapshot.bombs] };
        const proposedId = Math.min(-1, ...hypothetical.bombs.map(b => b.id - 1));
        hypothetical.bombs.push({ id: proposedId, ownerId: p.id, x: here.x, y: here.y, remainingSeconds: DEFAULT_BOMB_CONFIG.fuseSeconds, range: 1 + p.rangeUpgrades });
        const predicted = new HazardMap(hypothetical), blastTime = predicted.detonationTimes.get(proposedId)!;
        const others = snapshot.players.filter(other => other.id !== p.id && other.status !== "eliminated");
        const enemyInBlast = others.some(other => other.teamId !== p.teamId && predicted.isDangerous(tile(other, size).x, tile(other, size).y, blastTime));
        const allyInBlast = others.some(other => {
          if (other.teamId !== p.teamId) return false;
          const ally = tile(other, size);
          // Hard also protects floor tiles the ally could step onto before detonation.
          const offsets = this.difficulty === "hard" ? [[0,0],[1,0],[-1,0],[0,1],[0,-1]] : [[0,0]];
          return offsets.some(([dx, dy]) => snapshot.map.tiles[ally.y + dy]?.[ally.x + dx]?.type === "floor" && predicted.isDangerous(ally.x + dx, ally.y + dy, blastTime));
        });
        const nearWall = [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => snapshot.map.tiles[here.y + dy]?.[here.x + dx]?.type === "destructible");
        const canBomb = centered && !snapshot.bombs.some(b => b.x === here.x && b.y === here.y) && snapshot.bombs.filter(b => b.ownerId === p.id).length < 1 + p.capacityUpgrades;
        if (canBomb && !allyInBlast && (enemyInBlast || nearWall)) {
          const route = this.escape(hypothetical, p, predicted, blastTime + DEFAULT_BOMB_CONFIG.explosionSeconds + 0.1);
          if (route.length > 1 && route.at(-1)!.time + 0.3 < blastTime) {
            this.path = route; this.state = "ESCAPE"; this.reason = "Bomb placed; retreating along safe route"; placeBomb = true;
          }
        }
        if (!this.path.length) {
          let partial: { path: Waypoint[]; state: BotState; reason: string } | undefined;
          const usefulPartial = (path: Waypoint[]) => {
            const end = path.at(-1);
            if (!end || path.length < 2) return false;
            const visited = this.visits.get(`${end.x},${end.y}`);
            return visited === undefined || snapshot.tick - visited > 180;
          };
          const items = snapshot.items.filter(i => i.kind === "pickup" && i.active && (i.type === "boots" || i.type === "range" || i.type === "capacity"));
          const targets = items.sort((a, b) => distance(here, a) - distance(here, b) || a.y - b.y || a.x - b.x).slice(0, config.goals);
          for (const target of targets) {
            const result = this.search(snapshot, p, target, hazards, { maxNodes: config.nodes, horizonSeconds: config.horizon, initialDelaySeconds: this.centeringDelay(snapshot, p), allowPartial: true });
            if (result.path.length > 1 && !result.partial) { this.path = result.path; this.state = "COLLECT_ITEM"; this.reason = `Seeking ${target.type}`; break; }
            if (result.partial && usefulPartial(result.path) && !partial) partial = { path: result.path, state: "COLLECT_ITEM", reason: `Approaching ${target.type} via an intermediate tile` };
          }
          if (!this.path.length) {
            const enemies = others.filter(o => o.teamId !== p.teamId).sort((a, b) => distance(here, tile(a, size)) - distance(here, tile(b, size)) || a.id.localeCompare(b.id)).slice(0, 2);
            for (const enemy of enemies) {
              const goal = tile(enemy, size), result = this.search(snapshot, p, goal, hazards, { maxNodes: config.nodes, horizonSeconds: config.horizon, initialDelaySeconds: this.centeringDelay(snapshot, p), allowPartial: true });
              if (result.path.length > 1 && !result.partial) { this.path = result.path; this.state = "APPROACH_OPPONENT"; this.reason = "Approaching opponent"; break; }
              if (result.partial && usefulPartial(result.path) && !partial) partial = { path: result.path, state: "APPROACH_OPPONENT", reason: "Approaching opponent via an intermediate tile" };
            }
          }
          if (!this.path.length && partial) { this.path = partial.path; this.state = partial.state; this.reason = partial.reason; }
          if (!this.path.length) {
            // A local, time-checked exploration step prevents an unreachable goal
            // from causing endless idle. Prefer the least recently visited tile.
            const neighbors = [[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy]) => ({ x: here.x + dx, y: here.y + dy }))
              .filter(q => snapshot.map.tiles[q.y]?.[q.x]?.type === "floor")
              .sort((a, b) => (this.visits.get(`${a.x},${a.y}`) ?? -1) - (this.visits.get(`${b.x},${b.y}`) ?? -1) || a.y - b.y || a.x - b.x);
            for (const goal of neighbors) {
              const route = this.search(snapshot, p, goal, hazards, { maxNodes: 80, horizonSeconds: 2, initialDelaySeconds: this.centeringDelay(snapshot, p),
                goalTest: (x, y, time) => x === goal.x && y === goal.y && !hazards.isDangerousDuring(x, y, time, time + 1) }).path;
              if (route.length > 1) { this.path = route; this.state = "REPOSITION"; this.reason = "Exploring a safe neighboring tile"; break; }
            }
          }
        }
      }
      if (this.path.length) { this.planTick = snapshot.tick; }
    }
    // Recenter first, then follow cardinal tile centres; half-tick tolerance prevents oscillation.
    while (this.path.length) {
      const waypoint = this.path[0], x = (waypoint.x + 0.5) * size, y = (waypoint.y + 0.5) * size;
      const dx = x - p.x, dy = y - p.y;
      if (Math.abs(dx) <= tolerance && Math.abs(dy) <= tolerance) {
        if ((snapshot.tick - this.planTick) * dt + 1e-9 < waypoint.time) break;
        this.path.shift(); continue;
      }
      const input = idle();
      if (Math.abs(dx) > tolerance) input[dx > 0 ? "right" : "left"] = true;
      else if (Math.abs(dy) > tolerance) input[dy > 0 ? "down" : "up"] = true;
      this.wasMoving = true;
      return { input, placeBomb, state: this.state, reason: this.reason };
    }
    this.wasMoving = false;
    return { input: idle(), placeBomb, state: this.state, reason: this.reason };
  }
}
