# Deploy Loud + Cana

Use the full Node service for persistent order requests and the `/staff` dashboard. Use static hosting only for a client-review demo. This guide prepares a deployment; it does not claim the app has been published or that the business is authorized for commercial cannabis sales.

## Render: full application

1. Put the complete `source/` contents in the intended GitHub repository and branch. Do not commit real `.env` files, passwords, or `.local/` databases.
2. In Render, create a Node **Web Service** from that repository. Use `render.yaml` as a Blueprint if desired, or configure manually. If the code is in a subfolder, set Render's root directory to that folder.
3. Use **Node.js 24**, build command `npm ci && npm run build`, and start command `npm start`. Set the health-check path to `/api/health`.
4. Use a plan supporting a **persistent disk** (for example, Render Starter with a disk). Mount the disk at `/var/data`, and set `DATABASE_PATH=/var/data/orders.sqlite`. An ephemeral filesystem is unsuitable for client orders: deploys or restarts can remove an unmounted SQLite database.
5. Add configuration in Render's environment settings. Enter the staff password as a secret. Start in demo mode, deploy, and use the actual Render URL returned by the service.
6. Set `PUBLIC_ORIGIN` to the exact HTTPS origin of the deployed site, without a trailing slash or path, especially when using a custom domain. Render's `RENDER_EXTERNAL_URL` is used automatically when no explicit origin is configured.

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
| `LIVE_ORDERS_ENABLED`                 | Keep `false` during client review; enable only after all launch requirements and the operational checks below are complete.              |

The server exposes its current `demo`/`live` mode and missing setup requirements through `/api/config`. All launch requirements must be met before it accepts real order requests. Setting an individual flag does not replace the underlying business authorization, catalog approval, or operational process.

`PORT` is supplied by Render. For local development it defaults to 3000. The provided `.env.example` is a template, not a credential file. Real values belong in host settings or an ignored local environment file loaded through your chosen runtime command.

## Client acceptance before real requests

- Open the actual HTTPS storefront and `/api/health`; check that `/api/config` reports the intended mode and no unresolved launch requirements before enabling live requests.
- Sign in at `/staff` using the owner-supplied staff password. Check that incorrect passwords are rejected and that signing out ends staff access.
- In an authorized test environment, submit a clearly marked test request using an approved postal code. Confirm it appears in `/staff`, its totals match the catalog, and customer lookup reflects a staff status update.
- Restart or redeploy once and confirm that the test request remains on the persistent disk. Create and test a backup/restore procedure before relying on the database for customers. SQLite database files and their WAL/SHM files must be handled consistently during backup; prefer a supported SQLite backup operation or stop the service for a filesystem copy.
- Confirm the business's ID/age verification, support, cancellation, payment, and fulfillment processes. This build does not collect online payments or automatically verify identity or dispatch drivers.
- Replace sample copy/catalog data, confirm rand pricing and four-digit postal coverage, and complete the business's required privacy/terms review before launch.

## Static public demo

The prepared repository also has a **`loud-cana-preview`** branch containing the tested single-file site at its root. For the quickest public demo, open the repository's **Settings → Pages**, choose **Deploy from a branch**, select **`loud-cana-preview`** and **`/ (root)`**, then save. GitHub displays the actual site URL after deployment. The API connection in this environment could not enable Pages automatically; the branch alone does not establish that Pages is published.

Publish the **contents** of `static-site/`. Its `index.html` is the self-contained offline preview, so it works at an origin root or a repository subpath such as `/Cana/` without additional base-path configuration. It can demonstrate browsing, cart, and demo checkout without a Node service. For GitHub Pages, use the provided repository deployment workflow when present, or upload the built directory through your normal Pages process.

A static site has no persistent server orders, staff authentication service, or dispatch integration. Do not present its local demo confirmations as actual accepted orders.

## Operating notes

The database contains customer contact and delivery details. Restrict staff and host access, use HTTPS, maintain tested backups, and apply the business's retention policy. Changing `ADMIN_PASSWORD` requires the business to distribute the new secret securely. Do not send passwords through chat or include them in the client ZIP.

Check service logs for errors while keeping customer data and secrets out of shared logs. Redeploy code changes through the normal Git/Render process; the data disk should remain mounted at the same path.
