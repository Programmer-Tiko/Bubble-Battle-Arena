import Phaser from "phaser";
import type { GameSnapshot, MovementInput } from "@bubble/shared";
import { LocalGameAdapter, type GameAdapter } from "./adapter";
import { NetworkGameAdapter } from "./network";
import { SessionDebug } from "./session-debug";
import { ArenaRenderer } from "./arena-renderer";
import { characterStats } from "./visual-model";
import { cameraCenter, minimapPoint } from "./viewport";
import { drawStylePreview } from "./style-preview";
import "./style.css";

let adapter: GameAdapter = new LocalGameAdapter();
let network: NetworkGameAdapter | undefined;
if (!import.meta.env.DEV) document.querySelector<HTMLElement>("#dev-controls")!.hidden = true;
const status = document.querySelector<HTMLElement>("#status")!;
const notice = document.querySelector<HTMLElement>("#notice")!;
const timer = document.querySelector<HTMLElement>("#timer")!;
const badge = document.querySelector<HTMLElement>("#player-badge")!;
const statsPanel = document.querySelector<HTMLElement>("#character-stats")!;
const inventory = document.querySelector<HTMLElement>("#inventory")!;
const resultPanel = document.querySelector<HTMLElement>("#match-result")!;
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
  private arena!: ArenaRenderer;
  private inventorySignature = "";
  private iconUrls: Record<string, string> = {};
  private labels: Phaser.GameObjects.Text[] = [];
  private labelCount = 0;
  private mapCache = "";
  private terrain = document.createElement("canvas");
  private cameraIdentity = "";
  private spectatorCenter = { x: 240, y: 208 };
  private label(x: number, y: number, text: string): void {
    const label = this.labels[this.labelCount] ?? this.add.text(0, 0, "", { fontSize: "11px", color: "#ffffff", backgroundColor: "#132633" }).setDepth(30);
    this.labels[this.labelCount++] = label; label.setPosition(x, y).setText(text).setVisible(true);
  }

  constructor() { super("arena"); }
  create(): void {
    if (!this.input.keyboard) throw new Error("Keyboard input is unavailable");
    this.keys = this.input.keyboard.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE,ONE,TWO,THREE,FOUR,FIVE") as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.keyboard.addCapture(["UP", "DOWN", "LEFT", "RIGHT"]);
    this.graphics = this.add.graphics().setDepth(3);
    this.arena = new ArenaRenderer(this);
    const stylePreview = document.querySelector<HTMLSelectElement>("#style-preview")!;
    const previewCanvas = document.querySelector<HTMLCanvasElement>("#style-preview-canvas")!;
    const showStyle = () => {
      const source = this.textures.get(`chibi-${stylePreview.selectedIndex}-front-0`).getSourceImage();
      if (source instanceof HTMLCanvasElement || source instanceof HTMLImageElement) drawStylePreview(previewCanvas, source, stylePreview.selectedIndex);
    };
    stylePreview.onchange = showStyle; showStyle();
    for (const type of ["banana", "slowdown"]) {
      const source = this.textures.get(`item-${type}`).getSourceImage();
      if (source instanceof HTMLCanvasElement) this.iconUrls[type] = source.toDataURL();
    }
    const { map } = adapter.snapshot();
    this.cameras.main.setZoom(2).setBounds(0, 0, map.width * map.tileSize, map.height * map.tileSize).centerOn(map.width * map.tileSize / 2, map.height * map.tileSize / 2);
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
    const identity = network?.sessionId ?? "local";
    if (identity !== this.cameraIdentity) {
      this.cameraIdentity = identity; this.mapCache = "";
      this.spectatorCenter = { x: snapshot.map.width * snapshot.map.tileSize / 2, y: snapshot.map.height * snapshot.map.tileSize / 2 };
      this.cameras.main.setBounds(0, 0, snapshot.map.width * snapshot.map.tileSize, snapshot.map.height * snapshot.map.tileSize);
    }
    if (!player || player.status === "eliminated") {
      const dx = Number(input.right) - Number(input.left), dy = Number(input.down) - Number(input.up);
      this.spectatorCenter = cameraCenter(snapshot.map, this.spectatorCenter.x + dx * delta * .25, this.spectatorCenter.y + dy * delta * .25);
    } else this.spectatorCenter = cameraCenter(snapshot.map, player.x, player.y);
    this.cameras.main.centerOn(this.spectatorCenter.x, this.spectatorCenter.y);
    this.renderMinimap(snapshot, player);
    const remaining = Math.max(0, 600 - snapshot.elapsedSeconds);
    const winningTeam = snapshot.result?.kind === "winner" ? snapshot.result.teamId : undefined;
    const winners = winningTeam ? snapshot.players.filter(p => p.teamId === winningTeam) : [];
    const result = snapshot.result ? (snapshot.result.kind === "draw" ? "It's a draw!" : winners.length === 1 ? `Player ${snapshot.players.indexOf(winners[0]) + 1} wins!` : `${snapshot.result.teamId} wins!`) : "";
    timer.textContent = `${Math.floor(remaining / 60)}:${String(Math.floor(remaining % 60)).padStart(2, "0")}`;
    const number = snapshot.players.findIndex(p => p.id === adapter.playerId) + 1;
    badge.textContent = network && !network.playerId ? "SPECTATOR" : player?.status === "eliminated" ? "ELIMINATED · SPECTATING" : player ? `PLAYER ${number} · ${player.status.toUpperCase()}` : "SPECTATOR";
    status.textContent = network ? `${network.status} | Session ${network.sessionId}` : "Local mode";
    resultPanel.hidden = !snapshot.result; resultPanel.textContent = result;
    this.updateLoadout(player);
    this.renderSnapshot(snapshot);
  }
  private renderMinimap(snapshot: GameSnapshot, player: GameSnapshot["players"][number] | undefined): void {
    const canvas = document.querySelector<HTMLCanvasElement>("#minimap")!, context = canvas.getContext("2d")!;
    const { map } = snapshot, signature = `${map.width}x${map.height}:` + map.tiles.map(row => row.map(tile => tile.type[0]).join("")).join("");
    if (signature !== this.mapCache) {
      this.mapCache = signature; this.terrain.width = canvas.width; this.terrain.height = canvas.height;
      const terrain = this.terrain.getContext("2d")!;
      for (const row of map.tiles) for (const tile of row) {
        terrain.fillStyle = tile.type === "floor" ? "#dcece0" : tile.type === "destructible" ? "#b77a52" : "#526d77";
        terrain.fillRect(tile.x * canvas.width / map.width, tile.y * canvas.height / map.height, Math.ceil(canvas.width / map.width), Math.ceil(canvas.height / map.height));
      }
    }
    context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(this.terrain, 0, 0);
    if (player && player.status !== "eliminated") {
      const p = minimapPoint(map, player.x, player.y, canvas.width, canvas.height);
      context.fillStyle = "#dd5268"; context.strokeStyle = "#fff"; context.lineWidth = 2;
      context.beginPath(); context.arc(p.x, p.y, 4, 0, Math.PI * 2); context.fill(); context.stroke();
    }
  }
  private updateLoadout(player: GameSnapshot["players"][number] | undefined): void {
    if (!player) {
      if (this.inventorySignature !== "spectator") { inventory.replaceChildren(); statsPanel.textContent = "Spectator view"; this.inventorySignature = "spectator"; }
      return;
    }
    const stats = characterStats(player);
    const signature = JSON.stringify(stats);
    if (signature === this.inventorySignature) return;
    this.inventorySignature = signature;
    statsPanel.replaceChildren();
    for (const [label, value] of [["Speed", `${stats.speedPercent}%`], ["Balloons", `×${stats.capacity}`], ["Blast", `×${stats.range}`]]) {
      const item = document.createElement("span"), amount = document.createElement("b"); item.textContent = label; amount.textContent = value; item.append(amount); statsPanel.append(item);
    }
    inventory.replaceChildren();
    stats.inventory.forEach((slot, index) => {
      const box = document.createElement("div"), key = document.createElement("span");
      box.className = `slot${slot ? "" : " empty"}`; box.setAttribute("aria-label", `Slot ${index + 1}: ${slot ? `${slot.type}, ${slot.charges} charges` : "empty"}`);
      key.className = "slot-key"; key.textContent = String(index + 1); box.append(key);
      if (slot) { const image = document.createElement("img"), count = document.createElement("span"); image.src = this.iconUrls[slot.type]; image.alt = ""; count.className = "slot-charge"; count.textContent = `×${slot.charges}`; box.append(image, count); }
      inventory.append(box);
    });
  }
  private renderSnapshot(snapshot: GameSnapshot): void {
    const { map } = snapshot;
    this.arena.render(snapshot, this.time.now);
    this.graphics.clear(); this.labels.forEach(label => label.setVisible(false)); this.labelCount = 0;
    const debug = botDebug.data[Number(debugBot.value)];
    if (debugToggle.checked && debug) {
      debugStatus.textContent = `${debug.state}: ${debug.reason}${debug.destination ? ` → (${debug.destination.x}, ${debug.destination.y})` : ""}`;
      for (const danger of debug.danger) {
        if (danger.end <= 0 || danger.start > 5) continue;
        this.graphics.fillStyle(0xff3b32, 0.27);
        this.graphics.fillRect(danger.x * map.tileSize + 2, danger.y * map.tileSize + 2, map.tileSize - 4, map.tileSize - 4);
        this.label(danger.x * map.tileSize + 3, danger.y * map.tileSize + 3, `${Math.max(0, danger.start).toFixed(1)}s`);
      }
      this.graphics.lineStyle(3, 0xffc92e, 0.95);
      if (debug.position) {
        this.graphics.strokeCircle(debug.position.x, debug.position.y, 14);
        let prev = debug.position;
        for (const point of debug.path) { const next = { x: (point.x + 0.5) * map.tileSize, y: (point.y + 0.5) * map.tileSize }; this.graphics.lineBetween(prev.x, prev.y, next.x, next.y); prev = next; }
        if (debug.destination) this.graphics.strokeRect(debug.destination.x * map.tileSize + 5, debug.destination.y * map.tileSize + 5, map.tileSize - 10, map.tileSize - 10);
      }
    }
    snapshot.players.forEach((player, index) => {
      if (player.status === "eliminated") return;
      this.label(player.x - 7, player.y - map.tileSize * 1.43, String(index + 1));
    });
  }
}

new Phaser.Game({
  type: Phaser.AUTO, parent: "game", width: 960, height: 832, backgroundColor: "#132633",
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, scene: ArenaScene,
});
