import jwt from "jsonwebtoken";

/** Must match services/auth/src/app.ts (a test checks that they stay the same). */
export const COOKIE_NAME = "token";
export const JWT_ISSUER = "bubble-auth";
export const JWT_AUDIENCE = "bubble-game";

/** Who a request or WebSocket belongs to. Only ever created from a verified JWT. */
export interface VerifiedIdentity {
  readonly subject: string;   // stable account ID (JWT "sub")
  readonly username: string;  // display name
  readonly expiresAt: number; // epoch seconds (JWT "exp")
}

/** Reads one cookie from a Cookie header like "a=1; token=abc". */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=") || null;
  }
  return null;
}

/**
 * Verifies a JWT locally with the auth server's public key: no call to the auth server and no database.
 * Rejects a bad signature, any algorithm except RS256 (including "none" and HS256 tricks),
 * the wrong issuer or audience, and expired tokens. Returns null if anything is wrong.
 */
export function verifyIdentity(token: string | null, publicKey: string): VerifiedIdentity | null {
  if (!token) return null;
  try {
    const claims = jwt.verify(token, publicKey, {
      algorithms: ["RS256"],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    if (typeof claims !== "object" || typeof claims.sub !== "string" || typeof claims.exp !== "number") return null;
    if (typeof claims.username !== "string") return null;
    return { subject: claims.sub, username: claims.username, expiresAt: claims.exp };
  } catch {
    return null;
  }
}

/** Convenience for HTTP requests and WebSocket handshakes, which both carry the Cookie header. */
export function identityFromCookieHeader(cookieHeader: string | undefined, publicKey: string): VerifiedIdentity | null {
  return verifyIdentity(readCookie(cookieHeader, COOKIE_NAME), publicKey);
}