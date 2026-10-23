# Deploy Loud + Cana

Use the full Node service for persistent order requests and the `/staff` dashboard. The application is hosted on Render, and a separate static collection website is published on GitHub Pages. A successful deployment does not establish commercial sales authorization or readiness to accept orders.

## Existing Render service

**Application:** https://loud-cana.onrender.com/

**Staff login page:** https://loud-cana.onrender.com/staff

The existing service deploys `main`. Deployment `46d4573` succeeded on 22 October 2026 after a production-install fix. The storefront, static assets, health check, product API, configuration endpoint, and staff login page returned HTTP 200. Public configuration reports catalog mode, with these setup requirements still missing:

| Setting | Action in Render → Environment |
| --- | --- |
| `DELIVERY_ZIPS` | Supply the client's actual approved four-digit delivery postal codes, separated by commas. |
| `ADMIN_PASSWORD` | Set a unique secret of at least 16 characters. Keep it in Render's secure settings, not chat or source. |
| `CATALOG_APPROVED` | Set to `true` only after the client approves the actual products, prices, and information. |
| `LEGAL_SALES_AUTHORIZATION_CONFIRMED` | Set to `true` only after the business confirms genuine commercial sales and delivery authorization. |
| `LIVE_ORDERS_ENABLED` | Enable only after the other setup requirements and operational acceptance checks below are complete. |

Some business fields pass the application's format checks. Their authenticity and the underlying sales authorization have not been independently verified. Before taking orders, confirm a persistent disk is mounted at `/var/data` and set `DATABASE_PATH=/var/data/orders.sqlite`; the disk configuration cannot be verified from the public API. Save the legitimate settings, redeploy, and check `/api/config` for `mode: "live"` with no missing requirements. Payment collection remains unconnected.

## Membership deployment

This release adds real member accounts independently of order activation. Signup and login do not require `LIVE_ORDERS_ENABLED`, catalog approval, or a configured staff password. Keep order intake disabled while the business requirements above are pending. The member service creates its tables in the same SQLite database on startup; no member credentials or signing secrets need to be added to source.

**Before accepting member registrations, verify the existing service's persistent disk and set `DATABASE_PATH=/var/data/orders.sqlite` with a disk mounted at `/var/data`. The current disk mount cannot be verified through the public API.** An ephemeral database can lose accounts, favourites, sessions, and order records on redeployment. The Blueprint includes a persistent disk, but an existing manually configured Render service must be checked in the owner's dashboard. Keep a tested backup and restore procedure.

After the latest `main` deployment, check `/api/health`, `/api/members/me`, `/membership`, `/signup`, `/login`, and `/account` on the actual HTTPS service. A guest request to `/api/members/me` should return `{ "member": null }`. In an authorized test environment, verify signup, logout/login, profile changes, cross-device favourites, password changes, and account deletion. Restart the test service once to confirm account and session persistence. Do not use a real customer's account for acceptance tests.

Passwords use salted scrypt hashes with a 12–128 character input limit. Member sessions expire after 30 days and use opaque tokens, hashed at rest, in HttpOnly SameSite cookies marked Secure in production. A password change replaces the current session and revokes other sessions. Account deletion requires the member's password and removes the member profile, saved favourites, and sessions; independent order records are not cancelled. Staff sessions and member sessions are separate.

No email verification or email-based password reset provider is connected. Registration does not prove email ownership or identity. The login help link goes to Contact rather than claiming to send a reset email. Add and test a genuine mail provider and recovery process before advertising those features.

The full service supports direct navigation and refresh on 14 routes: `/`, `/shop`, `/our-space`, `/about`, `/membership`, `/contact`, `/signup`, `/login`, `/account`, `/privacy`, `/terms`, `/responsible-use`, `/help`, and `/staff`. Unknown page paths show a page-not-found view. Account pages require member access; staff pages use their own authentication.

## Render: full application

