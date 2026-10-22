const resetToken = new URLSearchParams(window.location.search).get("token");
window.history.replaceState(null, "", window.location.pathname);
const resetForm = document.querySelector("#reset-form");
const resetMessage = document.querySelector("#reset-message");
if (!resetToken) {
  resetForm.hidden = true;
  resetMessage.textContent = "Open the password reset link from your email.";
}
resetForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!resetToken || resetForm.getAttribute("aria-busy") === "true") return;
  const password = document.querySelector("#new-password").value;
  if (password.length < 15 || password.length > 128) {
    resetMessage.textContent = "Use a password with 15–128 characters.";
    resetMessage.className = "verify-message error";
    return;
  }
  if (password !== document.querySelector("#repeat-password").value) {
    resetMessage.textContent = "Your passwords do not match.";
    resetMessage.className = "verify-message error";
    return;
  }
  const button = resetForm.querySelector("button");
  button.disabled = true;
  resetForm.setAttribute("aria-busy", "true");
  try {
    const { error } = await window.careerAuth.request("reset-password", { token: resetToken, password });
    resetMessage.textContent = error ? error.message : "Password updated. You can now sign in.";
    resetMessage.className = `verify-message ${error ? "error" : "success"}`;
    if (!error) { resetForm.reset(); resetForm.hidden = true; }
  } catch {
    resetMessage.textContent = "Unable to complete this request. Please try again.";
    resetMessage.className = "verify-message error";
  } finally {
    button.disabled = false;
    resetForm.removeAttribute("aria-busy");
  }
});
