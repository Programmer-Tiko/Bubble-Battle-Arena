import Phaser from "phaser";

// Original canvas illustrations. Textures are generated once per scene and then reused.
type Painter = (c: CanvasRenderingContext2D) => void;
function texture(scene: Phaser.Scene, key: string, width: number, height: number, draw: Painter): void {
  if (scene.textures.exists(key)) return;
  const texture = scene.textures.createCanvas(key, width * 2, height * 2);
  if (!texture) throw new Error(`Unable to create ${key}`);
  const c = texture.context; c.scale(2, 2); c.lineJoin = "round"; c.lineCap = "round"; draw(c); texture.refresh();
}
function ellipse(c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string, stroke?: string, line = 1): void {
  c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fillStyle = fill; c.fill();
  if (stroke) { c.lineWidth = line; c.strokeStyle = stroke; c.stroke(); }
}
function shape(c: CanvasRenderingContext2D, points: number[], fill: string, stroke?: string, line = 1): void {
  c.beginPath(); c.moveTo(points[0], points[1]); for (let i = 2; i < points.length; i += 2) c.lineTo(points[i], points[i + 1]); c.closePath(); c.fillStyle = fill; c.fill();
  if (stroke) { c.lineWidth = line; c.strokeStyle = stroke; c.stroke(); }
}
function rounded(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string, line = 1): void {
  c.beginPath(); c.roundRect(x, y, w, h, r); c.fillStyle = fill; c.fill(); if (stroke) { c.lineWidth = line; c.strokeStyle = stroke; c.stroke(); }
}
const palettes = [
  { hair: "#233c65", light: "#5a78aa", coat: "#ed7790", trim: "#fff2d9", skin: "#f9d4bd", accent: "#ffd167" },
  { hair: "#a85457", light: "#ed9a83", coat: "#79b9ce", trim: "#f8f2e2", skin: "#f4c6aa", accent: "#ffca5a" },
  { hair: "#e4b866", light: "#fff0b4", coat: "#a68bc7", trim: "#fff5dc", skin: "#f6d1b8", accent: "#e57488" },
  { hair: "#534467", light: "#9d8bbb", coat: "#eea863", trim: "#fff6e3", skin: "#dca784", accent: "#ffe17c" },
  { hair: "#528b79", light: "#a4d8b1", coat: "#e68072", trim: "#fff3dd", skin: "#f5c9b2", accent: "#ffd36a" },
  { hair: "#6a4a42", light: "#b68972", coat: "#ebc665", trim: "#fffaeb", skin: "#d59978", accent: "#74c4cd" },
  { hair: "#b881a9", light: "#f5c7df", coat: "#7193be", trim: "#fff4e3", skin: "#f5cab3", accent: "#ffe6a1" },
  { hair: "#dce5e6", light: "#ffffff", coat: "#bb7889", trim: "#fff4db", skin: "#bc846d", accent: "#a8dfd1" },
];
// Hand-drawn vector silhouettes: each player has a different hair shape and outfit.
function character(c: CanvasRenderingContext2D, i: number, back: boolean, frame: number): void {
  const p = palettes[i], ink = "#3c3551", step = frame === 1 ? -2 : frame === 2 ? 2 : 0;
  const grad = (top: string, bottom: string, y1: number, y2: number) => {
    const g = c.createLinearGradient(0, y1, 0, y2); g.addColorStop(0, top); g.addColorStop(1, bottom); return g;
  };
  const path = (draw: () => void, fill: string | CanvasGradient, stroke = ink, width = 1.5) => {
    c.beginPath(); draw(); c.closePath(); c.fillStyle = fill; c.fill();
    c.strokeStyle = stroke; c.lineWidth = width; c.stroke();
  };
  const hair = grad(p.light, p.hair, 2, 40);
  // The back hair and side locks define eight different, readable silhouettes.
  if (i === 1 || i === 6) {
    path(() => { c.moveTo(14,18); c.bezierCurveTo(3,18,2,32,5,43); c.quadraticCurveTo(8,49,16,43); c.lineTo(19,26); }, hair);
    path(() => { c.moveTo(50,18); c.bezierCurveTo(61,18,62,32,59,43); c.quadraticCurveTo(56,49,48,43); c.lineTo(45,26); }, hair);
  } else if (i === 3) {
    path(() => { c.moveTo(45,13); c.bezierCurveTo(62,11,64,24,59,35); c.quadraticCurveTo(63,43,52,45); c.lineTo(42,31); }, hair);
  } else if (i === 4 || i === 7) {
    path(() => { c.moveTo(11,19); c.quadraticCurveTo(2,34,9,46); c.quadraticCurveTo(17,42,19,31); }, hair);
    path(() => { c.moveTo(53,19); c.quadraticCurveTo(62,34,55,46); c.quadraticCurveTo(47,42,45,31); }, hair);
  } else if (i === 2) {
    path(() => { c.moveTo(12,24); c.quadraticCurveTo(3,25,5,34); c.quadraticCurveTo(9,41,17,35); }, hair);
    path(() => { c.moveTo(52,24); c.quadraticCurveTo(61,25,59,34); c.quadraticCurveTo(55,41,47,35); }, hair);
  }
  ellipse(c,32,67,18,3,"rgba(37,51,65,.19)");
  // Boots, layered clothing and a central contrasting collar read at small sizes.
  rounded(c,21,53,9,11+step,4,"#4c4960",ink,1); rounded(c,34,53,9,11-step,4,"#4c4960",ink,1);
  rounded(c,19,60+step,12,6,3,"#f9efe4",ink,1); rounded(c,33,60-step,12,6,3,"#f9efe4",ink,1);
  path(() => { c.moveTo(22,41); c.quadraticCurveTo(32,37,42,41); c.quadraticCurveTo(47,48,47,59); c.quadraticCurveTo(32,63,17,59); c.quadraticCurveTo(17,48,22,41); }, grad(p.trim,p.coat,39,60));
  path(() => { c.moveTo(21,43); c.quadraticCurveTo(14,41,12,49+step/2); c.lineTo(14,55+step/2); c.lineTo(22,53); }, p.coat,ink,1.1);
  path(() => { c.moveTo(43,43); c.quadraticCurveTo(50,41,52,49-step/2); c.lineTo(50,55-step/2); c.lineTo(42,53); }, p.coat,ink,1.1);
  ellipse(c,16,55+step/2,3.5,3,p.skin,ink,.8); ellipse(c,48,55-step/2,3.5,3,p.skin,ink,.8);
  if (!back) {
    path(() => { c.moveTo(23,42); c.lineTo(32,48); c.lineTo(41,42); c.lineTo(38,51); c.lineTo(32,48); c.lineTo(26,51); }, p.trim,ink,.8);
    if (i % 3 === 0) { path(() => { c.moveTo(32,47); c.lineTo(27,49); c.lineTo(28,53); c.lineTo(32,51); c.lineTo(36,53); c.lineTo(37,49); },p.accent,ink,.7); }
    else if (i % 3 === 1) { rounded(c,25,54,14,3,1,p.accent,ink,.6); }
    else { path(() => { c.moveTo(29,49); c.lineTo(35,49); c.lineTo(34,56); c.lineTo(30,56); },p.accent,ink,.7); }
  } else { rounded(c,23,51,18,4,2,p.trim,ink,.7); }
  // Rounded back hair and a softly shaded face, with tapered bangs rather than blocky shapes.
  path(() => { c.moveTo(9,28); c.bezierCurveTo(8,12,18,4,32,4); c.bezierCurveTo(47,4,56,13,55,28); c.lineTo(51,38); c.quadraticCurveTo(32,47,13,38); },hair);
  if (!back) {
    path(() => { c.moveTo(14,25); c.bezierCurveTo(15,14,49,14,50,25); c.bezierCurveTo(51,37,45,43,32,44); c.bezierCurveTo(19,43,13,37,14,25); },grad("#fff0df",p.skin,19,43),ink,1.1);
    // Large eyes, upper lashes and light reflections are deliberately bold at game scale.
    ellipse(c,24,32,3.7,5.1,"#424057"); ellipse(c,40,32,3.7,5.1,"#424057");
    ellipse(c,23.2,30.5,1.4,1.7,"#fffdf4"); ellipse(c,39.2,30.5,1.4,1.7,"#fffdf4");
    ellipse(c,25,34.3,.8,.6,p.light); ellipse(c,41,34.3,.8,.6,p.light);
    ellipse(c,18,38,3,1.5,"rgba(228,115,130,.42)"); ellipse(c,46,38,3,1.5,"rgba(228,115,130,.42)");
    c.beginPath(); c.moveTo(30,39.5); c.quadraticCurveTo(32,41.5,34,39.5); c.strokeStyle="#a45f6d"; c.lineWidth=1.1; c.stroke();
    const part = [0,-3,2,4,-2,3,-4,1][i];
    path(() => { c.moveTo(10,26); c.bezierCurveTo(9,10,19,4,32,4); c.bezierCurveTo(46,4,55,12,54,26); c.quadraticCurveTo(51,30,48,31); c.quadraticCurveTo(46,23,42+part,19); c.quadraticCurveTo(42,27,36,29); c.quadraticCurveTo(34,24,32+part,20); c.quadraticCurveTo(28,29,21,30); c.quadraticCurveTo(20,25,19,23); c.quadraticCurveTo(16,31,12,33); },hair,ink,1.3);
  } else {
    path(() => { c.moveTo(10,27); c.bezierCurveTo(9,11,20,4,32,4); c.bezierCurveTo(46,4,55,12,54,27); c.quadraticCurveTo(54,40,47,42); c.quadraticCurveTo(32,46,17,42); c.quadraticCurveTo(10,39,10,27); },hair,ink,1.3);
    c.beginPath(); c.moveTo(39,15); c.quadraticCurveTo(45,25,43,35); c.strokeStyle="rgba(255,255,255,.32)"; c.lineWidth=1.3; c.stroke();
  }
  c.beginPath(); c.moveTo(17,17); c.quadraticCurveTo(23,10,31,10); c.strokeStyle="rgba(255,255,255,.55)"; c.lineWidth=2; c.stroke();
  // Individual accessories distinguish players even when their backs face the camera.
  if (i === 0 || i === 7) { ellipse(c,47,14,4.5,4.5,p.accent,ink,.8); ellipse(c,47,14,1.5,1.5,"#fff8e5"); }
  else if (i === 1 || i === 6) { path(() => { c.moveTo(10,14); c.quadraticCurveTo(4,8,4,16); c.lineTo(12,18); c.lineTo(19,15); c.quadraticCurveTo(19,8,13,13); },p.accent,ink,.8); ellipse(c,12,15,2,2,p.trim,ink,.6); }
  else if (i === 2 || i === 5) { rounded(c,37,8,12,3,1.5,p.accent,ink,.8); }
  else { path(() => { c.moveTo(11,15); c.lineTo(15,6); c.lineTo(22,9); c.lineTo(21,16); },p.accent,ink,.8); }
}
function icon(c: CanvasRenderingContext2D, type: string): void {
  const o = "#35445e";
  ellipse(c, 16, 26, 12, 3, "rgba(31,54,72,.18)");
  if (type === "boots") {
    shape(c,[7,5, 17,6, 17,16, 24,20, 25,25, 8,25, 7,21],"#72caa9",o,1.5); shape(c,[7,18, 17,18, 17,21, 8,21],"#edf8e7");
    shape(c,[3,14, 7,9, 6,16, 11,16, 5,22, 6,17, 2,17],"#ffe786",o,.7);
  } else if (type === "capacity") {
    ellipse(c,15,16,9,9,"#8e86df",o,1.5);ellipse(c,12,12,3,2,"#dcd6ff");rounded(c,13,5,4,3,1,"#ded8ff",o,.7);
    rounded(c,22,15,4,10,1,"#fff6bc",o,.7);rounded(c,19,18,10,4,1,"#fff6bc",o,.7);
  } else if (type === "range") {
    shape(c,[14,4,18,4,18,12,26,12,26,17,18,17,18,25,14,25,14,17,6,17,6,12,14,12],"#ffbf68",o,1.4);
    ellipse(c,16,14.5,4,4,"#fff1c5");
  } else if (type === "banana") {
    // Three curved yellow peel flaps and a dark stem read as a peel, not an arrow.
    c.lineWidth=1.4; c.strokeStyle=o; c.fillStyle="#ffd75c";
    c.beginPath(); c.moveTo(15,10); c.bezierCurveTo(12,14,10,20,4,22); c.quadraticCurveTo(7,27,13,23); c.lineTo(16,17); c.quadraticCurveTo(18,23,24,25); c.quadraticCurveTo(29,24,28,20); c.quadraticCurveTo(22,20,19,10); c.closePath(); c.fill(); c.stroke();
    c.fillStyle="#fff1a4"; c.beginPath(); c.moveTo(15,11); c.quadraticCurveTo(13,22,16,26); c.quadraticCurveTo(20,26,19,21); c.lineTo(18,11); c.closePath(); c.fill(); c.stroke();
    rounded(c,14,5,5,6,2,"#865441",o,.8);
  } else {
    // An icy-blue clock with a downward arrow communicates a slowing trap.
    ellipse(c,16,16,12,12,"#ddf6f2",o,1.4); ellipse(c,16,16,9,9,"#4f9fb8","#34758f",1);
    c.strokeStyle="#f8ffff"; c.lineWidth=2; c.beginPath(); c.moveTo(16,9); c.lineTo(16,16); c.lineTo(20,18); c.stroke();
    shape(c,[7,22,11,22,11,17,14,17,14,22,18,22,12.5,27],"#fff2a6",o,1);

  }
}
export function createArt(scene: Phaser.Scene): void {
  for (let variant=0; variant<3; variant++) texture(scene,`floor-${variant}`,32,32,c=>{
    c.fillStyle=["#d9e9df","#d5e6dc","#deece2"][variant]; c.fillRect(0,0,32,32);
    c.strokeStyle="rgba(99,147,140,.16)"; c.lineWidth=.65;c.strokeRect(.5,.5,31,31);
    c.strokeStyle="rgba(255,255,255,.45)";c.beginPath();c.moveTo(2,2);c.lineTo(30,2);c.stroke();
    if(variant===1){ellipse(c,7,23,2.2,1.2,"rgba(157,195,173,.35)");ellipse(c,9,21,1.2,2,"rgba(157,195,173,.35)");}
    if(variant===2){ellipse(c,24,8,1.4,1.4,"rgba(255,255,255,.55)");ellipse(c,6,8,.7,.7,"rgba(122,175,164,.3)");}
  });
  texture(scene,"wall",32,32,c=>{rounded(c,1,3,30,28,4,"#607d87","#344e60",1.2);rounded(c,2,1,28,24,4,"#91aeb0","#536e79",1.1);shape(c,[4,18,28,18,28,24,4,24],"#77969d");c.strokeStyle="#66868d";c.lineWidth=1;c.beginPath();c.moveTo(3,13);c.lineTo(29,13);c.moveTo(15,2);c.lineTo(15,13);c.moveTo(10,13);c.lineTo(10,23);c.moveTo(22,13);c.lineTo(22,23);c.stroke();c.strokeStyle="rgba(255,255,255,.5)";c.beginPath();c.moveTo(5,4);c.lineTo(12,4);c.stroke();});
  texture(scene,"crate",32,32,c=>{rounded(c,2,4,28,27,3,"#a66348","#624558",1.2);rounded(c,2,1,28,25,3,"#e4aa70","#875e4e",1.3);c.fillStyle="#c9855b";c.fillRect(5,5,22,17);c.strokeStyle="#a7654c";c.lineWidth=1;c.beginPath();c.moveTo(6,10);c.lineTo(26,10);c.moveTo(6,17);c.lineTo(26,17);c.stroke();shape(c,[5,5,9,5,27,20,27,23,23,23,5,8],"#f3c38b","#a86e51",.7);shape(c,[23,5,27,5,9,23,5,23,5,20],"#f6c58e","#a86e51",.7);for(const [x,y] of [[6,6],[26,6],[6,22],[26,22]])ellipse(c,x,y,.8,.8,"#6d5360");});
  texture(scene,"bomb",32,32,c=>{ellipse(c,16,26,11,3,"rgba(34,72,93,.2)");ellipse(c,16,17,10,10,"#408fb7","#315b83",1.4);ellipse(c,16,14,9,8,"#72d1dc");ellipse(c,12,11,4,2.5,"rgba(255,255,255,.8)");ellipse(c,20,19,2,1,"rgba(255,255,255,.45)");shape(c,[14,7,13,4,16,5,19,3,18,7],"#f28ba3","#624c6c",.8);ellipse(c,23,7,1.3,1.3,"#fff2b3");});
  for(const item of ["boots","capacity","range","banana","slowdown"]) texture(scene,`item-${item}`,32,32,c=>icon(c,item));
  for(let frame=0;frame<3;frame++) texture(scene,`splash-${frame}`,32,32,c=>{const s=frame===1?1:frame===0?.77:.88;c.save();c.translate(16,16);c.scale(s,s);ellipse(c,0,0,14,12,"rgba(122,221,242,.82)");shape(c,[-14,1,-10,-4,-11,-10,-5,-7,0,-14,4,-7,10,-11,9,-4,15,1,9,5,11,10,4,8,0,13,-4,8,-11,11,-9,5],"#b9f4fb","#67bfd8",.8);ellipse(c,0,0,7,6,"rgba(255,255,255,.72)");ellipse(c,-5,-3,2,1.5,"#fff");c.restore();});
  texture(scene,"landing",32,32,c=>{ellipse(c,16,20,13,7,"rgba(38,64,78,.26)");ellipse(c,16,20,9,4.5,"rgba(32,55,70,.19)");});
  texture(scene,"balloon",64,80,c=>{ellipse(c,32,30,22,27,"#e77883","#755970",1.8);ellipse(c,32,29,10,25,"#ffcf85");ellipse(c,25,17,4,8,"rgba(255,255,255,.3)");c.strokeStyle="#866675";c.lineWidth=1.5;c.beginPath();c.moveTo(17,51);c.lineTo(25,65);c.moveTo(47,51);c.lineTo(39,65);c.stroke();rounded(c,23,64,18,10,2,"#aa7659","#6b5260",1);c.strokeStyle="#ebbe88";c.beginPath();c.moveTo(25,68);c.lineTo(39,68);c.stroke();});
  for(let i=0;i<8;i++) for(const back of [false,true]) for(let frame=0;frame<3;frame++) texture(scene,`chibi-${i}-${back?"back":"front"}-${frame}`,64,72,c=>character(c,i,back,frame));
}