[Open the official Deploy to Render flow for the prepared branch](https://render.com/deploy?repo=https://github.com/carlosreynaga674-del/Cana/tree/loud-cana-client-handoff). The blueprint creates a catalog-only service with live-intake flags disabled and an automatically generated staff password. It does not require fictitious licensing or store data. Review the paid persistent-disk service and sign in using the owner’s account.

1. Open the deployment link above, sign in to the client’s Render account, and connect GitHub if prompted. Select **`carlosreynaga674-del/Cana`**, branch **`loud-cana-client-handoff`**. The app is at the repository root; leave Root Directory blank. No code upload is needed for this repository.
2. Review the Blueprint and its **paid Starter service plus persistent disk**, then deploy. It already specifies Node 24, build command `npm ci --include=dev --no-audit --no-fund && npm run build`, start command `npm start`, health check `/api/health`, and a 1 GB disk at `/var/data`. Vite is included in the application's dependencies so manual production installs also have the build tool available.
3. Wait until Render reports a successful deployment. Open the service’s actual `https://…onrender.com` URL and `/api/health`. Keep the three intake flags `false` while the business information is pending. The site can be published in catalog mode immediately.
4. In **Environment**, retrieve the generated `ADMIN_PASSWORD` securely or set a new unique secret of at least 16 characters. Use that secret at **`/staff`**; never copy it into client-side code or the handoff ZIP.
5. Supply the genuine values in the table below. After the owner approves the real catalog and commercial sales authorization and completes the acceptance checks, enable the three intake flags and redeploy. Check `/api/config` for `mode: "live"` and no missing requirements.
6. Give the client the Render URL, or add their domain in Render’s **Settings → Custom Domains** and follow the displayed DNS records. Set `PUBLIC_ORIGIN` to that exact HTTPS origin, without a trailing slash or path. Render’s `RENDER_EXTERNAL_URL` supplies the default when no custom origin is configured.

The frontend and API run on the same Render origin. The self-contained GitHub Pages export deliberately operates without API requests; there is no supported environment setting that connects it to a separate Render backend. Use the full Render service URL as the ordering website. Keep `/var/data/orders.sqlite` on the persistent disk: an ephemeral filesystem is unsuitable for customer requests.

## Required configuration

| Variable                              | Value to supply                                                                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                            | `production` on the hosted service.                                                                                                      |
| `DATABASE_PATH`                       | `/var/data/orders.sqlite` on the persistent disk.                                                                                        |
| `ADMIN_PASSWORD`                      | A unique password of at least 16 characters, supplied securely by the owner. Never put it in source or client-side code.                 |
| `PUBLIC_ORIGIN`                       | Actual HTTPS site origin. Defaults to Render's external URL when available.                                                              |
| `BUSINESS_NAME`                       | Approved trading name.                                                                                                                   |
| `BUSINESS_JURISDICTION`               | Actual operating jurisdiction; this build is localized for Gauteng, South Africa.                                                        |
| `STORE_LICENSE_NUMBER`                | The business's valid commercial sales authorization/license reference. Do not invent one or assume private-use permission is sufficient. |
| `DELIVERY_ZIPS`                       | Comma-separated, approved four-digit postal codes.                                                                                       |
| `PICKUP_ADDRESS`                      | Actual authorized pickup location.                                                                                                       |
| `CONTACT_EMAIL`                       | Monitored customer-support email address.                                                                                                |
| `CATALOG_APPROVED`                    | `true` only after the business approves all actual product information and prices.                                                       |
| `LEGAL_SALES_AUTHORIZATION_CONFIRMED` | `true` only after the owner confirms lawful commercial sales and delivery authorization for the products and operating region.           |
| `LIVE_ORDERS_ENABLED`                 | Keep `false` while service details are pending; enable only after all launch requirements and the operational checks below are complete. |

The server exposes its current `demo`/`live` mode and missing setup requirements through `/api/config`. All launch requirements must be met before it accepts real order requests. Setting an individual flag does not replace the underlying business authorization, catalog approval, or operational process.

`PORT` is supplied by Render. For local development it defaults to 3000. The provided `.env.example` is a template, not a credential file. Real values belong in host settings or an ignored local environment file loaded through your chosen runtime command.

## Client acceptance before real requests

- Open the actual HTTPS storefront and `/api/health`; check that `/api/config` reports the intended mode and no unresolved launch requirements before enabling live requests.
- Sign in at `/staff` using the owner-supplied staff password. Check that incorrect passwords are rejected and that signing out ends staff access.
- In an authorized test environment, submit a clearly marked test request using an approved postal code. Confirm it appears in `/staff`, its totals match the catalog, and customer lookup reflects a staff status update.
- Restart or redeploy once and confirm that the test request remains on the persistent disk. Create and test a backup/restore procedure before relying on the database for customers. SQLite database files and their WAL/SHM files must be handled consistently during backup; prefer a supported SQLite backup operation or stop the service for a filesystem copy.
- Confirm the business's ID/age verification, support, cancellation, payment, and fulfillment processes. This build does not collect online payments or automatically verify identity or dispatch drivers.
- Replace sample copy/catalog data, confirm rand pricing and four-digit postal coverage, and complete the business's required privacy/terms review before launch.

## Static public catalog

The collection website is published at **https://carlosreynaga674-del.github.io/Cana/**. GitHub reports a successful build from `loud-cana-preview`, and the served HTML was verified against the tested standalone export. Real order intake remains disabled on this static catalog.

The **`loud-cana-preview`** branch contains the self-contained public website at its root. Pages is already configured to deploy from this branch. To review the configuration, open the repository’s **Settings → Pages → Deploy from a branch → loud-cana-preview → / (root)**. Pushing an updated branch triggers the next deployment.

For another static host, publish the **contents** of `static-site/`. Its self-contained `index.html` works at an origin root or a repository subpath such as `/Cana/` without extra base-path configuration. Internal pages use hash routes such as `#/shop`, so direct page links and refresh work without server rewrites. It supports browsing, filters, saved picks, the gallery, and a personal selection. Signup, login, and account buttons direct the visitor to the full Render website for real account access. The static files neither simulate authentication nor submit orders or produce simulated confirmations.

The reference-style design uses black, neon lime, bold lettering, and illustrative store imagery. The proposed 28-entry catalog includes accessories; actual products, prices, potency, and inventory still require business approval. A static site has no persistent server orders, staff authentication service, payment processor, or dispatch integration.

## Operating notes

The database contains member names, emails, password hashes, saved favourites, session hashes, age/terms acceptance records, and customer order details. Restrict staff and host access, use HTTPS, maintain tested backups, and apply the business's retention policy. Changing `ADMIN_PASSWORD` requires the business to distribute the new secret securely. Member passwords are set by members through the HTTPS account forms. Do not send passwords through chat or include them in the client ZIP.

Check service logs for errors while keeping customer data and secrets out of shared logs. Redeploy code changes through the normal Git/Render process; the data disk should remain mounted at the same path.
