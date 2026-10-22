const authClient = window.careerAuth;

let postAuthUrl =
  new URL("onboarding.html", window.location.href).href;

async function resolvePostAuthUrl() {
  const settingsUrl = authClient.settingsReturnUrl?.();
  if (settingsUrl) return settingsUrl.href;
  const { data, error } = await authClient.request("assessment");
  if (error) throw new Error(error.message || "We couldn't load your saved career.");
  return new URL(data?.selectedCareer ? "dashboard.html" : "onboarding.html", window.location.href).href;
}

function openVerification(email) {
  const page = new URL("verify-email.html", window.location.href);
  page.searchParams.set("email", email);
  window.location.assign(page.href);
}

/* =========================================
   GOOGLE LOGIN
========================================= */

const googleLoginButton =
  document.querySelector("#google-login");


if (googleLoginButton) {

  googleLoginButton.addEventListener(
    "click",
    async () => {

      const originalText =
        googleLoginButton.innerHTML;


      googleLoginButton.disabled =
        true;


      googleLoginButton.innerHTML = `
        <span class="google-icon">G</span>
        <span>Connecting...</span>
      `;

      try {
        const { error } = await authClient.signInWithOAuth();
        if (error) throw new Error(error.message || "Google sign-in failed.");
      } catch {

        googleLoginButton.disabled =
          false;


        googleLoginButton.innerHTML =
          originalText;


        loginMessage.textContent =
          "Google sign in failed. Please try again.";


        loginMessage.className =
          "auth-message error";

      }

    }
  );

}


/* =========================================
   ELEMENTS
========================================= */

const registerTab =
  document.querySelector("#register-tab");

const loginTab =
  document.querySelector("#login-tab");

const tabSlider =
  document.querySelector("#auth-tab-slider");


const registerForm =
  document.querySelector("#register-form");

const loginForm =
  document.querySelector("#login-form");


const authTitle =
  document.querySelector("#auth-title");

const authSubtitle =
  document.querySelector("#auth-subtitle");


const switchText =
  document.querySelector("#auth-switch-text");

const switchButton =
  document.querySelector("#auth-switch-button");


const registerMessage =
  document.querySelector("#register-message");

const loginMessage =
  document.querySelector("#login-message");



/* =========================================
   AUTH MODE
========================================= */

let currentMode = "login";


function showRegister() {

  currentMode = "register";
  document.title = "Create an account | CareerKraft";


  registerForm.classList.remove("hidden");

  loginForm.classList.add("hidden");


  registerTab.classList.add("active");

  loginTab.classList.remove("active");


  tabSlider.classList.add("register");


  authTitle.textContent =
    "Create your account";


  authSubtitle.textContent =
    "Start building your personalised career journey.";


  switchText.innerHTML = `
    Already have an account?
    <button
      type="button"
      id="auth-switch-button"
    >
      Log in
    </button>
  `;


  document
    .querySelector("#auth-switch-button")
    .addEventListener(
      "click",
      showLogin
    );


  clearMessages();

}



function showLogin() {

  currentMode = "login";
  document.title = "Sign in | CareerKraft";


  registerForm.classList.add("hidden");

  loginForm.classList.remove("hidden");


  registerTab.classList.remove("active");

  loginTab.classList.add("active");


  tabSlider.classList.remove("register");


  authTitle.textContent =
    "Welcome back";


  authSubtitle.textContent =
    "Continue building your CareerKraft journey.";


  switchText.innerHTML = `
    New to CareerKraft?
    <button
      type="button"
      id="auth-switch-button"
    >
      Create an account
    </button>
  `;


  document
    .querySelector("#auth-switch-button")
    .addEventListener(
      "click",
      showRegister
    );


  clearMessages();

}



/* =========================================
   TAB EVENTS
========================================= */

registerTab.addEventListener(
  "click",
  showRegister
);


loginTab.addEventListener(
  "click",
  showLogin
);


