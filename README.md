# Loud + Cana

A luxury cannabis collection website and gated order-request service for **Gauteng, South Africa**. The public site has 24 catalog selections, editorial photography, rand pricing, collection filters, saved favourites, product details, and a persistent personal selection. The full Node service includes private tracking, a staff dashboard, and SQLite storage.

The public site operates as an informational catalog, with no simulated checkout or fabricated order confirmations. Real requests remain disabled until actual business details, lawful commercial sales authorization, catalog approval, and secure staff access are supplied. No online payment, automatic identity verification, or driver dispatch is connected.

## Client handoff

Published collection website: **https://carlosreynaga674-del.github.io/Cana/**. GitHub Pages deployment and the published file were verified. Online order intake is not open. Product prices, potency, and availability require store confirmation.

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

[Deploy the prepared full service to Render](https://render.com/deploy?repo=https://github.com/carlosreynaga674-del/Cana/tree/loud-cana-client-handoff). This opens Render’s official deployment flow for this branch. The account owner must sign in and approve the persistent-disk service cost. No hosting account credentials were supplied to the agent.

`render.yaml` prepares a Node service with persistent SQLite storage. It uses a paid plan with a persistent disk; review the hosting cost before creating the service. The repository owner must connect the repository to their Render account and securely configure the actual store details. No public deployment is implied by the presence of this file.

For static catalog hosting, select **Settings → Pages → Deploy from a branch → loud-cana-preview → / (root)** and save. That branch contains the self-contained catalog. GitHub displays the actual URL once deployed. Pushing the branch alone does not publish the site.

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

When legitimately activated, the backend calculates R49 delivery, waived at an R750 product subtotal; pickup is free. `LOUD15` applies 15% off the product subtotal. Current products and potency values are sample content; approve and replace them before any lawful live launch.
