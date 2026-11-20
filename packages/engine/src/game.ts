import type { GameSnapshot, GameState, MovementInput } from "@bubble/shared";
import { generateMap, type MapConfig } from "./map.js";
import { DEFAULT_MOVEMENT_CONFIG, movePlayer, type MovementConfig } from "./movement.js";

const IDLE: MovementInput = { up: false, down: false, left: false, right: false };
/** One headless match. Player-player collision is intentionally unresolved. */
export class Game {
  private state: GameState;
  private inputs = new Map<string, MovementInput>();
  private movement: MovementConfig;
  constructor(playerIds: string[], mapConfig: Partial<MapConfig> = {}, movementConfig: Partial<MovementConfig> = {}) {
    if (playerIds.length < 1 || playerIds.length > 8 || new Set(playerIds).size !== playerIds.length || playerIds.some(id => !id)) {
      throw new RangeError("Expected 1?8 distinct, nonempty player IDs");
    }
    const { map, spawns } = generateMap({ ...mapConfig, playerCount: playerIds.length });
    this.movement = { ...DEFAULT_MOVEMENT_CONFIG, ...movementConfig };
    if (!Number.isFinite(this.movement.speed) || this.movement.speed < 0 || !Number.isFinite(this.movement.timestepSeconds) || this.movement.timestepSeconds <= 0 ||
        !Number.isFinite(this.movement.playerRadius) || this.movement.playerRadius <= 0 || this.movement.playerRadius * 2 >= map.tileSize) {
      throw new RangeError("Invalid movement configuration");
    }
    this.state = { tick: 0, map, players: playerIds.map((id, i) => ({ id, x: (spawns[i].x + 0.5) * map.tileSize, y: (spawns[i].y + 0.5) * map.tileSize })) };
  }
  setInput(playerId: string, input: MovementInput): void {
    if (!this.state.players.some(p => p.id === playerId)) throw new RangeError("Unknown player");
    if ([input.up, input.down, input.left, input.right].some(value => typeof value !== "boolean")) throw new TypeError("Invalid movement input");
    this.inputs.set(playerId, { ...input });
  }
  /** Advance exactly one configured fixed timestep. */
  step(): void {
    this.state.players = this.state.players.map(p => movePlayer(p, this.inputs.get(p.id) ?? IDLE, this.state.map, this.movement));
    this.state.tick++;
  }
  /** Return a detached public copy so consumers cannot mutate the simulation. */
  getSnapshot(): GameSnapshot { return structuredClone(this.state); }
}
