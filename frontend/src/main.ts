import Phaser from "phaser";
import type { GameSnapshot, MovementInput, TileType } from "@bubble/shared";
import { LocalGameAdapter, type GameAdapter } from "./adapter";
import "./style.css";

const teamColors = [0x2c7de1, 0xf2a64a, 0xde5e78, 0x7b65d4, 0x3a9c73, 0xe6c744, 0x8b684e, 0x77899b];
const colors: Record<TileType, number> = { floor: 0xcee9e3, indestructible: 0x34546a, destructible: 0xd59668 };

class ArenaScene extends Phaser.Scene {
  private readonly adapter: GameAdapter = new LocalGameAdapter();
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private graphics!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Text;

  constructor() { super("arena"); }
  create(): void {
    if (!this.input.keyboard) throw new Error("Keyboard input is unavailable");
    this.keys = this.input.keyboard.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE,ONE,TWO,THREE,FOUR,FIVE") as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.keyboard.addCapture(["UP", "DOWN", "LEFT", "RIGHT"]);
    this.graphics = this.add.graphics();
    this.hud = this.add.text(5, 5, "", { fontSize: "13px", color: "#ffffff", backgroundColor: "#132633" }).setScrollFactor(0).setDepth(1);
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
    if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) this.adapter.placeBomb();
    ["ONE", "TWO", "THREE", "FOUR", "FIVE"].forEach((key, index) => { if (Phaser.Input.Keyboard.JustDown(this.keys[key])) this.adapter.useItem(index); });
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
    for (const explosion of snapshot.explosions) {
      this.graphics.fillStyle(0x88e9ff, 0.8);
      this.graphics.fillRect(explosion.x * map.tileSize + 3, explosion.y * map.tileSize + 3, map.tileSize - 6, map.tileSize - 6);
    }
    const itemColors = { boots: 0x52bd65, capacity: 0x7266df, range: 0xf39843, banana: 0xffdf41, slowdown: 0xe25f7b };
    for (const item of snapshot.items) {
      if (item.supplyDroppedAt !== undefined) {
        const age = snapshot.elapsedSeconds - item.supplyDroppedAt;
        if (age >= 0 && age < 3) {
          const x = (item.x + 0.5) * map.tileSize, y = (item.y + 0.5) * map.tileSize;
          this.graphics.lineStyle(2, 0xffffff, 1 - age / 3);
          this.graphics.strokeCircle(x, y, 12 + age * 3);
          if (age < 1) { this.graphics.fillStyle(0xffffff, 0.9); this.graphics.fillCircle(x, y - (1 - age) * 25, 3); }
        }
      }
      this.graphics.fillStyle(itemColors[item.type], item.kind === "trap" && !item.active ? 0.5 : 1);
      this.graphics.fillRect(item.x * map.tileSize + 9, item.y * map.tileSize + 9, 14, 14);
      if (item.kind !== "pickup") { this.graphics.lineStyle(2, 0x222222); this.graphics.strokeRect(item.x * map.tileSize + 9, item.y * map.tileSize + 9, 14, 14); }
    }
    if (snapshot.balloon) {
      const progress = Math.max(0, Math.min(1, (snapshot.elapsedSeconds - snapshot.balloon.startedAt) / snapshot.balloon.durationSeconds));
      const x = -20 + progress * (map.width * map.tileSize + 40), y = map.tileSize * 1.5;
      this.graphics.fillStyle(0xe75e58); this.graphics.fillEllipse(x, y, 30, 38);
      this.graphics.fillStyle(0xffd06c); this.graphics.fillEllipse(x, y, 12, 37);
      this.graphics.lineStyle(2, 0x66452b); this.graphics.lineBetween(x - 9, y + 15, x - 5, y + 25); this.graphics.lineBetween(x + 9, y + 15, x + 5, y + 25);
      this.graphics.fillStyle(0x8b5c38); this.graphics.fillRect(x - 7, y + 23, 14, 8);
    }
    const local = snapshot.players.find(p => p.id === this.adapter.playerId);
    this.hud.setText(local ? local.inventory.map((slot, i) => `${i + 1}: ${slot ? `${slot.type} x${slot.charges}` : "-"}`).join("  ") : "");
    for (const bomb of snapshot.bombs) {
      this.graphics.fillStyle(0x27408b);
      this.graphics.fillCircle((bomb.x + 0.5) * map.tileSize, (bomb.y + 0.5) * map.tileSize, 11);
    }
    const teams = [...new Set(snapshot.players.map(player => player.teamId))].sort();
    for (const player of snapshot.players) {
      if (player.status === "eliminated") continue;
      this.graphics.fillStyle(player.status === "trapped" ? 0x84e8ff : teamColors[teams.indexOf(player.teamId) % teamColors.length]);
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
