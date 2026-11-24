/** Isolated development concept sketches; these do not select a network skin. */
export function drawStylePreview(canvas: HTMLCanvasElement, sprite: CanvasImageSource, style: number): void {
  const c = canvas.getContext("2d")!; c.clearRect(0, 0, canvas.width, canvas.height);
  c.lineCap = "round"; c.lineJoin = "round";
  const ellipse = (x: number, y: number, rx: number, ry: number, fill: string) => {
    c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fillStyle = fill; c.fill(); c.strokeStyle = "#354358"; c.lineWidth = 2.5; c.stroke();
  };
  const wheel = (x: number, y: number) => { ellipse(x, y, 12, 12, "#f6f7f0"); ellipse(x, y, 3, 3, "#82a8ad"); };
  c.fillStyle = "#eff8ee"; c.fillRect(0, 0, 160, 120);
  if (style === 2) { wheel(40, 94); wheel(120, 94); c.strokeStyle = "#d97985"; c.lineWidth = 4; c.beginPath(); c.moveTo(40,94); c.lineTo(67,66); c.lineTo(91,94); c.lineTo(40,94); c.lineTo(57,94); c.lineTo(82,66); c.lineTo(120,94); c.stroke(); }
  if (style === 3) { ellipse(84, 90, 42, 19, "#88c798"); ellipse(123, 76, 17, 16, "#9bd8a5"); ellipse(128, 73, 2, 3, "#384b55"); }
  if (style === 4) { c.fillStyle="#e8897f"; c.strokeStyle="#794b56"; c.lineWidth=3; c.beginPath(); c.roundRect(27,72,106,26,12); c.fill(); c.stroke(); wheel(45,98); wheel(115,98); }
  if (style === 6) { ellipse(80, 91, 44, 21, "#f5e8e5"); ellipse(122, 79, 18, 18, "#fff6ed"); ellipse(114, 56, 6, 18, "#fff6ed"); ellipse(128, 57, 6, 18, "#fff6ed"); ellipse(128, 78, 2, 3, "#654c55"); }
  if (style === 7) { c.strokeStyle="#946343"; c.lineWidth=6; c.beginPath(); c.moveTo(29,99); c.lineTo(126,85); c.stroke(); c.fillStyle="#e4bd69"; c.beginPath(); c.moveTo(23,94); c.lineTo(43,94); c.lineTo(38,107); c.lineTo(15,109); c.closePath(); c.fill(); }
  c.drawImage(sprite, 33, 0, 94, 105);
  if (style === 0 || style === 1) {
    ellipse(119, 89, 14, 14, style === 0 ? "#e99b5d" : "#fffdf5");
    c.strokeStyle="#465161"; c.lineWidth=1.5; c.beginPath();
    if (style === 0) { c.moveTo(105,89); c.lineTo(133,89); c.moveTo(119,75); c.lineTo(119,103); c.moveTo(110,78); c.quadraticCurveTo(121,88,111,100); }
    else { c.moveTo(114,84); c.lineTo(121,81); c.lineTo(126,87); c.lineTo(122,94); c.lineTo(115,93); c.closePath(); }
    c.stroke();
  }
  if (style === 5) { c.fillStyle="#d56c7e"; c.beginPath(); c.roundRect(31,96,100,7,4); c.fill(); wheel(49,106); wheel(113,106); }
}
