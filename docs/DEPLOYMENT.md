# Deploy Loud + Cana

Use the full Node service for persistent order requests and the protected `/admin` and `/staff` workspaces. The application is hosted on Render, and a separate static collection website is published on GitHub Pages. A successful deployment does not establish commercial sales authorization or readiness to accept orders.

## Existing Render service

**Application:** https://loud-cana.onrender.com/

**Shared login:** https://loud-cana.onrender.com/login

**Administrator workspace:** https://loud-cana.onrender.com/admin

**Staff operations:** https://loud-cana.onrender.com/staff

The existing service deploys `main`. A public configuration check on 23 October 2026 reported `DELIVERY_ZIPS` and `ADMIN_PASSWORD` missing. This release additionally needs an independent upload-encryption key before it can accept ID/selfie images. Complete the following private hosting settings and recheck actual service readiness:

| Setting | Action in Render → Environment |
| --- | --- |
| `DELIVERY_ZIPS` | Supply the client's actual approved four-digit delivery postal codes, separated by commas. |
| `ADMIN_PASSWORD` | Set a unique administrator secret of at least 16 characters. Keep it in Render's secure settings, not chat or source. |
| `STAFF_PASSWORD` | Configure a separate secret of at least 16 characters before using the staff role. It must differ from `ADMIN_PASSWORD`; leave staff access unavailable until a genuine secret is set. |
| `IDENTITY_UPLOAD_KEY` | Supply an independent, stable 64-character hexadecimal key in secure settings. Generate privately with `openssl rand -hex 32`; never put the result in source, chat, build logs or the package. |

The public configuration reports `CATALOG_APPROVED`, `LEGAL_SALES_AUTHORIZATION_CONFIRMED`, and `LIVE_ORDERS_ENABLED` as enabled. Those flags and the supplied business fields have not been independently verified as genuine catalog approval or lawful commercial sales authorization. The owner must confirm those underlying facts before completing launch; keep intake disabled while they are unresolved. Do not fill the missing settings with invented postal codes or a password committed to source.

Before taking registrations or orders, confirm a persistent disk is mounted at `/var/data` and set `DATABASE_PATH=/var/data/orders.sqlite`; the disk configuration cannot be verified from the public API. The connected repository tools cannot change the existing service's private Render settings. Save legitimate settings in the owner's Render dashboard, redeploy, and check `/api/config` for the intended mode and missing requirements. Payment collection and automatic driver dispatch remain unconnected.

## Membership deployment

Members, administrators and staff use the same **`/login`** page. Members enter their registered email; the literal workforce usernames are **`admin`** and **`staff`**. Server-validated roles route to **`/account`**, **`/admin`** and **`/staff`** respectively. `ADMIN_PASSWORD` configures administrator access, while a separate `STAFF_PASSWORD` of at least 16 characters, different from the admin secret, enables staff access. The existing admin credential remains the administrator credential. Staff do not receive access merely by choosing a route or entering a member email.

Member accounts operate independently of order activation. Account access does not require `LIVE_ORDERS_ENABLED` or catalog approval, but authorised management access is necessary for member management, product management and manual review. Configure `ADMIN_PASSWORD` for the administrator role and a distinct `STAFF_PASSWORD` for workforce staff; each role stays unavailable until its own valid secret is configured. New identity submissions additionally require a valid **`IDENTITY_UPLOAD_KEY`**; missing or invalid key configuration rejects image submission instead of storing unprotected photographs. An account remains restricted until its required ID/selfie review is completed. Keep order intake disabled while the business requirements above are pending. The member service creates and migrates its tables in the same SQLite database on startup; no member credentials or signing secrets belong in source.

Signup now uses a server-side 18+ date-of-birth check, separate age-check consent, and three random responsible-use questions. `GET /api/members/signup-challenge` creates a browser-bound 15-minute challenge with shuffled choices, at most three answer attempts, and single-use enforcement. New applications also require a government-issued photo ID image and a face photograph through the authenticated secure account flow, with specific upload/review consent. The member remains restricted until manual staff review. Older applications retain their legacy original-ID path, but new submissions use the ID/selfie workflow. A profile name change invalidates age verification and removes pending images. Questions, dates and image uploads are not an automatic identity result; no automated face matching, liveness service or third-party identity provider is connected.

