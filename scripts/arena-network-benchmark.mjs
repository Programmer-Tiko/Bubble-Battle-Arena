import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import { io } from "socket.io-client";
import { createGameServer } from "../services/game/dist/server.js";
const server = createGameServer(), games = Array.from({ length: 4 }, () => server.create("ffa", 8, 8));
await new Promise(resolve => server.http.listen(0,"127.0.0.1",resolve));
const port=server.http.address().port, sockets=[], deliveries=Array(4).fill(0), sizes=[];
try {
  for (let i=0;i<games.length;i++) {
    const socket=io(`http://127.0.0.1:${port}`,{transports:["websocket"],reconnection:false}); sockets.push(socket);
    await new Promise((resolve,reject)=>{socket.once("connect",resolve);socket.once("connect_error",reject);});
    const reply=await new Promise(resolve=>socket.emit("join",{sessionId:games[i].id,role:"spectator"},resolve));
    if (!reply.ok) throw Error(JSON.stringify(reply));
    socket.on("snapshot",s=>{deliveries[i]++;sizes.push(Buffer.byteLength(JSON.stringify(s)));});
  }
  const startingTicks=games.map(g=>g.snapshot.tick), lag=monitorEventLoopDelay({resolution:10}), cpu=process.cpuUsage(), start=performance.now();lag.enable();
  await new Promise(resolve=>setTimeout(resolve,5000));
  const elapsed=(performance.now()-start)/1000, usage=process.cpuUsage(cpu);lag.disable();
  console.log(JSON.stringify({elapsed,startingTicks,endingTicks:games.map(g=>g.snapshot.tick),expectedTicks:elapsed*30,deliveries,
    minBytes:Math.min(...sizes),maxBytes:Math.max(...sizes),eventLoopP95Ms:lag.percentile(95)/1e6,eventLoopP99Ms:lag.percentile(99)/1e6,
    cpuSeconds:(usage.user+usage.system)/1e6,heapUsedMB:process.memoryUsage().heapUsed/1048576,
    note:"One local spectator per game; server and clients share one process. Unseeded, short probe."}));
} finally { sockets.forEach(socket=>socket.disconnect());await server.close(); }
