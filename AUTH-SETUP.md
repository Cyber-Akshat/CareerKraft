# Run CareerKraft

Requires Node.js 24 or newer. In PowerShell:

```powershell
npm.cmd install
# Only if .env does not already exist:
Copy-Item .env.example .env
npm.cmd start
```

Open http://localhost:3000/auth.html. PyCharm's static preview on port 63342
cannot handle the authentication API. The Node server serves the website and API
together. All authentication pages use auth-api.js, then their page script.

Accounts, profiles, career assessments, ranked career matches, selected careers
and early-access signups are stored in the app-owned SQLite database at
data/accounts.sqlite. No Supabase URL or key is needed. Sessions use HttpOnly
cookies. Verification and password reset links expire and can be used once;
resets revoke existing sessions. Existing Supabase accounts are not migrated.

With MAIL_MODE=preview, emails are saved privately to data/mail/. Open the local
text file and copy its link into your browser. No email is delivered to Gmail
in this mode. For real delivery, set MAIL_MODE=smtp and your provider's SMTP_HOST,
SMTP_PORT, SMTP_USER, SMTP_PASSWORD and MAIL_FROM in .env, then restart.

SMTP delivery does not require the recipient to connect a Google account. The
server logs SMTP acceptance counts and message IDs, or failure codes, without
logging recipients, verification links or credentials. SMTP acceptance confirms
that the mail server accepted a message; check spam folders and the sending
mailbox for bounce notices if it does not arrive.

For people using another device, APP_URL must be the publicly reachable HTTPS
address of the app. A link to http://localhost:3000 opens the recipient's own
device. Hosting must also forward requests to the Node server. Restart the app
after changing .env so new messages use the updated settings.

For Google sign-in, set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET and register
http://localhost:3000/api/google/callback as the Google OAuth redirect URI.
Google credentials are exchanged on the server. Existing password accounts must
sign in with their password first, then connect Google from Account settings.
Connecting Google requires the current password and a session-bound OAuth flow;
matching email addresses never link accounts automatically. Accounts using only
Google must verify with Google again before setting a password, changing email,
or deleting their account. A Google connection cannot be removed until a password
has been set.

Open Account settings from the dashboard navigation or visit
http://localhost:3000/settings.html while signed in. The page supports display
names, profile pictures, email and password changes, Google connection management,
appearance and motion preferences, signing out other sessions, an account JSON
export, and permanent account deletion. Email changes take effect only after the
new address confirms its single-use link while signed into the requesting account.
Preview mode saves this confirmation email in data/mail/ just like verification
and password-reset emails. Password changes revoke other sessions and outstanding
password-reset links while keeping the current session signed in.

Profile photos accept PNG, JPEG and WebP files up to 2 MB and 16 megapixels. The
server decodes and re-encodes them as PNG images up to 512 pixels, strips metadata,
and saves them in private data/avatars/. SVG uploads are not accepted. Users can
also choose one of six built-in character avatars. Character choices persist with
the account, appear in the JSON export, and replace uploaded photos, removing the
previous private upload. Uploading a photo or removing the avatar clears the
character choice. Profile avatar URLs require an authenticated session and return
only that account's current photo or character.

The JSON export contains the account profile, career assessments and matches,
roadmaps, evidence details, verified skills and Lumia conversation history. It
omits passwords, authentication tokens and private file-storage locations; original
uploaded files are not embedded in JSON. Deleting an account removes its database
records, sessions, tokens, matching early-access signup, and private evidence and
avatar files. Deletion requires the current password, or recent Google verification
for Google-only accounts, plus typing DELETE in the confirmation form.

Keep .env and data/ private. For production, use HTTPS, persistent storage,
NODE_ENV=production, MAIL_MODE=smtp and the public HTTPS APP_URL. The local server
binds to 127.0.0.1; configure hosting and proxy settings for your deployment.
This SQLite setup is for a single server instance. A public rollout needs a
database backup and account migration plan.

## Authentication security

Passwords are stored using one-way, salted scrypt hashes, not reversible
encryption. New hashes use N=131072, r=8, p=1, a random 32-byte salt and a 64-byte
derived key. The stored version and parameters are validated before use. Older
salt:hash accounts remain able to sign in and are upgraded after successful
password verification. Legacy checks also do production-cost work so failed
legacy logins do not take the old fast path. Password comparisons use
timingSafeEqual, and expensive hashing is capped at two active jobs plus sixteen
waiting jobs to bound memory and CPU use.

