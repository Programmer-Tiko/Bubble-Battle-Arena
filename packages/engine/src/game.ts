import type { BombState, GameSnapshot, GameState, MovementInput, ItemType, TrapType, GroundItem } from "@bubble/shared";
import { DEFAULT_MAP_CONFIG, generateMap, type MapConfig } from "./map.js";
import { seededRandom } from "./random.js";
import { DEFAULT_MOVEMENT_CONFIG, movePlayer, type MovementConfig } from "./movement.js";
import { visitBlast } from "./blast.js";

const IDLE: MovementInput = { up: false, down: false, left: false, right: false };
/** Provisional values until the team agrees on limits and visual duration. */
export interface MatchConfig { mode: "ffa" | "team"; teams?: Record<string, string>; timeLimitSeconds?: number }
export interface ItemConfig { initialOtherPerType: number; chargesPerHazard: number }
export const DEFAULT_ITEM_CONFIG: ItemConfig = { initialOtherPerType: 2, chargesPerHazard: 1 };
export interface BombConfig { fuseSeconds: number; explosionSeconds: number; initialCapacity: number; maxCapacity: number; maxRange: number; stopAtDestructible: boolean; repeatedHit: "ignore" | "reset" | "eliminate" }
export const DEFAULT_BOMB_CONFIG: BombConfig = { fuseSeconds: 3, explosionSeconds: 0.3, initialCapacity: 1, maxCapacity: 8, maxRange: 8, stopAtDestructible: true, repeatedHit: "ignore" };

