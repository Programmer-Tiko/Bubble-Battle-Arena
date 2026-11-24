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

const app = createAuthApp({ users, privateKey: keys.privateKey, secureCookie: env.COOKIE_SECURE === "true" });
const port = Number(env.PORT ?? 3002);
app.listen(port, "0.0.0.0", () => console.log(`Auth server listening on port ${port}`));