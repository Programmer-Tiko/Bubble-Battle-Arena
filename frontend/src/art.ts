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
function character(c: CanvasRenderingContext2D, i: number, back: boolean, frame: number): void {
  const p = palettes[i], outline = "#303b55", step = frame === 1 ? -2 : frame === 2 ? 2 : 0;
  // Hair silhouette and a distinct accessory give each roster member a readable identity.
  if (i === 1 || i === 4) ellipse(c, 12, 29, 6, 13, p.hair, outline, 1.2);
  if (i === 1 || i === 6) ellipse(c, 52, 29, 6, 13, p.hair, outline, 1.2);
  if (i === 3) shape(c, [10,25, 3,33, 9,43, 17,34], p.hair, outline, 1.2);
  ellipse(c, 32, 66, 18, 4, "rgba(39,49,67,.20)");
  rounded(c, 21, 52, 9, 13 + step, 4, "#39455d", outline, 1.2); rounded(c, 34, 52, 9, 13 - step, 4, "#39455d", outline, 1.2);
  rounded(c, 19, 61 + step, 12, 6, 3, "#f8ecdd", outline, 1.2); rounded(c, 33, 61 - step, 12, 6, 3, "#f8ecdd", outline, 1.2);
  rounded(c, 17, 41, 30, 19, 9, p.coat, outline, 1.4);
  shape(c, [23,43, 32,49, 41,43, 38,52, 26,52], p.trim);
  rounded(c, 13, 44 + step / 2, 10, 13, 5, p.coat, outline, 1.2); rounded(c, 41, 44 - step / 2, 10, 13, 5, p.coat, outline, 1.2);
  ellipse(c, 17, 54 + step / 2, 4, 3, p.skin, outline, .8); ellipse(c, 47, 54 - step / 2, 4, 3, p.skin, outline, .8);
  ellipse(c, 32, 27, 23, 22, p.hair, outline, 1.5);
  if (!back) {
    ellipse(c, 32, 31, 18, 16, p.skin, outline, 1.1);
    ellipse(c, 25, 33, 2.8, 4, "#30344d"); ellipse(c, 39, 33, 2.8, 4, "#30344d");
    ellipse(c, 24.3, 31.7, .9, 1.2, "#fff"); ellipse(c, 38.3, 31.7, .9, 1.2, "#fff");
    ellipse(c, 19, 38, 3, 1.5, "rgba(239,119,132,.4)"); ellipse(c, 45, 38, 3, 1.5, "rgba(239,119,132,.4)");
    c.beginPath(); c.moveTo(30, 40); c.quadraticCurveTo(32, 42, 34, 40); c.strokeStyle = "#9d5c63"; c.lineWidth = 1; c.stroke();
    shape(c, [11,26, 13,15, 22,8, 38,7, 49,13, 53,26, 46,23, 43,28, 38,22, 32,27, 28,22, 21,27, 18,22], p.hair, outline, 1.2);
    shape(c, [16,17, 22,11, 30,10, 25,13, 19,18], p.light);
  } else {
    ellipse(c, 32, 27, 21, 20, p.hair, outline, 1.2);
    shape(c, [15,20, 20,12, 30,9, 25,13, 19,21], p.light);
    c.strokeStyle = p.light; c.lineWidth = 1; c.beginPath(); c.moveTo(38,13); c.quadraticCurveTo(43,21,42,34); c.stroke();
  }
  if (i % 4 === 0) { ellipse(c, 46, 13, 4, 4, p.accent, outline, .8); ellipse(c, 46, 13, 1.3, 1.3, "#fff7da"); }
  if (i % 4 === 1) { shape(c, [14,13, 8,10, 9,17, 15,16], p.accent, outline, .8); shape(c, [17,13, 22,9, 21,17, 16,16], p.accent, outline, .8); }
  if (i % 4 === 2) { rounded(c, 36, 8, 12, 3, 1, p.accent, outline, .7); }
  if (i % 4 === 3) { shape(c, [14,15, 17,7, 24,10, 23,15], p.accent, outline, .8); }
  ellipse(c, 32, 53, 2, 2, p.accent);
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
    shape(c,[15,5, 18,6, 18,11, 25,21, 21,24, 16,18, 12,25, 8,23, 12,14, 7,19, 5,16, 12,9],"#f7d766",o,1.4);
    rounded(c,14,4,4,4,1,"#886044");
  } else {
    ellipse(c,16,16,10,10,"#d6f4f2",o,1.3);ellipse(c,16,16,7,7,"#76bfd3");
    c.strokeStyle="#f8ffff"; c.lineWidth=1.5; for(let j=0;j<3;j++){c.save();c.translate(16,16);c.rotate(j*Math.PI/3);c.beginPath();c.moveTo(-6,0);c.lineTo(6,0);c.stroke();c.restore();}
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
  texture(scene,"landing",32,32,c=>{ellipse(c,16,16,13,10,"rgba(255,219,133,.35)","#d89450",1.5);ellipse(c,16,16,9,7,"rgba(255,247,202,.28)","#fff9d9",1.4);shape(c,[16,5,18,12,25,14,18,16,16,23,14,16,7,14,14,12],"rgba(255,251,213,.9)");});
  texture(scene,"balloon",64,80,c=>{ellipse(c,32,30,22,27,"#e77883","#755970",1.8);ellipse(c,32,29,10,25,"#ffcf85");ellipse(c,25,17,4,8,"rgba(255,255,255,.3)");c.strokeStyle="#866675";c.lineWidth=1.5;c.beginPath();c.moveTo(17,51);c.lineTo(25,65);c.moveTo(47,51);c.lineTo(39,65);c.stroke();rounded(c,23,64,18,10,2,"#aa7659","#6b5260",1);c.strokeStyle="#ebbe88";c.beginPath();c.moveTo(25,68);c.lineTo(39,68);c.stroke();});
  for(let i=0;i<8;i++) for(const back of [false,true]) for(let frame=0;frame<3;frame++) texture(scene,`chibi-${i}-${back?"back":"front"}-${frame}`,64,72,c=>character(c,i,back,frame));
}
