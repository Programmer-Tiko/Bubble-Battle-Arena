// Run the server in a child process and Socket.IO clients in this process.
// Seeded maps and deterministic input schedule; timings remain host-dependent.
import { fork } from "node:child_process";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import { io } from "socket.io-client";
import { Game } from "../packages/engine/dist/index.js";
import { BotController } from "../packages/bot/dist/index.js";
import { createGameServer } from "../services/game/dist/server.js";

const config = { sessions: Number(process.env.LOAD_SESSIONS ?? 4), humans: Number(process.env.LOAD_HUMANS ?? 0), spectators: Number(process.env.LOAD_SPECTATORS ?? 2), seed: Number(process.env.LOAD_SEED ?? 7), seconds: Number(process.env.LOAD_SECONDS ?? 10) };
const stats = values => { const s=[...values].sort((a,b)=>a-b); return s.length ? {mean:s.reduce((a,b)=>a+b,0)/s.length,p95:s[Math.floor((s.length-1)*.95)],p99:s[Math.floor((s.length-1)*.99)],max:s.at(-1)} : null; };
if (process.argv[2] === "server") {
  const server=createGameServer({autoTick:false}), games=[];
  for(let j=0;j<config.sessions;j++) {
    const s=server.create("ffa",8,8-config.humans), ids=Array.from({length:8},(_,i)=>`p${i}`);
    s.slots.forEach((slot,i)=>{slot.id=ids[i]; if(slot.bot) slot.bot=new BotController(ids[i],i,"normal");});
    s.game=new Game(ids,{seed:config.seed+j},{},{},{mode:"ffa"});
    // A controlled inventory fixture lets real player sockets exercise item use.
    for(let i=0;i<config.humans;i++) s.game.state.players[i].inventory[0]={type:"banana",charges:3};
    s.snapshot=s.game.getSnapshot(); games.push(s);
  }
  const broadcast=[], originals=server.io.to.bind(server.io);
  server.io.to=(...args)=>{const op=originals(...args), emit=op.emit.bind(op);op.emit=(...data)=>{const t=performance.now();try{return emit(...data);}finally{broadcast.push(performance.now()-t);}};return op;};
  await new Promise(resolve=>server.http.listen(0,"127.0.0.1",resolve));
  process.send({type:"ready",port:server.http.address().port,ids:games.map(s=>s.id)});
  process.on("message",async message=>{
    if(message!=="start") return;
    const lag=monitorEventLoopDelay({resolution:10}), tickTimes=[], batchTimes=[], start=performance.now(), cpu=process.cpuUsage(), memoryStart=process.memoryUsage();
    let previous=start,accum=0; lag.enable();
    const timer=setInterval(()=>{
      const now=performance.now();accum+=Math.min(now-previous,1000/30*5);previous=now;
      let steps=0;
      while(accum>=1000/30 && steps++<5){const batch=performance.now();for(const game of games){const t=performance.now();server.tick(game);tickTimes.push(performance.now()-t);}batchTimes.push(performance.now()-batch);accum-=1000/30;}
      if(steps>=5)accum=Math.min(accum,1000/30);
      if(now-start>=config.seconds*1000){
        clearInterval(timer);lag.disable(); const elapsed=(performance.now()-start)/1000, used=process.cpuUsage(cpu);
        process.send({type:"result",result:{config,elapsed,expectedTicks:elapsed*30,ticks:games.map(g=>g.snapshot.tick),completed:games.map(g=>g.completed),
          tickMs:stats(tickTimes),batchMs:stats(batchTimes),broadcastEmitMs:stats(broadcast),eventLoopP95Ms:lag.percentile(95)/1e6,eventLoopP99Ms:lag.percentile(99)/1e6,
          cpuSeconds:(used.user+used.system)/1e6,rssStartMB:memoryStart.rss/1048576,rssEndMB:process.memoryUsage().rss/1048576,heapEndMB:process.memoryUsage().heapUsed/1048576}});
      }
    },10);
  });
  process.on("disconnect",async()=>{await server.close();process.exit(0);});
} else {
  const child=fork(new URL(import.meta.url),["server"],{stdio:["ignore","ignore","inherit","ipc"]}), sockets=[], latencies=[], sizes=[], deliveries=Array(config.sessions).fill(0), events={disconnects:0,bombAccepted:0,itemAccepted:0,explosionSnapshots:0,moveAccepted:0};
  const waitMessage=type=>new Promise((resolve,reject)=>{const handler=message=>{if(message.type===type){child.off("message",handler);resolve(message);}};child.on("message",handler);child.once("exit",code=>reject(Error(`Server exited ${code}`)));});
  try {
    const ready=await waitMessage("ready");
    for(let j=0;j<config.sessions;j++) for(let i=0;i<config.humans+config.spectators;i++) {
      const role=i<config.humans?"player":"spectator", socket=io(`http://127.0.0.1:${ready.port}`,{transports:["websocket"],reconnection:false}); sockets.push({socket,role});
      await new Promise((resolve,reject)=>{socket.once("connect",resolve);socket.once("connect_error",reject);});
      const reply=await new Promise(resolve=>socket.emit("join",{sessionId:ready.ids[j],role},resolve));if(!reply.ok)throw Error(JSON.stringify(reply));
      socket.on("disconnect",()=>events.disconnects++);
      socket.on("snapshot",s=>{deliveries[j]++;sizes.push(Buffer.byteLength(JSON.stringify(s)));if(s.explosions.length)events.explosionSnapshots++;});
    }
    let seq=0,action=0,round=0;
    const send=(socket,event,body,field)=>{const t=performance.now();socket.timeout(2000).emit(event,body,(err,reply)=>{if(!err){latencies.push(performance.now()-t);if(reply?.ok)events[field]++;}});};
    const resultPromise=waitMessage("result");child.send("start");
    const actions=setInterval(()=>{const direction=["right","down","left","up"][Math.floor(round++/10)%4];
      for(const {socket,role} of sockets)if(role==="player") {
        send(socket,"move",{seq:seq++,input:{up:direction==="up",down:direction==="down",left:direction==="left",right:direction==="right"}},"moveAccepted");
        if(round%20===1)send(socket,"bomb",{seq:action++},"bombAccepted");
        if(round%20===5)send(socket,"item",{seq:action++,slot:0},"itemAccepted");
      }
    },100);
    const {result}=await resultPromise;clearInterval(actions);
    console.log(JSON.stringify({...result,client:{processId:process.pid,serverProcessId:child.pid,deliveries,events,ackRoundTripMs:stats(latencies),snapshotBytes:stats(sizes)}}));
  } finally {sockets.forEach(({socket})=>socket.disconnect());child.disconnect();}
}
