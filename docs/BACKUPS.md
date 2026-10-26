# Private database backup and recovery

The Node 24 recovery tool creates a consistent, standalone SQLite snapshot, including committed changes still in the running database's WAL. It copies the entire database: members, employee accounts, products and photographs, review records and encrypted pending evidence, sessions, notifications, membership-number reservations, private administrator merchandise bank details, merchandise receipts and token balances. It does not copy the separate identity-upload key or host environment settings.

These commands are for an authorised operator in the server shell. They are not website features and do not expose a database download endpoint. No production backup, recovery, schedule or offsite transfer has been performed merely by deploying this code.

## Create and verify a snapshot

1. Open the existing Render service's authorised **Shell**, from the application directory. Confirm that its existing `DATABASE_PATH` refers to the mounted database. Keep the existing identity-upload key and all other secrets unchanged.
2. Run the following command. It uses `DATABASE_PATH` without printing environment secrets. Choose a new numbered filename for every snapshot.

   ```sh
   node scripts/database-backup.mjs backup --output /var/data/backups/loud-cana-before-release-001.sqlite
   ```

3. The tool creates the directory with mode `0700` and snapshot/checksum files with mode `0600`. An existing output directory must already be private. It refuses symlinks, existing destination files or sidecars, and output anywhere inside the application repository. It does not change permissions on shared directories.
4. Success returns metadata including the SHA-256 checksum and `verified: true`. The snapshot is checked with SQLite's full integrity check and foreign-key check. It also creates the matching `.sqlite.sha256` file. Verify the saved pair independently:

   ```sh
   node scripts/database-backup.mjs verify --database /var/data/backups/loud-cana-before-release-001.sqlite
   ```

   Expect `verified: true` and `checksumVerified: true`. Any checksum mismatch, unreadable database or failed integrity/foreign-key check exits unsuccessfully. The tool prints metadata, never member records, documents or credentials.

`backup` can read an active WAL database. `verify` and `restore` require a standalone snapshot without WAL/SHM/journal sidecars; use `backup` first instead of copying an active database file. If an older standalone snapshot has no checksum sidecar, verification still checks SQLite integrity but reports `checksumVerified: false`. That cannot establish that the file matches an earlier trusted snapshot.

Use an explicit absolute source when needed:

```sh
node scripts/database-backup.mjs backup --database /var/data/orders.sqlite --output /var/data/backups/loud-cana-before-release-002.sqlite
```

## Keep a protected offsite copy

`/var/data/backups` is on the same mounted disk as the live database. This protects against some application mistakes, not loss of that disk or hosting account. Copy the snapshot and its checksum through the host's authorised private file-transfer process into owner-controlled, encrypted offsite storage. Preserve their filenames, restrict access, and verify the transferred pair. Do not put them in Git, GitHub releases, `public`, `dist`, a shared download link or ordinary email.

Backups contain personal account information and password/session hashes. Only pending ID/selfie evidence has the application's separate field-level encryption; the snapshot as a whole is not encrypted by this tool. Protect it accordingly. Keep the original `IDENTITY_UPLOAD_KEY` in a separate secure secret backup; changing or losing that key can make still-pending evidence unreadable.

The owner must choose and operate the backup frequency, retention and offsite transfer. This command does not schedule backups, rotate or delete old copies, upload data, or guarantee recovery from host loss. Perform a recovery drill using a private copy and an isolated destination. Do not send mail or admit customers during that drill.

## Restore to a new file

Restoration is a deliberate maintenance operation. A snapshot represents an earlier point in time, so later members, product edits, deletions, staff credential resets and token/payment entries may not be present.

1. Select the intended snapshot and verify its checksum/integrity as above. Preserve a fresh recovery snapshot of the current database when it is readable.
2. Arrange maintenance and stop application writes before switching the active database. Use the host's supported recovery workflow or authorised recovery shell with the persistent disk mounted. Never replace the current database file or remove its WAL/SHM files while the service is running.
3. Create a separate recovery file. The command refuses an existing output and never changes the active database or hosting configuration:

   ```sh
   node scripts/database-backup.mjs restore --database /var/data/backups/loud-cana-before-release-001.sqlite --output /var/data/recovery/loud-cana-recovered-001.sqlite
   node scripts/database-backup.mjs verify --database /var/data/recovery/loud-cana-recovered-001.sqlite
   ```

   If the hosting console is unavailable while the service is stopped, prepare this new verified file first, then enter maintenance before switching paths and restarting. The running service continues to use its original file until the owner deliberately changes its configuration.
4. Before starting the recovered service, review restored privacy and account state. A backup can reintroduce deleted accounts/evidence, revoked member sessions, earlier employee passwords, old membership-number reservations and pending welcome jobs. Reapply subsequent deletions and credential/access changes, invalidate restored member sessions, and reconcile later-issued member numbers and merchandise receipts/token balances using the business's records. The recovery command does not perform these business-specific changes automatically.
5. Temporarily clear `EMAIL_FROM` in private hosting settings to keep welcome jobs pending during recovery review; preserve the mailbox/API secrets. Clearing only `EMAIL_PROVIDER` does not disable a fully configured sender. Review the restored queue before restoring the actual authorised sender.
6. With writes stopped and recovery checks complete, the owner can change `DATABASE_PATH` to the new absolute recovered path in the existing service's private settings and redeploy. Preserve the original identity-upload key and other required settings. Do not point the app directly at the archival backup.
7. Check `/api/health`, private login, current member/product data, permissions and balances before reopening access. Confirm the intended sender only after the restored queue and recipient records have been reviewed. Retain or remove superseded files according to the owner's recovery/retention policy.

There is no automatic rollback, live database replacement, environment change or deployment in this tool. A successful checksum is an integrity check, not a digital signature or proof that a snapshot is current or suitable for recovery.

See [deployment instructions](DEPLOYMENT.md), [staff setup](STAFF_SETUP.md), [identity retention](IDENTITY_VERIFICATION.md) and [welcome-email setup](EMAIL_SETUP.md).
