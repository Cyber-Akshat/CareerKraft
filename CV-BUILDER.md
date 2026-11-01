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
- `stage: 'validation'` reports counts before and after the API's final check,
  immediately before persistence. Here the input is the helper's already
  validated output, so compare the reviewer stage for the original model count.

If every returned suggestion is rejected, the request returns HTTP 502 with
`CV_BUILD_VALIDATION` and logs `validationReason: 'no_usable_suggestions'`.
It saves no partial build; the student can retry. An explicitly empty model
list remains distinguishable by its zero raw count.

Logs contain counts and fixed rejection categories rather than uploaded CVs,
contact details, or full model responses.

Run the focused regression checks with:

```sh
node --test tests/cv-parser.test.js tests/cv-suggestions.test.js tests/cv-builder.test.js tests/cv-build-api.test.js
```
