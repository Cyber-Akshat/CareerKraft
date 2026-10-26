# Send CareerKraft emails with EmailJS

EmailJS can send through a Gmail account you connect, so you do not need to own
a domain. Recipients receive mail from that account and do not need to connect
their own Google account. Personal email services suit development and very low
volume usage; see [EmailJS's guidance](https://www.emailjs.com/docs/user-guide/connecting-email-services/).

The [free plan](https://www.emailjs.com/pricing/) includes **200 requests per
month and two templates**. CareerKraft uses one template for registration
verification, resends, password resets and email-change confirmations. Every
send, including a resend, uses the allowance. Requests stop when the allowance
is exhausted. EmailJS also limits its
[send API](https://www.emailjs.com/docs/rest-api/send/) to one request per second.

## 1. Connect your sender

Create an [EmailJS account](https://dashboard.emailjs.com/sign-up). Under
**Email Services**, add **Gmail**, connect the Gmail account you want to send
from, and grant permission to send email. A separate Gmail account for
CareerKraft makes its sender address easy to recognize. Save the **Service ID**.
If the service already exists, use its existing ID.

## 2. Create one shared template

Open **Email Templates**, create a template, and configure these fields exactly:

| Template field | Value |
| --- | --- |
| To Email | `{{to_email}}` |
| Subject | `{{subject}}` |
| From Name | `{{from_name}}` |
| From Email | Use the default email address of the connected service |
| Reply-To | Leave empty, or use your fixed support address |
| CC / BCC | Leave empty |

Paste the contents of [templates/emailjs-auth.html](templates/emailjs-auth.html) into the
template's HTML/code editor, then save it. Copy the **Template ID**. The body
uses `{{message}}`, which the server supplies with the complete message and
single-use action link. Keep its double braces: EmailJS escapes the message
instead of interpreting it as HTML. See
[dynamic template variables](https://www.emailjs.com/docs/user-guide/dynamic-variables-templates/).

The same template handles every authentication email, so do not hard-code a
verification-only subject or a fixed recipient address. The HTML file is a
setup artifact to copy into EmailJS; it is not a website page.

## 3. Enable backend requests and copy your keys

Open **Account → Security** and enable **Allow EmailJS API for non-browser
applications**. Server requests are disabled by default; the
[official Node.js SDK instructions](https://github.com/emailjs-com/emailjs-nodejs)
describe this setting.

Under **Account**, copy your **Public Key**. A **Private Key** is optional and
recommended for server requests. If you enable private-key authorization in
EmailJS, copy that key too and set `EMAILJS_PRIVATE_KEY` below. Keep the private
key on the server. A Service ID alone is not enough: the shared template and
public key are also required.

## 4. Configure CareerKraft

Add these settings to your private `.env`, keeping your existing database and
other configuration:

```dotenv
MAIL_MODE=emailjs
EMAILJS_SERVICE_ID=your_service_id
EMAILJS_TEMPLATE_ID=your_template_id
EMAILJS_PUBLIC_KEY=your_public_key
# Optional, unless private-key authorization is enabled in EmailJS:
EMAILJS_PRIVATE_KEY=
APP_URL=http://localhost:3000
```

An existing `EMAIL_SERVICE_ID` works as an alias for `EMAILJS_SERVICE_ID`.
Existing `PUBLIC_API_KEY` and `PRIVATE_API_KEY` values also work as aliases for
`EMAILJS_PUBLIC_KEY` and `EMAILJS_PRIVATE_KEY`. Use the canonical `EMAILJS_` names
for new setup. EmailJS uses the connected sender selected in its template;
`MAIL_FROM` is used only by Brevo.

Restart the app with Node.js 24 or newer:

```powershell
npm.cmd start
```

CareerKraft sends through the EmailJS HTTPS REST API from its backend. Account
creation, token generation, token expiry and verification remain on the server.
Do not send directly from the browser or add authentication tokens to frontend
EmailJS examples. The server uses the selected provider and does not fall back
to another provider or local preview if delivery fails.

## 5. Configure Render

Open your web service's **Environment** settings and add the same EmailJS
variables. Your local `.env` is not automatically uploaded. Set:

```dotenv
NODE_VERSION=24
NODE_ENV=production
MAIL_MODE=emailjs
EMAILJS_SERVICE_ID=your_service_id
EMAILJS_TEMPLATE_ID=your_template_id
EMAILJS_PUBLIC_KEY=your_public_key
# Include EMAILJS_PRIVATE_KEY if used in EmailJS.
APP_URL=https://your-careerkraft-service.onrender.com
```

Use your actual public HTTPS address for `APP_URL`: verification links must
reach the hosted app, and `localhost` points at the recipient's own computer.
Keep your existing Aiven MySQL environment variables and CA certificate
configuration. Use `npm ci` as the build command and `npm start` as the start
command, then save and redeploy. See
[Render environment variables](https://render.com/docs/configure-environment-variables)
and [Node.js version settings](https://render.com/docs/node-version).

## Check delivery

After setup, request a verification email through CareerKraft and check the
connected Gmail account and **Email History** in EmailJS. A successful API
response confirms acceptance, not inbox delivery. If mail is missing, check
the recipient's spam folder, the monthly allowance, and the Gmail connection.
If EmailJS reports non-browser access is disabled, return to **Account →
Security**. If the wrong person receives an email, confirm **To Email** is
`{{to_email}}` rather than a fixed address.

Keep API keys, email addresses, message bodies and authentication links out of
logs and public issue reports. Use the existing local `MAIL_MODE=preview` only
for development when you do not want an email delivered; it is unavailable in
production.