Configure the staff and upload secrets securely in Render, then use **`/staff` → Age Checks**. Staff privately view the submitted ID and selfie, compare the ID photograph, full name and birth date against the selfie and application, and record both required identity-comparison and 18+ attestations through the confirmation step. Do not approve an unseen image or treat a questionnaire as verification. An uploaded photograph does not prove a document is genuine or the person is live. Legacy in-person original-ID reviews are available only for older records. Order submission still requires a currently verified signed-in member plus every business-sales gate. Read [the South African signup guide](SOUTH_AFRICAN_SIGNUP.md) and [encrypted upload instructions](IDENTITY_VERIFICATION.md) before operating the queue. Do not request ID images by email or a contact form.

**Before accepting member registrations, verify the existing service's persistent disk and set `DATABASE_PATH=/var/data/orders.sqlite` with a disk mounted at `/var/data`. The current disk mount cannot be verified through the public API.** An ephemeral database can lose accounts, favourites, sessions, and order records on redeployment. The Blueprint includes a persistent disk, but an existing manually configured Render service must be checked in the owner's dashboard. Keep a tested backup and restore procedure.

After the latest `main` deployment, check `/api/health`, `/api/members/me`, `/membership`, `/signup`, `/login`, and `/account` on the actual HTTPS service. A guest request to `/api/members/me` should return `{ "member": null }`. In an authorised local test environment, verify under-18 and invalid-date rejection, random challenge replacement/expiry/replay limits, pending signup, legacy member onboarding, staff rejection and approval, birth-date purging, name-change invalidation, logout/login, profile changes, cross-device favourites, password changes, and account deletion. Verify a pending or rejected member cannot submit an order even if business-sales flags are enabled. Use synthetic images in local acceptance tests. Never record a real verification without performing the applicable manual comparison, and never approve a production test fixture as a real person. Restart the test service once to confirm account and session persistence. Do not use a real customer's account for acceptance tests.

Passwords use salted scrypt hashes with a 12–128 character input limit. Member sessions expire after 30 days and use opaque tokens, hashed at rest, in HttpOnly SameSite cookies marked Secure in production. A password change replaces the current session and revokes other sessions. Account deletion requires the member's password and removes the member profile, saved favourites, and sessions; independent order records are not cancelled. Staff sessions and member sessions are separate.

No email verification, email-based password reset, or automated identity-verification provider is connected. Registration and passing questions do not prove email ownership, identity, or age; only an actually performed staff review using the applicable ID/selfie or legacy original-ID process can be recorded as manually verified. The login help link goes to Contact rather than claiming to send a reset email. Add and test a genuine mail provider and recovery process before advertising those features.

The full service supports direct navigation and refresh on 15 routes: `/`, `/shop`, `/our-space`, `/about`, `/membership`, `/contact`, `/signup`, `/login`, `/account`, `/privacy`, `/terms`, `/responsible-use`, `/help`, `/staff`, and `/admin`. Unknown page paths show a page-not-found view. Account pages require member access; staff pages use their own authentication.

## Staff member directory and catalog

Only authenticated staff/admin sessions can read **`/api/admin/members`** or manage **`/api/admin/products`**. Member sessions do not grant this access. **`/staff` → Members** provides paginated search across registered accounts and verification statuses without displaying full birth dates or identity images in the directory. Identity images remain restricted to the review workflow. The administrator workspace includes Overview plus the four management tabs. The staff workspace provides Orders, Members, Products and Age Checks. The server restricts `/api/admin/overview` to administrators and returns a forbidden response for the staff role. Admin and staff have separate role credentials, but there are no individual employee accounts; the owner must maintain employee-level accountability and secure credential distribution.

**`/staff` → Products** supports draft creation, detail and size-price edits, publication and archive. Revision checks return a conflict when another session has changed a product. Changes and audit metadata persist in SQLite. The original collection seeds once; restarting does not replace staff changes or republish archived products. Only published entries reach **`/api/products`**, and the full Render storefront uses that catalog and current server prices for checkout. Publishing is a visibility action, not proof of actual stock, catalog approval or sales authority.

Pages and offline HTML remain bundled snapshots of the source collection. Staff product edits update the full Render site; rebuild/export and republish a snapshot to update those static copies. They do not receive member data or identity photographs.