/* =========================================
   CLEAR MESSAGES
========================================= */

function clearMessages() {

  registerMessage.textContent = "";

  registerMessage.className =
    "auth-message";


  loginMessage.textContent = "";

  loginMessage.className =
    "auth-message";

}



/* =========================================
   SHOW MESSAGE
========================================= */

function showMessage(
  element,
  message,
  type
) {

  element.textContent =
    message;


  element.className =
    `auth-message ${type}`;

}



/* =========================================
   PASSWORD SHOW / HIDE
========================================= */

const passwordButtons =
  document.querySelectorAll(
    ".password-toggle"
  );


passwordButtons.forEach(
  (button) => {

    button.addEventListener(
      "click",
      () => {

        const inputID =
          button.dataset.target;


        const input =
          document.querySelector(
            `#${inputID}`
          );


        if (
          input.type === "password"
        ) {

          input.type =
            "text";

          button.textContent =
            "Hide";

          button.setAttribute(
            "aria-label",
            "Hide password"
          );

        }

        else {

          input.type =
            "password";

          button.textContent =
            "Show";

          button.setAttribute(
            "aria-label",
            "Show password"
          );

        }

      }
    );

  }
);



/* =========================================
   REGISTER
========================================= */

registerForm.addEventListener(
  "submit",
  async (event) => {

    event.preventDefault();


    clearMessages();


    const name =
      document
        .querySelector("#register-name")
        .value
        .trim();


    const email =
      document
        .querySelector("#register-email")
        .value
        .trim()
        .toLowerCase();


    const password =
      document
        .querySelector("#register-password")
        .value;


    const confirmPassword =
      document
        .querySelector("#confirm-password")
        .value;


    const termsAccepted =
      document
        .querySelector("#register-terms")
        .checked;


    const button =
      document
        .querySelector("#register-button");


    /* -----------------------------------------
       VALIDATION
    ----------------------------------------- */

    if (!name) {

      showMessage(
        registerMessage,
        "Please enter your name.",
        "error"
      );

      return;

    }


    if (!email) {

      showMessage(
        registerMessage,
        "Please enter your email address.",
        "error"
      );

      return;

    }


    if (
      password.length < 15 || password.length > 128
    ) {

      showMessage(
        registerMessage,
        "Use a password with 15–128 characters.",
        "error"
      );

      return;

    }


    if (
      password !==
      confirmPassword
    ) {

      showMessage(
        registerMessage,
        "Your passwords do not match.",
        "error"
      );

      return;

    }


    if (!termsAccepted) {

      showMessage(
        registerMessage,
        "Please agree to the CareerKraft Terms of Use and confirm that you are at least 15 years old.",
        "error"
      );

      return;

    }



    /* -----------------------------------------
       LOADING
    ----------------------------------------- */

    button.disabled =
      true;


    const originalText =
      button
        .querySelector("span")
        .textContent;


    button
      .querySelector("span")
      .textContent =
      "Sending request...";



    /* -----------------------------------------
       CAREERKRAFT SIGN UP
    ----------------------------------------- */

    try {

      const {
  data,
  error
} =
  await authClient
    .signUp({

      email:
        email,

      password:
        password,

      options: {

        data: {

          display_name:
            name

        }

      }

    });


      if (error) {

        showMessage(
          registerMessage,
          error.message,
          "error"
        );


        button.disabled =
          false;


        button
          .querySelector("span")
          .textContent =
          originalText;


        return;

      }



      showMessage(registerMessage, data.message || "If this address can be used, an email with the next steps will arrive shortly.", "success");
      openVerification(email);

    }

    catch (error) {

      showMessage(
        registerMessage,
        "Something went wrong. Please try again.",
        "error"
      );


      button.disabled =
        false;


      button
        .querySelector("span")
        .textContent =
        originalText;

    }

  }
);



/* =========================================
   LOGIN
========================================= */

