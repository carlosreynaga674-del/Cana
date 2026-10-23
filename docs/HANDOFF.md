# Loud + Cana — client handoff

An ordering experience for **Loud + Cana, Gauteng, South Africa**, with rand pricing, South African phone validation, and four-digit postal codes. The storefront includes product discovery, saved picks, age confirmation, a personal selection, category filtering, and a store concept gallery. When legitimately activated on a Node host, it also supports delivery/pickup requests, promotions, checkout, and private order lookup. The full application also includes a staff order dashboard and a persistent Node/SQLite order service.

## Show the client today

Open **https://loud-cana.onrender.com/** for the hosted full application. The storefront, product API, health check, and `/staff` login page were verified on 22 October 2026 after deployment of `46d4573`. It currently operates in catalog mode; order intake still needs the configuration listed in `DEPLOYMENT.md` under "Existing Render service". A loaded staff login page does not mean staff credentials have been configured.

The static collection website also remains available at **https://carlosreynaga674-del.github.io/Cana/**. It does not accept orders or produce simulated confirmations. For an offline copy, use the package below.

1. Extract `loud-cana-client.zip`.
2. Open **`loud-cana-preview.html`** in a modern browser. This is a single file: no server, installation, or internet connection is needed. If a managed browser blocks local HTML files, use the published website above or another browser that permits local files.
3. Browse products, confirm age, add a product, and build a personal selection. Ordering is clearly unavailable until the store’s service details are configured. Favourites and selection persistence are available when the browser permits local storage.

For public catalog hosting, upload the **contents** of `static-site/` to a static host such as GitHub Pages. Its self-contained `index.html` works at the site's root or a repository subpath such as `/Cana/`, without extra asset or base-path configuration. The static site cannot receive real orders or run the staff dashboard. The single-file copy and static site remain catalog-only even when the separate full server has been configured for live requests.

The full application is already hosted on Render and deploys the repository's `main` branch. Its staff route is **https://loud-cana.onrender.com/staff**. Finish configuring that existing service following `DEPLOYMENT.md`; no second deployment is needed. For a separate host, deploy `source/` as a Node web service. Use the full service URL or attach the client's domain for the operational application; the standalone Pages export does not call a separate backend.

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

The `tests/` directory also contains browser smoke suites. They require Python Playwright and Chromium, and a running application for hosted-app checks. The standalone smoke suite loads the exported bytes directly and in a restricted iframe, with external network requests blocked.

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
