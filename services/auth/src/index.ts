import pg from "pg";
import { createAuthApp } from "./app.js";
import { loadOrCreateKeys } from "./keys.js";
import { PostgresUserStore } from "./users.js";

const env = process.env;

const keys = loadOrCreateKeys(
  env.PRIVATE_KEY_PATH ?? "/keys/private/private.pem",
  env.PUBLIC_KEY_PATH ?? "/keys/public/public.pem",
);

const pool = new pg.Pool({
  host: env.DB_HOST ?? "postgres",
  user: env.POSTGRES_USER,
  password: env.POSTGRES_PASSWORD,
  database: env.POSTGRES_DB,
});
const users = new PostgresUserStore(pool);

// The database container can take a few seconds to accept connections
for (let attempt = 1; ; attempt++) {
  try {
    await users.init();
    break;
  } catch (error) {
    if (attempt >= 30) throw error;
    console.log(`Waiting for the database (attempt ${attempt})`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

// Secure cookies are ON unless explicitly turned off, so forgetting the variable in production is safe.
// Only the local docker compose setup (plain HTTP on localhost:8080) sets COOKIE_SECURE=false.
const secureCookie = env.COOKIE_SECURE !== "false";
if (!secureCookie) console.warn("WARNING: COOKIE_SECURE=false, cookies will be sent over plain HTTP (local development only)");

const allowedOrigins = (env.ALLOWED_ORIGINS ?? "http://localhost:8080").split(",").map(origin => origin.trim());

const app = createAuthApp({
  users,
  privateKey: keys.privateKey,
  secureCookie,
  allowedOrigins,
  trustProxy: env.TRUST_PROXY === "true",
});const port = Number(env.PORT ?? 3002);
app.listen(port, "0.0.0.0", () => console.log(`Auth server listening on port ${port}`));