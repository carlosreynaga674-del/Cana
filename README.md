# Loud + Cana

A black-and-neon-lime cannabis lifestyle website, member accounts, and gated order-request service for **Gauteng, South Africa**. The site has dedicated navigation pages, an initial 28-item proposed collection, staff-managed product publishing, store concept photography, rand pricing, collection filters, product details, and a personal selection. The full Node service includes persistent member profiles and favourites, private order tracking, a separate staff dashboard, and SQLite storage.

The public site operates as an informational catalog, with no simulated checkout or fabricated order confirmations. Real requests remain disabled until actual business details, lawful commercial sales authorization, catalog approval, and secure staff access are supplied. Order requests also require a signed-in member whose current manual age-check review has been recorded. No online payment, automated identity-verification provider, or driver dispatch is connected.

## Client handoff

Hosted full application: **https://loud-cana.onrender.com/**. Member-account functionality, dedicated pages, the product API, health check, and staff login were tested on the earlier hosted release. Those functionality tests did not verify members' identities. This release adds a protected Members directory, persistent Products management, and encrypted ID-and-selfie uploads for manual staff review. Verify the new flows after the latest deployment; uploads need the private hosting key described below. Order intake remains separate and disabled until the remaining [deployment requirements](docs/DEPLOYMENT.md#existing-render-service) are completed.

Static collection website: **https://carlosreynaga674-del.github.io/Cana/**. GitHub Pages and the published file were verified. Product prices, potency, and availability require store confirmation.

```sh
npm ci
npm test
npm run release
```

Use **Node.js 24**. The release contains:

- `release/loud-cana-preview.html`: a complete single-file collection website with no external dependencies. Works in restricted embedded frames without a local server.
- `release/loud-cana-client.zip`: standalone catalog, static site, full source, deployment instructions, and file checksums. Credentials, databases, and dependencies are excluded.

Read [client handoff instructions](docs/HANDOFF.md), [deployment instructions](docs/DEPLOYMENT.md), the [South African signup operating guide](docs/SOUTH_AFRICAN_SIGNUP.md), and [ID-and-selfie setup and review instructions](docs/IDENTITY_VERIFICATION.md).

## Full application

```sh
npm run build
npm start
```

The Node service serves the app, API, `/admin` and `/staff` from one origin on `PORT` (default 3000). An optional `.env` is loaded by `npm start`; copy `.env.example` and enter private values locally or directly in host settings. Never commit credentials.

The public navigation opens Home (`/`), Shop (`/shop`), Our Space (`/our-space`), About (`/about`), Membership (`/membership`), and Contact (`/contact`). Additional pages provide Signup (`/signup`), Login (`/login`), Account (`/account`), Privacy (`/privacy`), Terms (`/terms`), Responsible Use (`/responsible-use`), and Help (`/help`). The management workspaces are `/staff` and `/admin`, giving 15 routes in total. All three account types use the shared `/login` page: members enter their registered email, administrators use the literal username `admin`, and staff use `staff`. Successful server-validated login sends each role to `/account`, `/admin` or `/staff` respectively. Unknown addresses show a page-not-found view with working navigation.

Free member signup and login work independently of order activation. Signup requires a server-checked date of birth establishing an age of at least 18 in South African time, the account/age-check consents, and three server-selected responsible-use questions. Questions and answer order change between fresh applications; the browser-bound challenge expires after 15 minutes, allows at most three answer attempts, and can be used only once. These steps are declarations and awareness checks, not proof of identity or age. Applicants must also submit a government-issued photo ID image and a face photograph through the secure account flow, with separate consent, before their new application can be reviewed. Accounts remain restricted until authorised staff manually compare the uploaded ID photograph, name and birth date with the submitted selfie and application. This is human review; no automatic face match, liveness check or government document verification is connected. Legacy original-ID checks remain supported for older records, but new applications require the upload flow. Members can edit their name, save favourites across devices, change their password, sign out, or permanently close their account. A name change invalidates an existing age verification. Passwords are salted and hashed with scrypt; opaque session tokens are hashed in SQLite and sent to the browser in HttpOnly, SameSite cookies, marked Secure in production. Member sessions expire after 30 days. Password changes revoke other sessions, and account deletion removes member data and sessions without cancelling independent order requests. Email verification and email-based password reset are not connected; no reset email is simulated.

