# Deploy Loud + Cana

Use the full Node service for persistent order requests and the `/staff` dashboard. Use static hosting for the public collection website. The collection website is already published on GitHub Pages. This guide covers the separate Node service; a Render deployment and commercial sales authorization are not implied.

## Render: full application

[Open the official Deploy to Render flow for the prepared branch](https://render.com/deploy?repo=https://github.com/carlosreynaga674-del/Cana/tree/loud-cana-client-handoff). The blueprint creates a catalog-only service with live-intake flags disabled and an automatically generated staff password. It does not require fictitious licensing or store data. Review the paid persistent-disk service and sign in using the owner’s account.

1. Open the deployment link above, sign in to the client’s Render account, and connect GitHub if prompted. Select **`carlosreynaga674-del/Cana`**, branch **`loud-cana-client-handoff`**. The app is at the repository root; leave Root Directory blank. No code upload is needed for this repository.
2. Review the Blueprint and its **paid Starter service plus persistent disk**, then deploy. It already specifies Node 24, build command `npm ci --no-audit --no-fund && npm run build`, start command `npm start`, health check `/api/health`, and a 1 GB disk at `/var/data`.
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

For another static host, publish the **contents** of `static-site/`. Its self-contained `index.html` works at an origin root or a repository subpath such as `/Cana/` without extra base-path configuration. It supports browsing, filters, saved picks, the gallery, and a personal selection. It does not submit orders or produce simulated confirmations.

The reference-style design uses black, neon lime, bold lettering, and illustrative store imagery. The proposed 28-entry catalog includes accessories; actual products, prices, potency, and inventory still require business approval. A static site has no persistent server orders, staff authentication service, payment processor, or dispatch integration.

## Operating notes

The database contains customer contact and delivery details. Restrict staff and host access, use HTTPS, maintain tested backups, and apply the business's retention policy. Changing `ADMIN_PASSWORD` requires the business to distribute the new secret securely. Do not send passwords through chat or include them in the client ZIP.

Check service logs for errors while keeping customer data and secrets out of shared logs. Redeploy code changes through the normal Git/Render process; the data disk should remain mounted at the same path.
