import { createGameServer } from "./server.js";
const server = createGameServer({ snapshotEveryTicks: Number(process.env.SNAPSHOT_EVERY_TICKS ?? 3), staleInputMs: Number(process.env.INPUT_STALE_MS ?? 500) });
const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError("Invalid port");
server.http.listen(port, "127.0.0.1", () => console.log(`Development game server: http://127.0.0.1:${port}`));
