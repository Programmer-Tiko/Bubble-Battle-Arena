import bcrypt from "bcryptjs";
import express, { type NextFunction, type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import { loginPage, registerPage } from "./pages.js";
import type { UserStore } from "./users.js";

/** Shared with the game server, which must check the same values when it verifies a token. */
export const COOKIE_NAME = "token";
export const JWT_ISSUER = "bubble-auth";
export const JWT_AUDIENCE = "bubble-game";
export const TOKEN_SECONDS = 24 * 60 * 60; // 24 hours

export interface AuthOptions {
  users: UserStore;
  privateKey: string;
  /** true in production (HTTPS), so the cookie is only ever sent over TLS. */
  secureCookie: boolean;
  /** Exact origins allowed to POST, e.g. ["http://localhost:8080", "https://bubble.example.com"]. */
  allowedOrigins: string[];
  /** true when running behind nginx, so req.ip is the real user's address instead of nginx's. */
  trustProxy?: boolean;
  bcryptRounds?: number;
  tokenSeconds?: number;
}

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;

/**
 * Allows at most `max` requests per key in each time window, then answers 429.
 * Kept in memory: fine for a single auth container, and it resets when the container restarts.
 */
function rateLimit(keyOf: (req: Request) => string, max: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = keyOf(req);
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    if (entry.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      res.status(429).json({ error: "Too many attempts, please wait a minute" });
      return;
    }
    // Forget expired entries so the map can't grow forever
    if (hits.size > 10000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    next();
  };
}

/** Returns the username and password if they are valid, otherwise null. */
function readCredentials(body: unknown): { username: string; password: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const { username, password } = body as Record<string, unknown>;
  if (typeof username !== "string" || typeof password !== "string") return null;
  if (!USERNAME_PATTERN.test(username)) return null;
  // bcrypt only uses the first 72 bytes, so longer passwords are rejected instead of silently cut
  const bytes = Buffer.byteLength(password, "utf8");
  if (bytes < 8 || bytes > 72) return null;
  return { username, password };
}

export function createAuthApp(options: AuthOptions) {
  const rounds = options.bcryptRounds ?? 12;
  const tokenSeconds = options.tokenSeconds ?? TOKEN_SECONDS;
  // Compared against when the username doesn't exist, so a wrong username takes as long as a wrong password
  const dummyHash = bcrypt.hashSync("not-a-real-password", rounds);

  const cookie = (value: string, maxAgeSeconds: number) =>
    `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}` +
    (options.secureCookie ? "; Secure" : "");

  const app = express();
  app.disable("x-powered-by");
  // Behind nginx every request comes from nginx's address; trusting one proxy hop
  // makes req.ip the real client address (needed for per-user rate limits)
  app.set("trust proxy", options.trustProxy ? 1 : false);

  // XSRF protection, three layers:
  // 1. A browser POST from another site carries that site's Origin header, so reject it.
  //    (Requests with no Origin, like curl, can't use a victim's cookie anyway.)
  // 2. Every POST must be JSON: a form on another site can't send JSON without a CORS preflight.
  // 3. The cookie itself is SameSite=Strict.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "POST") {
      next();
      return;
    }
    const origin = req.get("origin");
    if (origin !== undefined && !options.allowedOrigins.includes(origin)) {
      res.status(403).json({ error: "Origin not allowed" });
      return;
    }
    if (!req.is("application/json")) {
      res.status(415).json({ error: "Requests must be JSON" });
      return;
    }
    next();
  });
  app.use(express.json({ limit: "2kb" }));

  // Brute force / bcrypt CPU protection. Per IP is generous because a whole classroom can share
  // one public IP; per account is strict because password guessing targets one username.
  const perIp = rateLimit(req => req.ip ?? "unknown", 60, 60_000);
  const perAccount = rateLimit(req => {
    const username = (req.body as { username?: unknown } | undefined)?.username;
    return `${req.ip}|${typeof username === "string" ? username.toLowerCase() : ""}`;
  }, 10, 60_000);

  app.get("/login", (_req, res) => { res.type("html").send(loginPage); });
  app.get("/register", (_req, res) => { res.type("html").send(registerPage); });

  app.post("/register", perIp, async (req, res) => {
    const credentials = readCredentials(req.body);
    if (!credentials) {
      res.status(400).json({ error: "Username must be 3-20 letters, numbers, or _ and the password 8-72 characters" });
      return;
    }
    const passwordHash = await bcrypt.hash(credentials.password, rounds);
    const user = await options.users.create(credentials.username, passwordHash);
    if (!user) {
      res.status(409).json({ error: "That username is taken" });
      return;
    }
    res.status(201).json({ username: user.username });
  });

  app.post("/login", perIp, perAccount, async (req, res) => {
    const credentials = readCredentials(req.body);
    const user = credentials ? await options.users.findByUsername(credentials.username) : null;
    const passwordMatches = await bcrypt.compare(credentials?.password ?? "", user?.passwordHash ?? dummyHash);
    if (!user || !passwordMatches) {
      // Same message either way, so attackers can't tell which usernames exist
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }
    const token = jwt.sign({ username: user.username }, options.privateKey, {
      algorithm: "RS256",
      subject: user.id,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      expiresIn: tokenSeconds,
    });
    res.setHeader("Set-Cookie", cookie(token, tokenSeconds));
    res.json({ username: user.username });
  });

  app.post("/logout", (_req, res) => {
    res.setHeader("Set-Cookie", cookie("", 0)); // Max-Age=0 tells the browser to delete it
    res.status(204).end();
  });

  // Bad JSON or anything unexpected: never send stack traces to the browser
  app.use((error: { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    const status = error.status === 400 || error.status === 413 ? error.status : 500;
    res.status(status).json({ error: status === 500 ? "Server error" : "Invalid request" });
  });

  return app;
}