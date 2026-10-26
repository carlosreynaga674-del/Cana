# Loud + Cana

A black-and-neon-lime cannabis lifestyle website, member accounts, and gated order-request service for **Gauteng, South Africa**. The site has dedicated navigation pages, an initial 28-item proposed collection, staff-managed product publishing, store concept photography, rand pricing, collection filters, product details, and a personal selection. The full Node service includes persistent member profiles and favourites, private order tracking, a separate staff dashboard, and SQLite storage.

The full service accepts real order requests only when its business launch checks are complete and the signed-in member has a current manual age-check approval. The public configuration now reports live order mode and configured encrypted ID storage; these technical settings do not independently establish genuine catalog information or lawful commercial sales authority. There is no simulated checkout or fabricated order confirmation. No online payment, automated identity-verification provider, or driver dispatch is connected.

## Client handoff

Hosted full application: **https://loud-cana.onrender.com/**. The service is healthy, reports live order mode and has configured encrypted ID storage. This release adds administrator deletion of registered members, direct product-photo uploads and queued transactional welcome emails for new signups. Verify those new flows after the latest deployment. Welcome emails require a genuine SMTP mailbox or Resend sender configured privately in Render; the app does not claim mail was sent while the provider is unconfigured. Functional tests do not establish a member's identity or the business's legal authority. See [deployment requirements](docs/DEPLOYMENT.md#existing-render-service).

Static collection website: **https://carlosreynaga674-del.github.io/Cana/**. GitHub Pages and the published file were verified. Product prices, potency, and availability require store confirmation.

```sh
npm ci
npm test
npm run release
```

Use **Node.js 24**. The release contains:

- `release/loud-cana-preview.html`: a complete single-file collection website with no external dependencies. Works in restricted embedded frames without a local server.
- `release/loud-cana-client.zip`: standalone catalog, static site, full source, deployment instructions, and file checksums. Credentials, databases, and dependencies are excluded.

Read [client handoff instructions](docs/HANDOFF.md), [deployment instructions](docs/DEPLOYMENT.md), the [South African signup operating guide](docs/SOUTH_AFRICAN_SIGNUP.md), [ID-and-selfie review instructions](docs/IDENTITY_VERIFICATION.md), the step-by-step [admin and staff setup guide](docs/STAFF_SETUP.md), and [welcome-email setup](docs/EMAIL_SETUP.md).

## Full application

```sh
npm run build
npm start
```

The Node service serves the app, API, `/admin` and `/staff` from one origin on `PORT` (default 3000). An optional `.env` is loaded by `npm start`; copy `.env.example` and enter private values locally or directly in host settings. Never commit credentials.

The public navigation opens Home (`/`), Shop (`/shop`), Our Space (`/our-space`), About (`/about`), Membership (`/membership`), and Contact (`/contact`). Additional pages provide Signup (`/signup`), Login (`/login`), Account (`/account`), Privacy (`/privacy`), Terms (`/terms`), Responsible Use (`/responsible-use`), and Help (`/help`). The management workspaces are `/staff` and `/admin`, giving 15 routes in total. All three account types use the shared `/login` page: members enter their registered email, administrators use the username `admin`, and employees use individual usernames created by an administrator. Successful server-validated login sends each role to `/account`, `/admin` or `/staff` respectively. Public navigation has no staff-access link, and the shared login uses a generic email-or-username field; protected management requests still require the appropriate server-authenticated role. Unknown addresses show a page-not-found view with working navigation.

Free member signup and login work independently of order activation. Signup requires a server-checked date of birth establishing an age of at least 18 in South African time, the account/age-check consents, and three server-selected responsible-use questions. Questions and answer order change between fresh applications; the browser-bound challenge expires after 15 minutes, allows at most three answer attempts, and can be used only once. These steps are declarations and awareness checks, not proof of identity or age. Applicants must also submit a government-issued photo ID image and a face photograph through the secure account flow, with separate consent, before their new application can be reviewed. Accounts remain restricted until authorised staff manually compare the uploaded ID photograph, name and birth date with the submitted selfie and application. This is human review; no automatic face match, liveness check or government document verification is connected. Legacy original-ID checks remain supported for older records, but new applications require the upload flow. Members can edit their name, save favourites across devices, change their password, sign out, or permanently close their account. A name change invalidates an existing age verification. Passwords are salted and hashed with scrypt; opaque session tokens are hashed in SQLite and sent to the browser in HttpOnly, SameSite cookies, marked Secure in production. Member sessions expire after 30 days. Password changes revoke other sessions, and account deletion removes member data and sessions without cancelling independent order requests. Email verification and email-based password reset are not connected; no reset email is simulated.

