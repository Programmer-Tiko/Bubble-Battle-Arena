import type { BombState, GameSnapshot, GameState, MovementInput } from "@bubble/shared";
import { generateMap, type MapConfig } from "./map.js";
import { DEFAULT_MOVEMENT_CONFIG, movePlayer, type MovementConfig } from "./movement.js";

const IDLE: MovementInput = { up: false, down: false, left: false, right: false };
/** Provisional values until the team agrees on limits and visual duration. */
export interface BombConfig { fuseSeconds: number; explosionSeconds: number; initialCapacity: number; maxCapacity: number; maxRange: number; stopAtDestructible: boolean }
export const DEFAULT_BOMB_CONFIG: BombConfig = { fuseSeconds: 3, explosionSeconds: 0.3, initialCapacity: 1, maxCapacity: 8, maxRange: 8, stopAtDestructible: true };

/** One headless match. Player-player collision is intentionally unresolved. */
export class Game {
  private state: GameState;
  private inputs = new Map<string, MovementInput>();
  private movement: MovementConfig;
  private bombConfig: BombConfig;
  private upgrades = new Map<string, { capacity: number; range: number }>();
  private nextBombId = 0;
  constructor(playerIds: string[], mapConfig: Partial<MapConfig> = {}, movementConfig: Partial<MovementConfig> = {}, bombConfig: Partial<BombConfig> = {}) {
    if (playerIds.length < 1 || playerIds.length > 8 || new Set(playerIds).size !== playerIds.length || playerIds.some(id => !id)) {
      throw new RangeError("Expected 1?8 distinct, nonempty player IDs");
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
        !Number.isInteger(b.maxRange) || b.maxRange < 1 || typeof b.stopAtDestructible !== "boolean") throw new RangeError("Invalid bomb configuration");
    for (const id of playerIds) this.upgrades.set(id, { capacity: b.initialCapacity, range: 1 });
    this.state = { tick: 0, map, bombs: [], explosions: [], players: playerIds.map((id, i) => ({ id, x: (spawns[i].x + 0.5) * map.tileSize, y: (spawns[i].y + 0.5) * map.tileSize, status: "alive", trappedSeconds: 0 })) };
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
    if (player.status !== "alive") return false;
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
        this.state.explosions.push({ x, y, remainingSeconds: this.bombConfig.explosionSeconds });
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
      if (player.status === "alive" && this.state.explosions.some(e => e.x === x && e.y === y)) {
        player.status = "trapped"; player.trappedSeconds = 10;
      }
    }
    this.state.tick++;
  }
  /** Return a detached public copy so consumers cannot mutate the simulation. */
  getSnapshot(): GameSnapshot { return structuredClone(this.state); }
}
