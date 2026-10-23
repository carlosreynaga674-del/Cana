# Loud + Cana — client handoff

A member website and ordering experience for **Loud + Cana, Gauteng, South Africa**, with rand pricing, South African phone validation, and four-digit postal codes. The storefront includes dedicated pages, product discovery, age confirmation, a personal selection, category filtering, and a store concept gallery. Free member accounts provide signup, login, saved favourites across devices, and account settings. When legitimately activated on a Node host, the app also supports delivery/pickup requests, promotions, checkout, and private order lookup. Staff access remains separate from member accounts.

## Show the client today

Open **https://loud-cana.onrender.com/** for the hosted full application. The storefront, product API, health check, and `/staff` login page were verified on 22 October 2026 after deployment of `46d4573`. This release adds membership and dedicated pages; verify those flows on the service after the latest `main` deployment. Order intake still needs the configuration listed in `DEPLOYMENT.md` under "Existing Render service". A loaded staff login page does not mean staff credentials have been configured.

The static collection website also remains available at **https://carlosreynaga674-del.github.io/Cana/**. It does not accept orders or produce simulated confirmations. For an offline copy, use the package below.

1. Extract `loud-cana-client.zip`.
2. Open **`loud-cana-preview.html`** in a modern browser. This is a single file: no server, installation, or internet connection is needed. If a managed browser blocks local HTML files, use the published website above or another browser that permits local files.
3. Browse products, confirm age, add a product, and build a personal selection. Ordering is clearly unavailable until the store’s service details are configured. Favourites and selection persistence are available when the browser permits local storage.

For public catalog hosting, upload the **contents** of `static-site/` to a static host such as GitHub Pages. Its self-contained `index.html` works at the site's root or a repository subpath such as `/Cana/`, without extra asset or base-path configuration. Internal pages use hash routes such as `#/shop` and `#/membership`. Account buttons link to the full Render website for real signup and login; no account is created or authenticated inside the static files. The static site cannot receive real orders or run the staff dashboard, even when the separate full server has been configured for live requests.

The full application is already hosted on Render and deploys the repository's `main` branch. Its staff route is **https://loud-cana.onrender.com/staff**. Finish configuring that existing service following `DEPLOYMENT.md`; no second service is needed. A deployment of this release publishes the new membership and page features. For a separate host, deploy `source/` as a Node web service. Use the full service URL or attach the client's domain for the operational application; the standalone Pages export does not call a separate backend.

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
| Member login | `/login` |
| Your account | `/account` |
| Privacy | `/privacy` |
| Terms | `/terms` |
| Responsible Use | `/responsible-use` |
| Help Centre | `/help` |
| Staff login | `/staff` |

Member signup is free and works while sales remain disabled. It requires a name, email, password of 12 to 128 characters, adult age confirmation, and acceptance of the terms/privacy notice. Members can change their name or password, sign out, view account favourites, and permanently close their account after confirming their password and intention. Signed-in favourites persist with the account across devices. Signing in does not verify identity, email ownership, or purchase eligibility.

Passwords are stored as salted scrypt hashes, not readable passwords. Member sessions use an HttpOnly cookie with a 30-day expiry and Secure protection on production HTTPS. Session tokens are hashed in the database. Changing a password revokes other sessions; closing an account deletes the profile, favourites, and member sessions. Independently submitted order records are not cancelled by account deletion. There is no connected email verification or password-reset email provider; the site does not pretend to send those messages.

**Confirm persistent storage before accepting member registrations.** The existing Render disk mount has not been verified through the public service. The owner must confirm a disk at `/var/data` with `DATABASE_PATH=/var/data/orders.sqlite`. Without it, member accounts and saved favourites can be lost on redeployment. Member data, sessions, and orders share the SQLite database and need tested backups.

## Collection and service status

The site includes 28 proposed catalog entries across flower, pre-rolls, edibles, vapes, drinks, and accessories. Prices are indicative; potency is not represented as verified. All entries carry a store-confirmation status. No licence, pickup address, contact details, or actual stock was fabricated. The black-and-neon-lime visual design follows the supplied references. Store interiors are illustrative concept imagery, not evidence of an operating retail location.

## What needs business approval

Products, potency values, prices, offers, and business copy are starting content. The business must approve the actual catalog, supported postal codes, pickup address, customer-support address, and lawful commercial sales/delivery authorization before enabling live ordering. Private-use rules do not by themselves establish permission for commercial sales or delivery in Gauteng.

Until those requirements are supplied, the application remains in **catalog mode**. No payment processor, automated ID-verification provider, or driver-dispatch integration is connected. Live mode, when legitimately configured, receives requests for staff review; it does not establish that payment, identity verification, or fulfillment has occurred. Staff must follow the business's approved process.

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

The project includes 40 unit/API tests and browser smoke suites. Browser checks require Python Playwright and Chromium, and a running application for hosted-app checks. `tests/membership_browser_smoke.py` creates a temporary local service for account and navigation checks; it does not register real customers on production. The standalone smoke suite loads the exported bytes directly and in a restricted iframe, with external network requests blocked.

## Handoff contents

| Item                     | Purpose                                                                   |
| ------------------------ | ------------------------------------------------------------------------- |
| `loud-cana-preview.html` | Self-contained collection website.                                            |
| `static-site/`           | Production frontend assets for static catalog hosting.                    |
| `source/`                | Frontend, server, tests, scripts, lockfile, and deployment configuration. |
| `DEPLOYMENT.md`          | Full-service deployment and launch steps.                                 |
| `release-manifest.json`  | File inventory, sizes, and SHA-256 hashes.                                |
| `SHA256SUMS.txt`         | Checksums for the packaged app and source files.                          |

Dependencies, Git internals, local databases, real environment files, and credentials are excluded. Keep `source/package-lock.json`; install with `npm ci`. To reproduce the handoff from the repository, run `npm run release`.
