import os from "node:os";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { createGameServer } from "../services/game/dist/server.js";

const ticks = Number(process.env.BOT_BENCH_TICKS ?? 300);
if (!Number.isInteger(ticks) || ticks < 1 || ticks > 100000) throw new RangeError("Invalid BOT_BENCH_TICKS");
const stats = values => { const a = [...values].sort((x,y) => x-y); return { mean: a.reduce((x,y) => x+y, 0)/a.length, p95: a[Math.floor((a.length-1)*0.95)], p99: a[Math.floor((a.length-1)*0.99)], max: a.at(-1) }; };
console.log(JSON.stringify({ node: process.version, platform: `${os.platform()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, ticks, timestepHz: 30, difficulty: "normal", note: "Synchronous simulated ticks, no network clients; not a real-time load test." }));
for (const [sessions, bots] of [[1,1], [1,4], [1,8], [4,8]]) {
  const server = createGameServer({ autoTick: false });
  const games = Array.from({ length: sessions }, () => server.create("ffa", 8, bots));
  const decisions = [], times = [], cpuStart = process.cpuUsage(), wall = performance.now();
  for (const session of games) for (const slot of session.slots) if (slot.bot) {
    const original = slot.bot.update.bind(slot.bot);
    slot.bot.update = (...args) => { const t = performance.now(); const result = original(...args); decisions.push(performance.now() - t); return result; };
  }
  for (let i = 0; i < ticks; i++) { const t = performance.now(); for (const session of games) server.tick(session); times.push(performance.now() - t); }
  const elapsed = performance.now() - wall, cpu = process.cpuUsage(cpuStart);
  const metrics = games.flatMap(g => g.slots.filter(s => s.bot).map(s => s.bot.metrics()));
  const total = k => metrics.reduce((n, m) => n + m[k], 0);
  console.log(JSON.stringify({ sessions, botsPerSession: bots, activePlayersPerSession: 8, simulatedSeconds: ticks/30, actualSeconds: elapsed/1000,
    botDecisionMs: stats(decisions), sessionBatchTickMs: stats(times), batchesOver33ms: times.filter(t => t > 1000/30).length,
    searches: total("searches"), nodes: total("expanded"), budgetExhaustions: total("exhausted"), heapUsedMB: process.memoryUsage().heapUsed/1048576,
    cpuSeconds: (cpu.user+cpu.system)/1e6 }));
  await server.close();
}
// Separate wall-clock probe using the actual server timers and event loop.
for (const [sessions, bots] of [[1,1], [1,4], [1,8], [4,8]]) {
  const server = createGameServer(), lag = monitorEventLoopDelay({ resolution: 10 });
  const games = Array.from({ length: sessions }, () => server.create("ffa", 8, bots));
  lag.enable(); const start = performance.now();
  await new Promise(resolve => setTimeout(resolve, 3000));
  const elapsed = (performance.now() - start) / 1000; lag.disable();
  console.log(JSON.stringify({ realtimeProbe: true, sessions, botsPerSession: bots, durationSeconds: elapsed,
    sessionTicks: games.map(g => g.snapshot.tick), completed: games.map(g => g.completed), expectedTicks: elapsed * 30,
    eventLoopP95Ms: lag.percentile(95) / 1e6, eventLoopP99Ms: lag.percentile(99) / 1e6, eventLoopMaxMs: lag.max / 1e6 }));
  await server.close();
}
