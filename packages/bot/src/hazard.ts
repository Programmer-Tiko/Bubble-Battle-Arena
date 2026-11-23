import { DEFAULT_BOMB_CONFIG, DEFAULT_MOVEMENT_CONFIG, visitBlast, type BombConfig } from "@bubble/engine";
import type { BombState, AuthoritativeGameSnapshot as GameSnapshot } from "@bubble/shared";

export interface Interval { start: number; end: number }
const key = (x: number, y: number) => `${x},${y}`;

/** Predict known bombs on a detached map. Times are relative to the snapshot.
 * No prediction is made about bombs placed after the snapshot. */
export class HazardMap {
  private readonly danger = new Map<string, Interval[]>();
  readonly detonationTimes = new Map<number, number>();

  constructor(snapshot: GameSnapshot, config: BombConfig = DEFAULT_BOMB_CONFIG, dt = DEFAULT_MOVEMENT_CONFIG.timestepSeconds) {
    if (!Number.isFinite(dt) || dt <= 0) throw new RangeError("Invalid timestep");
    const tiles = snapshot.map.tiles.map(row => row.map(tile => ({ ...tile })));
    const bombs = snapshot.bombs.map(b => ({ ...b }));
    const tickAt = (seconds: number) => Math.max(1, Math.ceil((seconds - 1e-9) / dt));
    const add = (x: number, y: number, start: number, end: number) => {
      const k = key(x, y), intervals = this.danger.get(k) ?? [];
      intervals.push({ start, end }); this.danger.set(k, intervals);
    };
    for (const explosion of snapshot.explosions) add(explosion.x, explosion.y, 0, tickAt(explosion.remainingSeconds) * dt);
    // Engine decrements all fuses before visiting expired bombs in array order;
    // chain reactions are processed immediately in a FIFO queue.
    while (bombs.length) {
      const tick = Math.min(...bombs.map(b => tickAt(b.remainingSeconds)));
      const expired = bombs.filter(b => tickAt(b.remainingSeconds) === tick);
      for (const initial of expired) {
        if (!bombs.includes(initial)) continue;
        const queue: BombState[] = [initial], pending = new Set([initial.id]);
        for (let i = 0; i < queue.length; i++) {
          const bomb = queue[i];
          bombs.splice(bombs.indexOf(bomb), 1);
          this.detonationTimes.set(bomb.id, tick * dt);
          visitBlast(bomb.x, bomb.y, bomb.range, (x, y) => {
            const tile = tiles[y]?.[x];
            if (!tile || tile.type === "indestructible") return false;
            add(x, y, tick * dt, (tick + tickAt(config.explosionSeconds)) * dt);
            const chained = bombs.find(b => b.x === x && b.y === y);
            if (chained && !pending.has(chained.id)) { pending.add(chained.id); queue.push(chained); }
            if (tile.type === "destructible") { tile.type = "floor"; return !config.stopAtDestructible; }
            return true;
          });
        }
      }
    }
    for (const [k, intervals] of this.danger) {
      intervals.sort((a, b) => a.start - b.start);
      const merged: Interval[] = [];
      for (const interval of intervals) {
        const last = merged.at(-1);
        if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
        else merged.push({ ...interval });
      }
      this.danger.set(k, merged);
    }
  }

  isDangerous(x: number, y: number, time: number): boolean {
    return (this.danger.get(key(x, y)) ?? []).some(i => i.start <= time && time < i.end);
  }

  isDangerousDuring(x: number, y: number, start: number, end: number): boolean {
    return (this.danger.get(key(x, y)) ?? []).some(i => i.start <= end && i.end > start);
  }

  /** Detached intervals for development inspection. */
  intervals(): { x: number; y: number; start: number; end: number }[] {
    return [...this.danger].flatMap(([key, intervals]) => {
      const [x, y] = key.split(",").map(Number);
      return intervals.map(i => ({ x, y, ...i }));
    });
  }

  /** Half-open safe intervals within [0, horizon). */
  getSafeIntervals(x: number, y: number, horizon: number): Interval[] {
    if (!Number.isFinite(horizon) || horizon < 0) throw new RangeError("Invalid horizon");
    const result: Interval[] = []; let start = 0;
    for (const i of this.danger.get(key(x, y)) ?? []) {
      if (i.start >= horizon) break;
      if (i.start > start) result.push({ start, end: Math.min(i.start, horizon) });
      start = Math.max(start, i.end);
    }
    if (start < horizon) result.push({ start, end: horizon });
    return result;
  }
}
