import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, configFromEnv } from "./app.mjs";
import { identityConfigFromEnv } from "./identity.mjs";
import { mailConfigFromEnv } from "./welcome-mail.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT must be between 1 and 65535.");
const server = createServer({
  dbPath:
    process.env.DATABASE_PATH || path.join(root, ".local", "orders.sqlite"),
  config: configFromEnv(),
  adminPassword: process.env.ADMIN_PASSWORD || "",
  staffPassword: process.env.STAFF_PASSWORD || "",
  identityConfig: identityConfigFromEnv(),
  mailConfig: mailConfigFromEnv(),
  staticDir: path.join(root, "dist"),
});
server.listen(port, "0.0.0.0", () =>
  console.log(
    `Loud + Cana server listening on port ${port}. Live requests require all configured launch gates.`,
  ),
);
function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
