import Phaser from "phaser";
import type { GameSnapshot, PlayerState } from "@bubble/shared";
import { createArt } from "./art";
import { supplyMarkers, visibleBombs, visibleItems } from "./visual-model";

const colors = [0x6394d1, 0xf4ad65, 0xe983a1, 0xa18bd4, 0x60b7a2, 0xdec36c, 0xbc8d79, 0x91a6bc];
type PoolName = "items" | "bombs" | "splash" | "markers" | "players" | "ghosts" | "balloon";
interface Trace { x: number; y: number; movedAt: number; status: PlayerState["status"]; palette: number }
interface Burst { x: number; y: number; started: number; kind: "rescue" | "trapped" | "pickup" | "eliminated"; palette: number }

/** Retains and reuses Phaser images; textures are illustrated once in createArt. */
export class ArenaRenderer {
  private tiles: Phaser.GameObjects.Image[] = [];
  private tileKeys: string[] = [];
  private pools: Record<PoolName, Phaser.GameObjects.Image[]> = { items: [], bombs: [], splash: [], markers: [], players: [], ghosts: [], balloon: [] };
  private used: Record<PoolName, number> = { items: 0, bombs: 0, splash: 0, markers: 0, players: 0, ghosts: 0, balloon: 0 };
  private rings: Phaser.GameObjects.Graphics;
  private effects: Phaser.GameObjects.Graphics;
  private traces = new Map<string, Trace>();
  private lastItems = new Map<number, { x: number; y: number; kind: string }>();
  private lastTick = -1;
  private roster = "";
  private bursts: Burst[] = [];
  constructor(private scene: Phaser.Scene) {
    createArt(scene); this.rings = scene.add.graphics().setDepth(7); this.effects = scene.add.graphics().setDepth(20);
  }
  private image(pool: PoolName, key: string, x: number, y: number, size: number, depth: number): Phaser.GameObjects.Image {
    const i = this.used[pool]++, image = this.pools[pool][i] ?? this.scene.add.image(0, 0, key).setOrigin(.5);
    this.pools[pool][i] = image;
    image.setVisible(true).setTexture(key).setPosition(x, y).setDisplaySize(size, size).setAlpha(1).setRotation(0).setFlipX(false).setDepth(depth);
    return image;
  }
  private resetPools(): void {
    for (const key of Object.keys(this.pools) as PoolName[]) this.used[key] = 0;
    this.rings.clear(); this.effects.clear();
  }
  private finishPools(): void {
    for (const key of Object.keys(this.pools) as PoolName[]) for (let i = this.used[key]; i < this.pools[key].length; i++) this.pools[key][i].setVisible(false);
  }
  private trackEvents(snapshot: GameSnapshot, now: number): void {
    const roster = snapshot.players.map(p => p.id).join("|");
    if (snapshot.tick < this.lastTick || roster !== this.roster) { this.traces.clear(); this.lastItems.clear(); this.bursts = []; this.lastTick = -1; this.roster = roster; }
    if (snapshot.tick === this.lastTick) return;
    if (this.lastTick >= 0) {
      for (const [id, item] of this.lastItems) if (!snapshot.items.some(i => i.id === id) && item.kind === "pickup") {
        const p = snapshot.players.find(p => p.status === "alive" && Math.floor(p.x / snapshot.map.tileSize) === item.x && Math.floor(p.y / snapshot.map.tileSize) === item.y);
        if (p) this.bursts.push({ x: p.x, y: p.y, started: now, kind: "pickup", palette: 0 });
      }
    }
    this.lastItems = new Map(snapshot.items.map(item => [item.id, { x: item.x, y: item.y, kind: item.kind }]));
    snapshot.players.forEach((player, i) => {
      const previous = this.traces.get(player.id);
      if (previous && previous.status !== player.status) {
        const kind = player.status === "trapped" ? "trapped" : player.status === "eliminated" ? "eliminated" : "rescue";
        this.bursts.push({ x: player.x, y: player.y, started: now, kind, palette: i % 8 });
      }
      const moved = previous && Math.hypot(player.x - previous.x, player.y - previous.y) > .05;
      this.traces.set(player.id, { x: player.x, y: player.y, status: player.status, palette: i % 8, movedAt: moved ? now : previous?.movedAt ?? -1000 });
    });
    this.lastTick = snapshot.tick;
  }
  render(snapshot: GameSnapshot, now: number): void {
    const { map } = snapshot, size = map.tileSize;
    this.trackEvents(snapshot, now); this.resetPools();
    let index = 0;
    for (const row of map.tiles) for (const tile of row) {
      const key = tile.type === "floor" ? `floor-${(tile.x * 7 + tile.y * 11) % 3}` : tile.type === "destructible" ? "crate" : "wall";
      const image = this.tiles[index] ?? this.scene.add.image(0, 0, key).setOrigin(.5).setDepth(0);
      this.tiles[index] = image;
      if (this.tileKeys[index] !== key) { image.setTexture(key); this.tileKeys[index] = key; }
      image.setVisible(true).setPosition((tile.x + .5) * size, (tile.y + .5) * size).setDisplaySize(size, size); index++;
    }
    for (let i = index; i < this.tiles.length; i++) this.tiles[i].setVisible(false);
    const markers = supplyMarkers(snapshot);
    for (const marker of markers) {
      const pulse = 1 + Math.sin(now / 240 + marker.id) * .06;
      this.image("markers", "landing", marker.x, marker.y, size * 1.18 * pulse, 2).setAlpha(.95);
    }
    for (const item of visibleItems(snapshot)) {
      const sprite = this.image("items", `item-${item.type}`, item.position.x, item.position.y, size * .84, 5);
      if (item.kind !== "pickup") {
        sprite.setAlpha(item.kind === "trap" && !item.active ? .62 : 1);
        this.rings.lineStyle(1.6, 0x73536b, .9); this.rings.strokeCircle(item.position.x, item.position.y, size * .36);
      }
    }
    for (const explosion of snapshot.explosions) {
      const frame = Math.floor(now / 90 + explosion.x + explosion.y) % 3;
      this.image("splash", `splash-${frame}`, (explosion.x + .5) * size, (explosion.y + .5) * size, size * 1.05, 4);
    }
    for (const bomb of visibleBombs(snapshot)) {
      const pulse = 1 + .035 * Math.sin(now / 350 + bomb.id * 1.7);
      this.image("bombs", "bomb", bomb.x, bomb.y, size * .87 * pulse, 6);
    }
    if (snapshot.supplyPreview || snapshot.balloon) {
      const preview = snapshot.supplyPreview;
      const progress = preview
        ? Phaser.Math.Clamp((snapshot.elapsedSeconds - preview.announcedAt) / Math.max(.001, preview.scheduledAt - preview.announcedAt), 0, 1)
        : Phaser.Math.Clamp((snapshot.elapsedSeconds - snapshot.balloon!.startedAt) / snapshot.balloon!.durationSeconds, 0, 1);
      const destination = preview && markers.length ? markers.reduce((sum, marker) => sum + marker.x, 0) / markers.length : map.width * size + size;
      const x = size * .7 + progress * (destination - size * .7);
      this.rings.lineStyle(1, 0xffd68c, .3);
      for (const marker of markers) this.rings.lineBetween(x, size * 1.35, marker.x, marker.y);
      this.image("balloon", "balloon", x, size * 1.15, size * 1.45, 18).setDisplaySize(size * 1.45, size * 1.8);
    }
    const teams = [...new Set(snapshot.players.map(p => p.teamId))].sort();
    snapshot.players.forEach((player, i) => {
      if (player.status === "eliminated") return;
      const trace = this.traces.get(player.id), moving = !!player.slide || (!!trace && now - trace.movedAt < 180);
      const frame = moving ? 1 + Math.floor(now / 150) % 2 : 0;
      const back = player.direction.up && !player.direction.down;
      const sprite = this.image("players", `chibi-${i % 8}-${back ? "back" : "front"}-${frame}`, player.x, player.y, size, 10);
      sprite.setDisplaySize(size * 1.02, size * 1.15).setOrigin(.5, .85).setFlipX(player.direction.left && !player.direction.right);
      if (player.slide) sprite.setRotation(Math.sin(now / 120) * .12);
      else if (!moving && player.status === "alive") sprite.setScale(sprite.scaleX, sprite.scaleY * (1 + .015 * Math.sin(now / 450 + i)));
      this.rings.lineStyle(2.3, colors[teams.indexOf(player.teamId) % colors.length], .95);
      this.rings.strokeEllipse(player.x, player.y + size * .18, size * .7, size * .27);
      if (player.status === "trapped") {
        this.effects.fillStyle(0xa9efff, .32); this.effects.fillEllipse(player.x, player.y - size * .18, size * .9, size * 1.15);
        this.effects.lineStyle(1.5, 0xe6ffff, .9); this.effects.strokeEllipse(player.x, player.y - size * .18, size * .9, size * 1.15);
        this.effects.fillStyle(0xffffff, .85); this.effects.fillEllipse(player.x - size * .2, player.y - size * .48, size * .12, size * .07);
      }
    });
    this.bursts = this.bursts.filter(event => now - event.started < 650);
    for (const event of this.bursts) {
      const progress = (now - event.started) / 650, alpha = 1 - progress;
      if (event.kind === "eliminated") this.image("ghosts", `chibi-${event.palette}-front-0`, event.x, event.y - progress * size, size, 15).setDisplaySize(size, size * 1.15).setOrigin(.5,.85).setAlpha(alpha * .7);
      this.effects.lineStyle(2, event.kind === "trapped" ? 0xa8ebff : event.kind === "eliminated" ? 0xf0d0e8 : 0xffdf83, alpha);
      this.effects.strokeCircle(event.x, event.y, 5 + progress * 20);
      this.effects.fillStyle(0xfff6cf, alpha);
      for(let i=0;i<5;i++){const angle=i*Math.PI*2/5 + progress;this.effects.fillCircle(event.x+Math.cos(angle)*progress*20,event.y+Math.sin(angle)*progress*17,1.5);}
    }
    this.finishPools();
  }
}
