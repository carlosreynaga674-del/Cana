# Loud + Cana — client handoff

A member website and ordering experience for **Loud + Cana, Gauteng, South Africa**, with rand pricing, South African phone validation, and four-digit postal codes. The storefront includes dedicated pages, product discovery, adult age eligibility checks, a personal selection, category filtering, and a store concept gallery. Free member accounts provide signup, login, saved favourites across devices, and account settings. When legitimately activated on a Node host, the app also supports delivery/pickup requests, promotions, checkout, and private order lookup. Staff access remains separate from member accounts.

## Show the client today

Open **https://loud-cana.onrender.com/** for the hosted full application. A current public check reports a healthy service, live order mode and configured encrypted ID storage. Preserve its existing host secrets and database settings. This release adds administrator deletion of registered members, direct product-photo uploads and queued welcome emails for new signups. Verify the new flows after the latest `main` deployment and configure a genuine mail sender before expecting welcome messages. Technical readiness and functional tests do not independently verify a member's identity, actual stock or commercial sales authority. See `DEPLOYMENT.md` and `EMAIL_SETUP.md`.

The static collection website also remains available at **https://carlosreynaga674-del.github.io/Cana/**. It does not accept orders or produce simulated confirmations. For an offline copy, use the package below.

1. Extract `loud-cana-client.zip`.
2. Open **`loud-cana-preview.html`** in a modern browser. This is a single file: no server, installation, or internet connection is needed. If a managed browser blocks local HTML files, use the published website above or another browser that permits local files.
3. Browse products, confirm age, add a product, and build a personal selection. The offline copy does not accept order requests; the full Render service operates separately. Favourites and selection persistence are available when the browser permits local storage.

For public catalog hosting, upload the **contents** of `static-site/` to a static host such as GitHub Pages. Its self-contained `index.html` works at the site's root or a repository subpath such as `/Cana/`, without extra asset or base-path configuration. Internal pages use hash routes such as `#/shop` and `#/membership`. Account buttons link to the full Render website for real signup and login; no account is created or authenticated inside the static files. The static site cannot receive real orders or run the staff dashboard, even when the separate full server has been configured for live requests.

The full application is already hosted on Render and deploys the repository's `main` branch. Use the shared **https://loud-cana.onrender.com/login** page: members enter their registered email, administrators enter `admin`, and employees enter the individual usernames created by the administrator. The server sends them to `/account`, `/admin` or `/staff` after validating the appropriate credentials. Finish configuring that existing service following `DEPLOYMENT.md`; no second service is needed. A deployment of this release publishes the new adult-onboarding and ID-age review features. For a separate host, deploy `source/` as a Node web service. Use the full service URL or attach the client's domain for the operational application; the standalone Pages export does not call a separate backend.

## Pages and membership

| Page | Full-service path |
| --- | --- |
| Home | `/` |
| Shop | `/shop` |
| Our Space | `/our-space` |
| About | `/about` |
| Membership | `/membership` |
| Contact | `/contact` |
| Create account | `/signup` |
| Shared member/admin/staff login | `/login` |
| Your account | `/account` |
| Privacy | `/privacy` |
| Terms | `/terms` |
| Responsible Use | `/responsible-use` |
| Help Centre | `/help` |
| Staff operations | `/staff` |
| Administrator workspace and Overview | `/admin` |

Member signup is free and works while sales remain disabled. It requires a name, email, password of 12 to 128 characters, a valid date of birth showing the applicant is at least 18 using the server's South African date, adult confirmation, consent to the stated age-check processing, acceptance of the terms/privacy notice, and correct answers to three random responsible-use questions. The questions are a business onboarding choice, not a statutory quiz or identity check. Each fresh challenge selects new questions and shuffles answer choices; it is browser-bound, expires after 15 minutes, allows at most three answer attempts, and is single-use.

New applications require an uploaded government-issued photo ID image and a face photograph through the secure account flow, with separate upload/review consent. The account remains restricted until authorised staff compare the submitted ID photograph, full name and birth date with the selfie and application through **`/staff` → Age Checks**. Staff record both required attestations and confirm the decision. This is a manual comparison, not automated facial recognition, liveness detection or government document validation. Legacy in-person original-ID review is retained for older records. Passing questions, declaring a birth date or uploading two images never automatically sets verified status.

Members can change their name or password, sign out, view account favourites, and permanently close their account after confirming their password and intention. Signed-in favourites persist with the account across devices. A name change requires a new age-check submission and review. Earlier members without an ID check have **submission required** status; they are not silently treated as verified. Signing in does not verify email ownership or commercial purchase eligibility. Order requests require a verified signed-in member as well as the unchanged business sales gates.

