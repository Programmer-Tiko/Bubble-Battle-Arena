// Seeded headless workload. Compile this file with the desired source tree's
// @bubble aliases before running; see docs/large-arena-experiment.md.
import { performance } from "node:perf_hooks";
import { Game } from "@bubble/engine";
import { BotController } from "@bubble/bot";

const width = Number(process.env.ARENA_WIDTH ?? 30), height = Number(process.env.ARENA_HEIGHT ?? 26);
const count = Number(process.env.ARENA_PLAYERS ?? 8), sessions = Number(process.env.ARENA_SESSIONS ?? 4);
const ticks = Number(process.env.ARENA_TICKS ?? 300), seed = Number(process.env.ARENA_SEED ?? 1);
const difficulty = process.env.ARENA_DIFFICULTY ?? "normal", mode = process.env.ARENA_MODE ?? "ffa";
const reuse = process.env.ARENA_REUSE === "1";
const ids = Array.from({ length: count }, (_, i) => `p${i}`);
const teams = Object.fromEntries(ids.map((id, i) => [id, `t${Math.floor(i / 2)}`]));
const games = Array.from({ length: sessions }, (_, i) => {
  const game = new Game(ids, { width, height, seed: seed + i }, {}, {}, { mode, teams });
  const bots = ids.map((id, index) => new BotController(id, index, difficulty));
  return { game, bots, travel: 0, stationary: Array(count).fill(0), maxStationary: Array(count).fill(0),
    encounter: null, engagement: null, trap: null, elimination: null, result: null,
    nearPairs: new Set(), encounterEpisodes: 0, encounterPairTicks: 0 };
});
const timings = { snapshot: 0, bot: 0, step: 0, serialization: 0 }, durations = [];
let bytes = 0, snapshotCount = 0;
const snapshot = game => { const t = performance.now(); const s = game.getSnapshot(); timings.snapshot += performance.now() - t; snapshotCount++; return s; };
const startCPU = process.cpuUsage(), startWall = performance.now(), startMem = process.memoryUsage();
for (let tick = 0; tick < ticks; tick++) {
  const batch = performance.now();
  for (const row of games) {
    if (row.result) continue;
    const before = snapshot(row.game), size = before.map.tileSize;
    const nearPairs = new Set();
    for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
      const a = before.players[i], b = before.players[j];
      if (a.status === "alive" && b.status === "alive" && a.teamId !== b.teamId &&
          Math.abs(Math.floor(a.x / size) - Math.floor(b.x / size)) + Math.abs(Math.floor(a.y / size) - Math.floor(b.y / size)) <= 3) {
        const key = `${i},${j}`; nearPairs.add(key); row.encounterPairTicks++;
        if (!row.nearPairs.has(key)) row.encounterEpisodes++;
      }
    }
    row.nearPairs = nearPairs;
    let shared = before;
    for (let i = 0; i < count; i++) {
      const s = i === 0 ? before : reuse ? shared : snapshot(row.game), t = performance.now();
      const cmd = row.bots[i].update(s, s.tick % count === i); timings.bot += performance.now() - t;
      row.game.setInput(ids[i], cmd.input);
      if (cmd.placeBomb && row.game.placeBomb(ids[i])) {
        const p = s.players[i], x = Math.floor(p.x / size), y = Math.floor(p.y / size);
        if (row.engagement === null && s.players.some(o => o.teamId !== p.teamId && o.status === "alive" && Math.abs(Math.floor(o.x/size)-x) + Math.abs(Math.floor(o.y/size)-y) <= 3)) row.engagement = tick / 30;
        if (reuse) shared = snapshot(row.game);
      }
    }
    let t = performance.now(); row.game.step(); timings.step += performance.now() - t;
    const after = snapshot(row.game);
    if (after.tick % 3 === 0) {
      t = performance.now();
      const publicView = { ...after, players: after.players.map(({ trappedSeconds, ...p }) => p), bombs: after.bombs.map(({ remainingSeconds, ...b }) => b) };
      bytes = Buffer.byteLength(JSON.stringify(publicView)); timings.serialization += performance.now() - t;
    }
    for (let i = 0; i < count; i++) {
      const p = before.players[i], q = after.players[i], moved = Math.hypot(q.x-p.x, q.y-p.y);
      row.travel += moved;
      if (p.status === "alive") { row.stationary[i] = moved < 0.01 ? row.stationary[i] + 1 : 0; row.maxStationary[i] = Math.max(row.maxStationary[i], row.stationary[i]); }
      if (row.trap === null && p.status === "alive" && q.status === "trapped") row.trap = after.elapsedSeconds;
      if (row.elimination === null && p.status !== "eliminated" && q.status === "eliminated") row.elimination = after.elapsedSeconds;
      if (row.encounter === null && p.status === "alive" && before.players.some(o => o.teamId !== p.teamId && o.status === "alive" && Math.abs(Math.floor(o.x/size)-Math.floor(p.x/size)) + Math.abs(Math.floor(o.y/size)-Math.floor(p.y/size)) <= 3)) row.encounter = before.elapsedSeconds;
    }
    if (after.result) row.result = { ...after.result, seconds: after.elapsedSeconds };
  }
  durations.push(performance.now() - batch);
  if (games.every(g => g.result)) break;
}
const elapsed = performance.now() - startWall, cpu = process.cpuUsage(startCPU), sorted = [...durations].sort((a,b)=>a-b);
const percentile = p => sorted[Math.floor((sorted.length-1)*p)];
console.log(JSON.stringify({ width,height,count,sessions,ticks:durations.length,seed,difficulty,mode,reuse,
  tickMs:{ mean:durations.reduce((a,b)=>a+b,0)/durations.length,p95:percentile(.95),p99:percentile(.99) },
  timings, snapshotCount, publicSnapshotBytes:bytes, cpuSeconds:(cpu.user+cpu.system)/1e6, wallSeconds:elapsed/1000,
  heapStart:startMem.heapUsed, heapEnd:process.memoryUsage().heapUsed,
  games:games.map(g=>({travelTiles:g.travel/32, maxStationarySeconds:Math.max(...g.maxStationary)/30,
    encounter:g.encounter, encounterEpisodes:g.encounterEpisodes, encounterPairSeconds:g.encounterPairTicks/30,
    engagement:g.engagement, trap:g.trap, elimination:g.elimination, result:g.result,
    search:g.bots.reduce((a,b)=>{const m=b.metrics(); for(const k of Object.keys(a)) a[k]+=m[k]; return a;},{searches:0,expanded:0,exhausted:0})})) }));