New registrations, password changes and resets require 15–128 characters and
reject a small local list of common passwords and obvious repeated patterns.
Unicode, spaces and password-manager paste are supported; passwords are never
trimmed or silently changed. This local screen is not a comprehensive breached
password database. Existing shorter passwords can still be verified and upgraded.

Authentication rate limits are stored in SQLite and survive process restarts:

| Request | Per IP | Per normalized email |
| --- | --- | --- |
| Login | 20 per 15 minutes | 10 per 15 minutes |
| Registration | 5 per hour | 3 per hour |
| Verification/reset emails | 5 per 15 minutes | 3 per 15 minutes |
| Verification/reset token submission | 20 per 15 minutes | — |
| Google OAuth start/callback | 20 per 15 minutes | — |

Attempts count even when invalid or successful. Email identities and IP buckets
are hashed before storage, IPv6 network addresses are grouped, and the store is
bounded. Limit responses are generic JSON with Retry-After. The existing general
API limit also applies. This is a single-instance SQLite deployment; a deployment
with multiple server instances needs a shared rate-limit and session store.

Login failures use the same status, message and code for incorrect, missing,
unverified, Google-only and damaged-password accounts. Valid registration
requests return the same neutral 202 response for new or existing addresses and
for mail-delivery failure. Recovery responses are also neutral. Email delivery
runs in a bounded background queue so SMTP latency cannot determine the public
response. Delivery failures are logged without addresses, passwords or tokens;
users can request another email later.

Sessions use random 256-bit secrets, store only their hashes, expire after
30 minutes of inactivity and have a 24-hour absolute lifetime by default. Set
AUTH_SESSION_IDLE_MINUTES (5–1440) and AUTH_SESSION_MAX_AGE_HOURS (1–168) to adjust
these limits. Each account is limited to ten sessions. Sign-in and sensitive
password, email and Google changes rotate the current cookie; password resets
revoke all sessions and outstanding recovery proofs. Google confirmation grants
its short-lived security proof only to the newly issued session.

Production requires NODE_ENV=production and an HTTPS APP_URL. Cookies use the
__Host-ck_session name with Secure, HttpOnly, SameSite=Lax and Path=/, without a
Domain attribute. Insecure production requests are rejected. Forwarded headers
are ignored by default. If a reverse proxy you control terminates TLS, explicitly
set TRUST_PROXY to its trusted IP/CIDR list (for example 127.0.0.1,::1 for a local
proxy), restrict direct access to the Node server, and have that proxy replace
forwarding headers. Boolean trust-all and arbitrary hop counts are rejected.

Every response includes a Content Security Policy that permits application
scripts and hashes of the existing inline initialization scripts, with no
unsafe-eval or unrestricted inline JavaScript. The policy allows the app's current
inline styles and Google Font hosts. Framing and objects are blocked; nosniff,
no-referrer, a restrictive permissions policy and production HSTS are set. API
responses are no-store. State-changing API requests require the configured Origin
and JSON (apart from the explicitly supported multipart uploads), and JSON bodies
must be objects within the size limit. All account authorization and validation
remain server-side.

The .env file stays private and ignored by Git. Keep its SMTP/OAuth/API secrets in
the server environment or a secret manager on public hosting. Restart the server
after deploying these changes or changing environment configuration.

These changes harden the existing password and Google flow. The app does not yet
implement passkeys or application-managed multi-factor authentication.

Implementation references: [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
and [OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).

Run all tests with npm.cmd test.

Evidence uploads use the existing GROQ_API_KEY for image observations and audio
transcription, followed by the normal module-criteria review. GROQ_VISION_MODEL
and GROQ_TRANSCRIPTION_MODEL optionally override the defaults in .env.example.
The key stays on the server. FFmpeg and FFprobe are installed with npm.

Uploads remain limited to 10 MB. Media processing handles clips up to 10 minutes;
videos use a transcript and at most three sampled frames, not continuous visual
analysis. PowerPoint extraction reads text from at most 40 slides and does not
grade slide appearance. Incomplete, corrupt or failed processing cannot approve
an uploaded file automatically. The original work stays in data/evidence-uploads;
temporary media is processed in data/evidence-processing and removed afterward.
Both directories stay private.