/** One headless match. Player-player collision is intentionally unresolved. */
export class Game {
  private state: GameState;
  private inputs = new Map<string, MovementInput>();
  private movement: MovementConfig;
  private bombConfig: BombConfig;
  private itemConfig: ItemConfig;
  private upgrades = new Map<string, { capacity: number; range: number }>();
  private nextBombId = 0;
  private nextItemId = 0;
  private supplyRandom: () => number;
  private nextSupplyIndex = 0;
  private hitExplosions = new Map<number, Set<string>>();
  private match?: MatchConfig;
  constructor(playerIds: string[], mapConfig: Partial<MapConfig> = {}, movementConfig: Partial<MovementConfig> = {}, bombConfig: Partial<BombConfig> = {}, match?: MatchConfig, itemConfig: Partial<ItemConfig> = {}) {
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
    this.supplyRandom = seededRandom((mapConfig.seed ?? DEFAULT_MAP_CONFIG.seed) ^ 0x5a17b411);
    const { map, spawns } = generateMap({ ...mapConfig, playerCount: playerIds.length });
    this.movement = { ...DEFAULT_MOVEMENT_CONFIG, ...movementConfig };
    if (!Number.isFinite(this.movement.speed) || this.movement.speed < 0 || !Number.isFinite(this.movement.timestepSeconds) || this.movement.timestepSeconds <= 0 ||
        !Number.isFinite(this.movement.playerRadius) || this.movement.playerRadius <= 0 || this.movement.playerRadius * 2 >= map.tileSize) {
      throw new RangeError("Invalid movement configuration");
    }
    this.itemConfig = { ...DEFAULT_ITEM_CONFIG, ...itemConfig };
    if (!Number.isInteger(this.itemConfig.initialOtherPerType) || this.itemConfig.initialOtherPerType < 0 || !Number.isInteger(this.itemConfig.chargesPerHazard) || this.itemConfig.chargesPerHazard < 1) throw new RangeError("Invalid item configuration");
    this.bombConfig = { ...DEFAULT_BOMB_CONFIG, ...bombConfig };
    const b = this.bombConfig;
    if (!Number.isFinite(b.fuseSeconds) || b.fuseSeconds <= 0 || !Number.isFinite(b.explosionSeconds) || b.explosionSeconds <= 0 ||
        !Number.isInteger(b.initialCapacity) || b.initialCapacity < 1 || !Number.isInteger(b.maxCapacity) || b.maxCapacity < b.initialCapacity ||
        !Number.isInteger(b.maxRange) || b.maxRange < 1 || typeof b.stopAtDestructible !== "boolean" || !["ignore", "reset", "eliminate"].includes(b.repeatedHit)) throw new RangeError("Invalid bomb configuration");
    for (const id of playerIds) this.upgrades.set(id, { capacity: b.initialCapacity, range: 1 });
    this.state = { tick: 0, elapsedSeconds: 0, result: null, map, bombs: [], explosions: [], players: playerIds.map((id, i) => ({ id, teamId: match?.mode === "team" ? match.teams![id] : id, x: (spawns[i].x + 0.5) * map.tileSize, y: (spawns[i].y + 0.5) * map.tileSize, status: "alive", trappedSeconds: 0, boots: 0, capacityUpgrades: 0, rangeUpgrades: 0, inventory: Array(5).fill(null), slowSeconds: 0, slide: null, direction: { ...IDLE } })), items: [], balloon: null };
    // Provisional initial distribution: four boots and a configurable supply of other items.
    const available = map.tiles.flat().filter(t => t.type === "floor" && !spawns.some(p => Math.abs(p.x - t.x) + Math.abs(p.y - t.y) <= 1));
    for (const tile of map.tiles.flat()) if (tile.type === "floor" && !available.includes(tile)) available.push(tile);
    const types: ItemType[] = ["boots", "boots", "boots", "boots"];
    for (const type of ["capacity", "range", "banana", "slowdown"] as const) for (let i = 0; i < this.itemConfig.initialOtherPerType; i++) types.push(type);
    for (const type of types) { const tile = available.shift(); if (tile) this.addItem(type, tile.x, tile.y, "pickup"); }
  }
  setInput(playerId: string, input: MovementInput): void {
    if (!this.state.players.some(p => p.id === playerId)) throw new RangeError("Unknown player");
    if ([input.up, input.down, input.left, input.right].some(value => typeof value !== "boolean")) throw new TypeError("Invalid movement input");
    this.inputs.set(playerId, { ...input });
  }
  private addItem(type: ItemType, x: number, y: number, kind: GroundItem["kind"], ownerId?: string): void {
    this.state.items.push({ id: this.nextItemId++, type, x, y, kind, ownerId, active: kind !== "trap" });
  }
  /** A bounded selection from currently free floor tiles. Fewer than four means no drop. */
  private spawnSupply(startedAt: number): void {
    this.state.balloon = { startedAt, durationSeconds: 20 };
    const size = this.state.map.tileSize;
    const tiles = this.state.map.tiles.flat().filter(tile => tile.type === "floor" &&
      !this.state.items.some(item => item.x === tile.x && item.y === tile.y) &&
      !this.state.bombs.some(bomb => bomb.x === tile.x && bomb.y === tile.y) &&
      !this.state.players.some(player => player.status !== "eliminated" && Math.floor(player.x / size) === tile.x && Math.floor(player.y / size) === tile.y));
    if (tiles.length < 4) return;
    const count = Math.min(4 + Math.floor(this.supplyRandom() * 3), tiles.length);
    const types: ItemType[] = ["boots", "capacity", "range", "banana", "slowdown"];
    const chosen: ItemType[] = [];
    for (let i = 0; i < count; i++) {
      const j = i + Math.floor(this.supplyRandom() * (tiles.length - i));
      [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
      chosen.push(types[Math.floor(this.supplyRandom() * types.length)]);
    }
    // Guarantee diversity without retry loops or biasing every event to a fixed category.
    if (chosen.every(type => type === chosen[0])) {
      const first = types.indexOf(chosen[0]);
      chosen[count - 1] = types[(first + 1 + Math.floor(this.supplyRandom() * (types.length - 1))) % types.length];
    }
    for (let i = 0; i < count; i++) {
      this.addItem(chosen[i], tiles[i].x, tiles[i].y, "pickup");
      this.state.items[this.state.items.length - 1].supplyDroppedAt = startedAt;
    }
  }
  /** Place one inventory charge on the current tile. Slots are zero-based. */
  useItem(playerId: string, slot: number): boolean {
    const p = this.state.players.find(p => p.id === playerId);
    if (!p) throw new RangeError("Unknown player");
    if (!Number.isInteger(slot) || slot < 0 || slot >= 5) throw new RangeError("Invalid slot");
    const item = p.inventory[slot];
    if (p.status !== "alive" || this.state.result || !item) return false;
    const x = Math.floor(p.x / this.state.map.tileSize), y = Math.floor(p.y / this.state.map.tileSize);
    if (this.state.items.some(i => i.x === x && i.y === y)) return false;
    this.addItem(item.type, x, y, "trap", p.id);
    if (--item.charges === 0) p.inventory[slot] = null;
    return true;
  }
  private collect(p: GameState["players"][number], item: GroundItem): boolean {
    if (item.type === "boots") p.boots++;
    else if (item.type === "capacity") { if (p.capacityUpgrades >= this.bombConfig.maxCapacity - this.bombConfig.initialCapacity) return false; p.capacityUpgrades++; this.upgradeBomb(p.id, "capacity"); }
    else if (item.type === "range") { if (p.rangeUpgrades >= this.bombConfig.maxRange - 1) return false; p.rangeUpgrades++; this.upgradeBomb(p.id, "range"); }
    else {
      const index = p.inventory.findIndex(s => s?.type === item.type);
      const empty = p.inventory.findIndex(s => s === null);
      const target = index >= 0 ? index : empty;
      if (target < 0) return false;
      const type = item.type as TrapType;
      if (!p.inventory[target]) p.inventory[target] = { type, charges: 0 };
      p.inventory[target]!.charges += type === "banana" ? 2 : 5;
    }
    return true;
  }
  private dropItems(p: GameState["players"][number]): void {
    const types: { type: ItemType; kind: GroundItem["kind"] }[] = [];
    for (const [type, count] of [["boots", p.boots], ["capacity", p.capacityUpgrades], ["range", p.rangeUpgrades]] as const)
      for (let i = 0; i < count; i++) types.push({ type, kind: "pickup" });
    for (const slot of p.inventory) if (slot) for (let i = 0; i < slot.charges; i += this.itemConfig.chargesPerHazard) types.push({ type: slot.type, kind: "hazard" });
    const size = this.state.map.tileSize, px = Math.floor(p.x / size), py = Math.floor(p.y / size);
    const tiles = this.state.map.tiles.flat().filter(t => t.type === "floor" && !this.state.bombs.some(b => b.x === t.x && b.y === t.y) && !this.state.items.some(i => i.x === t.x && i.y === t.y) && !this.state.players.some(other => other.status !== "eliminated" && Math.floor(other.x / size) === t.x && Math.floor(other.y / size) === t.y))
      .sort((a, b) => (Math.abs(a.x-px)+Math.abs(a.y-py)) - (Math.abs(b.x-px)+Math.abs(b.y-py)) || a.y-b.y || a.x-b.x);
    // Multiple drops share valid tiles when there are more drops than free tiles.
    for (let i = 0; i < types.length && tiles.length; i++) this.addItem(types[i].type, tiles[i % tiles.length].x, tiles[i % tiles.length].y, types[i].kind);
    p.boots = p.capacityUpgrades = p.rangeUpgrades = 0; p.inventory = Array(5).fill(null);
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
      visitBlast(bomb.x, bomb.y, bomb.range, blast);
    }
  }
  /** Advance exactly one configured fixed timestep. */
  step(): void {
    if (this.state.result) return;
    const before = this.state.players.map(p => ({ ...p }));
    this.state.players = this.state.players.map(p => {
      if (p.status !== "alive") return p;
      const input = p.slide ?? this.inputs.get(p.id) ?? IDLE;
      if (!p.slide && (Number(input.right) !== Number(input.left) || Number(input.down) !== Number(input.up))) p.direction = { ...input };
      const speed = this.movement.speed * (p.slowSeconds > 0 ? 0.5 : 1 + p.boots * 0.1);
      // Bombs are solid during forced slides; the starting tile remains escapable.
      const map = p.slide ? structuredClone(this.state.map) : this.state.map;
      if (p.slide) for (const b of this.state.bombs) if (Math.floor(p.x / map.tileSize) !== b.x || Math.floor(p.y / map.tileSize) !== b.y) map.tiles[b.y][b.x].type = "indestructible";
      const moved = movePlayer(p, input, map, { ...this.movement, speed });
      if (p.slide && Math.hypot(moved.x-p.x, moved.y-p.y) + 1e-8 < speed * this.movement.timestepSeconds) moved.slide = null;
      return moved;
    });
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
    for (const p of this.state.players) {
      if (p.slowSeconds > 0) p.slowSeconds = Math.max(0, p.slowSeconds - dt);
      if (p.status !== "alive") p.slide = null;
      const x = Math.floor(p.x / this.state.map.tileSize), y = Math.floor(p.y / this.state.map.tileSize);
      for (const item of [...this.state.items]) {
        if (item.kind === "trap" && !item.active && item.ownerId === p.id && (item.x !== x || item.y !== y)) item.active = true;
      }
    }
    for (const p of this.state.players) {
      if (p.status !== "alive") continue;
      const x = Math.floor(p.x / this.state.map.tileSize), y = Math.floor(p.y / this.state.map.tileSize);
      for (const item of [...this.state.items]) {
        if (item.x !== x || item.y !== y || !item.active) continue;
        if (item.kind === "pickup") { if (!this.collect(p, item)) continue; }
        else if (item.type === "slowdown") p.slowSeconds = 10;
        else if (item.type === "banana") {
          const input = p.slide ?? this.inputs.get(p.id) ?? IDLE;
          p.slide = (Number(input.right) !== Number(input.left) || Number(input.down) !== Number(input.up)) ? { ...input } : { ...p.direction };
          if (!p.slide.up && !p.slide.down && !p.slide.left && !p.slide.right) p.slide = null;
        }
        this.state.items = this.state.items.filter(i => i.id !== item.id);
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
    for (const p of this.state.players) if (p.status === "eliminated" && before.find(old => old.id === p.id)?.status !== "eliminated") this.dropItems(p);
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
    if (this.state.balloon && this.state.elapsedSeconds >= this.state.balloon.startedAt + this.state.balloon.durationSeconds) this.state.balloon = null;
    const schedule = [180, 360, 540];
    while (!this.state.result && this.nextSupplyIndex < schedule.length && this.state.elapsedSeconds + 1e-9 >= schedule[this.nextSupplyIndex]) {
      this.spawnSupply(schedule[this.nextSupplyIndex++]);
    }
  }
  /** Return a detached public copy so consumers cannot mutate the simulation. */
  getSnapshot(): GameSnapshot { return structuredClone(this.state); }
}