Authorised staff use **`/staff` → Age Checks** to review the private ID and selfie side by side and record both required identity-comparison and 18+ attestations through a confirmation step. Uploading files or answering questions never automatically verifies a member. ID images may contain document numbers; the app does not extract or store a separate ID-number field or biometric template. Images are normalised and encrypted with AES-256-GCM using an independent hosting secret, and removed after review, replacement, account/name invalidation, or a maximum seven-day pending period. The pending birth date has a maximum 30-day period and is removed after review or expiry; outcome metadata remains. Backups and SQLite WAL copies need their own retention procedure. See the operating guides for the actual controls and owner responsibilities.

## Membership cards and account notifications

Members receive a permanent, random membership number such as `LC-123456`. Existing accounts receive one automatically on deployment; it stays the same across sign-ins, profile changes and restarts. The member dashboard shows a personalised digital membership card with the member's name, number, joining date and current verification status. **Download membership card** saves an SVG snapshot. The number and card identify the account; they are not government ID, proof of age or verification, a payment card, or permission to make purchases. Keep downloaded copies private and check the dashboard for the current status.

Once the required staff review is approved, the dashboard hides the completed ID/selfie review panel and setup checklist. The membership card keeps its **Verified member** status. Pending applications still show their review steps; a name change that requires a new review restores those steps.

Every valid membership card now includes a Code 128 barcode, both on screen and in a newly downloaded SVG. The barcode contains only the permanent membership number. In either protected workspace, **Scan member card** supports an explicitly started camera, a local barcode photo/screenshot, or a USB scanner/manual number followed by Enter. Each lookup retrieves the current account status from the authenticated service; the barcode does not authenticate its holder or carry a verification decision. Camera and barcode images stay on the scanning device. Previously downloaded cards need a fresh download to include the barcode.

Membership numbers use LC- followed by exactly six digits, including leading zeros. Both dashboards have a **Search member ID** field; enter the full ID or its six digits. The one-time migration replaces older long numbers and preserves them as lookup aliases, so older cards still find the correct account. Issued IDs remain reserved after account deletion, with no remaining member link, and are never assigned to another person.

Both protected workspaces include a **Notifications** bell, unread count and activity view for new membership applications, submitted verification information, completed staff reviews and actual member-name changes. The view refreshes about every 15 seconds while the dashboard is visible and when it regains focus. Read status persists separately for each administrator or individual employee; one person's read action does not clear another person's inbox. **Mark all read** covers the latest displayed event boundary, leaving newer arrivals unread. The optional legacy shared staff login shares one inbox. These are in-app account notifications; the dashboard must be open. They do not send email or operating-system push alerts.

Notifications are retained for up to 30 days, with a maximum of 10,000 shared activity events. Existing accounts do not generate historical notifications on deployment. Account deletion removes linked events and read receipts. Notification storage contains event references and hashed read-receipt identities, without copied names, email addresses, dates of birth, documents or passwords; protected responses look up the member's current name. The staff directory can also search by membership number. See [the staff guide](docs/STAFF_SETUP.md#11-use-account-notifications).

## Processed merchandise reports and rewards

The administrator's **Processed reports** tab saves a selection of non-cannabis merchandise products and groups matching completed or delivered records by processing date in South African time. Report eligibility requires the **Accessories** category in both the current catalog and the historical item record. Other categories are excluded by the server. The report shows selected merchandise quantities and the staff name recorded when an eligible completion occurs. Earlier records without attribution show **Not recorded**; a legacy shared staff login shows **Shared staff account**. Date filters cover up to 366 days at a time. Staff and members cannot open the administrator report.

**Merchandise rewards** are nontransferable store credit: each cumulative **R1,000 of eligible externally paid merchandise spend earns R10**. Completing a record does not prove payment or automatically award credit. An administrator must identify the correct member and confirm the actual paid merchandise through **Record merchandise payment**. The server calculates the discounted eligible merchandise amount, excludes delivery and other product categories, and records that receipt once. Credit already applied to a receipt does not earn more credit. Report product selections control reporting; reward eligibility covers all qualifying merchandise lines independently of that selection.

Members can view their own balance, progress and recent earned/redeemed history on their dashboard. The administrator may apply available merchandise credit while confirming another eligible receipt, up to the available balance and eligible amount. These tokens are store credit, not cryptocurrency, cash withdrawal or transfer balances. No payment processor, historical credit backfill or automatic refund/reversal is connected. Account deletion removes the member reward account and ledger; a receipt reference, financial amounts and trusted administrator confirmation remain without the member link to prevent duplicate awards and support the business's separate record-retention process.

## Staff member and product management

