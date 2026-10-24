# Private ID and selfie review

New members must complete the adult eligibility declaration and random awareness questions, then upload **both** a government-issued photo ID image and a recent selfie for an authorised staff comparison. Creating an account or successfully uploading photographs does not verify identity. The account stays restricted until staff record the actual review.

This application performs **manual document-and-selfie comparison**. It does not perform automated facial recognition, biometric matching, document-authenticity testing, or a liveness check. A submitted selfie alone does not establish live presence or rule out impersonation. The business must decide whether this manual process is appropriate and lawful for its intended operations; the software does not certify legal compliance or sales authorisation.

No third-party identity service receives the submissions. The application server decodes, sanitises and encrypts them in the site's private SQLite database. There is no public image URL, document download area, or member-facing image endpoint.

## Required hosting configuration

Set **`IDENTITY_UPLOAD_KEY`** to a newly generated, cryptographically random 32-byte key represented by **64 hexadecimal characters**, using the host's secure environment settings. Keep the key outside source control, the client ZIP, browser code, chat, and the database. Back it up securely and restrict access independently of database access. There is deliberately no automatically generated or default key.

If the key is missing or invalid, the server refuses image submissions with HTTP 503. Members remain unverified; signup does not silently bypass the upload requirement. Temporarily missing or changed keys do not erase otherwise-current pending evidence. Restore the original key to review those images. Changing the key without a controlled re-encryption procedure makes old ciphertext unreadable. Do not replace or discard it during redeployment.

The existing production database must be on confirmed persistent storage, with restricted host and staff access, tested backups and HTTPS. Configure a secure `ADMIN_PASSWORD`, sign in as `admin`, and create individual employees in **Staff accounts** before offering staff review. Employees then use their own usernames/passwords at the shared login; no shared `STAFF_PASSWORD` is required. Follow [the Render and staff setup guide](STAFF_SETUP.md). The member service and image store use the same database; an ephemeral Render filesystem can lose both.

## Submission and retention

- Each file must be a static JPEG, PNG or WebP image, at most **6 MiB**, at least **200 × 200 pixels**, and no more than **20 megapixels**. PDF, SVG and animated files are rejected.
- The server decodes each file, strips metadata such as EXIF/GPS, applies orientation, limits both dimensions to 2,400 pixels and re-encodes it as JPEG. Original filenames and original uploaded bytes are not retained.
- The sanitised JPEGs are encrypted independently with AES-256-GCM, fresh nonces and authenticated upload/role bindings. A document ciphertext cannot be substituted for a selfie ciphertext. Names and declared birth dates are bound to the submission with keyed hashes rather than copied into the upload table.
- A member must give the stated identity-image consent. This consent does not subscribe them to marketing. A new submission invalidates the preceding upload; a name or eligibility-application change invalidates the evidence attached to the old details.
- Pending encrypted images are removed from the live records after **seven days**, on approval or rejection, or when superseded. Cleanup runs on access and periodically while the correctly configured service runs. A stopped service cannot execute cleanup until it restarts and receives access or the periodic cleanup runs.
- Approval and rejection also remove the pending declared date of birth from the separate age-check record. For applications that never reach the image stage, the age-check module has its own 30-day pending retention.
- Account deletion cascades local image and upload records. Minimal review status, dates, submission identifiers and hashed staff-session references remain while the account exists. These are still personal data and need the business's documented retention policy.

Deleting live database values does not erase encrypted historical SQLite/WAL pages or backups automatically. The owner must apply a matching backup retention, access and deletion process. The encryption key protects those historical copies only while its confidentiality is maintained.

## Staff workflow

1. Sign in at `/login` with an authorised employee username/password, then use **Review applications** or open **Age checks** in `/staff`. Only authenticated staff endpoints can return pending images.
2. Open the actual current application. Compare the ID portrait with the submitted selfie, and compare the document's name and date of birth with the application. Check the document's validity and whether it establishes an age of at least 18. Do not treat the software's upload validation or questionnaire as this inspection.
3. Record both required attestations only after the comparison. If the image is unreadable, the face or details do not match, the document is unsuitable, or eligibility cannot be established, reject the application using the provided reason. Do not enter ID numbers or personal document notes.
4. Confirm the decision. The server requires both the current eligibility-submission timestamp and exact upload ID, so a stale review cannot approve a replacement submission. The image purge and age/audit update are atomic.

Staff should never save, share or copy documents outside the approved process. Create a separate employee account for each reviewer; the administrator can reset or disable it, ending its existing sessions. The review audit uses an authenticated reviewer reference rather than personal document notes. The business remains responsible for reviewer accountability, access reviews and training. If the optional legacy shared login is retained, it does not identify an individual employee.

## API boundary

`GET /api/members/identity-verification` returns the signed-in member's status and availability metadata, never image bytes. `POST` to that path requires `{ identityConsent: true, document: { data: "base64" }, selfie: { data: "base64" } }`. A successful HTTP 200 upload returns **pending** status.

Staff-only JPEG endpoints are `/api/admin/members/:id/identity-documents/document` and `/api/admin/members/:id/identity-documents/selfie`. Responses must remain private, `no-store`, and protected by staff authentication. A completed or stale review has no available images.

The existing staff review endpoint `/api/admin/members/:id/age-verification` accepts method `uploaded_id_selfie`, `expectedUploadId`, `expectedSubmittedAt`, a decision, and the required attestations. Rejection reasons are restricted to `identity_not_confirmed`, `details_mismatch`, and `unable_to_verify`.

## Owner privacy responsibilities

Before collecting real documents or face photographs, supply the genuine responsible-party/contact details and a clear notice describing purposes, access, retention, rights and complaint routes. Obtain and document an appropriate lawful basis, review whether the processing involves POPIA special personal information/biometric processing and the applicable authorisation, and assess the actual hosting region and any cross-border transfer basis. Configure host/operator agreements, incident response and a practical data-rights process. User consent and encryption do not by themselves discharge those duties.

Read the primary legal sources in [the South African signup operating guide](SOUTH_AFRICAN_SIGNUP.md), especially POPIA's minimality, retention, security and cross-border requirements. Commercial cannabis sales and delivery authorisation remain separate from membership and identity checks.
