# Send CareerKraft emails with EmailJS

EmailJS can send through a Gmail account you connect, so you do not need to own
a domain. Recipients receive mail from that account and do not need to connect
their own Google account. Personal email services suit development and very low
volume usage; see [EmailJS's guidance](https://www.emailjs.com/docs/user-guide/connecting-email-services/).

The [free plan](https://www.emailjs.com/pricing/) includes **200 requests per
month and two templates**. CareerKraft can share one template for all
authentication emails, or use a separate password-reset template. Every
send, including a resend, uses the allowance. Requests stop when the allowance
is exhausted. EmailJS also limits its
[send API](https://www.emailjs.com/docs/rest-api/send/) to one request per second.

## 1. Connect your sender

Create an [EmailJS account](https://dashboard.emailjs.com/sign-up). Under
**Email Services**, add **Gmail**, connect the Gmail account you want to send
from, and grant permission to send email. A separate Gmail account for
CareerKraft makes its sender address easy to recognize. Save the **Service ID**.
If the service already exists, use its existing ID.

## 2. Create your email templates

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

If you keep your own email design, set the button's **Link / URL** to
`{{action_url}}`. In the HTML editor, use:

```html
<a href="{{action_url}}">Verify CareerKraft Account!</a>
```

CareerKraft supplies `action_url` as the complete URL, including the unique
single-use token for that email. A fixed `/verify-email.html` address cannot
confirm an account by itself. Use double braces so EmailJS escapes the value.
The supplied example uses a generic **Continue** button because the same field
also handles password resets and account security links.

Deploy the backend change before using this field in an existing template, then
request a fresh email. Editing the template does not update emails already sent.

By default, the same template handles every authentication email, so use
`{{subject}}` and `{{to_email}}` rather than a verification-only subject or a
fixed recipient. The HTML file is a setup artifact to copy into EmailJS; it is
not a website page.

For a separate password-reset design, create a second template with the same
recipient fields and `{{action_url}}` button URL, then set
`EMAILJS_RESET_TEMPLATE_ID` to its Template ID. `EMAILJS_TEMPLATE_ID1` is also
accepted; `EMAILJS_RESET_TEMPLATE_ID` takes precedence if both are set.

| Email | Template setting |
| --- | --- |
| Registration, verification resends and email-change confirmations | `EMAILJS_TEMPLATE_ID` |
| Password resets | `EMAILJS_RESET_TEMPLATE_ID` or `EMAILJS_TEMPLATE_ID1`, falling back to `EMAILJS_TEMPLATE_ID` when neither is set |

The reset button receives a unique `/reset-password.html?token=...` URL. A
verification resend continues to use the verification template and link.

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
# Optional separate password-reset template (EMAILJS_TEMPLATE_ID1 is an alias):
EMAILJS_RESET_TEMPLATE_ID=
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
# Set this if you use a separate password-reset template:
# EMAILJS_RESET_TEMPLATE_ID=your_reset_template_id
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

For an account you already registered, open the verification page and click
**Resend verification email**. Repeating registration with the same address
returns the same neutral response but does not send another email.

For local testing, open **http://localhost:3000**, matching `APP_URL`. A PyCharm
static preview does not run the authentication backend. Using `127.0.0.1` while
`APP_URL` is `http://localhost:3000` also fails the application's origin check.
For Render, configure its Environment settings separately and use its public
HTTPS URL for `APP_URL`.

After setup, request a verification email through CareerKraft and check the
connected Gmail account and **Email History** in EmailJS. A successful API
response confirms acceptance, not inbox delivery. If mail is missing, check
the recipient's spam folder, the monthly allowance, and the Gmail connection.
If EmailJS reports non-browser access is disabled, return to **Account →
Security**. If the wrong person receives an email, confirm **To Email** is
`{{to_email}}` rather than a fixed address.

A successful dashboard test of a different template does not validate the
template in `.env`. Confirm that `EMAILJS_TEMPLATE_ID` matches the template
containing `{{message}}`, and that its **To Email** field is `{{to_email}}`.
Dashboard tests also do not establish that non-browser API requests are enabled.

The server logs fixed diagnostic codes for recognized EmailJS failures, without
printing provider response text:

| Log code | Next step |
| --- | --- |
| `NON_BROWSER_API_DISABLED` | Enable non-browser API requests under Account / Security. |
| `PUBLIC_KEY_REJECTED` / `PRIVATE_KEY_REJECTED` | Copy the keys from the same EmailJS account as the service and template. |
| `TEMPLATE_NOT_FOUND` / `SERVICE_NOT_FOUND` | Check the corresponding ID against the EmailJS dashboard. |
| `RECIPIENT_INVALID` | Set the template's To Email field to `{{to_email}}`. |
| `GMAIL_AUTHORIZATION` | Reconnect Gmail in Email Services and grant permission to send email. |
| `QUOTA_EXCEEDED` / `RATE_LIMITED` | Check the monthly allowance, or wait before requesting another message. |
| `ORIGIN_REJECTED` / `CAPTCHA_REQUIRED` | Review the template and account security settings for backend API use. |
| `HTTP_ERROR` | Check EmailJS Email History for details; the response was unrecognized or unavailable. |

Keep API keys, email addresses, message bodies and authentication links out of
logs and public issue reports. Use the existing local `MAIL_MODE=preview` only
for development when you do not want an email delivered; it is unavailable in
production.
