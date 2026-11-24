import { Game } from "../packages/engine/dist/index.js";
const seeds=Number(process.env.ACCESS_SEEDS??200),ids=Array.from({length:8},(_,i)=>`p${i}`);
for(const [width,height] of [[24,22],[30,26]]){
  let sum=0,n=0,worstGap=0,unreachable=0,invalid=0;
  for(let seed=1;seed<=seeds;seed++){
    const s=new Game(ids,{width,height,seed}).getSnapshot(), boots=s.items.filter(i=>i.type==="boots"),nearest=[];
    if(boots.length!==4||s.items.some(i=>s.map.tiles[i.y][i.x].type!=="floor"))invalid++;
    for(const p of s.players){
      const x=Math.floor(p.x/s.map.tileSize),y=Math.floor(p.y/s.map.tileSize),queue=[[x,y,0]],seen=new Set([`${x},${y}`]);let best=Infinity;
      for(let i=0;i<queue.length;i++){const [a,b,d]=queue[i];if(boots.some(t=>t.x===a&&t.y===b))best=Math.min(best,d);
        for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=a+dx,ny=b+dy,k=`${nx},${ny}`;if(s.map.tiles[ny]?.[nx]?.type==="floor"&&!seen.has(k)){seen.add(k);queue.push([nx,ny,d+1]);}}
      }
      if(s.items.some(t=>!seen.has(`${t.x},${t.y}`)))unreachable++;
      nearest.push(best);sum+=best;n++;
    }
    worstGap=Math.max(worstGap,Math.max(...nearest)-Math.min(...nearest));
  }
  console.log(JSON.stringify({width,height,seeds,meanNearestBootsTiles:sum/n,worstSpawnGapTiles:worstGap,unreachableSpawnChecks:unreachable,invalid}));
}
