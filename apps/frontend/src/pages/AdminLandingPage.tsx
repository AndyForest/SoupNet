import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { authFetch } from "../auth.js";
import { Icon } from "../components/Icon.js";

export function AdminLandingPage() {
  const meQuery = useQuery({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      const res = await authFetch("/auth/me");
      const json = (await res.json()) as { ok: boolean; data?: { user: { id: string; email: string; role: string } } };
      if (!json.ok || !json.data) throw new Error("Failed");
      return json.data.user;
    },
  });

  if (meQuery.isLoading) {
    return <div style={{ padding: "var(--space-lg)" }}>Loading...</div>;
  }

  if (meQuery.data?.role !== "system") {
    return (
      <div style={{ padding: "var(--space-lg)", maxWidth: 600 }}>
        <h1>Admin</h1>
        <p style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-md)" }}>
          You don't have access to this page. System admin role required.
        </p>
      </div>
    );
  }

  const sections = [
    {
      title: "User Management",
      description: "List, search, verify, reset, suspend, and invite users. Trusted-tier oversight.",
      href: "/admin/users",
      icon: "users" as const,
    },
    {
      title: "Job Queues",
      description: "Generic pg-boss queue dashboard. Job state, backlog age, cron schedules — independent of what the workers do.",
      href: "/admin/queues",
      icon: "clock" as const,
    },
    {
      title: "Embedding Pipeline",
      description: "Strategy coverage, vector status, stuck processing recovery, failed vector retry. Domain-specific worker dashboard.",
      href: "/admin/workers/embeddings",
      icon: "settings" as const,
    },
  ];

  return (
    <div style={{ padding: "var(--space-lg)", maxWidth: 800 }}>
      <h1>System Admin</h1>
      <p style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-xs)", marginBottom: "var(--space-lg)" }}>
        Operational tools for monitoring and managing the deployed system.
      </p>

      <div style={{ display: "grid", gap: "var(--space-md)" }}>
        {sections.map((section) => (
          <Link
            key={section.href}
            to={section.href}
            style={{
              textDecoration: "none",
              color: "inherit",
              display: "block",
              padding: "var(--space-lg)",
              background: "var(--color-surface-container-low)",
              borderRadius: "var(--radius-lg)",
              border: "1px solid var(--color-outline-variant)",
              transition: "background 0.15s",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)" }}>
              <Icon name={section.icon} size={24} />
              <div>
                <h2 style={{ margin: 0, fontSize: "1.1rem" }}>{section.title}</h2>
                <p style={{ margin: "var(--space-xs) 0 0 0", color: "var(--color-on-surface-variant)", fontSize: "0.9rem" }}>
                  {section.description}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
