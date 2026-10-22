// Local-only browser-test fixture. This is not a real store or sales authorization.
// Never use this configuration for deployment or accepting customer orders.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../../server/app.mjs";

if (process.env.LC_RUN_TEST_FIXTURE !== "1") {
  throw new Error(
    "Run this local fixture through tests/live_browser_smoke.py only.",
  );
}
if (!process.env.LC_TEST_DATABASE_PATH) {
  throw new Error("A temporary test database path is required.");
}

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const server = createServer({
  dbPath: process.env.LC_TEST_DATABASE_PATH,
  adminPassword: "local-test-password-for-api-only",
  staticDir: path.join(root, "dist"),
  config: {
    businessName: "Loud + Cana Test Store",
    businessJurisdiction: "Local browser test fixture, Gauteng, ZA",
    storeLicenseNumber: "TEST-NOT-A-REAL-LICENSE",
    deliveryZips: ["2196"],
    pickupAddress: "123 Test Fixture Lane",
    contactEmail: "test@example.com",
    liveOrdersEnabled: true,
    legalSalesAuthorizationConfirmed: true,
    catalogApproved: true,
    production: false,
  },
});

server.listen(Number(process.env.LC_TEST_PORT || 0), "127.0.0.1", () => {
  console.log(`TEST_FIXTURE_URL=http://127.0.0.1:${server.address().port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 3000).unref();
  });
}
