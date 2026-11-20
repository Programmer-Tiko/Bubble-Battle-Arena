// Run after npm run build: node --expose-gc scripts/benchmark.mjs
import { createGameServer } from "../services/game/dist/server.js";
import { io } from "socket.io-client";
import { deflateRawSync } from "node:zlib";
import os from "node:os";
import { performance } from "node:perf_hooks";

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run(count) {
  global.gc?.(); const before = process.memoryUsage().heapUsed;
  const server = createGameServer({ emptySessionMs: 60000 });
  await new Promise(resolve => server.http.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.http.address().port}`;
  const sessions = Array.from({ length: count }, () => server.create("ffa", 8));
  const clients = []; let firstJoin;
  for (const session of sessions) for (let i = 0; i < 8; i++) {
    const client = io(url, { transports: ["websocket"], reconnection: false });
    await new Promise((resolve, reject) => { client.once("connect", resolve); client.once("connect_error", reject); });
    const joined = await new Promise(resolve => client.emit("join", { sessionId: session.id, role: "player" }, resolve));
    if (!joined.ok) throw new Error(joined.error);
    if (!firstJoin) firstJoin = joined.value;
    clients.push(client);
  }
  global.gc?.(); const heapWithSessions = process.memoryUsage().heapUsed;
  const snapshot = sessions[0].game.getSnapshot(), text = JSON.stringify(["snapshot", snapshot]);
  const player = snapshot.players.find(p => p.id === firstJoin.playerId), size = snapshot.map.tileSize;
  const x = Math.floor(player.x / size), y = Math.floor(player.y / size);
  const directions = [["right",1,0],["left",-1,0],["down",0,1],["up",0,-1]];
  const direction = directions.find(([,dx,dy]) => snapshot.map.tiles[y+dy]?.[x+dx]?.type === "floor")[0];
  const input = { up: false, down: false, left: false, right: false, [direction]: true };
  const intervals = []; let last = 0, received = 0, latency;
  clients[1].on("snapshot", s => {
    const t = performance.now(); if (last) intervals.push(t - last); last = t; received++;
    const current = s.players.find(p => p.id === firstJoin.playerId);
    if (latency === undefined && Math.hypot(current.x-player.x,current.y-player.y) > 0.01) latency = t - started;
  });
  const ticksBefore = sessions.map(s => s.game.getSnapshot().tick), started = performance.now();
  clients[0].emit("move", { seq: 0, input }, () => {});
  await wait(3000);
  const elapsed = performance.now() - started;
  const ticks = sessions.map((s, i) => s.game.getSnapshot().tick - ticksBefore[i]);
  clients.forEach(c => c.disconnect()); await server.close();
  const avg = values => values.reduce((a,b) => a+b,0) / values.length;
  return { sessions: count, connectedPlayers: clients.length, elapsedMs: Math.round(elapsed), ticks, snapshotsReceived: received, averageSnapshotIntervalMs: +avg(intervals).toFixed(1), minSnapshotIntervalMs: +Math.min(...intervals).toFixed(1), maxSnapshotIntervalMs: +Math.max(...intervals).toFixed(1), inputToObservedSnapshotMs: latency === undefined ? null : +latency.toFixed(1), jsonBytes: Buffer.byteLength(text), deflateRawBytes: deflateRawSync(text).length, heapDeltaBytes: heapWithSessions - before };
}
async function measureIdleSessionHeap() {
  const server = createGameServer({ autoTick: false });
  global.gc?.(); const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 16; i++) server.create("ffa", 8);
  global.gc?.(); const difference = process.memoryUsage().heapUsed - before;
  await server.close(); return { sessions: 16, totalHeapDeltaBytes: difference, approximateBytesPerSession: Math.round(difference / 16) };
}
console.log(JSON.stringify({ idleSessionHeap: await measureIdleSessionHeap(), node: process.version, platform: os.platform(), cpus: os.cpus().length, note: "Loopback, idle players, 3 seconds per run; heap delta includes server and all sockets; deflate is standalone payload estimate, not measured wire bytes.", results: [await run(1), await run(4)] }, null, 2));
