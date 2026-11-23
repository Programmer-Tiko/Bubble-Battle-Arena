import { createGameServer } from "./server.js";
const server = createGameServer({ botDebug: process.env.BOT_DEBUG === "1", snapshotEveryTicks: Number(process.env.SNAPSHOT_EVERY_TICKS ?? 3), staleInputMs: Number(process.env.INPUT_STALE_MS ?? 500), maxSessions: Number(process.env.MAX_SESSIONS ?? 32), maxConnections: Number(process.env.MAX_CONNECTIONS ?? 256), maxMembersPerSession: Number(process.env.MAX_SESSION_CONNECTIONS ?? 24), emptySessionMs: Number(process.env.EMPTY_SESSION_MS ?? 120000), completedSessionMs: Number(process.env.COMPLETED_SESSION_MS ?? 300000) });
const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError("Invalid port");
server.http.listen(port, "127.0.0.1", () => console.log(`Development game server: http://127.0.0.1:${port}`));
