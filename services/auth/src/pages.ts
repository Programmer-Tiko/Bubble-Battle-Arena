/** Minimal login and register pages. Messages are shown with textContent, never innerHTML. */
function page(title: string, action: "login" | "register", footer: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} - Bubble Battle Arena</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; display: grid; place-items: center; min-height: 100vh; margin: 0; }
  form { background: #1e293b; padding: 2rem; border-radius: 12px; display: grid; gap: 0.75rem; width: min(320px, 90vw); }
  input, button { padding: 0.6rem; border-radius: 6px; border: 0; font-size: 1rem; }
  button { background: #2563eb; color: white; cursor: pointer; }
  #message { min-height: 1.2em; color: #fca5a5; }
  a { color: #93c5fd; }
</style>
</head>
<body>
<form id="form">
  <h1>${title}</h1>
  <input name="username" placeholder="Username" autocomplete="username" required>
  <input name="password" type="password" placeholder="Password" autocomplete="${action === "login" ? "current-password" : "new-password"}" required>
  <button type="submit">${title}</button>
  <div id="message"></div>
  <div>${footer}</div>
</form>
<script>
  const form = document.getElementById("form");
  const message = document.getElementById("message");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const response = await fetch("/${action}", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: data.get("username"), password: data.get("password") }),
    });
    if (response.ok) {
      window.location.href = "${action === "login" ? "/" : "/login"}";
    } else {
      const body = await response.json().catch(() => ({}));
      message.textContent = body.error || "Something went wrong";
    }
  });
</script>
</body>
</html>`;
}

export const loginPage = page("Log in", "login", 'No account? <a href="/register">Register</a>');
export const registerPage = page("Register", "register", 'Have an account? <a href="/login">Log in</a>');