# Loud + Cana

A cannabis storefront and order-request service localized for **Gauteng, South Africa**. Includes a responsive catalog, rand pricing, saved picks, age confirmation, delivery/pickup, promotions, private order tracking, a staff dashboard, and persistent SQLite order storage.

The app starts in client preview mode. Real requests remain disabled until actual business details, lawful commercial sales authorization, catalog approval, and secure staff access are supplied. No online payment, automatic identity verification, or driver dispatch is connected.

## Client handoff

Published client preview: **https://carlosreynaga674-del.github.io/Cana/**. GitHub Pages deployment and the published file were verified. This is a demo storefront, not live order intake.

```sh
npm ci
npm test
npm run release
```

Use **Node.js 24**. The release contains:

- `release/loud-cana-preview.html`: a complete single-file client demo with no external dependencies. Works in restricted embedded frames without a local server.
- `release/loud-cana-client.zip`: standalone preview, static demo, full source, deployment instructions, and file checksums. Credentials, databases, and dependencies are excluded.

Read [client handoff instructions](docs/HANDOFF.md) and [deployment instructions](docs/DEPLOYMENT.md).

## Full application

```sh
npm run build
npm start
```

The Node service serves the app, API, and `/staff` from one origin on `PORT` (default 3000). An optional `.env` is loaded by `npm start`; copy `.env.example` and enter private values locally or directly in host settings. Never commit credentials.

For frontend development, leave the Node service running and run `npm run dev` in a second terminal. Vite listens on port 5173 and proxies `/api` to the local Node service. Production uses `npm start`, not the Vite preview server.

## Hosting

`render.yaml` prepares a Node service with persistent SQLite storage. It uses a paid plan with a persistent disk; review the hosting cost before creating the service. The repository owner must connect the repository to their Render account and securely configure the actual store details. No public deployment is implied by the presence of this file.

For the quickest public demo, select **Settings → Pages → Deploy from a branch → loud-cana-preview → / (root)** and save. That branch contains the self-contained demo. GitHub displays the actual URL once deployed. Pushing the branch alone does not publish the site.

The **Publish client preview** GitHub Actions workflow is an alternative after the workflow is available on the default branch and Pages is configured for GitHub Actions. The demo does not accept real requests. **Validate and package client handoff** checks the app and saves downloadable build artifacts.

## Validation

```sh
npm test
npm run build
CANA_BASE_URL=http://127.0.0.1:3000 python3 tests/browser_smoke.py
python3 tests/standalone_smoke.py
python3 tests/live_browser_smoke.py
```

Browser checks require Python Playwright and Chromium. The final integration suite creates an isolated local test server and temporary database with fictitious store configuration; it does not enable the running store or send a real order. Unit/API tests cover authoritative pricing, validation, private tracking, staff authentication, status transitions, idempotency, persistence, and safe restoration of browser state.

Delivery is R49, free at an R750 product subtotal; pickup is free. `LOUD15` applies 15% off the product subtotal. Current products and potency values are sample content; approve and replace them before any lawful live launch.
