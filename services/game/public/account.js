// Account bar shown on every page served by the app: "Logged in as <name>" + Log out,
// or Log in / Register links. Text is set with textContent, never innerHTML.
(async () => {
  const bar = document.createElement("nav");
  bar.id = "account-bar";
  bar.style.cssText = "display:flex;gap:1rem;justify-content:flex-end;align-items:center;padding:0.5rem 1rem;font-family:system-ui,sans-serif";

  const link = (href, text) => {
    const a = document.createElement("a");
    a.href = href;
    a.textContent = text;
    return a;
  };

  const response = await fetch("/api/me", { credentials: "same-origin" }).catch(() => null);
  if (response && response.ok) {
    const me = await response.json();
    const name = document.createElement("span");
    name.id = "logged-in-user";
    name.textContent = `Logged in as ${me.username}`;
    const logout = document.createElement("button");
    logout.textContent = "Log out";
    logout.addEventListener("click", async () => {
      await fetch("/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      window.location.reload();
    });
    bar.append(name, logout);
  } else {
    bar.append(link("/login", "Log in"), link("/register", "Register"));
  }
  document.body.prepend(bar);
})();