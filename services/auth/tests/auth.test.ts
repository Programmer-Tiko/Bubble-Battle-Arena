import { mkdtempSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jwt from "jsonwebtoken";
import { afterEach, describe, expect, it } from "vitest";
import { createAuthApp, JWT_AUDIENCE, JWT_ISSUER } from "../src/app.js";
import { loadOrCreateKeys } from "../src/keys.js";
import type { UserRecord, UserStore } from "../src/users.js";

/** Same behavior as PostgresUserStore, kept in memory so tests don't need a database. */
class MemoryUserStore implements UserStore {
  private users: UserRecord[] = [];
  async create(username: string, passwordHash: string) {
    if (await this.findByUsername(username)) return null;
    const user = { id: String(this.users.length + 1), username, passwordHash };
    this.users.push(user);
    return user;
  }
  async findByUsername(username: string) {
    return this.users.find(u => u.username.toLowerCase() === username.toLowerCase()) ?? null;
  }
}

const servers: { close: () => void }[] = [];
afterEach(() => servers.splice(0).forEach(s => s.close()));

function start() {
  const dir = mkdtempSync(join(tmpdir(), "auth-test-"));
  const keys = loadOrCreateKeys(join(dir, "private", "private.pem"), join(dir, "public", "public.pem"));
  const app = createAuthApp({ users: new MemoryUserStore(), privateKey: keys.privateKey, secureCookie: false, bcryptRounds: 4 });
  const server = app.listen(0);
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown) =>
    fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { base, post, keys };
}

describe("auth server", () => {
  it("registers a user and rejects duplicates ignoring case", async () => {
    const { post } = start();
    expect((await post("/register", { username: "Alice", password: "Password1!" })).status).toBe(201);
    expect((await post("/register", { username: "alice", password: "Password1!" })).status).toBe(409);
  });

  it("rejects invalid usernames and passwords", async () => {
    const { post } = start();
    for (const body of [
      { username: "<script>", password: "Password1!" },
      { username: "ab", password: "Password1!" },
      { username: "alice", password: "short" },
      { username: "alice", password: "x".repeat(73) },
      { username: "alice" },
    ]) {
      expect((await post("/register", body)).status).toBe(400);
    }
  });

  it("rejects non-JSON posts (XSRF from HTML forms)", async () => {
    const { base } = start();
    const response = await fetch(base + "/register", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "username=alice&password=Password1!",
    });
    expect(response.status).toBe(415);
  });

  it("gives the same error for a wrong password and an unknown user", async () => {
    const { post } = start();
    await post("/register", { username: "alice", password: "Password1!" });
    const wrongPassword = await post("/login", { username: "alice", password: "WrongPass1!" });
    const unknownUser = await post("/login", { username: "nobody", password: "Password1!" });
    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(await wrongPassword.json()).toEqual(await unknownUser.json());
    expect(wrongPassword.headers.get("set-cookie")).toBeNull();
  });

  it("logs in with an HttpOnly cookie holding an RS256 JWT that expires", async () => {
    const { post, keys } = start();
    await post("/register", { username: "alice", password: "Password1!" });
    const response = await post("/login", { username: "ALICE", password: "Password1!" });
    expect(response.status).toBe(200);

    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Max-Age=86400/);

    const token = cookie.split(";")[0].slice("token=".length);
    expect(jwt.decode(token, { complete: true })?.header.alg).toBe("RS256");
    const claims = jwt.verify(token, keys.publicKey, { algorithms: ["RS256"], issuer: JWT_ISSUER, audience: JWT_AUDIENCE }) as jwt.JwtPayload;
    expect(claims.sub).toBe("1");
    expect(claims.username).toBe("alice"); // the stored spelling, not what was typed at login
    expect(claims.exp! - claims.iat!).toBe(86400);
  });

  it("logout deletes the cookie", async () => {
    const { post } = start();
    const response = await post("/logout", {});
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toMatch(/^token=;.*Max-Age=0/);
  });

  it("keeps the same key across restarts", () => {
    const dir = mkdtempSync(join(tmpdir(), "auth-keys-"));
    const paths = [join(dir, "private", "private.pem"), join(dir, "public", "public.pem")] as const;
    const first = loadOrCreateKeys(...paths);
    const second = loadOrCreateKeys(...paths);
    expect(second.privateKey).toBe(first.privateKey);
    expect(readFileSync(paths[1], "utf8")).toBe(first.publicKey);
  });
});