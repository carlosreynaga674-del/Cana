# Deploy Loud + Cana

Use the full Node service for persistent order requests and the `/staff` dashboard. The application is hosted on Render, and a separate static collection website is published on GitHub Pages. A successful deployment does not establish commercial sales authorization or readiness to accept orders.

## Existing Render service

**Application:** https://loud-cana.onrender.com/

**Staff login page:** https://loud-cana.onrender.com/staff

The existing service deploys `main`. A public configuration check on 23 October 2026 confirmed that the storefront remains in catalog mode with the following two setup requirements missing. Check the actual current configuration again before launch:

| Setting | Action in Render → Environment |
| --- | --- |
| `DELIVERY_ZIPS` | Supply the client's actual approved four-digit delivery postal codes, separated by commas. |
| `ADMIN_PASSWORD` | Set a unique secret of at least 16 characters. Keep it in Render's secure settings, not chat or source. |

The public configuration reports `CATALOG_APPROVED`, `LEGAL_SALES_AUTHORIZATION_CONFIRMED`, and `LIVE_ORDERS_ENABLED` as enabled. Those flags and the supplied business fields have not been independently verified as genuine catalog approval or lawful commercial sales authorization. The owner must confirm those underlying facts before completing launch; keep intake disabled while they are unresolved. Do not fill the missing settings with invented postal codes or a password committed to source.

Before taking registrations or orders, confirm a persistent disk is mounted at `/var/data` and set `DATABASE_PATH=/var/data/orders.sqlite`; the disk configuration cannot be verified from the public API. The connected repository tools cannot change the existing service's private Render settings. Save legitimate settings in the owner's Render dashboard, redeploy, and check `/api/config` for the intended mode and missing requirements. Payment collection and automatic driver dispatch remain unconnected.

## Membership deployment

Member accounts operate independently of order activation. Adult signup and login do not require `LIVE_ORDERS_ENABLED` or catalog approval, but a configured **`ADMIN_PASSWORD`** and authorised staff are necessary to complete manual ID age verification. Keep order intake disabled while the business requirements above are pending. The member service creates and migrates its tables in the same SQLite database on startup; no member credentials or signing secrets belong in source.

Signup now uses a server-side 18+ date-of-birth check, separate age-check consent, and three random responsible-use questions. `GET /api/members/signup-challenge` creates a browser-bound 15-minute challenge with shuffled choices, at most three answer attempts, and single-use enforcement. New accounts are pending an in-person original-photo-ID review; accounts from earlier releases without that evidence require a new onboarding submission. A profile name change invalidates age verification. The questions and date declaration are not identity proof, and no automated verification provider is connected.

Configure the staff secret securely in Render, then use **`/staff` → Age Checks**. Staff must inspect the original valid government-issued photo ID against the person, full name, and declared birth date before recording both required attestations. Do not approve an unseen document or treat a questionnaire as verification. Order submission requires that the signed-in member has a recorded verified ID check in addition to every existing business-sales gate. See [the South African signup operating guide](SOUTH_AFRICAN_SIGNUP.md) before operating the review queue.

**Before accepting member registrations, verify the existing service's persistent disk and set `DATABASE_PATH=/var/data/orders.sqlite` with a disk mounted at `/var/data`. The current disk mount cannot be verified through the public API.** An ephemeral database can lose accounts, favourites, sessions, and order records on redeployment. The Blueprint includes a persistent disk, but an existing manually configured Render service must be checked in the owner's dashboard. Keep a tested backup and restore procedure.

After the latest `main` deployment, check `/api/health`, `/api/members/me`, `/membership`, `/signup`, `/login`, and `/account` on the actual HTTPS service. A guest request to `/api/members/me` should return `{ "member": null }`. In an authorised local test environment, verify under-18 and invalid-date rejection, random challenge replacement/expiry/replay limits, pending signup, legacy member onboarding, staff rejection and approval, birth-date purging, name-change invalidation, logout/login, profile changes, cross-device favourites, password changes, and account deletion. Verify a pending or rejected member cannot submit an order even if business-sales flags are enabled. Never record a real verification without inspecting a real original document. Restart the test service once to confirm account and session persistence. Do not use a real customer's account for acceptance tests.

