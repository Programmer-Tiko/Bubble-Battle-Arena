import Phaser from "phaser";
import type { GameSnapshot, MovementInput, TileType } from "@bubble/shared";
import { LocalGameAdapter, type GameAdapter } from "./adapter";
import "./style.css";

const colors: Record<TileType, number> = { floor: 0xcee9e3, indestructible: 0x34546a, destructible: 0xd59668 };

class ArenaScene extends Phaser.Scene {
  private readonly adapter: GameAdapter = new LocalGameAdapter();
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private graphics!: Phaser.GameObjects.Graphics;

  constructor() { super("arena"); }
  create(): void {
    if (!this.input.keyboard) throw new Error("Keyboard input is unavailable");
    this.keys = this.input.keyboard.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT") as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.keyboard.addCapture(["UP", "DOWN", "LEFT", "RIGHT"]);
    this.graphics = this.add.graphics();
    const { map } = this.adapter.snapshot();
    this.cameras.main.setBounds(0, 0, map.width * map.tileSize, map.height * map.tileSize);
    this.renderSnapshot(this.adapter.snapshot());
  }
  update(_time: number, delta: number): void {
    const input: MovementInput = {
      up: this.keys.W.isDown || this.keys.UP.isDown,
      down: this.keys.S.isDown || this.keys.DOWN.isDown,
      left: this.keys.A.isDown || this.keys.LEFT.isDown,
      right: this.keys.D.isDown || this.keys.RIGHT.isDown,
    };
    this.adapter.setInput(input);
    this.adapter.advance(delta);
    this.renderSnapshot(this.adapter.snapshot());
  }
  private renderSnapshot(snapshot: GameSnapshot): void {
    const { map } = snapshot;
    this.graphics.clear();
    for (const row of map.tiles) for (const tile of row) {
      this.graphics.fillStyle(colors[tile.type]);
      this.graphics.fillRect(tile.x * map.tileSize, tile.y * map.tileSize, map.tileSize - 1, map.tileSize - 1);
    }
    for (const player of snapshot.players) {
      this.graphics.fillStyle(player.id === this.adapter.playerId ? 0x2c7de1 : 0xf2a64a);
      this.graphics.fillCircle(player.x, player.y, 10);
      this.graphics.lineStyle(2, 0xffffff);
      this.graphics.strokeCircle(player.x, player.y, 10);
    }
  }
}

new Phaser.Game({
  type: Phaser.AUTO, parent: "game", width: 480, height: 416, backgroundColor: "#132633",
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, scene: ArenaScene,
});
