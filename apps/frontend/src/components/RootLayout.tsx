import { Outlet, useNavigate } from "@tanstack/react-router";
import { clearToken, isLoggedIn } from "../auth.js";

export function RootLayout() {
  const navigate = useNavigate();
  const loggedIn = isLoggedIn();

  function handleLogout() {
    clearToken();
    void navigate({ to: "/auth/login" });
  }

  return (
    <div>
      <header
        style={{
          borderBottom: "1px solid var(--border)",
          background: "var(--card-bg)",
        }}
      >
        <div
          className="container"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <a
            href="/"
            style={{
              fontWeight: 700,
              fontSize: "1.1rem",
              color: "var(--text)",
            }}
          >
            ClaimNet
          </a>
          {loggedIn && (
            <button
              className="secondary"
              onClick={handleLogout}
              style={{ fontSize: "0.85rem", padding: "0.35rem 0.8rem" }}
            >
              Logout
            </button>
          )}
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