Passwords are stored as salted scrypt hashes, not readable passwords. Member sessions use an HttpOnly cookie with a 30-day expiry and Secure protection on production HTTPS. Session tokens are hashed in the database. Changing a password revokes other sessions; closing an account deletes the profile, favourites, and member sessions. Independently submitted order records are not cancelled by account deletion. There is no connected email verification or password-reset email provider; the site does not pretend to send those messages.

**Confirm persistent storage before accepting member registrations.** The existing Render disk mount has not been verified through the public service. The owner must confirm a disk at `/var/data` with `DATABASE_PATH=/var/data/orders.sqlite`. Without it, member accounts and saved favourites can be lost on redeployment. Member data, sessions, and orders share the SQLite database and need tested backups.

Read **`source/docs/SOUTH_AFRICAN_SIGNUP.md`** for the legal sources, exact staff workflow, verification states, date-of-birth retention, and owner privacy responsibilities. The pending birth date has a maximum 30-day period and is removed after review or application expiry. Uploaded ID/selfie photographs are normalised, encrypted with AES-256-GCM, and removed after review, replacement/invalidation or a maximum seven-day pending period. An ID image may visibly contain a document number; the app does not extract a separate ID-number field or create biometric templates. Live-database deletion does not remove older backups or WAL copies automatically.

The member dashboard now includes a permanent membership number and a digital membership card. Existing accounts receive random `LC-123456` numbers automatically; numbers persist across profile changes and restarts. The card shows the member's name, joining date and current verification status, including pending/required states. **Download membership card** saves an SVG snapshot without email, date of birth or identity images. It is an account reference, not government ID, proof of age or account approval. Members should keep their copy private and check the dashboard for current status.

## Staff workspace

Follow **[admin and staff setup](STAFF_SETUP.md)** first. Set the administrator password and upload-encryption key in the existing Render service, confirm persistent storage, then sign in at **https://loud-cana.onrender.com/login** as **`admin`**. In **Admin → Staff accounts**, create each employee with their own name, username and password. Employees sign in on that same page and reach **`/staff`**; members use their registered email and reach `/account`. Member login never grants workforce access. Only administrators can open Overview or manage staff accounts. An administrator can reset an employee password or disable/re-enable access; credential resets and disabling invalidate existing employee sessions. The public storefront no longer displays a staff-access link. `STAFF_PASSWORD` remains an optional legacy shared login and is not needed for these individual accounts.

- **Staff accounts (admin only):** create employees, reset their passwords, and disable or enable their access.
- **Members:** search and paginate all registered accounts and see their verification status. The directory does not expose full birth dates or ID photographs.
- **Notifications:** view new membership applications, submitted verification information, completed staff reviews and actual member-name changes. The bell shows each signed-in account's unread count; reading does not clear another employee's inbox. Member/verification links open the current record.
- **Age Checks:** view the private pending ID/selfie images, compare the application, record the two required attestations, and confirm approval or a structured rejection. Do not approve a review that was not performed.
- **Products:** add a draft, edit product details and size prices, publish to the full Render storefront, or archive an unavailable product. Stale revisions prompt a refresh instead of overwriting another staff session's work.
- **Orders:** manage operational requests when the separate lawful-business launch requirements have been completed.

Product changes and member records persist in SQLite. Only published products are served by the full site's public catalog; checkout uses current server prices. Publishing does not establish factual catalog approval or commercial sales authority. The initial 28 entries seed once and do not overwrite saved staff edits on restart. **Pages and offline copies remain bundled snapshots:** rebuild/republish them to include later staff catalog changes.

Account notifications refresh about every 15 seconds while the dashboard is visible and on focus/reconnection. Keep the protected dashboard open for these in-app updates; no push, sound or email notification is promised. **Mark all read** uses the displayed event boundary so newer arrivals stay unread. Individual read status persists across sign-ins and restarts; the optional legacy shared staff login shares one inbox. Events are retained for up to 30 days with a 10,000-event cap, and account deletion cascades linked events/read receipts. Deployment does not backfill historical notifications. No dates of birth, identity evidence, passwords or copied email addresses are stored in the notification feed.

Administrators can use **Members → Delete member**, type the account email and confirm permanent deletion. Staff do not receive this control. It removes the account, saved favourites, sessions, linked identity/age-check records and queued unsent welcome emails. Independent orders are retained and are not cancelled; prior emails and backup copies need their own retention process. Deletion does not prevent a future fresh signup.

