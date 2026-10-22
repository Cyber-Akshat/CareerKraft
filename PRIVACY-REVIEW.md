# CareerKraft Beta privacy notice review

The implemented page is `privacy.html`. It is public, linked from every page footer,
and accompanied by short notices at registration, Google sign-in, the quiz,
evidence submission, early-access signup, account settings and the Lumia composer.
The visible draft status is intentional until the facts below are confirmed.

## Details requiring the operator's confirmation

- The legal data controller, including whether a parent operates CareerKraft.
  The draft uses Esha Prasad and careerkraft.official@gmail.com because these
  already appear in `terms.html`. Confirm or update both documents together.
- A suitable UK postal contact address. No address has been invented or published.
- The actual hosting/storage and automated-email providers, their locations and
  applicable contracts. Provider categories are described while those facts are unknown.
- The proposed lawful bases in section 7. Legitimate interests require an actual
  necessity and balancing assessment, with particular attention to under-18 users.
  Writing a policy does not establish that assessment or create consent.
- Applicable international transfer arrangements and any required transfer
  assessment. Groq's published DPA contains SCCs and the UK Addendum, but the page
  does not claim that the operator has verified every applicable agreement or setting.
- The real Groq organisation's data-control settings. The app makes inference and
  transcription requests; it does not configure provider zero-retention settings.
- Any separately held mail, support, server-log or backup retention arrangements.
  There is no implemented general timed purge or provider-side deletion workflow.

After those facts are confirmed, update the affected sections and replace the draft
status with the final effective/updated date. Keep Terms and collection notices consistent.

## Backend facts checked

- Production `__Host-ck_session`; local `ck_session`; optional ten-minute `ck_oauth`.
  Default maximum session age is 24 hours, inactivity limit 30 minutes; configurable.
- Account links expire after one hour. Expiry does not guarantee record erasure.
- Private evidence can be accessed by its owner and authorised reviewers, who may
  also see the submitting user's name and email. There is no public evidence gallery.
- Text extraction, Groq image analysis/transcription and up to three sampled video
  frames; uploaded code, notebooks and spreadsheet formulas are not executed.
- Extracted content is used during processing, not saved as a separate transcript
  database field. Original uploads, supporting text and review information are stored.
- Settings exports JSON and deletes live account/journey/evidence/skills/Lumia
  records, revokes access, and attempts linked-file removal. No individual evidence
  or conversation deletion button, guaranteed file erasure, database secure wipe,
  mail-preview cleanup or backup purge is implemented.
- Google Fonts requests are independent of optional Google sign-in. No advertising
  or analytics cookies were found. Browser preferences and notification markers
  can remain after account deletion.

## Sources checked on 21 October 2026

- [ICO: privacy information to provide](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/what-privacy-information-should-we-provide/)
- [ICO: lawful bases and children's information](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/children-and-the-uk-gdpr/how-do-the-lawful-bases-apply-to-children-s-personal-information/)
- [ICO: international transfers](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/international-transfers/)
- [Groq: data handling and retention](https://console.groq.com/docs/your-data)
- [Groq: Data Processing Addendum](https://console.groq.com/docs/legal/customer-data-processing-addendum)

## Verification

Run `npm.cmd test` for the server, page and privacy integration tests.
Run `npm.cmd run test:browser` for real Chrome/Edge layouts and interactions,
including the privacy page and mobile collection notices.
