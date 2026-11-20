import type { BombState, GameSnapshot, GameState, MovementInput } from "@bubble/shared";
import { generateMap, type MapConfig } from "./map.js";
import { DEFAULT_MOVEMENT_CONFIG, movePlayer, type MovementConfig } from "./movement.js";

const IDLE: MovementInput = { up: false, down: false, left: false, right: false };
/** Provisional values until the team agrees on limits and visual duration. */
export interface MatchConfig { mode: "ffa" | "team"; teams?: Record<string, string>; timeLimitSeconds?: number }
export interface BombConfig { fuseSeconds: number; explosionSeconds: number; initialCapacity: number; maxCapacity: number; maxRange: number; stopAtDestructible: boolean; repeatedHit: "ignore" | "reset" | "eliminate" }
export const DEFAULT_BOMB_CONFIG: BombConfig = { fuseSeconds: 3, explosionSeconds: 0.3, initialCapacity: 1, maxCapacity: 8, maxRange: 8, stopAtDestructible: true, repeatedHit: "ignore" };

/** One headless match. Player-player collision is intentionally unresolved. */
export class Game {
  private state: GameState;
  private inputs = new Map<string, MovementInput>();
  private movement: MovementConfig;
  private bombConfig: BombConfig;
  private upgrades = new Map<string, { capacity: number; range: number }>();
  private nextBombId = 0;
  private hitExplosions = new Map<number, Set<string>>();
  private match?: MatchConfig;
  constructor(playerIds: string[], mapConfig: Partial<MapConfig> = {}, movementConfig: Partial<MovementConfig> = {}, bombConfig: Partial<BombConfig> = {}, match?: MatchConfig) {
    if (playerIds.length < 1 || playerIds.length > 8 || new Set(playerIds).size !== playerIds.length || playerIds.some(id => !id)) {
      throw new RangeError("Expected 1?8 distinct, nonempty player IDs");
    }
    if (match) {
      if (match.mode !== "ffa" && match.mode !== "team") throw new RangeError("Unknown match mode");
      if (playerIds.length < 4 || (match.mode === "team" && playerIds.length % 2 !== 0)) throw new RangeError("Invalid match roster");
      if (match.timeLimitSeconds !== undefined && (!Number.isFinite(match.timeLimitSeconds) || match.timeLimitSeconds <= 0 || match.timeLimitSeconds > 600)) throw new RangeError("Invalid match duration");
      if (match.mode === "team") {
        const teams = playerIds.map(id => match.teams?.[id]);
        if (teams.some(team => typeof team !== "string" || !team)) throw new RangeError("Each player needs a team");
        const counts = new Map<string, number>();
        for (const team of teams as string[]) counts.set(team, (counts.get(team) ?? 0) + 1);
        if ([...counts.values()].some(count => count !== 2)) throw new RangeError("Teams require two players");
      }
      this.match = { ...match, teams: match.teams && { ...match.teams } };
    }
    const { map, spawns } = generateMap({ ...mapConfig, playerCount: playerIds.length });
    this.movement = { ...DEFAULT_MOVEMENT_CONFIG, ...movementConfig };
    if (!Number.isFinite(this.movement.speed) || this.movement.speed < 0 || !Number.isFinite(this.movement.timestepSeconds) || this.movement.timestepSeconds <= 0 ||
        !Number.isFinite(this.movement.playerRadius) || this.movement.playerRadius <= 0 || this.movement.playerRadius * 2 >= map.tileSize) {
      throw new RangeError("Invalid movement configuration");
    }
    this.bombConfig = { ...DEFAULT_BOMB_CONFIG, ...bombConfig };
    const b = this.bombConfig;
    if (!Number.isFinite(b.fuseSeconds) || b.fuseSeconds <= 0 || !Number.isFinite(b.explosionSeconds) || b.explosionSeconds <= 0 ||
        !Number.isInteger(b.initialCapacity) || b.initialCapacity < 1 || !Number.isInteger(b.maxCapacity) || b.maxCapacity < b.initialCapacity ||
        !Number.isInteger(b.maxRange) || b.maxRange < 1 || typeof b.stopAtDestructible !== "boolean" || !["ignore", "reset", "eliminate"].includes(b.repeatedHit)) throw new RangeError("Invalid bomb configuration");
    for (const id of playerIds) this.upgrades.set(id, { capacity: b.initialCapacity, range: 1 });
    this.state = { tick: 0, elapsedSeconds: 0, result: null, map, bombs: [], explosions: [], players: playerIds.map((id, i) => ({ id, teamId: match?.mode === "team" ? match.teams![id] : id, x: (spawns[i].x + 0.5) * map.tileSize, y: (spawns[i].y + 0.5) * map.tileSize, status: "alive", trappedSeconds: 0 })) };
  }
  setInput(playerId: string, input: MovementInput): void {
    if (!this.state.players.some(p => p.id === playerId)) throw new RangeError("Unknown player");
    if ([input.up, input.down, input.left, input.right].some(value => typeof value !== "boolean")) throw new TypeError("Invalid movement input");
    this.inputs.set(playerId, { ...input });
  }
  /** Upgrade hooks for the later item system. */
  upgradeBomb(playerId: string, kind: "capacity" | "range"): void {
    const stats = this.upgrades.get(playerId);
    if (!stats) throw new RangeError("Unknown player");
    if (kind === "capacity") stats.capacity = Math.min(this.bombConfig.maxCapacity, stats.capacity + 1);
    else if (kind === "range") stats.range = Math.min(this.bombConfig.maxRange, stats.range + 1);
    else throw new TypeError("Unknown upgrade");
  }
  placeBomb(playerId: string): boolean {
    const player = this.state.players.find(p => p.id === playerId);
    const stats = this.upgrades.get(playerId);
    if (!player || !stats) throw new RangeError("Unknown player");
    if (player.status !== "alive" || this.state.result) return false;
    const x = Math.floor(player.x / this.state.map.tileSize), y = Math.floor(player.y / this.state.map.tileSize);
    if (this.state.bombs.some(b => b.x === x && b.y === y) || this.state.bombs.filter(b => b.ownerId === playerId).length >= stats.capacity) return false;
    this.state.bombs.push({ id: this.nextBombId++, ownerId: playerId, x, y, remainingSeconds: this.bombConfig.fuseSeconds, range: stats.range });
    return true;
  }
  private detonate(initial: BombState): void {
    const queue = [initial];
    const pending = new Set([initial.id]);
    for (let i = 0; i < queue.length; i++) {
      const bomb = queue[i];
      this.state.bombs = this.state.bombs.filter(b => b.id !== bomb.id);
      const blast = (x: number, y: number): boolean => {
        const tile = this.state.map.tiles[y]?.[x];
        if (!tile || tile.type === "indestructible") return false;
        this.state.explosions.push({ id: bomb.id, x, y, remainingSeconds: this.bombConfig.explosionSeconds });
        const chained = this.state.bombs.find(b => b.x === x && b.y === y);
        if (chained && !pending.has(chained.id)) { pending.add(chained.id); queue.push(chained); }
        if (tile.type === "destructible") { tile.type = "floor"; return !this.bombConfig.stopAtDestructible; }
        return true;
      };
      blast(bomb.x, bomb.y);
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        for (let distance = 1; distance <= bomb.range; distance++) if (!blast(bomb.x + dx * distance, bomb.y + dy * distance)) break;
      }
    }
  }
  /** Advance exactly one configured fixed timestep. */
  step(): void {
    if (this.state.result) return;
    const before = this.state.players.map(p => ({ ...p }));
    this.state.players = this.state.players.map(p => p.status === "alive" ? movePlayer(p, this.inputs.get(p.id) ?? IDLE, this.state.map, this.movement) : p);
    const dt = this.movement.timestepSeconds;
    this.state.explosions = this.state.explosions.filter(e => (e.remainingSeconds -= dt) > 1e-9);
    for (const bomb of this.state.bombs) bomb.remainingSeconds -= dt;
    for (const bomb of [...this.state.bombs]) {
      if (bomb.remainingSeconds <= 1e-9 && this.state.bombs.some(b => b.id === bomb.id)) this.detonate(bomb);
    }
    for (const player of this.state.players) {
      if (player.status === "trapped") {
        player.trappedSeconds = Math.max(0, player.trappedSeconds - dt);
        if (player.trappedSeconds <= 1e-9) player.status = "eliminated";
      }
      const x = Math.floor(player.x / this.state.map.tileSize), y = Math.floor(player.y / this.state.map.tileSize);
      for (const explosion of this.state.explosions) {
        if (explosion.x !== x || explosion.y !== y) continue;
        const hits = this.hitExplosions.get(explosion.id) ?? new Set<string>();
        this.hitExplosions.set(explosion.id, hits);
        if (hits.has(player.id)) continue;
        hits.add(player.id);
        if (player.status === "alive") { player.status = "trapped"; player.trappedSeconds = 10; }
        else if (player.status === "trapped" && this.bombConfig.repeatedHit === "reset") player.trappedSeconds = 10;
        else if (player.status === "trapped" && this.bombConfig.repeatedHit === "eliminate") player.status = "eliminated";
      }
    }
    const activeExplosions = new Set(this.state.explosions.map(e => e.id));
    for (const id of this.hitExplosions.keys()) if (!activeExplosions.has(id)) this.hitExplosions.delete(id);
    // Resolve contact using the whole movement segment; enemy contact takes priority.
    const radius = this.movement.playerRadius * 2;
    for (const target of this.state.players.filter(p => p.status === "trapped")) {
      const contacts = this.state.players.filter((p, i) => {
        if (p.id === target.id || p.status !== "alive") return false;
        const start = before[i];
        // X and then Y match the collision resolution path.
        const horizontal = Math.abs(start.y - target.y) < radius && Math.min(start.x, p.x) < target.x + radius && Math.max(start.x, p.x) > target.x - radius;
        const vertical = Math.abs(p.x - target.x) < radius && Math.min(start.y, p.y) < target.y + radius && Math.max(start.y, p.y) > target.y - radius;
        return horizontal || vertical;
      });
      if (contacts.some(p => p.teamId !== target.teamId)) target.status = "eliminated";
      else if (contacts.some(p => p.teamId === target.teamId)) { target.status = "alive"; target.trappedSeconds = 0; }
    }
    this.state.tick++;
    this.state.elapsedSeconds = this.state.tick * dt;
    if (this.match) {
      const survivors = this.state.players.filter(p => p.status !== "eliminated");
      const counts = new Map<string, number>();
      for (const player of survivors) counts.set(player.teamId, (counts.get(player.teamId) ?? 0) + 1);
      if (counts.size <= 1) this.state.result = counts.size ? { kind: "winner", teamId: counts.keys().next().value! } : { kind: "draw" };
      else if (this.state.elapsedSeconds + 1e-9 >= (this.match.timeLimitSeconds ?? 600)) {
        const maximum = Math.max(...counts.values());
        const winners = [...counts].filter(([, count]) => count === maximum);
        this.state.result = winners.length === 1 ? { kind: "winner", teamId: winners[0][0] } : { kind: "draw" };
      }
    }
  }
  /** Return a detached public copy so consumers cannot mutate the simulation. */
  getSnapshot(): GameSnapshot { return structuredClone(this.state); }
}
