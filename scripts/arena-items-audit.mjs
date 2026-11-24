import { Game } from "../packages/engine/dist/index.js";
const trials = Number(process.env.ARENA_SEEDS ?? 200), slots = Array.from({ length: 8 }, () => []), quadrant = [0,0,0,0], bySpawn = new Map();
let invalid = 0, unreachable = 0, nondeterministic = 0, worstSpread = 0;
for (let seed = 1; seed <= trials; seed++) {
  const make = () => new Game(Array.from({ length: 8 }, (_, i) => `p${i}`), { seed }).getSnapshot();
  const s = make(); if (JSON.stringify(s.items) !== JSON.stringify(make().items)) nondeterministic++;
  if (s.items.length !== 12 || new Set(s.items.map(i=>`${i.x},${i.y}`)).size !== s.items.length || s.items.filter(i=>i.type === "boots").length !== 4 || ["capacity","range","banana","slowdown"].some(type=>s.items.filter(i=>i.type===type).length!==2) || s.items.some(i=>s.map.tiles[i.y][i.x].type!=="floor" || i.kind!=="pickup")) invalid++;
  for (const i of s.items) quadrant[(i.y >= s.map.height/2 ? 2 : 0) + (i.x >= s.map.width/2 ? 1 : 0)]++;
  const distances = s.players.map((p, slot) => {
    const x = Math.floor(p.x/s.map.tileSize), y = Math.floor(p.y/s.map.tileSize), queue = [[x,y,0]], seen = new Set([`${x},${y}`]);
    let nearest = Infinity;
    for (let j=0; j<queue.length; j++) { const [a,b,d]=queue[j];
      if (s.items.some(i=>i.type==="boots" && i.x===a && i.y===b)) nearest=Math.min(nearest,d);
      for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) { const nx=a+dx, ny=b+dy, k=`${nx},${ny}`; if(s.map.tiles[ny]?.[nx]?.type==="floor" && !seen.has(k)){seen.add(k);queue.push([nx,ny,d+1]);} }
    }
    if (s.items.some(i=>!seen.has(`${i.x},${i.y}`))) unreachable++;
    slots[slot].push(nearest); const key=`${x},${y}`, group=bySpawn.get(key)??[]; group.push(nearest); bySpawn.set(key,group); return nearest;
  });
  worstSpread=Math.max(worstSpread,Math.max(...distances)-Math.min(...distances));
}
console.log(JSON.stringify({ trials,invalid,unreachableSpawnChecks:unreachable,nondeterministic,quadrantCounts:quadrant,
  meanNearestBootsBySlot:slots.map(values=>values.reduce((a,b)=>a+b,0)/values.length),
  meanNearestBootsBySpawn:Object.fromEntries([...bySpawn].map(([key,values])=>[key,values.reduce((a,b)=>a+b,0)/values.length])),worstWithinMatchNearestBootsSpread:worstSpread }));
