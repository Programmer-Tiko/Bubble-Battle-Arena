import type { AuthoritativeGameSnapshot as GameSnapshot, MovementInput } from "@bubble/shared";

/** Seeded random direction policy with basic wall avoidance, for evaluation. */
export class RandomBaseline {
  private randomState: number;
  private input: MovementInput = { up: false, down: false, left: false, right: false };
  constructor(readonly playerId: string, seed: number) { this.randomState = seed >>> 0 || 1; }
  private random() { let x = this.randomState; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.randomState = x >>> 0; return this.randomState / 0x100000000; }
  update(snapshot: GameSnapshot): { input: MovementInput; placeBomb: boolean } {
    const player = snapshot.players.find(p => p.id === this.playerId);
    if (!player || player.status !== "alive" || snapshot.result) return { input: { up: false, down: false, left: false, right: false }, placeBomb: false };
    const size = snapshot.map.tileSize, x = Math.floor(player.x / size), y = Math.floor(player.y / size);
    let placeBomb = false;
    if (snapshot.tick % 12 === 0) {
      const directions = [[1,0],[-1,0],[0,1],[0,-1]] as const;
      const valid = directions.filter(([dx,dy]) => snapshot.map.tiles[y + dy]?.[x + dx]?.type === "floor");
      const chosen = valid[Math.floor(this.random() * valid.length)];
      this.input = { up: chosen?.[1] === -1, down: chosen?.[1] === 1, left: chosen?.[0] === -1, right: chosen?.[0] === 1 };
      const opportunity = directions.some(([dx, dy]) => snapshot.map.tiles[y + dy]?.[x + dx]?.type === "destructible") ||
        snapshot.players.some(p => p.id !== player.id && p.teamId !== player.teamId && p.status === "alive" && Math.abs(Math.floor(p.x / size) - x) + Math.abs(Math.floor(p.y / size) - y) <= 1);
      placeBomb = opportunity && this.random() < 0.25;
    }
    return { input: this.input, placeBomb };
  }
}
