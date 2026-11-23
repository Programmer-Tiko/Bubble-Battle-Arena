import { Game } from "../packages/engine/dist/index.js";
import { BotController } from "../packages/bot/dist/index.js";

// Controlled headless fixture: initialize positions once, then use engine actions.
const game = new Game(["bot", "opponent"], { seed: 1, indestructibleDensity: 0, destructibleDensity: 0 });
const s = game.state, size = s.map.tileSize;
s.items = [];
s.players[0].x = 5.5 * size; s.players[0].y = 5.5 * size;
s.players[1].x = 5.5 * size; s.players[1].y = 6.5 * size;
game.placeBomb("opponent"); s.players[1].x = 10.5 * size; s.players[1].y = 9.5 * size;
const controller = new BotController("bot");
for (let tick = 0; tick < 105; tick++) {
  const before = game.getSnapshot(), command = controller.update(before);
  if (tick % 15 === 0 || command.placeBomb) {
    const debug = controller.debug(before, command), p = before.players[0];
    console.log(JSON.stringify({ time: tick/30, tile: [Math.floor(p.x/size), Math.floor(p.y/size)], state: debug.state, reason: debug.reason,
      destination: debug.destination, path: debug.path.map(w => [w.x,w.y]), danger: debug.danger.filter(d => d.x === Math.floor(p.x/size) && d.y === Math.floor(p.y/size)) }));
  }
  game.setInput("bot", command.input); if (command.placeBomb) game.placeBomb("bot"); game.step();
}
console.log(JSON.stringify({ result: game.getSnapshot().players[0].status }));