Authorised staff use **`/staff` → Age Checks** to review the private ID and selfie side by side and record both required identity-comparison and 18+ attestations through a confirmation step. Uploading files or answering questions never automatically verifies a member. ID images may contain document numbers; the app does not extract or store a separate ID-number field or biometric template. Images are normalised and encrypted with AES-256-GCM using an independent hosting secret, and removed after review, replacement, account/name invalidation, or a maximum seven-day pending period. The pending birth date has a maximum 30-day period and is removed after review or expiry; outcome metadata remains. Backups and SQLite WAL copies need their own retention procedure. See the operating guides for the actual controls and owner responsibilities.

## Staff member and product management

Only authenticated staff/admin sessions can open the protected management data and actions in **`/staff`** or **`/admin`**. Member login does not grant staff access. The **Members** tab provides a paginated, searchable directory of registered accounts and their verification status; full birth dates and ID photographs are not included in that directory. Private review images are available only in the authenticated Age Checks workflow. Administrators use `ADMIN_PASSWORD`; staff use a separate `STAFF_PASSWORD`, each at least 16 characters and different from the other. The admin workspace at `/admin` adds an administrator-only Overview and the management tabs; `/staff` provides operational Orders, Members, Products and Age Checks. Staff cannot read the administrator Overview. These are shared role credentials rather than individual employee accounts; the owner still needs employee-level accountability and secure distribution.

The **Products** tab creates drafts, edits product details and size prices, publishes products, and archives unavailable products. Changes persist in SQLite, and revision checks prevent one staff session from silently overwriting another session's edits. The initial collection seeds once and does not replace saved edits on restart. The full Render storefront reads the published catalog from the same service; draft and archived entries are excluded, and checkout uses the current server-side product prices. Publication changes visibility, not business approval or sales authority.

GitHub Pages and the offline HTML are bundled catalog snapshots. Staff changes update the full Render site; rebuild and republish a snapshot to update static/offline copies.

For frontend development, leave the Node service running and run `npm run dev` in a second terminal. Vite listens on port 5173 and proxies `/api` to the local Node service. Production uses `npm start`, not the Vite preview server.

## Hosting

The existing Render service deploys `main`. A production-install fix was pushed to `main` and `loud-cana-client-handoff`, and Render deployed it successfully. Manage the existing service rather than creating a duplicate. Hosting account credentials were not supplied to the agent.

**Before accepting identity uploads, set `IDENTITY_UPLOAD_KEY` to an independent 64-character hex secret in private hosting settings.** Generate it privately with `openssl rand -hex 32`; do not paste the result into chat, source, build logs or the client package. Keep it stable across deployments and back it up securely, separately from the database. Missing or invalid configuration blocks ID/selfie submission rather than accepting unprotected images.

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

The unit/API tests cover authoritative pricing, validation, private tracking, staff authentication, status transitions, idempotency, persistent member authentication, account controls, server-side age eligibility, random question challenges, staff age review, verified-member order gating, and safe restoration of browser state. Browser checks require Python Playwright and Chromium. The order and membership integration suites create isolated local servers and temporary databases; they do not enable the hosted store, register real customers, or send a real order. The membership suite covers desktop/mobile pages, signup, login, account controls, saved favourites, and persistence. Management and upload tests also cover private staff access, product publication, revision conflicts, safe image decoding, encryption and retention. Use synthetic fixture images in tests, never a real customer's ID.

When legitimately activated, the backend calculates R49 delivery, waived at an R750 product subtotal; pickup is free. `LOUD15` applies 15% off the product subtotal. Catalog entries and prices are proposed content, and potency is unverified. Approve and replace them with the actual product information before enabling real requests.
