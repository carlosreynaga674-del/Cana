# Loud + Cana

A black-and-neon-lime cannabis lifestyle website and gated order-request service for **Gauteng, South Africa**. The public site has 28 proposed catalog selections, store concept photography, rand pricing, collection filters, saved favourites, product details, and a persistent personal selection. The full Node service includes private tracking, a staff dashboard, and SQLite storage.

The public site operates as an informational catalog, with no simulated checkout or fabricated order confirmations. Real requests remain disabled until actual business details, lawful commercial sales authorization, catalog approval, and secure staff access are supplied. No online payment, automatic identity verification, or driver dispatch is connected.

## Client handoff

Hosted full application: **https://loud-cana.onrender.com/**. Its storefront, product API, health check, and staff login page were verified after deployment of `46d4573` on 22 October 2026. Order intake remains disabled; the remaining configuration is listed in [deployment instructions](docs/DEPLOYMENT.md#existing-render-service).

Static collection website: **https://carlosreynaga674-del.github.io/Cana/**. GitHub Pages and the published file were verified. Product prices, potency, and availability require store confirmation.

```sh
npm ci
npm test
npm run release
```

Use **Node.js 24**. The release contains:

- `release/loud-cana-preview.html`: a complete single-file collection website with no external dependencies. Works in restricted embedded frames without a local server.
- `release/loud-cana-client.zip`: standalone catalog, static site, full source, deployment instructions, and file checksums. Credentials, databases, and dependencies are excluded.

Read [client handoff instructions](docs/HANDOFF.md) and [deployment instructions](docs/DEPLOYMENT.md).

## Full application

```sh
npm run build
npm start
```

The Node service serves the app, API, and `/staff` from one origin on `PORT` (default 3000). An optional `.env` is loaded by `npm start`; copy `.env.example` and enter private values locally or directly in host settings. Never commit credentials.

For frontend development, leave the Node service running and run `npm run dev` in a second terminal. Vite listens on port 5173 and proxies `/api` to the local Node service. Production uses `npm start`, not the Vite preview server.

## Hosting

The existing Render service deploys `main`. A production-install fix was pushed to `main` and `loud-cana-client-handoff`, and Render deployed it successfully. Manage the existing service rather than creating a duplicate. Hosting account credentials were not supplied to the agent.

`render.yaml` is also available for a new Node service with persistent SQLite storage. Its [deployment flow](https://render.com/deploy?repo=https://github.com/carlosreynaga674-del/Cana/tree/loud-cana-client-handoff) uses a paid plan and persistent disk; review the cost before creating another service. Confirm the existing service's disk and actual business configuration before taking orders. The full application uses same-origin API requests: give clients the Render URL or a custom domain attached to that service. The static Pages export does not connect to a separate order API.

GitHub Pages is already configured at **Settings → Pages → Deploy from a branch → loud-cana-preview → / (root)**. That branch contains the self-contained catalog; subsequent pushes trigger its public deployment.

The **Publish client preview** GitHub Actions workflow is an alternative after the workflow is available on the default branch and Pages is configured for GitHub Actions. The catalog does not accept order requests. **Validate and package client handoff** checks the app and saves downloadable build artifacts.

## Validation

```sh
npm test
npm run build
CANA_BASE_URL=http://127.0.0.1:3000 python3 tests/browser_smoke.py
python3 tests/standalone_smoke.py
python3 tests/live_browser_smoke.py
```

Browser checks require Python Playwright and Chromium. The final integration suite creates an isolated local test server and temporary database with fictitious store configuration; it does not enable the running store or send a real order. Unit/API tests cover authoritative pricing, validation, private tracking, staff authentication, status transitions, idempotency, persistence, and safe restoration of browser state.

When legitimately activated, the backend calculates R49 delivery, waived at an R750 product subtotal; pickup is free. `LOUD15` applies 15% off the product subtotal. Catalog entries and prices are proposed content, and potency is unverified. Approve and replace them with the actual product information before enabling real requests.
