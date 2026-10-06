const SUPABASE_URL =
  "https://vrvhccnvrwvocoimjpkg.supabase.co";

const SUPABASE_KEY =
  "sb_publishable_YmDYvdVDX1eXOqBx-Iickw_bZc5zj_V";


const supabaseClient =
  window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
  );



/* =========================================
   GET EMAIL
========================================= */

const params =
  new URLSearchParams(
    window.location.search
  );


const email =
  params.get("email");

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


resendButton.addEventListener(
  "click",
  async () => {


    if (!email) {

      verifyMessage.textContent =
        "Return to sign up and enter your email again.";

      verifyMessage.className =
        "verify-message error";

      return;

    }


    resendButton.disabled =
      true;


    resendButton.textContent =
      "Sending...";


    try {
      const {
        error
      } =
        await supabaseClient
          .auth
          .resend({

            type:
              "signup",

            email:
              email,

            options: {

              emailRedirectTo:
                postAuthUrl

            }

          });

      if (error) {
        console.error(error);

        verifyMessage.textContent =
          "We couldn't resend the email. Try again shortly.";

        verifyMessage.className =
          "verify-message error";

        resendButton.disabled =
          false;

        resendButton.textContent =
          "Resend verification email";

        return;
      }

      verifyMessage.textContent =
        "Verification email sent ✓";

      verifyMessage.className =
        "verify-message success";

      resendButton.textContent =
        "Email sent ✓";

      setTimeout(
        () => {
          resendButton.disabled =
            false;

          resendButton.textContent =
            "Resend verification email";
        },
        5000
      );
    } catch (error) {
      console.error("Resend verification error:", error);
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