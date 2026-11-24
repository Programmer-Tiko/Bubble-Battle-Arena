// Controlled, separate-process soak of the existing development server.
// Run after building; set SOAK_WIDTH/HEIGHT, SOAK_HUMANS, SOAK_SEED/SECONDS.
import { fork } from "node:child_process";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import { io } from "socket.io-client";
import { Game } from "../packages/engine/dist/index.js";
import { BotController } from "../packages/bot/dist/index.js";
import { createGameServer } from "../services/game/dist/server.js";

const config={width:Number(process.env.SOAK_WIDTH??30),height:Number(process.env.SOAK_HEIGHT??26),humans:Number(process.env.SOAK_HUMANS??0),seed:Number(process.env.SOAK_SEED??7),seconds:Number(process.env.SOAK_SECONDS??60),spectators:2,sessions:4};
const stats=a=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y);return {mean:s.reduce((x,y)=>x+y,0)/s.length,p95:s[Math.floor((s.length-1)*.95)],p99:s[Math.floor((s.length-1)*.99)],max:s.at(-1)};};
if(process.argv[2]==="server") {
  const server=createGameServer({autoTick:false}), games=[];
  for(let j=0;j<config.sessions;j++) {
    const s=server.create("ffa",8,8-config.humans),ids=Array.from({length:8},(_,i)=>`p${i}`);
    s.slots.forEach((slot,i)=>{slot.id=ids[i];if(slot.bot)slot.bot=new BotController(ids[i],i,"normal");});
    s.game=new Game(ids,{width:config.width,height:config.height,seed:config.seed+j},{},{},{mode:"ffa"});
    const state=s.game.state;
    for(let i=0;i<config.humans;i++)state.players[i].inventory[0]={type:"banana",charges:3};
    // Controlled adjacent bombs guarantee a chain-reaction exercise in each game.
    let pair;
    for(const row of state.map.tiles){for(const t of row)if(t.type==="floor"&&state.map.tiles[t.y]?.[t.x+1]?.type==="floor"&&!state.players.some(p=>Math.floor(p.x/state.map.tileSize)===t.x&&Math.floor(p.y/state.map.tileSize)===t.y)){pair=t;break;}if(pair)break;}
    if(!pair)throw Error("No adjacent floors for chain fixture");
    state.bombs.push({id:-1,ownerId:ids[7],x:pair.x,y:pair.y,range:1,remainingSeconds:.5},{id:-2,ownerId:ids[7],x:pair.x+1,y:pair.y,range:1,remainingSeconds:4});
    s.snapshot=s.game.getSnapshot();games.push({session:s,chain:false,eliminated:0,completionSeconds:null});
  }
  const broadcast=[],to=server.io.to.bind(server.io);
  server.io.to=(...args)=>{const op=to(...args),emit=op.emit.bind(op);op.emit=(...data)=>{const t=performance.now();try{return emit(...data);}finally{broadcast.push(performance.now()-t);}};return op;};
  await new Promise(resolve=>server.http.listen(0,"127.0.0.1",resolve));
  process.send({type:"ready",port:server.http.address().port,ids:games.map(g=>g.session.id)});
  process.on("message",async message=>{if(message!=="start")return;
    const lag=monitorEventLoopDelay({resolution:10}),tickTimes=[],batchTimes=[],cpu=process.cpuUsage(),memory=process.memoryUsage(),start=performance.now();let previous=start,accum=0;lag.enable();
    const timer=setInterval(()=>{const now=performance.now();accum+=Math.min(now-previous,1000/30*5);previous=now;let steps=0;
      while(accum>=1000/30&&steps++<5){let batch=performance.now(),active=0;for(const g of games){const s=g.session;if(s.completed)continue;active++;
        const t=performance.now();server.tick(s);tickTimes.push(performance.now()-t);
        // The second fixture bomb has a four-second fuse, so an earlier
        // explosion proves it was triggered rather than expiring normally.
        if(s.snapshot.tick<120 && s.snapshot.explosions.some(e=>e.id===-2))g.chain=true;
        g.eliminated=Math.max(g.eliminated,s.snapshot.players.filter(p=>p.status==="eliminated").length);
        if(s.completed)g.completionSeconds=(performance.now()-start)/1000;
      }if(active)batchTimes.push(performance.now()-batch);accum-=1000/30;}
      if(steps>=5)accum=Math.min(accum,1000/30);
      if(now-start>=config.seconds*1000){clearInterval(timer);lag.disable();const elapsed=(performance.now()-start)/1000,used=process.cpuUsage(cpu),end=process.memoryUsage();
        process.send({type:"result",result:{config,elapsed,expectedTicks:elapsed*30,games:games.map(g=>({ticks:g.session.snapshot.tick,completed:g.session.completed,completionSeconds:g.completionSeconds,chain:g.chain,eliminated:g.eliminated})),tickMs:stats(tickTimes),batchMs:stats(batchTimes),broadcastMs:stats(broadcast),eventLoopP95Ms:lag.percentile(95)/1e6,eventLoopP99Ms:lag.percentile(99)/1e6,cpuSeconds:(used.user+used.system)/1e6,rssStartMB:memory.rss/1048576,rssEndMB:end.rss/1048576,heapStartMB:memory.heapUsed/1048576,heapEndMB:end.heapUsed/1048576}});
      }
    },10);
  });
  process.on("disconnect",async()=>{await server.close();process.exit(0);});
} else {
  const child=fork(new URL(import.meta.url),["server"],{stdio:["ignore","ignore","inherit","ipc"]}),sockets=[],latencies=[],sizes=[],deliveries=Array(config.sessions).fill(0),events={disconnects:0,bombs:0,items:0,moves:0,explosions:0};
  const waitMessage=type=>new Promise((resolve,reject)=>{const handler=m=>{if(m.type===type){child.off("message",handler);resolve(m);}};child.on("message",handler);child.once("exit",code=>reject(Error(`server exited ${code}`)));});
  try{const ready=await waitMessage("ready");
    for(let j=0;j<config.sessions;j++)for(let i=0;i<config.humans+config.spectators;i++){
      const role=i<config.humans?"player":"spectator",socket=io(`http://127.0.0.1:${ready.port}`,{transports:["websocket"],reconnection:false});sockets.push({socket,role});
      await new Promise((resolve,reject)=>{socket.once("connect",resolve);socket.once("connect_error",reject);});
      const reply=await new Promise(resolve=>socket.emit("join",{sessionId:ready.ids[j],role},resolve));if(!reply.ok)throw Error(JSON.stringify(reply));
      socket.on("disconnect",()=>events.disconnects++);socket.on("snapshot",s=>{deliveries[j]++;sizes.push(Buffer.byteLength(JSON.stringify(s)));if(s.explosions.length)events.explosions++;});
    }
    let sequence=0,action=0,round=0;const send=(socket,event,body,key)=>{const t=performance.now();socket.timeout(2000).emit(event,body,(error,reply)=>{if(!error){latencies.push(performance.now()-t);if(reply?.ok)events[key]++;}});};
    const resultPromise=waitMessage("result");child.send("start");
    const interval=setInterval(()=>{const direction=["right","down","left","up"][Math.floor(round++/10)%4];for(const {socket,role} of sockets)if(role==="player"){
      send(socket,"move",{seq:sequence++,input:{up:direction==="up",down:direction==="down",left:direction==="left",right:direction==="right"}},"moves");
      if(round%20===1)send(socket,"bomb",{seq:action++},"bombs");if(round%20===5)send(socket,"item",{seq:action++,slot:0},"items");
    }},100);
    const {result}=await resultPromise;clearInterval(interval);console.log(JSON.stringify({...result,client:{serverPid:child.pid,clientPid:process.pid,deliveries,events,ackMs:stats(latencies),snapshotBytes:stats(sizes)}}));
  }finally{sockets.forEach(({socket})=>socket.disconnect());child.disconnect();}
}
