# South African signup and age-check operating guide

This guide describes the application's controls and the business's operating duties. The primary sources below were checked on **22 October 2026**. The software does not certify that a business, product, transaction, or privacy programme complies with every applicable law.

## Legal basis and limits

- **Adult age is 18.** Section 17 of the Children's Act 38 of 2005 says a child becomes a major on reaching 18. Section 1 of the Cannabis for Private Purposes Act 7 of 2024 defines an adult person as someone who is 18 or older. The Department of Justice's 3 February 2026 statement confirms this age threshold. The earlier 21+ wording in the app was not the South African statutory adult threshold.
- **Private use is not a general commercial-sales permission.** The Department of Justice states that the Constitutional Court's private-use decision did not extend to buying and selling cannabis. A membership account, an ID check, or passing questions does not authorise cannabis sales or delivery. Existing business-sales gates remain necessary and must reflect genuine authority for the actual products and service area.
- **Do not represent the 2024 Act as fully commenced.** The official Act listing currently says **“Commencement: To be proclaimed.”** Section 8 provides for presidential proclamation and allows different commencement dates for different provisions. The February 2026 regulations notice is a draft consultation, not proof that its proposed limits are in force. No later commencement proclamation was established in this source review; this is not an exhaustive Gazette certification.
- **The random quiz is a business onboarding choice.** The reviewed sources do not prescribe this quiz, make it proof of age, or specify a particular electronic identity-verification vendor. The app uses questions to check responsible-use awareness and uses an actual manual original-photo-ID inspection for its recorded age-verification outcome.

## What happens during signup

1. The applicant provides their name, email, password and date of birth, confirms adulthood, accepts the account terms/privacy notice, and consents to the stated age-check processing.
2. The server validates the calendar date and calculates the applicant's age using the server's current date in **`Africa/Johannesburg`**. Invalid dates, future dates, and applicants younger than 18 are rejected. Changing the browser clock does not change server eligibility.
3. The browser requests `GET /api/members/signup-challenge`. The server chooses **three questions** from its responsible-use bank using cryptographic randomness and shuffles their answer choices. Each fresh application receives a new challenge; the immediately preceding question combination is not reused. The pool may be reused over time, so this does not promise globally unique questions for every person forever.
4. A challenge is bound to a secure browser cookie, expires after **15 minutes**, allows at most **three answer attempts**, and can be consumed only once. Requesting replacement questions invalidates the earlier unused challenge for that browser. Answer keys are not returned by the public API.
5. Correct answers allow account creation with **pending ID check** status. They never produce verified status. The account may use its profile and saved favourites while ordering remains unavailable to an unverified member.

Questions address lawful/responsible conduct, privacy and account safety. They are not password-recovery questions and do not request family-history secrets, health diagnoses, medication histories, ID numbers, or document images.

## Verification states

| State | Meaning and next action |
| --- | --- |
| Submission required (`required`) | No current eligible submission is available. The member must complete the date declaration, consent and new questions from their account. This also applies to legacy accounts without an ID-age check and to verification invalidated by a profile-name change. |
| Pending ID check (`pending`) | The declared date passed the server's 18+ calculation and the responsibility questions were completed. An authorised staff member must still inspect the person and original ID. |
| 18+ ID checked (`verified`) | An authenticated staff session recorded that an actual in-person original-photo-ID check was completed. This is a manual business verification, not a government API or automated identity result. |
| Not verified (`rejected`) | The staff check could not confirm the application. The member must submit a new age-check application before another review. |

Changing a member's name invalidates the current verification and removes any pending date of birth. The applicant must resubmit and be checked against the new name. A password change does not itself establish or replace age verification.

## Staff's actual original-ID check

A working staff login needs the owner to configure a unique **`ADMIN_PASSWORD`** of at least 16 characters in the host's private environment settings. A publicly loaded `/staff` login page does not mean the secret has been configured. Staff authentication is separate from member authentication.

1. Sign in at **`/staff`** and select **Age Checks**. Review the pending queue and open the applicant's entry.
2. Have the applicant present **in person** with an original, valid government-issued photo ID, such as a South African ID or a passport. Do not approve someone from their quiz result, an unchecked image, an email assertion, or a colleague's unrecorded assumption.
3. Inspect the original document and compare its **photograph, full name, and date of birth** against the person present and the current application. Confirm the document shows an age of **at least 18 today**. If the identity or details cannot be confirmed, do not verify the application.
4. Only after completing the inspection, select both attestations: the original valid photo ID matched the person/application, and the original ID confirmed the person is 18 or older. Confirm the verification decision in the interface.
5. If the check cannot be completed, choose the appropriate rejection reason: identity not confirmed, details mismatch, or unable to verify. Do not enter personal ID details into notes; the review API accepts structured reasons rather than document-number notes.
6. The application records the decision, method, review timestamp and pseudonymous authenticated-reviewer reference. The live pending birth date is removed after either approval or rejection. Reviewers should refresh the queue if another staff session has already acted on the application.

The business must restrict staff access and train reviewers. A shared staff password and pseudonymous session reference do not identify individual employees by name; the owner must maintain an appropriate authorised-reviewer operating record and accountability process. The software cannot make an unperformed inspection genuine.

