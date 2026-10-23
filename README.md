# Loud + Cana

A black-and-neon-lime cannabis lifestyle website, member accounts, and gated order-request service for **Gauteng, South Africa**. The site has dedicated navigation pages, 28 proposed catalog selections, store concept photography, rand pricing, collection filters, product details, and a personal selection. The full Node service includes persistent member profiles and favourites, private order tracking, a separate staff dashboard, and SQLite storage.

The public site operates as an informational catalog, with no simulated checkout or fabricated order confirmations. Real requests remain disabled until actual business details, lawful commercial sales authorization, catalog approval, and secure staff access are supplied. No online payment, automatic identity verification, or driver dispatch is connected.

## Client handoff

Hosted full application: **https://loud-cana.onrender.com/**. Its storefront, product API, health check, and staff login page were verified after deployment of `46d4573` on 22 October 2026. This release adds member accounts and dedicated pages; confirm them on the hosted service after its latest deployment. Order intake remains separate and disabled until the remaining [deployment requirements](docs/DEPLOYMENT.md#existing-render-service) are completed.

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

The public navigation opens Home (`/`), Shop (`/shop`), Our Space (`/our-space`), About (`/about`), Membership (`/membership`), and Contact (`/contact`). Additional pages provide Signup (`/signup`), Login (`/login`), Account (`/account`), Privacy (`/privacy`), Terms (`/terms`), Responsible Use (`/responsible-use`), and Help (`/help`). Staff access is a separate fourteenth route at `/staff`. Unknown addresses show a page-not-found view with working navigation.

Free member signup and login work independently of order activation. Members can edit their name, save favourites across devices, change their password, sign out, or permanently close their account. Passwords are salted and hashed with scrypt; opaque session tokens are hashed in SQLite and sent to the browser in HttpOnly, SameSite cookies, marked Secure in production. Member sessions expire after 30 days. Password changes revoke other sessions, and account deletion removes member data and sessions without cancelling independent order requests. Email verification and email-based password reset are not connected; no reset email is simulated.

For frontend development, leave the Node service running and run `npm run dev` in a second terminal. Vite listens on port 5173 and proxies `/api` to the local Node service. Production uses `npm start`, not the Vite preview server.

## Hosting

The existing Render service deploys `main`. A production-install fix was pushed to `main` and `loud-cana-client-handoff`, and Render deployed it successfully. Manage the existing service rather than creating a duplicate. Hosting account credentials were not supplied to the agent.

**Before accepting member registrations or orders, confirm the existing Render service has a persistent disk mounted at `/var/data` and `DATABASE_PATH=/var/data/orders.sqlite`. Its current disk mount has not been verified from the public API.** Accounts, saved favourites, sessions, and order requests share that SQLite database; an ephemeral database can be lost during a redeployment. Maintain tested backups.

`render.yaml` is also available for a new Node service with persistent SQLite storage. Its [deployment flow](https://render.com/deploy?repo=https://github.com/carlosreynaga674-del/Cana/tree/loud-cana-client-handoff) uses a paid plan and persistent disk; review the cost before creating another service. Confirm the actual business configuration before taking orders. The full application uses same-origin API requests: give clients the Render URL or a custom domain attached to that service. The static Pages export does not connect to a separate order API.

GitHub Pages is already configured at **Settings → Pages → Deploy from a branch → loud-cana-preview → / (root)**. That branch contains the self-contained catalog; subsequent pushes trigger its public deployment.

Pages and the standalone export use hash routes such as `/Cana/#/shop`, so internal pages work without a server rewrite. Signup, login, and account access link to the full Render website, where real authentication is available. The static files never create local or simulated accounts.

The **Publish client preview** GitHub Actions workflow is an alternative after the workflow is available on the default branch and Pages is configured for GitHub Actions. The catalog does not accept order requests. **Validate and package client handoff** checks the app and saves downloadable build artifacts.

## Validation

```sh
npm test
npm run build
CANA_BASE_URL=http://127.0.0.1:3000 python3 tests/browser_smoke.py
python3 tests/standalone_smoke.py
python3 tests/live_browser_smoke.py
python3 tests/membership_browser_smoke.py
```

The 40 unit/API tests cover authoritative pricing, validation, private tracking, staff authentication, status transitions, idempotency, persistent member authentication, account controls, and safe restoration of browser state. Browser checks require Python Playwright and Chromium. The order and membership integration suites create isolated local servers and temporary databases; they do not enable the hosted store, register real customers, or send a real order. The membership suite covers desktop/mobile pages, signup, login, account controls, saved favourites, and persistence.

When legitimately activated, the backend calculates R49 delivery, waived at an R750 product subtotal; pickup is free. `LOUD15` applies 15% off the product subtotal. Catalog entries and prices are proposed content, and potency is unverified. Approve and replace them with the actual product information before enabling real requests.
