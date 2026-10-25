# Welcome-email setup

New member signup queues one generic, transactional welcome email. It confirms account creation and directs the member to their account for the current verification status and any required manual ID/selfie review. It does not contain a password, date of birth, document number, identity photograph or product promotion. It does not verify email ownership, approve membership eligibility, subscribe anyone to marketing, send password-reset links or invite staff.

The application needs an authenticated sending account. It cannot send mail simply because a contact email is displayed on the site. You can use an existing mailbox the owner controls through SMTP; no new identity-verification provider is involved. Resend's HTTPS API is an alternative when the owner has a verified sending domain.

There are no mail credentials in source, the client package or this guide. Enter actual secrets only in the existing service's private Render **Environment** settings. Do not paste them in chat, screenshots, source files or build commands.

## Set the public contact and reply address

The requested business contact is **`loudpluscana@protonmail.com`**. Sign in to that mailbox at [Proton Mail](https://mail.proton.me/) and confirm that you can receive and reply to a message. Changing the website's contact address does not create the mailbox, prove ownership or grant the application permission to send from it.

1. Open the existing [Loud + Cana Render service](https://dashboard.render.com/web/srv-dbd567t9fdbs73agdiq0).
2. Choose **Environment → Edit / Add Environment Variable**.
3. Set **`CONTACT_EMAIL=loudpluscana@protonmail.com`** and **`EMAIL_REPLY_TO=loudpluscana@protonmail.com`**. These values are public contact details, not credentials.
4. Preserve the existing `ADMIN_PASSWORD`, `IDENTITY_UPLOAD_KEY`, `DATABASE_PATH` and mounted disk. Save and redeploy. Do not regenerate the upload-encryption key for this email change.

This configures contact links and the reply address. Automatic welcome messages still require an authorised sending account as described below.

## Option A: send through Proton Mail

**Proton's direct SMTP submission requires a paid Proton Mail plan and an active custom-domain address.** The address `loudpluscana@protonmail.com` uses Proton's own domain and cannot be selected for this direct SMTP service, even merely by upgrading the account. It can remain the public contact and reply address. See [Proton's official SMTP requirements and instructions](https://proton.me/support/smtp-submission).

If you have only the `@protonmail.com` mailbox and no custom domain, stop before entering SMTP settings. Keep that mailbox for incoming messages and replies; to send automatically, either obtain a domain you control and the required Proton plan, or use another genuinely authorised sender below. Do not invent a domain or put the Proton account password into Render.

1. Use a paid Proton Mail plan that supports the required custom-domain setup. Add a domain you own in Proton's settings and follow its displayed verification, mail-routing and authentication DNS instructions. Wait until Proton confirms the domain and sender are ready. See [Proton's custom-domain guide](https://proton.me/support/custom-domain).
2. Create an active sending address on that verified custom domain. This is the address that will appear in the message's **From** field; it is separate from the `@protonmail.com` contact/reply address.
3. In Proton Mail, open **Settings → All settings → IMAP/SMTP → SMTP tokens** and select **Generate token**.
4. Name the token **Loud Cana Render**, select that active custom-domain sending address, and generate it. Proton may ask for your account password inside Proton's own interface. Copy the generated **SMTP token** privately; the popup shows it only once. The account password and mailbox password do not work as SMTP credentials.
5. In the existing Render service's **Environment** settings, enter the following values. Replace the descriptive sender fields with the actual address selected in Proton; do not copy descriptive text as a value.

| Variable | Value |
| --- | --- |
| `EMAIL_PROVIDER` | `smtp` |
| `EMAIL_FROM` | The actual active custom-domain sending address paired with the Proton SMTP token. |
| `SMTP_HOST` | `smtp.protonmail.ch` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | The same actual custom-domain address selected for the token. |
| `SMTP_PASSWORD` | The private generated Proton SMTP token, not the Proton account password. |
| `CONTACT_EMAIL` | `loudpluscana@protonmail.com` |
| `EMAIL_REPLY_TO` | `loudpluscana@protonmail.com` |
| `EMAIL_PUBLIC_ORIGIN` | Leave unset to use `PUBLIC_ORIGIN` or Render's external URL, or supply the genuine full-service HTTPS origin. |

6. Preserve all existing administrator, upload-key and database settings. Select **Save, rebuild, and deploy** and wait for the service to finish deploying. The application requires STARTTLS with certificate verification on port 587.
7. Sign in as administrator and check that welcome-email setup is configured. Due pending signup jobs can now send automatically, as can future signup jobs. Review unwanted test accounts before enabling the sender because their queued messages may also be processed.
8. Test receipt only with an authorised recipient you control. Confirm both its Members-view mail status and the recipient's inbox/spam folder. **Sent** means Proton accepted the message, not proof of inbox placement. If a job fails, correct the sender/network settings before using the administrator's failed-message retry action.

Proton Mail Bridge is a local desktop-client connection and is not a hosted SMTP service supplied by Render. It is not a way to enter the free Proton mailbox's ordinary password into this cloud application. The app does not install or operate an always-running Bridge instance.

## Option B: an existing iCloud mailbox

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
| `EMAIL_REPLY_TO` | `loudpluscana@protonmail.com` for replies to the requested business mailbox. |
| `EMAIL_PUBLIC_ORIGIN` | Optional genuine full-service HTTPS origin. Leave unset to use `PUBLIC_ORIGIN` or Render's external URL. |

5. Preserve the existing `ADMIN_PASSWORD`, `IDENTITY_UPLOAD_KEY` and mounted database settings. Save the mail settings and redeploy. Do not generate a replacement identity-upload key for this mail change.
6. Check the admin mail setup and a new signup's welcome status. Test actual receipt only with an authorised recipient you control; sender acceptance and inbox placement are separate checks.

iCloud's SMTP connection uses port 587 with STARTTLS and certificate verification. See [Apple's iCloud Mail server settings](https://support.apple.com/en-us/102525). Do not weaken transport security to work around an authentication or network error.

## Other SMTP mailboxes

Use the actual mailbox provider's authenticated outgoing-server settings with `EMAIL_PROVIDER=smtp`, `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` and `SMTP_PASSWORD`. Use an app-specific password or the provider's approved SMTP credential when it requires one. Do not assume the normal account password works, and do not claim an address as the sender unless the provider authorises it.

Supported ports are **465** for TLS and **587/2525** for mandatory STARTTLS. The chosen provider must actually offer the port you configure. `EMAIL_REPLY_TO` and `EMAIL_PUBLIC_ORIGIN` are optional as described above.

Render free web services restrict common outbound SMTP ports, including 25, 465 and 587. Check the actual service plan and current host restrictions. The persistent-disk Blueprint uses a paid service, but that does not prove the existing service's private plan or network settings. If the host blocks the mailbox's required port, use a supported transport or the HTTPS option below. The application does not change hosting plans or create paid accounts automatically.

## Option C: Resend over HTTPS

1. Use the owner's Resend account and complete its domain-verification process for a domain the owner controls. Follow the provider's DNS/authentication instructions. A mailbox on a domain owned by another provider does not give the owner control of that domain's DNS.
2. Create a server-side API key with permission to send for the approved sender. Keep it private.
3. In Render **Environment**, set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` to that private key, and `EMAIL_FROM` to the approved verified-domain sender. Set `CONTACT_EMAIL` and `EMAIL_REPLY_TO` to `loudpluscana@protonmail.com`. Do not use an unauthorised `@protonmail.com` address as the Resend **From** sender; you do not control Proton's domain DNS.
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
