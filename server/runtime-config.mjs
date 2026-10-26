import path from "node:path";

/** A missing production path must never silently create an ephemeral database. */
export function databasePathFromEnv(env = process.env, root = process.cwd()) {
  const configured = typeof env.DATABASE_PATH === "string" ? env.DATABASE_PATH.trim() : "";
  if (configured.includes("\0")) throw new Error("DATABASE_PATH must be a valid filesystem path.");
  if (env.NODE_ENV === "production" && (!configured || !path.isAbsolute(configured)))
    throw new Error("Production requires DATABASE_PATH set to an absolute path on persistent storage.");
  return configured || path.join(root, ".local", "orders.sqlite");
}
