import express from "express";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { identityFromCookieHeader } from "./jwt.js";

export interface ProductionOptions {
  /** PEM public key from the auth server (shared read-only volume). */
  publicKey: string;
  /** Vite build output of the Phaser frontend (frontend/dist). */
  frontendDir: string;
  /** Small scripts owned by this service, like the account bar (services/game/public). */
  publicDir: string;
}

/**
 * Production HTTP app. Only what is listed here is exposed: no development session endpoints,
 * no unauthenticated gameplay. The Room Manager and the trusted-match adapter plug in here later.
 */
export function createProductionApp(options: ProductionOptions) {
  const app = express();
  app.disable("x-powered-by");

  // Who is logged in? Verified with the public key only (Objective 2).
  app.get("/api/me", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const identity = identityFromCookieHeader(req.headers.cookie, options.publicKey);
    if (!identity) {
      res.status(401).json({ error: "Not logged in" });
      return;
    }
    res.json({ username: identity.username });
  });

  // The home page is the built frontend, with the account bar script added to it
  const indexPath = join(options.frontendDir, "index.html");
  if (!existsSync(indexPath)) throw new Error(`Frontend build not found at ${indexPath}. Run npm run build first.`);
  const indexHtml = readFileSync(indexPath, "utf8").replace(
    "</body>",
    '    <script src="/account.js" defer></script>\n  </body>',
  );
  const sendIndex = (_req: express.Request, res: express.Response) => { res.type("html").send(indexHtml); };
  app.get("/", sendIndex);
  app.get("/index.html", sendIndex);

  app.use(express.static(options.publicDir, { index: false }));
  app.use(express.static(options.frontendDir, { index: false }));

  app.use((_req, res) => { res.status(404).type("text").send("Not found"); });
  return app;
}