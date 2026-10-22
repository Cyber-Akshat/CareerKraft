const authClient = window.careerAuth;



/* =========================================
   GET EMAIL
========================================= */

const params =
  new URLSearchParams(
    window.location.search
  );


let email =
  params.get("email");

const resendAddressGroup = document.querySelector("#resend-email-address");
const resendAddress = document.querySelector("#resend-address");
if (!email) resendAddressGroup.hidden = false;

const postAuthUrl =
  new URL("onboarding.html", window.location.href).href;


const emailElement =
  document.querySelector(
    "#verification-email"
  );


if (email) {

  emailElement.textContent =
    email;

} else {

  emailElement.textContent =
    "your email address";

}



/* =========================================
   RESEND EMAIL
========================================= */

const resendButton =
  document.querySelector(
    "#resend-email"
  );


const verifyMessage =
  document.querySelector(
    "#verify-message"
  );

let verificationComplete = false;
const callbackParams = new URLSearchParams(window.location.hash.slice(1));
const callbackError = params.get("error_description") ||
  callbackParams.get("error_description") || params.get("error") ||
  callbackParams.get("error");
const verificationToken = params.get("token");
if (verificationToken || callbackError) window.history.replaceState(null, "", window.location.pathname);

async function checkVerification() {
  if (verificationComplete || callbackError) return;

  try {
    // The server validates the session before showing success.
    const { data, error } = await authClient.getUser();
    const user = data?.user;
    if (error || !user?.email_confirmed_at) return;
    if (email && user.email?.toLowerCase() !== email.toLowerCase()) return;
    if (verificationComplete) return;

    verificationComplete = true;
    document.title = "Email verified | CareerKraft";
    document.querySelector(".verify-eyebrow").textContent = "EMAIL VERIFIED";
    document.querySelector(".verify-status h1").textContent = "Email verified";
    const descriptions = document.querySelectorAll(".verify-status .verify-description");
    descriptions[0].textContent = "Your email address has been confirmed:";
    descriptions[1].textContent = "Taking you to onboarding to build your profile.";
    emailElement.textContent = user.email;
    const steps = document.querySelectorAll(".verification-step");
    steps[1].classList.remove("current");
    steps[1].classList.add("active");
    steps[1].querySelector("strong").textContent = "Email verified";
    steps[1].querySelector("p").textContent = "Your email address is confirmed.";
    document.querySelectorAll(".step-connector")[1].classList.add("active");
    steps[2].classList.add("current");
    resendButton.hidden = true;
    resendAddressGroup.hidden = true;
    const continueLink = document.querySelector(".verify-secondary-button");
    continueLink.href = postAuthUrl;
    continueLink.textContent = "Continue to onboarding";
    document.querySelector(".verify-help").hidden = true;
    verifyMessage.textContent = "Email verified. Redirecting to onboarding...";
    verifyMessage.className = "verify-message success";
    window.history.replaceState(null, "", window.location.pathname);
    window.setTimeout(() => window.location.replace(postAuthUrl), 1500);
  } catch {
    verifyMessage.textContent = "Unable to check verification. Please try again.";
    verifyMessage.className = "verify-message error";
  }
}

if (callbackError) {
  verifyMessage.textContent = "This verification link is invalid or has expired. Request a new email, or return to sign in to resend it.";
  verifyMessage.className = "verify-message error";
} else {
  if (verificationToken) {
    verifyMessage.textContent = "Checking your verification link…";
    verifyMessage.className = "verify-message";
    authClient.request('verify', { token: verificationToken }).then(({ error }) => {
      if (error) {
        verifyMessage.textContent = error.message;
        verifyMessage.className = 'verify-message error';
      } else checkVerification();
    }).catch(() => {
      verifyMessage.textContent = "Unable to complete this request. Please try again.";
      verifyMessage.className = "verify-message error";
    });
  } else checkVerification();
  window.addEventListener("focus", checkVerification);
}


resendButton.addEventListener(
  "click",
  async () => {

    if (resendButton.disabled || verificationComplete) return;
    const address = (resendAddressGroup.hidden ? email : resendAddress.value).trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {

      verifyMessage.textContent =
        "Enter the email address you registered with.";

      verifyMessage.className =
        "verify-message error";

      return;

    }

    email = address;
    emailElement.textContent = email;


    resendButton.disabled =
      true;
    resendButton.setAttribute("aria-busy", "true");


    resendButton.textContent =
      "Sending...";


    try {
      const {
        data,
        error
      } =
        await authClient
          .resend({

            type:
              "signup",

            email:
              email

          });
      resendButton.removeAttribute("aria-busy");

      if (error) {
        verifyMessage.textContent =
          error.message || "We couldn't resend the email. Try again shortly.";

        verifyMessage.className =
          "verify-message error";

        resendButton.disabled =
          false;

        resendButton.textContent =
          "Resend verification email";

        return;
      }

      verifyMessage.textContent =
        data?.message || "If this address is eligible, an email with the next steps will arrive shortly.";

      verifyMessage.className =
        "verify-message success";

      resendButton.textContent =
        "Request received ✓";

      setTimeout(
        () => {
          resendButton.disabled =
            false;

          resendButton.textContent =
            "Resend verification email";
        },
        5000
      );
    } catch {
      resendButton.removeAttribute("aria-busy");
      verifyMessage.textContent =
        "We couldn't resend the email. Try again shortly.";
      verifyMessage.className =
        "verify-message error";
      resendButton.disabled =
        false;
      resendButton.textContent =
        "Resend verification email";
    }

  }
);



/* =========================================
   ENTRY ANIMATIONS
========================================= */

window.addEventListener(
  "load",
  () => {

    document.body.classList.add(
      "verification-loaded"
    );

  }
);
