/** Visit one bomb's cross in the same order as the simulation. The callback
 * returns false when a ray must stop. It may update the map between visits. */
export function visitBlast(x: number, y: number, range: number, visit: (x: number, y: number) => boolean): void {
  visit(x, y);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (let distance = 1; distance <= range; distance++) {
      if (!visit(x + dx * distance, y + dy * distance)) break;
    }
  }
}
