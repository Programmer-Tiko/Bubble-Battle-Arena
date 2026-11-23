import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { Game } from "../packages/engine/dist/index.js";
import { BotController, RandomBaseline } from "../packages/bot/dist/index.js";

const trials = Number(process.env.BOT_TRIALS ?? 24);
if (!Number.isInteger(trials) || trials < 1 || trials > 1000) throw new RangeError("Invalid BOT_TRIALS");
const idle = { up: false, down: false, left: false, right: false };
export function setup(seed, scenario) {
  const game = new Game(["bot", "opponent"], { seed });
  const s = game.state, size = s.map.tileSize;
  const rotate = (x, y) => { let dx = x - 5, dy = y - 5; for (let i = 0; i < seed % 4; i++) [dx, dy] = [-dy, dx]; return { x: dx + 5, y: dy + 5 }; };
  for (let y = 2; y <= 10; y++) for (let x = 2; x <= 10; x++) s.map.tiles[y][x].type = "floor";
  for (const [x, y, type] of [[6,5,"destructible"], [6,7,"indestructible"]]) { const p = rotate(x, y); s.map.tiles[p.y][p.x].type = type; }
  s.players[0].x = 5.5 * size; s.players[0].y = 5.5 * size;
  const opponent = rotate(8, 8); s.players[1].x = (opponent.x + 0.5) * size; s.players[1].y = (opponent.y + 0.5) * size;
  s.items = [[5,3,"boots"], [7,5,"range"], [3,5,"capacity"]].map(([x,y,type], i) => ({ id: 900+i, ...rotate(x,y), type, kind: "pickup", active: true }));
  if (scenario === "threat") {
    const bomb = rotate(5,6); s.players[1].x = (bomb.x+0.5) * size; s.players[1].y = (bomb.y+0.5) * size;
    game.placeBomb("opponent"); s.players[1].x = (opponent.x+0.5) * size; s.players[1].y = (opponent.y+0.5) * size;
  }
  return game;
}
function opportunity(s, p) {
  const z = s.map.tileSize, x = Math.floor(p.x/z), y = Math.floor(p.y/z);
  return [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => s.map.tiles[y+dy]?.[x+dx]?.type === "destructible") ||
    s.players.some(o => o.id !== p.id && o.teamId !== p.teamId && o.status === "alive" && Math.abs(Math.floor(o.x/z)-x)+Math.abs(Math.floor(o.y/z)-y) <= 1);
}
function trial(seed, scenario, kind) {
  const game = setup(seed, scenario), policy = kind === "intelligent" ? new BotController("bot") : new RandomBaseline("bot", seed), owned = new Set();
  const limit = scenario === "threat" ? 120 : 300; let decisions = 0, millis = 0, death = limit / 30, selfTrapped = false, attacks = 0, items = 0;
  for (let tick = 0; tick < limit; tick++) {
    const before = game.getSnapshot(), player = before.players[0];
    if (player.status !== "alive") { death = tick / 30; break; }
    const t = performance.now(), cmd = policy.update(before); millis += performance.now() - t; decisions++;
    game.setInput("bot", cmd.input);
    if (cmd.placeBomb && game.placeBomb("bot")) {
      const bomb = game.getSnapshot().bombs.at(-1); owned.add(bomb.id);
      if (opportunity(before, player)) attacks++;
    }
    if (scenario === "arena") {
      const phase = Math.floor(tick / 60) % 4;
      game.setInput("opponent", { ...idle, [ ["left", "up", "right", "down"][phase] ]: true });
      if (tick % 120 === 0) game.placeBomb("opponent");
    }
    game.step(); const after = game.getSnapshot();
    items = Math.max(items, after.players[0].boots + after.players[0].rangeUpgrades + after.players[0].capacityUpgrades);
    if (after.players[0].status !== "alive" && after.explosions.some(e => owned.has(e.id) && e.x === Math.floor(after.players[0].x / after.map.tileSize) && e.y === Math.floor(after.players[0].y / after.map.tileSize))) selfTrapped = true;
  }
  const result = game.getSnapshot(), p = result.players[0];
  return { survived: p.status === "alive", escape: scenario === "threat" && p.status === "alive", selfTrapped, survivalSeconds: death,
    items, attacks, millis, decisions };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) for (const scenario of ["threat", "arena"]) for (const kind of ["baseline", "intelligent"]) {
  for (let seed = 1; seed <= trials; seed++) if (JSON.stringify(setup(seed, scenario).getSnapshot()) !== JSON.stringify(setup(seed, scenario).getSnapshot())) throw new Error("Scenario initialization is not reproducible");
  const rows = Array.from({ length: trials }, (_, i) => trial(i + 1, scenario, kind));
  const sum = key => rows.reduce((n, r) => n + Number(r[key]), 0);
  console.log(JSON.stringify({ scenario, policy: kind, trials, survivalRate: sum("survived") / trials, escapeRate: scenario === "threat" ? sum("escape") / trials : null,
    selfTrapRate: sum("selfTrapped") / trials, averageSurvivalSeconds: sum("survivalSeconds") / trials, averageItems: sum("items") / trials,
    validAttackPlacements: sum("attacks"), decisionMeanMs: sum("millis") / sum("decisions") }));
}