Only authenticated staff/admin sessions can open the protected management data and actions in **`/staff`** or **`/admin`**. Member login does not grant staff access. The **Members** tab provides a paginated, searchable directory of registered accounts and their verification status; full birth dates and ID photographs are not included in that directory. Private review images are available only in the authenticated Age Checks workflow. The administrator uses `ADMIN_PASSWORD` and creates individual employee accounts from **Admin → Staff accounts**. Each employee receives a unique username and a password of 16–256 characters; only salted password hashes are stored in SQLite. Administrators can reset passwords or disable/re-enable access. Resetting a password, disabling an account or changing its username invalidates its existing sessions. Staff cannot create staff accounts, promote themselves, or read the administrator Overview. The admin workspace adds Overview, Staff accounts and Processed reports to the operational workspaces. `STAFF_PASSWORD` is an optional legacy shared login; leave it blank when using individual employee accounts. Follow [the setup guide](docs/STAFF_SETUP.md) to configure Render and create the first staff account.

The **Products** tab creates drafts, edits product details and size prices, publishes products, and archives unavailable products. Changes persist in SQLite, and revision checks prevent one staff session from silently overwriting another session's edits. The initial collection seeds once and does not replace saved edits on restart. The full Render storefront reads the published catalog from the same service; draft and archived entries are excluded, and checkout uses the current server-side product prices. Publication changes visibility, not business approval or sales authority.

An administrator can open **Members → Delete member**, type the member's email and confirm permanent deletion. The server also checks that the displayed account has not changed. Deletion removes the profile, favourites, sessions, linked ID/age-check records and unsent welcome-email jobs. It does not cancel or erase independent order records, recall email already sent, or automatically erase backups. Staff can review applications but cannot delete members. Deletion closes the current account; it is not a ban on future signup.

In a product editor, select **Product photo**, choose a static JPEG, PNG or WebP image of at most 6 MiB, then use **Upload photo** and save the product. The server decodes the image, strips metadata and stores a WebP of at most 1,600 pixels per side in SQLite. Draft previews require staff access; the public photo route works only while a published product references that image. Unreferenced uploads expire after 24 hours, while saved draft, published and archived references are retained. A direct HTTPS image URL remains an optional alternative. These public product photos are separate from encrypted private ID/selfie submissions.

Each successful new signup queues one generic welcome email in the same database transaction as account creation. A background worker sends it through configured SMTP or Resend and retries temporary failures. Existing members are not backfilled. The message confirms account creation and directs the member to their current review status; it contains no password, birth date, identity image or product promotion. Missing mail configuration leaves the message queued rather than claiming delivery. The admin delivery status records provider acceptance, not guaranteed inbox placement. Email verification, password-reset email and staff invitations remain separate unconnected features. See [EMAIL_SETUP.md](docs/EMAIL_SETUP.md).

GitHub Pages and the offline HTML are bundled catalog snapshots. Staff changes update the full Render site; rebuild and republish a snapshot to update static/offline copies.

For frontend development, leave the Node service running and run `npm run dev` in a second terminal. Vite listens on port 5173 and proxies `/api` to the local Node service. Production uses `npm start`, not the Vite preview server.

## Hosting

The existing Render service deploys `main`. A production-install fix was pushed to `main` and `loud-cana-client-handoff`, and Render deployed it successfully. Manage the existing service rather than creating a duplicate. Hosting account credentials were not supplied to the agent.

**Preserve the existing configured `IDENTITY_UPLOAD_KEY` when redeploying this service.** For a new host, set an independent 64-character hex secret in private hosting settings using `openssl rand -hex 32`. Do not paste the result into chat, source, build logs or the client package. Keep it stable across deployments and back it up securely, separately from the database. Missing or invalid configuration blocks ID/selfie submission rather than accepting unprotected images.

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

The unit/API tests cover authoritative pricing, validation, private tracking, staff authentication, status transitions, idempotency, persistent member authentication, account controls, server-side age eligibility, random question challenges, staff age review, verified-member order gating, and safe restoration of browser state. Browser checks require Python Playwright and Chromium. The order and membership integration suites create isolated local servers and temporary databases; they do not enable the hosted store, register real customers, or send a real order. The membership suite covers desktop/mobile pages, signup, login, account controls, saved favourites, and persistence. Management and upload tests cover administrator-only member deletion, product-photo privacy/publication, revision conflicts, safe image decoding, encryption and retention. Email tests use injected fake senders and do not send real messages. Use synthetic fixture images in tests, never a real customer's ID.

When legitimately activated, the backend calculates R49 delivery, waived at an R750 product subtotal; pickup is free. `LOUD15` applies 15% off the product subtotal. Catalog entries and prices are proposed content, and potency is unverified. Approve and replace them with the actual product information before enabling real requests.
