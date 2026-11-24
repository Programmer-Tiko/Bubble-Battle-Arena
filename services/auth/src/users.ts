import type pg from "pg";

export interface UserRecord { id: string; username: string; passwordHash: string }

/** Storage used by the auth routes. Postgres in production; tests use a small in-memory version. */
export interface UserStore {
  /** Returns null when the username is already taken. */
  create(username: string, passwordHash: string): Promise<UserRecord | null>;
  findByUsername(username: string): Promise<UserRecord | null>;
}

export class PostgresUserStore implements UserStore {
  constructor(private readonly pool: pg.Pool) {}

  /** Creates the table on startup. Usernames are unique ignoring case, so "Bob" and "bob" can't both exist. */
  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await this.pool.query("CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (LOWER(username))");
  }

  async create(username: string, passwordHash: string): Promise<UserRecord | null> {
    try {
      const result = await this.pool.query<{ id: number }>(
        "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id",
        [username, passwordHash],
      );
      return { id: String(result.rows[0].id), username, passwordHash };
    } catch (error) {
      if ((error as { code?: string }).code === "23505") return null; // unique violation: name taken
      throw error;
    }
  }

  async findByUsername(username: string): Promise<UserRecord | null> {
    const result = await this.pool.query<{ id: number; username: string; password_hash: string }>(
      "SELECT id, username, password_hash FROM users WHERE LOWER(username) = LOWER($1)",
      [username],
    );
    const row = result.rows[0];
    return row ? { id: String(row.id), username: row.username, passwordHash: row.password_hash } : null;
  }
}