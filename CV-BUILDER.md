# CV Builder diagnostics

CV builds use two Lumia requests. The parser assigns immutable source IDs to CV
sections; the server reconstructs the original wording. The reviewer receives
that structured CV, the selected career, positive CareerKraft verified skills,
and validated analysis from the saved scan. Suggestions remain pending until
the student accepts or edits them.

The reviewer is instructed to return 5–10 meaningful suggestions, with fewer allowed
when there are fewer supported improvements. The validator normalizes common
field aliases and checks every suggestion against the original source or a
verified skill. Unsupported claims are discarded.

## Checking an empty review on Render

After deploying these files, prepare a **new build** from the saved scan. Existing
builds retain their previously saved CV and suggestions. In the service logs,
look for `CV Builder analysis.`:

- `stage: 'parser'` means source classification passed. `stage: 'fallback'` means
  the server used the detected source headings after rejecting parser output.
- `stage: 'reviewer', rawSuggestions: 0` means Lumia returned an empty list.
- A positive `rawSuggestions` count with a lower `acceptedSuggestions` count
  means validation removed suggestions. `rejectedByReason` explains why, for
  example `invalid_schema`, `unknown_source`, or `unsupported_rewrite`.
- `stage: 'recovery'` means the reviewer supplied no usable suggestions. The
  server checked its existing wording options and missing positive verified
  skills, then returned up to 10 supported suggestions. This adds no AI calls.
- `stage: 'validation'` reports counts before and after the API's final check,
  immediately before persistence. Here the input is the helper's already
  validated output, so compare the reviewer stage for the original model count.

If every returned suggestion is rejected and recovery finds no checked
improvements, the request returns HTTP 502 with `CV_BUILD_VALIDATION` and
`validationReason: 'no_usable_suggestions'`. A malformed review without recovery
candidates returns `validationReason: 'schema'`. The response now includes the
safe reason category as well as the code; arbitrary provider text is excluded.
No partial build is saved on these errors. A genuinely empty model list is
accepted only when the server also finds no supported recovery suggestions.

Optional `wordingOptionId` values of `null` or whitespace mean an independent
rewrite rather than an invalid option selection. A valid server wording option
can omit evidence because its original source is already known. Supplied
evidence is still checked. Known suggestions-array aliases are normalized before
the same factual and source checks run. Recovery keeps the original CV unchanged
and stores every suggestion as pending until the student approves it.

Logs contain counts and fixed rejection categories rather than uploaded CVs,
contact details, or full model responses.

## "Lumia is busy right now"

This message means Groq returned HTTP 429. It can reflect request, token, or
daily limits; the message alone does not identify which quota was reached.
The scanner and other Lumia features also use the same model and can consume
the organization's allowance. Check the service's Groq account
[Limits page](https://console.groq.com/settings/limits) for its actual quotas;
see [Groq's rate-limit documentation](https://console.groq.com/docs/rate-limits).

The parser now uses an output budget scaled to the number of source IDs
(1,024–4,096 tokens), and the reviewer uses 4,096 instead of 8,192 tokens.
Both use low reasoning effort. If Groq supplies a short `Retry-After`, the
server waits and retries that failing pass once, keeping any successful parser
output. The wait must be at most 45 seconds and leave at least 5 seconds within
the build's overall 60-second deadline. Missing hints, longer waits and repeated
limits return the retryable error to the browser.

`stage: 'rate_limit'` logs the `providerStage` (`parser` or `reviewer`), bounded
`retryAfterSeconds` when available, and `willRetry`. The final failure log also
identifies the failing pass. The results page shows `Try again in Ns` and blocks
repeat clicks until the cooldown ends; it makes no automatic browser retries.
When the provider omits a wait time, the button uses a 30-second fallback.

If the error persists after the cooldown, check the account's quota and reset
time. Reducing token use and retrying temporary limits cannot resolve an
exhausted daily allowance. Deploy the updated backend and results script to
Render before retesting the hosted application.

Run the focused regression checks with:

```sh
node --test tests/cv-parser.test.js tests/cv-suggestions.test.js tests/cv-builder.test.js tests/cv-build-api.test.js tests/cv-results.test.js
```

## Templates after review

After reviewing improvements, **Choose a template** opens the final CV preview
with six template categories. Filter the gallery, select a card, and use
**Save as PDF** (choose that destination in the browser's print dialog).

| Category | Presentation and emphasis |
| --- | --- |
| Classic | Traditional serif type, clean rules, conventional experience-led order |
| Modern | Strong sans-serif headings and an understated accent for students and graduates |
| Minimal | Generous whitespace and restrained typography |
| Technical | Skills and Projects ahead of Experience and Education |
| Academic | Education and Certifications ahead of Projects and Experience |
| Creative | Expressive headings and a restrained accent in a professional layout |

All templates use one text column, standard section headings, and real contact
text in the document body. PDF export preserves selectable text. There are no
photos, skill charts, document tables, or layout sidebars in the exported CV.
These choices follow parsing guidance from
[Greenhouse](https://support.greenhouse.io/hc/en-us/articles/200989175-Unsuccessful-resume-parse)
and [Lever](https://help.lever.co/s/article/Understanding-Resume-Parsing); no
format can guarantee identical results across every ATS.

Template changes reorder actual document sections for screen readers and PDF
extraction. They preserve the approved CV text and hide empty sections. The
selected template is saved separately in `careerkraft-cv-template`, tied to its
build ID, and survives refresh and a return to the same review. If optional
preference storage fails, the chosen layout remains usable and printable for
the current visit. Starting another scan from the preview clears the template
preference along with the other CV workflow data.

Run template regressions with:

```sh
node --test tests/cv-preview.test.js tests/cv-builder-ui.test.js tests/auth-security.test.js
```

For Chrome/Edge layout, interaction, and selectable-PDF checks on Windows:

```powershell
$env:BROWSER_AUDIT_SCOPE = 'cv-templates'
$env:BROWSER_ARTIFACTS = "$env:TEMP/careerkraft-cv-templates-audit"
npm.cmd run test:browser
```

The browser audit uses fake CV data and an isolated in-memory server. It checks
desktop/light and mobile/dark layouts; with an artifact directory it also
extracts text from a PDF for every template and checks section order.
