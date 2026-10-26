# Run CareerKraft

Requires Node.js 24 or newer and a running MySQL 8.0.16 or newer server.
On Windows, install MySQL Community Server and configure its Windows service
with [MySQL's Windows installation instructions](https://dev.mysql.com/doc/refman/8.4/en/windows-installation.html).
Start the service before starting CareerKraft.

Connect through MySQL Workbench or the MySQL command-line client as an
administrator and create a dedicated database and account. Replace the sample
password with your own password:

```sql
CREATE DATABASE careerkraft CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
CREATE USER 'careerkraft'@'localhost' IDENTIFIED BY 'replace-with-your-own-password';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
  ON careerkraft.* TO 'careerkraft'@'localhost';
```

For a remote database, use the host/account access settings supplied by your
database provider. See MySQL's [CREATE USER](https://dev.mysql.com/doc/refman/8.4/en/create-user.html)
and [GRANT](https://dev.mysql.com/doc/refman/8.4/en/grant.html) documentation.
CareerKraft creates its tables in the configured database; it does not create
the database or the MySQL account.

In PowerShell:

```powershell
npm.cmd install
# Only if .env does not already exist:
Copy-Item .env.example .env
```

Set the MySQL connection in `.env`, keeping the rest of your existing settings:

```dotenv
DB_HOST=localhost
DB_PORT=3306
DB_NAME=careerkraft
DB_USER=careerkraft
DB_PASSWORD=your-own-password
```

Quote a password in `.env` if it contains `#` or spaces. Alternatively, set
`DATABASE_URL=mysql://user:password@host:3306/careerkraft`; a nonempty
`DATABASE_URL` takes precedence over the individual fields. URL credentials
must be percent-encoded when they contain special characters. Keep database
credentials on the server. For a remote MySQL server requiring TLS, set
`DB_SSL=true`; set `DB_SSL_CA` to its CA certificate file when your provider
requires a private CA. For example, an Aiven CA downloaded locally can use
`DB_SSL_CA=C:/Users/your-name/CareerKraft/certs/aiven-ca.pem`.
Alternatively, put the complete PEM certificate in `DB_SSL_CA`, surrounded by
quotes in `.env`. The value can span real newlines or use literal `\n` between
certificate lines:

```dotenv
DB_SSL=true
DB_SSL_CA="-----BEGIN CERTIFICATE-----\nREPLACE WITH YOUR CA CERTIFICATE BODY\n-----END CERTIFICATE-----"
```

Use the certificate supplied by your database provider, including its BEGIN and
END lines. A nonempty `DB_SSL_CA` enables TLS even if `DB_SSL` is unset or false.
The server certificate and hostname are verified for every TLS connection.

On Render, add the MySQL variables under the web service's Environment settings.
For a CA file, add a Secret File named `aiven-ca.pem`, paste the complete PEM
certificate into its Contents field, and set `DB_SSL_CA=/etc/secrets/aiven-ca.pem`
and `DB_SSL=true`. Render makes the file available at runtime; see
[Render's secret file instructions](https://render.com/docs/configure-environment-variables#secret-files).
An inline `DB_SSL_CA` environment value also works; paste the PEM contents without
the surrounding `.env` quotes when entering a value directly in the dashboard.
Save and redeploy after changing these settings.

If `data/accounts.sqlite` contains your existing accounts, migrate before the
first MySQL startup. Stop every CareerKraft process that uses either database
and keep a backup of `data/`. With MySQL configured and the destination database
empty, run:

```powershell
npm.cmd run db:migrate:mysql
# To migrate another SQLite file:
# npm.cmd run db:migrate:mysql -- --source C:\path\to\accounts.sqlite
npm.cmd start
```

The migration reads SQLite in a read-only transaction, creates the MySQL tables,
and copies accounts, password hashes, sessions, settings, roadmaps, evidence
records, skills, conversations and authentication limits while preserving IDs.
It refuses a destination that already contains data, checks row counts, and
commits the copied rows together. A failed import rolls back its rows; empty
tables created during setup may remain. The SQLite file stays unchanged.
Unsupported populated columns or invalid relationships stop the migration
instead of dropping data. Existing private avatar/evidence files remain in
`data/` and must be retained with the application.

For a fresh installation, skip the migration and run `npm.cmd start` after
configuring MySQL. Application startup always uses MySQL and does not import
SQLite automatically. The explicit SQLite backend is used by isolated tests.
To connect from PyCharm's Database window, use the `careerkraft` MySQL datasource
at `localhost:3306` and enter the same user/password there. Passwords are not
stored in the shared datasource XML.

Open http://localhost:3000/auth.html. PyCharm's static preview on port 63342
cannot handle the authentication API. The Node server serves the website and API
together. All authentication pages use auth-api.js, then their page script.

Accounts, profiles, career assessments, ranked career matches, selected careers
and early-access signups are stored in the configured MySQL database.
No Supabase URL or key is needed. Sessions use HttpOnly
cookies. Verification and password reset links expire and can be used once;
resets revoke existing sessions. Existing Supabase accounts are not migrated.

For local development, MAIL_MODE=preview saves emails privately to data/mail/.
Open the local text file and copy its link into your browser. No email is
delivered in this mode; preview is unavailable in production.

For real delivery without an owned domain, use `MAIL_MODE=emailjs` with your
connected Gmail account. Follow [the EmailJS setup guide](EMAILJS-SETUP.md) to
create the shared template, enable non-browser API access, and set
`EMAILJS_SERVICE_ID`, `EMAILJS_TEMPLATE_ID` and `EMAILJS_PUBLIC_KEY`.
An existing `EMAIL_SERVICE_ID` is also accepted as the service ID.
Existing `PUBLIC_API_KEY` and `PRIVATE_API_KEY` values are accepted as aliases
for the respective EmailJS keys; use the `EMAILJS_` names for new setup.
`EMAILJS_PRIVATE_KEY` is optional and recommended; supply it if you enable private
key authorization in EmailJS. The sender is your connected email account, not
`MAIL_FROM`. The free plan allows 200 requests per month and two templates; one
shared template handles all CareerKraft authentication emails. See
[EmailJS pricing](https://www.emailjs.com/pricing/) and its
[personal-email usage guidance](https://www.emailjs.com/docs/user-guide/connecting-email-services/).

Alternatively, set MAIL_MODE=brevo, BREVO_API_KEY and MAIL_FROM in .env, then
restart. BREVO is also supported as an alias for BREVO_API_KEY. MAIL_FROM accepts
a plain email address or a display name, such as `CareerKraft <hello@example.com>`.
Register and verify the sender in Brevo before sending; see
[Brevo's transactional email setup](https://developers.brevo.com/docs/send-a-transactional-email).
Verification emails, resends, password resets and email-change confirmations all
use the selected HTTPS API transport. SMTP settings and Nodemailer are no
longer required. Recipients do not need to connect a Google account. The server
does not fall back to another provider when a send fails.

Delivery logs contain only sanitized status information, without request or
response payloads, addresses, verification links, tokens or API keys. Failures
return generic messages. API acceptance does not guarantee inbox delivery;
check the selected provider's email history/delivery events and the recipient's
spam folder if mail is missing.

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
NODE_ENV=production, MAIL_MODE=emailjs or MAIL_MODE=brevo and the public HTTPS
APP_URL. Set the selected provider's credentials in the host's environment too:
Render does not deploy your local .env file. EmailJS setup on Render is covered
in [EMAILJS-SETUP.md](EMAILJS-SETUP.md). The server binds to 0.0.0.0 and uses the
host's PORT, with 3000 as the local fallback.
Configure the MySQL variables on your host as well; your local `.env` is not
deployed automatically. Use persistent storage for private evidence/avatar files
and maintain backups of both MySQL and those files. Multiple app instances need
access to the same private file storage as well as the same MySQL database.

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

Authentication rate limits are stored in MySQL and survive process restarts:

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
API limit also applies. Authentication limits and sessions share the configured
MySQL database across app instances; the general API limit remains per process.

Login failures use the same status, message and code for incorrect, missing,
unverified, Google-only and damaged-password accounts. Valid registration
requests return the same neutral 202 response for new or existing addresses and
for mail-delivery failure. Recovery responses are also neutral. Email delivery
runs in a bounded background queue so provider latency cannot determine the public
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
Domain attribute. Insecure production requests are rejected. The app trusts one
proxy hop by default so Render's forwarded HTTPS is recognized. TRUST_PROXY can
override this with a trusted IP/CIDR list (for example 127.0.0.1,::1 for a local
proxy). Restrict direct access to the Node server and have the proxy replace
forwarding headers.

Every response includes a Content Security Policy that permits application
scripts and hashes of the existing inline initialization scripts, with no
unsafe-eval or unrestricted inline JavaScript. The policy allows the app's current
inline styles and Google Font hosts. Framing and objects are blocked; nosniff,
no-referrer, a restrictive permissions policy and production HSTS are set. API
responses are no-store. State-changing API requests require the configured Origin
and JSON (apart from the explicitly supported multipart uploads), and JSON bodies
must be objects within the size limit. All account authorization and validation
remain server-side.

The .env file stays private and ignored by Git. Keep email-provider keys and other
OAuth/API secrets on the server, in its environment or a secret manager on public
hosting. EmailJS is called by the server; keep its private key and verification
tokens out of browser code. Never place the Brevo key in browser code. Restart
the server after deploying these changes or changing environment configuration.

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
