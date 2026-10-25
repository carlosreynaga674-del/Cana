# Welcome-email setup

New member signup queues one generic, transactional welcome email. It confirms account creation and directs the member to their account for the current verification status and any required manual ID/selfie review. It does not contain a password, date of birth, document number, identity photograph or product promotion. It does not verify email ownership, approve membership eligibility, subscribe anyone to marketing, send password-reset links or invite staff.

The application needs an authenticated sending account. It cannot send mail simply because a contact email is displayed on the site. You can use an existing mailbox the owner controls through SMTP; no new identity-verification provider is involved. Resend's HTTPS API is an alternative when the owner has a verified sending domain.

There are no mail credentials in source, the client package or this guide. Enter actual secrets only in the existing service's private Render **Environment** settings. Do not paste them in chat, screenshots, source files or build commands.

## Option A: an existing iCloud mailbox

Use this option only if the owner controls the iCloud mailbox that will send the message. A public contact address does not establish access to its mailbox.

1. Sign in to [Apple Account](https://account.apple.com/) as that mailbox's owner. Two-factor authentication must be enabled for app-specific passwords.
2. Open **Sign-In and Security → App-Specific Passwords** and generate a password for this application. Keep the value private. Use the app-specific password here, not the owner's ordinary Apple Account password. Apple's current account interface may use slightly different wording; see [Apple's app-specific-password instructions](https://support.apple.com/en-us/102654).
3. Open the existing [Loud + Cana Render service](https://dashboard.render.com/web/srv-dbd567t9fdbs73agdiq0) and choose **Environment → Edit / Add Environment Variable**.
4. Set the following values. Mailbox fields must contain the actual owner-controlled address, not descriptive text copied from the table.

| Variable | Value |
| --- | --- |
| `EMAIL_PROVIDER` | `smtp` |
| `EMAIL_FROM` | The full iCloud sender address that the owner controls. A display name with that authorised address is also supported. |
| `SMTP_HOST` | `smtp.mail.me.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | The full iCloud mailbox address. |
| `SMTP_PASSWORD` | The private Apple app-specific password generated above. |
| `EMAIL_REPLY_TO` | Optional monitored support address. Leave unset to use the sender's normal reply behavior. |
| `EMAIL_PUBLIC_ORIGIN` | Optional genuine full-service HTTPS origin. Leave unset to use `PUBLIC_ORIGIN` or Render's external URL. |

5. Preserve the existing `ADMIN_PASSWORD`, `IDENTITY_UPLOAD_KEY` and mounted database settings. Save the mail settings and redeploy. Do not generate a replacement identity-upload key for this mail change.
6. Check the admin mail setup and a new signup's welcome status. Test actual receipt only with an authorised recipient you control; sender acceptance and inbox placement are separate checks.

iCloud's SMTP connection uses port 587 with STARTTLS and certificate verification. See [Apple's iCloud Mail server settings](https://support.apple.com/en-us/102525). Do not weaken transport security to work around an authentication or network error.

## Other SMTP mailboxes

Use the actual mailbox provider's authenticated outgoing-server settings with `EMAIL_PROVIDER=smtp`, `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` and `SMTP_PASSWORD`. Use an app-specific password or the provider's approved SMTP credential when it requires one. Do not assume the normal account password works, and do not claim an address as the sender unless the provider authorises it.

Supported ports are **465** for TLS and **587/2525** for mandatory STARTTLS. The chosen provider must actually offer the port you configure. `EMAIL_REPLY_TO` and `EMAIL_PUBLIC_ORIGIN` are optional as described above.

Render free web services restrict common outbound SMTP ports, including 25, 465 and 587. Check the actual service plan and current host restrictions. The persistent-disk Blueprint uses a paid service, but that does not prove the existing service's private plan or network settings. If the host blocks the mailbox's required port, use a supported transport or the HTTPS option below. The application does not change hosting plans or create paid accounts automatically.

## Option B: Resend over HTTPS

1. Use the owner's Resend account and complete its domain-verification process for a domain the owner controls. Follow the provider's DNS/authentication instructions. A mailbox on a domain owned by another provider does not give the owner control of that domain's DNS.
2. Create a server-side API key with permission to send for the approved sender. Keep it private.
3. In Render **Environment**, set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` to that private key, and `EMAIL_FROM` to the approved verified-domain sender. Set `EMAIL_REPLY_TO` if the business needs a different monitored reply address.
4. Leave `EMAIL_PUBLIC_ORIGIN` unset to use the existing full-service origin, or supply the genuine HTTPS origin for member account links. Save and redeploy.

A provider's default testing sender may be limited to the provider account owner's own recipient address. It cannot be advertised as a sender for every new customer. Complete actual sender/domain authorisation before enabling production welcome messages.

## Queue behavior and status

- Each successful new account receives one outbox job in the signup transaction. A rejected or duplicate signup does not queue another welcome message.
- Existing members are **not backfilled**. An older account with no job shows **Not queued**; this feature is not a bulk-email tool.
- With missing or invalid sender configuration, new signup jobs remain **Pending**. Account creation does not fail just because mail is unavailable, and no unconfigured message is marked sent.
- After a genuine sender is configured and the service restarts, due pending jobs can send automatically. Review any test accounts before enabling the sender; delete unwanted test accounts so their unsent jobs are removed.
- A worker claims due jobs, records **Sending**, and retries temporary failures with a bounded schedule. A stopped process cannot send mail; pending work continues when the service runs again.
- **Sent means the sender/provider accepted the message.** It is not proof that the recipient owns the address, that an inbox received it, or that a member's ID review passed. The app does not process delivery/bounce webhooks or promise inbox placement.
- **Failed** indicates the bounded automatic attempts did not succeed. After correcting the sender, an administrator can use the Members view's failed-message retry action. Staff cannot trigger that administrative action. Retry does not create a job for a historical account or resend an already accepted message.

Stable message identifiers and provider-supported idempotency reduce duplicate attempts, but SMTP cannot guarantee exactly-once delivery. A process can stop after remote acceptance and before its local sent status is committed; the later retry may produce another message. Do not describe the queue as a guarantee of exactly one delivered email.

## Deletion and privacy

Member self-deletion and confirmed administrator deletion remove linked unsent welcome-email jobs. They do not recall a message already in flight or accepted, remove historical messages from an inbox, or automatically erase a provider's independent records or backups. Independent order records remain subject to the business's separate retention process.

The sending service receives the recipient address and welcome-message content. The owner must supply accurate support/privacy contacts, explain this transactional processing, restrict sender credentials and review the actual provider/operator and any cross-border arrangements. The welcome feature does not authorise a marketing campaign or permit identity evidence in ordinary email.

Read [the deployment guide](DEPLOYMENT.md), [admin and staff setup](STAFF_SETUP.md), and [the South African operating guide](SOUTH_AFRICAN_SIGNUP.md). Keep automated tests on injected fake transports; do not run release tests that email real customers.