Product editors now accept a direct **Product photo** upload: select a JPEG, PNG or WebP of at most 6 MiB, choose **Upload photo**, then save the draft or product. The server normalises it to a metadata-stripped WebP of at most 1,600 pixels per side. Photos are stored in SQLite with staff-only draft previews and become public only while a published product uses them. Unused uploads expire after 24 hours; saved product references protect their images. A direct HTTPS image URL remains available when appropriate. Product images are not the private ID/selfie store.

New signups queue one transactional welcome email. No historical member backfill or marketing subscription is performed. Delivery waits for private SMTP or Resend configuration; failures retry with a bounded schedule and the displayed status never claims an unconfigured message was sent. A successful send means the provider accepted the message, not proof of inbox delivery. The message confirms account creation and directs the member to their current review status without including passwords, birth dates or identity photographs. Read **`EMAIL_SETUP.md`** before enabling the sender. Deleting a member cancels queued jobs but cannot recall a message already in flight or sent.

Keep the already-configured **`IDENTITY_UPLOAD_KEY`** stable when redeploying the existing service. For a new host, configure an independent secret of exactly 64 hexadecimal characters following **`source/docs/IDENTITY_VERIFICATION.md`**. Missing or invalid key configuration blocks image submission. Generate a new installation's key privately with `openssl rand -hex 32`, keep it out of chat/source/build logs, and back it up securely separately from the database. No third-party identity provider is required or connected. Do not ask applicants to email ID documents or attach them to a contact message.

## Collection and service status

The site includes 28 proposed catalog entries across flower, pre-rolls, edibles, vapes, drinks, and accessories. Prices are indicative; potency is not represented as verified. All entries carry a store-confirmation status. No licence, pickup address, contact details, or actual stock was fabricated. The black-and-neon-lime visual design follows the supplied references. Store interiors are illustrative concept imagery, not evidence of an operating retail location.

## What needs business approval

Products, potency values, prices, offers, and business copy are starting content. The business must approve the actual catalog, supported postal codes, pickup address, customer-support address, and lawful commercial sales/delivery authorization before enabling live ordering. Private-use rules do not by themselves establish permission for commercial sales or delivery in Gauteng.

Until those requirements are supplied, the application remains in **catalog mode**. No payment processor, automated ID-verification provider, or driver-dispatch integration is connected. The application supports recorded **manual ID-and-selfie review** and legacy in-person original-ID checks; staff must perform the actual comparison. Live mode, when legitimately configured, receives requests for staff review from verified signed-in members; it does not establish that payment or fulfillment has occurred. Staff must follow the business's approved process.

## Developer quick start

Use **Node.js 24**, then from `source/`:

```sh
npm ci
npm run build
npm start
```

The service uses `PORT` when provided by the host, otherwise port 3000. No launch credentials are included in this package. Set them securely in the hosting dashboard. See `DEPLOYMENT.md` for required configuration and persistent storage.

For source validation:

```sh
npm test
npm run build
```

The project includes unit/API tests and browser smoke suites. Browser checks require Python Playwright and Chromium, and a running application for hosted-app checks. `tests/membership_browser_smoke.py` creates a temporary local service for account and navigation checks; it does not register real customers on production. The standalone smoke suite loads the exported bytes directly and in a restricted iframe, with external network requests blocked.

## Handoff contents

| Item                     | Purpose                                                                   |
| ------------------------ | ------------------------------------------------------------------------- |
| `loud-cana-preview.html` | Self-contained collection website.                                            |
| `static-site/`           | Production frontend assets for static catalog hosting.                    |
| `source/`                | Frontend, server, tests, scripts, lockfile, and deployment configuration. |
| `DEPLOYMENT.md`          | Full-service deployment and launch steps.                                 |
| `EMAIL_SETUP.md`         | Genuine SMTP/Resend sender setup and welcome-email delivery states.          |
| `source/docs/SOUTH_AFRICAN_SIGNUP.md` | Legal sources and manual age-check operating instructions. |
| `source/docs/IDENTITY_VERIFICATION.md` | Encrypted upload setup, image retention and staff ID/selfie review. |
| `release-manifest.json`  | File inventory, sizes, and SHA-256 hashes.                                |
| `SHA256SUMS.txt`         | Checksums for the packaged app and source files.                          |

Dependencies, Git internals, local databases, real environment files, and credentials are excluded. Keep `source/package-lock.json`; install with `npm ci`. To reproduce the handoff from the repository, run `npm run release`.
