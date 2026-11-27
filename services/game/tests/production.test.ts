import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jwt from "jsonwebtoken";
import { afterEach, describe, expect, it } from "vitest";
import * as authApp from "../../auth/src/app.js";
import { COOKIE_NAME, JWT_AUDIENCE, JWT_ISSUER, readCookie, verifyIdentity } from "../src/jwt.js";
import { createProductionApp } from "../src/production-app.js";

/** A fresh RSA key pair as PEM text, like the auth server creates. */
function pemKeys() {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}
const keys = pemKeys();
const otherKeys = pemKeys();

/** Signs a token the way the auth server does; overrides let tests break one thing at a time. */
function sign(overrides: Partial<jwt.SignOptions> = {}, payload: object = { username: "alice" }, key: string = keys.privateKey) {
  return jwt.sign(payload, key, { algorithm: "RS256", subject: "1", issuer: JWT_ISSUER, audience: JWT_AUDIENCE, expiresIn: 3600, ...overrides });
}

describe("JWT verification", () => {
  it("uses the same cookie name, issuer, and audience as the auth server", () => {
    expect([COOKIE_NAME, JWT_ISSUER, JWT_AUDIENCE]).toEqual([authApp.COOKIE_NAME, authApp.JWT_ISSUER, authApp.JWT_AUDIENCE]);
  });

  it("accepts a valid RS256 token", () => {
    expect(verifyIdentity(sign(), keys.publicKey)).toMatchObject({ subject: "1", username: "alice" });
  });

  it("rejects expired, forged, wrong-algorithm, wrong-issuer, and wrong-audience tokens", () => {
    const expired = jwt.sign({ username: "alice", exp: Math.floor(Date.now() / 1000) - 10 }, keys.privateKey, { algorithm: "RS256", subject: "1", issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
    const otherKey = sign({}, { username: "alice" }, otherKeys.privateKey);
    // Classic attack: sign with HS256 using the PUBLIC key as the shared secret
    const hs256 = jwt.sign({ username: "alice" }, Buffer.from(keys.publicKey), { algorithm: "HS256", subject: "1", issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
    const none = jwt.sign({ username: "alice", sub: "1", iss: JWT_ISSUER, aud: JWT_AUDIENCE }, "", { algorithm: "none" });
    const wrongIssuer = sign({ issuer: "someone-else" });
    const wrongAudience = sign({ audience: "another-app" });
    const tampered = sign().replace(/\.([^.]+)\./, (_m, body: string) => {
      const claims = JSON.parse(Buffer.from(body, "base64url").toString());
      return "." + Buffer.from(JSON.stringify({ ...claims, username: "admin" })).toString("base64url") + ".";
    });
    for (const token of [expired, otherKey, hs256, none, wrongIssuer, wrongAudience, tampered, "garbage", ""]) {
      expect(verifyIdentity(token, keys.publicKey)).toBeNull();
    }
  });

  it("reads the token cookie from a Cookie header", () => {
    expect(readCookie("a=1; token=abc.def; b=2", "token")).toBe("abc.def");
    expect(readCookie("a=1", "token")).toBeNull();
    expect(readCookie(undefined, "token")).toBeNull();
  });
});

describe("production app", () => {
  const servers: { close: () => void }[] = [];
  afterEach(() => servers.splice(0).forEach(s => s.close()));

  function start() {
    const frontendDir = mkdtempSync(join(tmpdir(), "frontend-"));
    writeFileSync(join(frontendDir, "index.html"), "<html><body><div id=\"game\"></div></body></html>");
    const publicDir = mkdtempSync(join(tmpdir(), "public-"));
    writeFileSync(join(publicDir, "account.js"), "// account bar");
    const server = createProductionApp({ publicKey: keys.publicKey, frontendDir, publicDir }).listen(0);
    servers.push(server);
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it("serves the frontend at / with the account bar script", async () => {
    const base = start();
    const response = await fetch(base + "/");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('id="game"');
    expect(html).toContain('<script src="/account.js" defer></script>');
    expect((await fetch(base + "/account.js")).status).toBe(200);
  });

  it("GET /api/me returns the username only for a valid token", async () => {
    const base = start();
    expect((await fetch(base + "/api/me")).status).toBe(401);
    expect((await fetch(base + "/api/me", { headers: { Cookie: `token=${sign({ expiresIn: -10 })}` } })).status).toBe(401);
    const response = await fetch(base + "/api/me", { headers: { Cookie: `token=${sign()}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ username: "alice" });
  });

  it("does not expose development endpoints", async () => {
    const base = start();
    const create = await fetch(base + "/dev/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "ffa", players: 4 }) });
    expect(create.status).toBe(404);
    expect((await fetch(base + "/socket.io/?EIO=4&transport=polling")).status).toBe(404);
  });
});