## Render: full application

[Open the official Deploy to Render flow for the prepared branch](https://render.com/deploy?repo=https://github.com/carlosreynaga674-del/Cana/tree/loud-cana-client-handoff). The blueprint creates a catalog-only service with live-intake flags disabled and an automatically generated administrator password. It prompts for `IDENTITY_UPLOAD_KEY` as a private value rather than committing or auto-generating an incompatible value. It does not require fictitious licensing or store data. Review the paid persistent-disk service and sign in using the owner’s account.

1. Open the deployment link above, sign in to the client’s Render account, and connect GitHub if prompted. Select **`carlosreynaga674-del/Cana`**, branch **`loud-cana-client-handoff`**. The app is at the repository root; leave Root Directory blank. No code upload is needed for this repository.
2. Review the Blueprint and its **paid Starter service plus persistent disk**, then deploy. It already specifies Node 24, build command `npm ci --include=dev --no-audit --no-fund && npm run build`, start command `npm start`, health check `/api/health`, and a 1 GB disk at `/var/data`. Vite is included in the application's dependencies so manual production installs also have the build tool available.
3. Wait until Render reports a successful deployment. Open the service’s actual `https://…onrender.com` URL and `/api/health`. Keep the three intake flags `false` while the business information is pending. The site can be published in catalog mode immediately.
4. In **Environment**, retrieve the generated `ADMIN_PASSWORD` securely or set a unique secret of at least 16 characters. Set `STAFF_PASSWORD` separately, also at least 16 characters and different from the administrator secret. Sign in at **`/login`** using the literal `admin` or `staff` username and its matching secret. Separately set `IDENTITY_UPLOAD_KEY` to a stable 64-character hex key generated privately with `openssl rand -hex 32`. Never copy any secret into client-side code or the handoff ZIP. Back up the upload key securely, separately from the database; changing or losing it prevents decryption of pending images. Do not regenerate it on each deployment.
5. Supply the genuine values in the table below. After the owner approves the real catalog and commercial sales authorization and completes the acceptance checks, enable the three intake flags and redeploy. Check `/api/config` for `mode: "live"` and no missing requirements.
6. Give the client the Render URL, or add their domain in Render’s **Settings → Custom Domains** and follow the displayed DNS records. Set `PUBLIC_ORIGIN` to that exact HTTPS origin, without a trailing slash or path. Render’s `RENDER_EXTERNAL_URL` supplies the default when no custom origin is configured.

The frontend and API run on the same Render origin. The self-contained GitHub Pages export deliberately operates without API requests; there is no supported environment setting that connects it to a separate Render backend. Use the full Render service URL as the ordering website. Keep `/var/data/orders.sqlite` on the persistent disk: an ephemeral filesystem is unsuitable for customer requests.

## Required configuration

| Variable                              | Value to supply                                                                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                            | `production` on the hosted service.                                                                                                      |
| `DATABASE_PATH`                       | `/var/data/orders.sqlite` on the persistent disk.                                                                                        |
| `ADMIN_PASSWORD`                      | Administrator-role password of at least 16 characters, supplied securely by the owner. Never put it in source or client-side code. |
| `STAFF_PASSWORD`                      | Separate staff-role password, at least 16 characters and different from `ADMIN_PASSWORD`. Required before enabling workforce staff access. |
| `IDENTITY_UPLOAD_KEY`                 | Independent 64-character hexadecimal AES-256 key. Store privately, keep stable across deployments and back up securely separately from SQLite. |
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
- Use the shared `/login`: a member email reaches `/account`, `admin` reaches `/admin`, and `staff` reaches `/staff` only after correct role credentials. Check invalid credentials, unconfigured staff access, cross-role route restrictions and logout. Staff requests to the administrator Overview must be rejected even though the operational tabs are available.
- In an isolated authorised test environment, complete the member onboarding and simulated test-only staff verification, then submit a clearly marked test request using an approved postal code. Confirm it appears in `/staff`, its totals match the catalog, and customer lookup reflects a staff status update.
- Restart or redeploy once and confirm that the test request remains on the persistent disk. Create and test a backup/restore procedure before relying on the database for customers. SQLite database files and their WAL/SHM files must be handled consistently during backup; prefer a supported SQLite backup operation or stop the service for a filesystem copy.
- Confirm the business's manual ID/selfie review, support, cancellation, payment, and fulfilment processes. Configure authorised staff access and train reviewers to compare the actual submitted ID, selfie and application, escalating uncertain cases instead of claiming automated proof. This build does not collect online payments, automatically verify identity, or dispatch drivers. The manual age-check workflow does not replace commercial sales authorisation.
- Verify the Members directory is staff-only and paginated, without DOB/images. Create a local test product as a draft, publish it, confirm the public catalog and server prices change, exercise a stale revision conflict, then archive it. Restart the local fixture and confirm saved product edits remain.
- With synthetic fixture images only, test supported formats/size limits, missing-key rejection, private image access, manual review, image purging after review/expiry, name-change invalidation and account deletion. Do not upload a real person's ID to a test environment.
- Replace sample copy/catalog data, confirm rand pricing and four-digit postal coverage, and complete the business's required privacy/terms review before launch.

## Static public catalog

The collection website is published at **https://carlosreynaga674-del.github.io/Cana/**. GitHub reports a successful build from `loud-cana-preview`, and the served HTML was verified against the tested standalone export. Real order intake remains disabled on this static catalog.

The **`loud-cana-preview`** branch contains the self-contained public website at its root. Pages is already configured to deploy from this branch. To review the configuration, open the repository’s **Settings → Pages → Deploy from a branch → loud-cana-preview → / (root)**. Pushing an updated branch triggers the next deployment.

For another static host, publish the **contents** of `static-site/`. Its self-contained `index.html` works at an origin root or a repository subpath such as `/Cana/` without extra base-path configuration. Internal pages use hash routes such as `#/shop`, so direct page links and refresh work without server rewrites. It supports browsing, filters, saved picks, the gallery, and a personal selection. Signup, login, and account buttons direct the visitor to the full Render website for real account access. The static files neither simulate authentication nor submit orders or produce simulated confirmations.

The reference-style design uses black, neon lime, bold lettering, and illustrative store imagery. The static snapshot starts with 28 proposed entries including accessories; actual products, prices, potency, and inventory still require business approval. A static site has no persistent server orders, staff authentication service, payment processor, or dispatch integration.

## Operating notes

The database contains member names, emails, password hashes, saved favourites, session hashes, age/terms/upload consent records, temporary pending dates of birth, encrypted pending ID and selfie images, question identifiers/pass timestamps, verification status/audit metadata, persistent catalog records and customer order details. ID images may show document numbers; no separate ID-number field is extracted and no biometric template is created. Uploaded JPG/JPEG, PNG and WebP images must each be at most 6 MiB, at least 200 × 200 pixels and at most 20 megapixels. The server decodes/re-encodes them to metadata-stripped JPEG, at most 2400 pixels on either side, and encrypts the image bytes with AES-256-GCM. Files are not served from a public upload directory.

Images are removed after approval, rejection, replacement/name invalidation, account deletion or at most seven days pending. The pending birth date has a maximum 30-day period and is removed after review or application expiry; cleanup runs on startup, periodically while the process runs, and during relevant operations. Historical backups and SQLite WAL copies need their own retention, deletion and restricted-access procedure. Live-database deletion is not a claim of immediate secure erasure from all storage. Loss or rotation of `IDENTITY_UPLOAD_KEY` makes older pending ciphertext unreadable, so use a deliberate key and image-lifecycle procedure rather than silently regenerating it. Restrict staff and host access, use HTTPS, maintain tested backups, and apply the business's retention policy. Changing `ADMIN_PASSWORD` or `STAFF_PASSWORD` requires the business to distribute the appropriate role secret securely. Member passwords are set by members through the HTTPS account forms. Do not send passwords through chat or include them in the client ZIP.

Before collecting production identity-related data, the owner must supply the genuine responsible-party/contact details, document a lawful processing basis and retention schedule, verify operator agreements/security, review the actual cross-border hosting basis under POPIA section 72, and account for DOB and encrypted-image copies in backups and WAL files. These operational duties cannot be completed by changing an application flag; see [the legal and operating guide](SOUTH_AFRICAN_SIGNUP.md).

Check service logs for errors while keeping customer data and secrets out of shared logs. Redeploy code changes through the normal Git/Render process; the data disk should remain mounted at the same path.
