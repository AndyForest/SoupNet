import {
  createRootRoute,
  createRoute,
  redirect,
} from "@tanstack/react-router";
import type { createRouter } from "@tanstack/react-router";
import { AppShell } from "./components/AppShell.js";
import { LoginPage } from "./pages/LoginPage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { CheckRecipePage } from "./pages/CheckRecipePage.js";
import { TraceDetailPage } from "./pages/TraceDetailPage.js";
import { ApiKeysPage } from "./pages/ApiKeysPage.js";
import { GroupsPage } from "./pages/GroupsPage.js";
import { GroupTracesPage } from "./pages/GroupTracesPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { RecipeMapPage } from "./pages/RecipeMapPage.js";
import { CheckLogPage } from "./pages/CheckLogPage.js";
import { VerifyPage } from "./pages/VerifyPage.js";
import { VerifyPendingPage } from "./pages/VerifyPendingPage.js";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage.js";
import { ResetPasswordPage } from "./pages/ResetPasswordPage.js";
import { TermsPage } from "./pages/TermsPage.js";
import { PrivacyPage } from "./pages/PrivacyPage.js";
import { LandingPage } from "./pages/LandingPage.js";
import { HowItWorksPage } from "./pages/HowItWorksPage.js";
import { AdminLandingPage } from "./pages/AdminLandingPage.js";
import { AdminQueuesPage } from "./pages/AdminQueuesPage.js";
import { AdminEmbeddingsPage } from "./pages/AdminEmbeddingsPage.js";
import { AdminUsersPage } from "./pages/AdminUsersPage.js";
import { isLoggedIn, getEmailVerified } from "./auth.js";

const rootRoute = createRootRoute({
  component: AppShell,
});

/**
 * Route guard for any authenticated route. Two checks:
 *   1. Logged in at all → otherwise bounce to /auth/login
 *   2. Email verified → otherwise bounce to /auth/verify-pending
 *
 * The cached emailVerified flag is set at login and refreshed by
 * VerifyPendingPage's polling /auth/me, so this check is sync.
 * Only `null` (unknown) and `false` (explicitly unverified) trigger
 * the redirect — `true` lets the route load.
 */
function requireAuth() {
  if (!isLoggedIn()) {
    throw redirect({ to: "/auth/login" });
  }
  if (getEmailVerified() !== true) {
    throw redirect({ to: "/auth/verify-pending" });
  }
}

/**
 * Route guard for /auth/verify-pending: must be logged in (so we know who
 * to verify) but must NOT be already verified (in which case we bounce them
 * to the dashboard so they don't get stuck on a meaningless page).
 */
function requireUnverified() {
  if (!isLoggedIn()) {
    throw redirect({ to: "/auth/login" });
  }
  if (getEmailVerified() === true) {
    throw redirect({ to: "/app/dashboard" });
  }
}

// ── Root index (landing) ────────────────────────────────────────────────────

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: LandingPage,
});

// ── Public info pages: /info/* ─────────────────────────────────────────────

const infoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/info",
});

const howItWorksRoute = createRoute({
  getParentRoute: () => infoRoute,
  path: "how-it-works",
  component: HowItWorksPage,
});

const privacyRoute = createRoute({
  getParentRoute: () => infoRoute,
  path: "privacy",
  component: PrivacyPage,
});

const termsRoute = createRoute({
  getParentRoute: () => infoRoute,
  path: "terms",
  component: TermsPage,
});

// ── Public auth flows: /auth/* ─────────────────────────────────────────────

const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth",
});

const loginRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "login",
  component: LoginPage,
});

const registerRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "register",
  component: LoginPage,
});

const verifyRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "verify",
  component: VerifyPage,
});

const verifyPendingRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "verify-pending",
  beforeLoad: requireUnverified,
  component: VerifyPendingPage,
});

const forgotPasswordRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "forgot-password",
  component: ForgotPasswordPage,
});

const resetPasswordRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "reset-password",
  component: ResetPasswordPage,
});

// ── Authenticated user app: /app/* ─────────────────────────────────────────

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app",
  beforeLoad: requireAuth,
});

const dashboardRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "dashboard",
  component: DashboardPage,
});

const checkRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "check",
  component: CheckRecipePage,
});

const traceDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "traces/$traceId",
  component: TraceDetailPage,
});

const keysRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "keys",
  component: ApiKeysPage,
});

const groupsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "groups",
  component: GroupsPage,
});

const groupTracesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "groups/$groupId/traces",
  component: GroupTracesPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "settings",
  component: SettingsPage,
});

const mapRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "map",
  component: RecipeMapPage,
});

const checksRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "checks",
  component: CheckLogPage,
});

// ── System admin: /admin/* (each route still individually auth-gated until
// migrated to the parent-route inheritance pattern). ────────────────────────

const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin",
  beforeLoad: requireAuth,
  component: AdminLandingPage,
});

const adminQueuesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/queues",
  beforeLoad: requireAuth,
  component: AdminQueuesPage,
});

const adminEmbeddingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/workers/embeddings",
  beforeLoad: requireAuth,
  component: AdminEmbeddingsPage,
});

const adminUsersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/users",
  beforeLoad: requireAuth,
  component: AdminUsersPage,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  infoRoute.addChildren([
    howItWorksRoute,
    privacyRoute,
    termsRoute,
  ]),
  authRoute.addChildren([
    loginRoute,
    registerRoute,
    verifyRoute,
    verifyPendingRoute,
    forgotPasswordRoute,
    resetPasswordRoute,
  ]),
  appRoute.addChildren([
    dashboardRoute,
    checkRoute,
    traceDetailRoute,
    keysRoute,
    groupsRoute,
    groupTracesRoute,
    settingsRoute,
    mapRoute,
    checksRoute,
  ]),
  adminRoute,
  adminQueuesRoute,
  adminEmbeddingsRoute,
  adminUsersRoute,
]);

export type Router = ReturnType<typeof createRouter<typeof routeTree>>;