**Do not photograph, upload, copy, or enter an ID number into this workflow.** No automated document, face-matching, or government identity service is connected. Connecting a genuine future provider would need a separate tested integration and appropriate privacy/operator arrangements.

## Ordering remains separately controlled

An order request requires both:

- A signed-in member whose current age-check status is `verified`.
- Every existing business launch requirement, including genuine sales/delivery authority, approved actual catalog and postal coverage, configured store/support details, secure staff access, and enabled order intake.

Neither condition replaces the other. A verified member cannot make an unauthorised business lawful. A fully configured business cannot accept this app's order request from a member who has not completed the ID-age check. The app does not collect online payments, automatically dispatch drivers, or guarantee fulfilment.

## Data minimisation and retention

The age-check flow stores a pending declared birth date so authorised staff can compare it with the original ID. The public member response exposes the verification status and relevant timestamps, not that full birth date. Staff can see a pending date of birth only through authenticated review access.

- The live pending date of birth is removed after **approval, rejection, or expiry of the 30-day pending period**. An expired pending application returns to submission-required status.
- Retention cleanup runs on startup, periodically while the server runs, and during onboarding/age-check operations. A stopped server cannot run scheduled cleanup; it processes expired records when it runs again.
- A profile-name change invalidates the verification and removes any pending date of birth.
- The app retains minimal outcome/audit metadata, consent/pass timestamps, policy version and question identifiers. It does not retain an ID photograph, ID number, biometric template, or personal answer history through this workflow.
- Closing an account removes its member profile, favourites, sessions and linked age-check/audit records. Independently submitted order records remain subject to the business's separate lawful retention process.
- Deleting a field from the live database does **not** automatically erase older backup copies. The owner must define and operate backup rotation, restricted access, restoration handling and eventual deletion so older DOB copies are not kept indefinitely.

The application's 30-day pending period is an implemented operational policy, **not a claim that POPIA prescribes 30 days**. The owner must assess and document the necessary retention period and purpose for the actual service, including review/audit records and backup copies.

## Owner privacy and hosting responsibilities

POPIA requires lawful and reasonable processing; adequate, relevant and non-excessive collection; a defined lawful purpose; appropriate notices; limited retention; and security safeguards. Before operating the process with real applicants, the owner must:

- Supply genuine responsible-party identity, address and monitored contact details, explain the processing purpose and required/optional fields, and provide a usable data-rights/contact process.
- Document the lawful basis, purpose, recipients, retention schedule and access controls for account and age-check information. Do not treat accepting all terms as unlimited permission for other uses or marketing.
- Restrict the database, staff dashboard, hosting account and backups; keep HTTPS enabled; manage staff secrets securely; and test backup/restore and deletion procedures.
- Review the actual hosting/operator arrangements and required written agreements. The provided Render Blueprint uses **Frankfurt**. POPIA section 72 governs foreign transfers and provides conditions such as adequate protection under law/binding agreement, consent, or another listed basis; overseas hosting must not be assumed automatically compliant or automatically prohibited.
- Confirm the existing Render service has a **persistent disk mounted at `/var/data`** and **`DATABASE_PATH=/var/data/orders.sqlite`**. The disk mount has not been established from the public API. Without persistent storage, accounts, sessions and audit information may be lost on redeployment.

These are owner operating duties, not an additional code-approval step. Application flags, a quiz, or this guide do not certify legal compliance. The genuine business authorisation and privacy arrangements must match the business actually being operated.

## Primary sources checked

1. **Children's Act 38 of 2005, section 17:** “A child … becomes a major upon reaching the age of 18 years.” [Official Department of Justice PDF](https://www.justice.gov.za/legislation/acts/2005-038%20childrensact.pdf).
2. **Cannabis for Private Purposes Act 7 of 2024, sections 1 and 8:** definition of an adult and proclamation-based commencement. The current official page states “To be proclaimed.” [Government Act listing](https://www.gov.za/documents/acts/cannabis-private-purposes-act-7-2024-english-sepedi-03-jun-2024) and [Government Gazette Act PDF](https://www.gov.za/sites/default/files/gcis_document/202406/50744-03-06-cannabisforprivatepurposesact-72024.pdf).
3. **Department of Justice statement, 3 February 2026:** adults are persons aged 18 or older; the Constitutional Court ruling did not extend to buying and selling cannabis; commercial matters fall outside the private-use Act's scope. [Official Government statement](https://www.gov.za/news/media-statements/justice-and-constitutional-development-draft-regulations-under-cannabis).
4. **Draft regulations consultation, 2 February 2026:** comments invited until 5 March 2026; this is a draft notice, not proof of final regulations or commencement. [Official notice](https://www.gov.za/documents/notices/cannabis-private-purposes-act-regulations-comments-invited-02-feb-2026).
5. **Protection of Personal Information Act 4 of 2013:** sections 9–14, 18–21 and 72 cover lawful processing, minimality, purpose/retention, notices, safeguards/operators and foreign transfers. [Official Department of Justice PDF](https://www.justice.gov.za/legislation/acts/2013-004.pdf).
