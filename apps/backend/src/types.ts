import type { AuthUser } from "./auth";

/**
 * Hono environment type for our app.
 * Declares the variables set by middleware (e.g., requireAuth sets "user").
 */
export type AppEnv = {
  Variables: {
    user: AuthUser;
  };
};
