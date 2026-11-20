import { DEFAULT_MOVEMENT_CONFIG, Game } from "@bubble/engine";
import type { GameSnapshot, MovementInput } from "@bubble/shared";

/** Snapshot/input boundary for a future network-backed adapter. */
export interface GameAdapter {
  readonly playerId: string;
  setInput(input: MovementInput): void;
  advance(deltaMs: number): void;
  snapshot(): GameSnapshot;
}

/** Local prototype only: the engine, not Phaser, advances positions. */
export class LocalGameAdapter implements GameAdapter {
  readonly playerId = "local-player";
  private readonly game = new Game([this.playerId]);
  private accumulatedMs = 0;
  private readonly tickMs = DEFAULT_MOVEMENT_CONFIG.timestepSeconds * 1000;
  setInput(input: MovementInput): void { this.game.setInput(this.playerId, input); }
  advance(deltaMs: number): void {
    // Avoid simulating a long tab suspension on return.
    this.accumulatedMs += Math.max(0, Math.min(deltaMs, 250));
    while (this.accumulatedMs >= this.tickMs) {
      this.game.step();
      this.accumulatedMs -= this.tickMs;
    }
  }
  snapshot(): GameSnapshot { return this.game.getSnapshot(); }
}