loginForm.addEventListener(
  "submit",
  async (event) => {

    event.preventDefault();


    clearMessages();


    const email =
      document
        .querySelector("#login-email")
        .value
        .trim()
        .toLowerCase();


    const password =
      document
        .querySelector("#login-password")
        .value;


    const button =
      document
        .querySelector("#login-button");


    if (
      !email ||
      !password
    ) {

      showMessage(
        loginMessage,
        "Enter your email and password.",
        "error"
      );

      return;

    }



    button.disabled =
      true;


    const buttonText =
      button
        .querySelector("span");


    const originalText =
      buttonText.textContent;


    buttonText.textContent =
      "Signing in...";



    try {

      const {
        data,
        error
      } =
        await authClient
          .signInWithPassword({

            email:
              email,

            password:
              password

          });


      if (error) {

        showMessage(
          loginMessage,
          error.message,
          "error"
        );


        button.disabled =
          false;


        buttonText.textContent =
          originalText;


        return;

      }



      showMessage(
        loginMessage,
        "Welcome back ✓",
        "success"
      );


      buttonText.textContent =
        "Welcome back ✓";


      postAuthUrl = await resolvePostAuthUrl();

      setTimeout(
        () => {

          window.location.href =
            postAuthUrl;

        },
        900
      );

    }

    catch (error) {

      showMessage(
        loginMessage,
        "Something went wrong. Please try again.",
        "error"
      );


      button.disabled =
        false;


      buttonText.textContent =
        originalText;

    }

  }
);



/* =========================================
   FORGOT PASSWORD
========================================= */

const forgotPassword =
  document.querySelector(
    "#forgot-password"
  );

let passwordResetRequestPending = false;


forgotPassword.addEventListener(
  "click",
  async (event) => {

    event.preventDefault();

    if (passwordResetRequestPending) return;


    const email =
      document
        .querySelector("#login-email")
        .value
        .trim()
        .toLowerCase();


    if (!email) {

      showMessage(
        loginMessage,
        "Enter your email address first.",
        "error"
      );

      return;

    }


    passwordResetRequestPending = true;
    forgotPassword.setAttribute("aria-disabled", "true");
    forgotPassword.setAttribute("aria-busy", "true");

    try {

      const {
        data,
        error
      } =
        await authClient
          .resetPasswordForEmail(
            email
          );


      if (error) {

        showMessage(
          loginMessage,
          error.message,
          "error"
        );

        return;

      }


      showMessage(
        loginMessage,
        data?.message || "If this address is eligible, an email with the next steps will arrive shortly.",
        "success"
      );

    }

    catch (error) {

      showMessage(
        loginMessage,
        "Unable to complete this request. Please try again.",
        "error"
      );

    } finally {
      passwordResetRequestPending = false;
      forgotPassword.removeAttribute("aria-disabled");
      forgotPassword.removeAttribute("aria-busy");
    }

  }
);



/* =========================================
   CHECK EXISTING SESSION
========================================= */

async function checkSession() {
  try {
    const { data, error } = await authClient.getSession();
    if (!error && data?.session) window.location.replace(await resolvePostAuthUrl());
  } catch (error) {
    showMessage(loginMessage, error.message || "We couldn't load your account. Please try again.", "error");
  }
}

checkSession();
if (["register", "signup"].includes(new URLSearchParams(window.location.search).get("mode"))) showRegister();
else showLogin();

const authError = new URLSearchParams(window.location.search).get("error");
const authErrors = {
  google_unconfigured: "Google sign-in needs server configuration.",
  google_failed: "Google sign-in failed. Please try again.",
  google_existing_account: "Google sign-in failed. Please try again."
};
if (authErrors[authError]) showMessage(loginMessage, authErrors[authError], "error");
if (new URLSearchParams(window.location.search).get("account") === "deleted") {
  showMessage(loginMessage, "Your account and saved CareerKraft data have been deleted.", "success");
}
