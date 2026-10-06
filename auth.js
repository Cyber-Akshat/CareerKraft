/* =========================================
   SUPABASE
========================================= */

const SUPABASE_URL =
  "https://vrvhccnvrwvocoimjpkg.supabase.co";

const SUPABASE_KEY =
  "sb_publishable_YmDYvdVDX1eXOqBx-Iickw_bZc5zj_V";


const supabaseClient =
  window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
  );

const postAuthUrl =
  new URL("onboarding.html", window.location.href).href;

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

      const {
        data,
        error
      } =
        await supabaseClient
          .auth
          .signInWithOAuth({

            provider:
              "google",

            options: {
              redirectTo:
                postAuthUrl
            }
          });


      if (error) {

        console.error(
          "Google login error:",
          error
        );

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
      password.length < 8
    ) {

      showMessage(
        registerMessage,
        "Your password must contain at least 8 characters.",
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
        "Please accept the Terms and Privacy Policy.",
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
      "Creating account...";



    /* -----------------------------------------
       SUPABASE SIGN UP
    ----------------------------------------- */

    try {

      const {
  data,
  error
} =
  await supabaseClient
    .auth
    .signUp({

      email:
        email,

      password:
        password,

      options: {

        data: {

          display_name:
            name

        },

        emailRedirectTo:
          postAuthUrl

      }

    });


      if (error) {

        console.error(
          "Sign up error:",
          error
        );


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



      console.log(
        "Account created:",
        data
      );


      /*
        Supabase may require email
        verification.

        If there is already a session,
        the account can continue
        immediately.
      */


      if (data.session) {

        showMessage(
          registerMessage,
          "Account created successfully ✓",
          "success"
        );


        setTimeout(
          () => {

            window.location.href =
              postAuthUrl;

          },
          1200
        );

      }

      else {

        const verificationPage =
          new URL("verify-email.html", window.location.href);

        verificationPage.searchParams.set("email", email);
        window.location.href = verificationPage.href;

      }

    }

    catch (error) {

      console.error(
        "Registration error:",
        error
      );


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
        await supabaseClient
          .auth
          .signInWithPassword({

            email:
              email,

            password:
              password

          });


      if (error) {

        console.error(
          "Login error:",
          error
        );


        showMessage(
          loginMessage,
          "Incorrect email or password.",
          "error"
        );


        button.disabled =
          false;


        buttonText.textContent =
          originalText;


        return;

      }



      console.log(
        "Logged in:",
        data.user
      );


      showMessage(
        loginMessage,
        "Welcome back ✓",
        "success"
      );


      buttonText.textContent =
        "Welcome back ✓";


      setTimeout(
        () => {

          window.location.href =
            postAuthUrl;

        },
        900
      );

    }

    catch (error) {

      console.error(
        "Login error:",
        error
      );


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


forgotPassword.addEventListener(
  "click",
  async (event) => {

    event.preventDefault();


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


    try {

      const {
        error
      } =
        await supabaseClient
          .auth
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
        "Password reset email sent ✓",
        "success"
      );

    }

    catch (error) {

      console.error(
        error
      );


      showMessage(
        loginMessage,
        "Unable to send reset email.",
        "error"
      );

    }

  }
);



/* =========================================
   CHECK EXISTING SESSION
========================================= */

async function checkSession() {

  const {
    data
  } =
    await supabaseClient
      .auth
      .getSession();

  if (
    data.session
  ) {

    console.log(
      "Existing CareerKraft session:",
      data.session.user.email
    );

  }

}


checkSession();
showLogin();