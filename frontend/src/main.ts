import Phaser from "phaser";
import type { GameSnapshot, MovementInput, TileType } from "@bubble/shared";
import { LocalGameAdapter, type GameAdapter } from "./adapter";
import { NetworkGameAdapter } from "./network";
import { SessionDebug } from "./session-debug";
import "./style.css";

const teamColors = [0x2c7de1, 0xf2a64a, 0xde5e78, 0x7b65d4, 0x3a9c73, 0xe6c744, 0x8b684e, 0x77899b];
const colors: Record<TileType, number> = { floor: 0xcee9e3, indestructible: 0x34546a, destructible: 0xd59668 };

let adapter: GameAdapter = new LocalGameAdapter();
let network: NetworkGameAdapter | undefined;
if (!import.meta.env.DEV) document.querySelector<HTMLElement>("#dev-controls")!.hidden = true;
const status = document.querySelector<HTMLElement>("#status")!;
const notice = document.querySelector<HTMLElement>("#notice")!;
const sessionField = document.querySelector<HTMLInputElement>("#session")!;
const modeField = document.querySelector<HTMLSelectElement>("#mode")!;
const countField = document.querySelector<HTMLSelectElement>("#players")!;
const botsField = document.querySelector<HTMLSelectElement>("#bots")!;
const difficultyField = document.querySelector<HTMLSelectElement>("#difficulty")!;
const debugToggle = document.querySelector<HTMLInputElement>("#bot-debug")!;
const debugBot = document.querySelector<HTMLSelectElement>("#debug-bot")!;
const debugStatus = document.querySelector<HTMLElement>("#debug-status")!;
interface BotDebug { playerId: string; position: { x: number; y: number } | null; state: string; reason: string; path: { x: number; y: number; time: number }[]; destination: { x: number; y: number } | null; danger: { x: number; y: number; start: number; end: number }[]; tick: number }
const botDebug = new SessionDebug<BotDebug>();
let debugPending = false, debugElapsed = 0;
let debugRequest: AbortController | undefined;
let joinGeneration = 0;
function bindDebug(sessionId: string | null): void {
  debugRequest?.abort(); debugRequest = undefined; debugPending = false;
  botDebug.bind(sessionId); debugStatus.textContent = "";
}
const roleField = document.querySelector<HTMLSelectElement>("#role")!;
const server = import.meta.env.VITE_GAME_SERVER ?? "http://127.0.0.1:3001";
document.querySelector<HTMLButtonElement>("#create-session")!.onclick = async () => {
  try {
    const response = await fetch(`${server}/dev/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: modeField.value, players: Number(countField.value), bots: Number(botsField.value), difficulty: difficultyField.value }) });
    const body = await response.json(); if (!response.ok) throw new Error(body.error);
    sessionField.value = body.sessionId; notice.textContent = network?.connected ? `Session created: ${body.sessionId}. Still viewing ${network.sessionId}; join to switch.` : "Session created. Share its ID, then join.";
  } catch (error) { notice.textContent = `Create failed: ${String(error)}`; }
};
document.querySelector<HTMLButtonElement>("#join-session")!.onclick = async () => {
  const generation = ++joinGeneration, requestedSession = sessionField.value.trim();
  try {
    notice.textContent = "Connecting...";
    const next = await NetworkGameAdapter.connect(server, requestedSession, roleField.value === "spectator" ? "spectator" : "player");
    if (generation !== joinGeneration) { next.close(); return; }
    network?.close(); network = next; adapter = next; bindDebug(next.sessionId); (document.activeElement as HTMLElement | null)?.blur(); notice.textContent = `Joined session ${next.sessionId}.`;
  } catch (error) { if (generation === joinGeneration) notice.textContent = `Join failed: ${String(error)}`; }
};
document.querySelector<HTMLButtonElement>("#local-mode")!.onclick = () => { joinGeneration++; network?.close(); network = undefined; bindDebug(null); adapter = new LocalGameAdapter(); notice.textContent = "Local mode selected."; };

class ArenaScene extends Phaser.Scene {
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private graphics!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Text;
  private labels: Phaser.GameObjects.Text[] = [];
  private labelCount = 0;
  private label(x: number, y: number, text: string): void {
    const label = this.labels[this.labelCount] ?? this.add.text(0, 0, "", { fontSize: "11px", color: "#ffffff", backgroundColor: "#132633" }).setDepth(2);
    this.labels[this.labelCount++] = label; label.setPosition(x, y).setText(text).setVisible(true);
  }

  constructor() { super("arena"); }
  create(): void {
    if (!this.input.keyboard) throw new Error("Keyboard input is unavailable");
    this.keys = this.input.keyboard.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE,ONE,TWO,THREE,FOUR,FIVE") as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.keyboard.addCapture(["UP", "DOWN", "LEFT", "RIGHT"]);
    this.graphics = this.add.graphics();
    this.hud = this.add.text(5, 5, "", { fontSize: "13px", color: "#ffffff", backgroundColor: "#132633" }).setScrollFactor(0).setDepth(1);
    const { map } = adapter.snapshot();
    this.cameras.main.setBounds(0, 0, map.width * map.tileSize, map.height * map.tileSize);
    this.renderSnapshot(adapter.snapshot());
  }
  update(_time: number, delta: number): void {
    debugElapsed += delta;
    if (network && !network.connected && botDebug.ticket()) bindDebug(null);
    if (import.meta.env.DEV && network?.connected && debugToggle.checked && !debugPending && debugElapsed >= 300) {
      debugElapsed = 0; debugPending = true;
      const active = network, ticket = botDebug.ticket()!, request = debugRequest = new AbortController();
      fetch(`${server}/dev/sessions/${encodeURIComponent(ticket.sessionId)}/bot-debug`, { signal: request.signal }).then(r => {
        if (!r.ok) throw new Error("Start server with BOT_DEBUG=1");
        return r.json() as Promise<BotDebug[]>;
      }).then(data => { if (active === network && active.connected && debugToggle.checked && botDebug.accept(ticket, data)) debugStatus.textContent = ""; }).catch(() => { if (!request.signal.aborted && active === network && active.connected && debugToggle.checked && botDebug.accept(ticket, [])) debugStatus.textContent = "Debug unavailable; start server with BOT_DEBUG=1"; }).finally(() => { if (debugRequest === request) { debugRequest = undefined; debugPending = false; } });
    }
    if (!debugToggle.checked || !network?.connected) { debugRequest?.abort(); debugRequest = undefined; debugPending = false; botDebug.clear(); debugStatus.textContent = ""; }
    const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLSelectElement;
    const input: MovementInput = {
      up: !typing && (this.keys.W.isDown || this.keys.UP.isDown),
      down: !typing && (this.keys.S.isDown || this.keys.DOWN.isDown),
      left: !typing && (this.keys.A.isDown || this.keys.LEFT.isDown),
      right: !typing && (this.keys.D.isDown || this.keys.RIGHT.isDown),
    };
    if (!typing && Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) adapter.placeBomb();
    ["ONE", "TWO", "THREE", "FOUR", "FIVE"].forEach((key, index) => { if (!typing && Phaser.Input.Keyboard.JustDown(this.keys[key])) adapter.useItem(index); });
    adapter.setInput(input);
    adapter.advance(delta);
    const snapshot = adapter.snapshot();
    const player = snapshot.players.find(p => p.id === adapter.playerId);
    const remaining = Math.max(0, 600 - snapshot.elapsedSeconds);
    const result = snapshot.result ? (snapshot.result.kind === "draw" ? "Draw" : `Winner: ${snapshot.result.teamId}`) : "";
    status.textContent = `${network ? `${network.status} | Session ${network.sessionId}` : "Local mode"} | ${network && !network.playerId ? "Spectator" : player?.status === "eliminated" ? "Spectator (eliminated)" : `Player ${adapter.playerId} / ${player?.teamId ?? ""}`} | ${Math.floor(remaining / 60)}:${String(Math.floor(remaining % 60)).padStart(2, "0")} ${player ? `| Speed: ${player.slowSeconds > 0 ? 50 : 100 + player.boots * 10}% (boots ${player.boots}) ${player.slowSeconds > 0 ? `| Slowed: ${player.slowSeconds.toFixed(1)}s` : ""}` : ""} ${result}`;
    this.renderSnapshot(snapshot);
  }
  private renderSnapshot(snapshot: GameSnapshot): void {
    const { map } = snapshot;
    this.graphics.clear();
    this.labels.forEach(label => label.setVisible(false)); this.labelCount = 0;
    for (const row of map.tiles) for (const tile of row) {
      this.graphics.fillStyle(colors[tile.type]);
      this.graphics.fillRect(tile.x * map.tileSize, tile.y * map.tileSize, map.tileSize - 1, map.tileSize - 1);
    }
    const debug = botDebug.data[Number(debugBot.value)];
    if (debugToggle.checked && debug) {
      debugStatus.textContent = `${debug.state}: ${debug.reason}${debug.destination ? ` → (${debug.destination.x}, ${debug.destination.y})` : ""}`;
      for (const danger of debug.danger) {
        if (danger.end <= 0 || danger.start > 5) continue;
        this.graphics.fillStyle(0xff3b32, 0.27);
        this.graphics.fillRect(danger.x * map.tileSize + 2, danger.y * map.tileSize + 2, map.tileSize - 4, map.tileSize - 4);
        this.label(danger.x * map.tileSize + 3, danger.y * map.tileSize + 3, `${Math.max(0, danger.start).toFixed(1)}s`);
      }
      this.graphics.lineStyle(3, 0xffee4f, 0.9);
      if (debug.position) {
        this.graphics.strokeCircle(debug.position.x, debug.position.y, 14);
        let prev = debug.position;
        for (const point of debug.path) { const next = { x: (point.x + 0.5) * map.tileSize, y: (point.y + 0.5) * map.tileSize }; this.graphics.lineBetween(prev.x, prev.y, next.x, next.y); prev = next; }
        if (debug.destination) this.graphics.strokeRect(debug.destination.x * map.tileSize + 5, debug.destination.y * map.tileSize + 5, map.tileSize - 10, map.tileSize - 10);
      }
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
    const local = snapshot.players.find(p => p.id === adapter.playerId);
    this.hud.setText(local ? local.inventory.map((slot, i) => `${i + 1}: ${slot ? `${slot.type} x${slot.charges}` : "-"}`).join("  ") : "");
    for (const bomb of snapshot.bombs) {
      this.graphics.fillStyle(0x27408b);
      this.graphics.fillCircle((bomb.x + 0.5) * map.tileSize, (bomb.y + 0.5) * map.tileSize, 11);
      this.label((bomb.x + 0.5) * map.tileSize - 4, (bomb.y + 0.5) * map.tileSize - 7, String(Math.max(1, Math.ceil(bomb.remainingSeconds))));
    }
    const teams = [...new Set(snapshot.players.map(player => player.teamId))].sort();
    for (const player of snapshot.players) {
      if (player.status === "eliminated") continue;
      this.graphics.fillStyle(player.status === "trapped" ? 0x84e8ff : teamColors[teams.indexOf(player.teamId) % teamColors.length]);
      this.graphics.fillCircle(player.x, player.y, 10);
      this.graphics.lineStyle(2, player.status === "trapped" ? teamColors[teams.indexOf(player.teamId) % teamColors.length] : 0xffffff);
      this.graphics.strokeCircle(player.x, player.y, 10);
      const number = snapshot.players.findIndex(p => p.id === player.id) + 1;
      this.label(player.x - 7, player.y - 23, player.status === "trapped" ? `${number}: ${Math.ceil(player.trappedSeconds)}s` : String(number));
    }
  }
}

new Phaser.Game({
  type: Phaser.AUTO, parent: "game", width: 480, height: 416, backgroundColor: "#132633",
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, scene: ArenaScene,
});
