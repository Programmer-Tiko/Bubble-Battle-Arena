import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createProductionApp } from "./production-app.js";

// Production entry point (used by Docker). The development server in index.ts is unchanged.
const env = process.env;
const publicKeyPath = env.PUBLIC_KEY_PATH ?? "/keys/public/public.pem";
const frontendDir = env.FRONTEND_DIR ?? fileURLToPath(new URL("../../../frontend/dist", import.meta.url));
const publicDir = env.PUBLIC_DIR ?? fileURLToPath(new URL("../public", import.meta.url));

// The auth container writes the public key the first time it starts, so wait for it
for (let attempt = 1; !existsSync(publicKeyPath); attempt++) {
  if (attempt > 60) throw new Error(`Public key not found at ${publicKeyPath}`);
  console.log(`Waiting for the auth server's public key (attempt ${attempt})`);
  await new Promise(resolve => setTimeout(resolve, 1000));
}
const publicKey = readFileSync(publicKeyPath, "utf8");

const app = createProductionApp({ publicKey, frontendDir, publicDir });
const port = Number(env.PORT ?? 3000);
createServer(app).listen(port, "0.0.0.0", () => console.log(`Production app listening on port ${port}`));