export interface StillRunning {
  apiKeys: number;
  connectedApps: number;
}

const FAILED =
  "Something went wrong on our side. Try again, and if this link has stopped working, request a new one from the sign-in page.";

/**
 * The answer to POST /auth/reset-password. A failure always throws a sentence
 * for the person: a server error or a proxy's page isn't JSON, and a network
 * failure's own message means nothing to them.
 */
export async function readResetAnswer(request: Promise<Pick<Response, "json">>): Promise<{ stillRunning: StillRunning }> {
  const json = (await request.then((res) => res.json()).catch(() => null)) as {
    ok?: boolean;
    error?: string;
    message?: string;
    data?: { stillRunning?: StillRunning };
  } | null;
  if (!json?.ok) throw new Error(json?.message ?? json?.error ?? FAILED);
  return { stillRunning: json.data?.stillRunning ?? { apiKeys: 0, connectedApps: 0 } };
}