Passwords use salted scrypt hashes with a 12–128 character input limit. Member sessions expire after 30 days and use opaque tokens, hashed at rest, in HttpOnly SameSite cookies marked Secure in production. A password change replaces the current session and revokes other sessions. Account deletion requires the member's password and removes the member profile, saved favourites, and sessions; independent order records are not cancelled. Staff sessions and member sessions are separate.

No email verification, email-based password reset, or automated identity-verification provider is connected. Registration and passing questions do not prove email ownership, identity, or age; only an actually performed in-person original-photo-ID check can be recorded as manually verified. The login help link goes to Contact rather than claiming to send a reset email. Add and test a genuine mail provider and recovery process before advertising those features.

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
- In an isolated authorised test environment, complete the member onboarding and simulated test-only staff verification, then submit a clearly marked test request using an approved postal code. Confirm it appears in `/staff`, its totals match the catalog, and customer lookup reflects a staff status update.
- Restart or redeploy once and confirm that the test request remains on the persistent disk. Create and test a backup/restore procedure before relying on the database for customers. SQLite database files and their WAL/SHM files must be handled consistently during backup; prefer a supported SQLite backup operation or stop the service for a filesystem copy.
- Confirm the business's original-photo-ID age-review, support, cancellation, payment, and fulfilment processes. Configure authorised staff access and train reviewers to compare the actual person and original ID. This build does not collect online payments, automatically verify identity, or dispatch drivers. The manual age-check workflow does not replace commercial sales authorisation.
- Replace sample copy/catalog data, confirm rand pricing and four-digit postal coverage, and complete the business's required privacy/terms review before launch.

## Static public catalog

The collection website is published at **https://carlosreynaga674-del.github.io/Cana/**. GitHub reports a successful build from `loud-cana-preview`, and the served HTML was verified against the tested standalone export. Real order intake remains disabled on this static catalog.

The **`loud-cana-preview`** branch contains the self-contained public website at its root. Pages is already configured to deploy from this branch. To review the configuration, open the repository’s **Settings → Pages → Deploy from a branch → loud-cana-preview → / (root)**. Pushing an updated branch triggers the next deployment.

For another static host, publish the **contents** of `static-site/`. Its self-contained `index.html` works at an origin root or a repository subpath such as `/Cana/` without extra base-path configuration. Internal pages use hash routes such as `#/shop`, so direct page links and refresh work without server rewrites. It supports browsing, filters, saved picks, the gallery, and a personal selection. Signup, login, and account buttons direct the visitor to the full Render website for real account access. The static files neither simulate authentication nor submit orders or produce simulated confirmations.

The reference-style design uses black, neon lime, bold lettering, and illustrative store imagery. The proposed 28-entry catalog includes accessories; actual products, prices, potency, and inventory still require business approval. A static site has no persistent server orders, staff authentication service, payment processor, or dispatch integration.

## Operating notes

The database contains member names, emails, password hashes, saved favourites, session hashes, age/terms acceptance records, temporary pending dates of birth, question identifiers/pass timestamps, verification status/audit metadata, and customer order details. No ID number or ID image is collected by the age-check flow. The live pending date of birth is removed after review or 30-day pending expiry; cleanup runs on startup, periodically while the process runs, and during onboarding/age-check operations. Historical backup copies need their own retention and deletion procedure. Restrict staff and host access, use HTTPS, maintain tested backups, and apply the business's retention policy. Changing `ADMIN_PASSWORD` requires the business to distribute the new secret securely. Member passwords are set by members through the HTTPS account forms. Do not send passwords through chat or include them in the client ZIP.

Before collecting production identity-related data, the owner must supply the genuine responsible-party/contact details, document a lawful processing basis and retention schedule, verify operator agreements/security, review the actual cross-border hosting basis under POPIA section 72, and account for DOB copies in backups. These operational duties cannot be completed by changing an application flag; see [the legal and operating guide](SOUTH_AFRICAN_SIGNUP.md).

Check service logs for errors while keeping customer data and secrets out of shared logs. Redeploy code changes through the normal Git/Render process; the data disk should remain mounted at the same path.
