import { isHttpLoopbackUri } from "@soupnet/contracts/oauth-redirect";

/**
 * What the consent page says about who is asking and where the browser goes
 * next. F44: a dynamically registered client's name is self-reported, so an
 * attacker can register as any name. A client identified by a metadata document
 * is vouched for by the domain that published it.
 *
 * F129: on an http loopback redirect that vouching doesn't reach the receiver.
 * Anyone can send a public client's id with a local redirect, and the code can
 * reach another listener on this computer, or the person can be talked into
 * pasting the address of the next page, which holds it. So the page doesn't say
 * "Published by" there, and warns about both.
 */
export interface ConsentIdentityCopy {
  lead: string;
  detail: string;
  closing: string;
}

const NEXT_PAGE = "After you authorize (or cancel), your browser will be sent to:";

export function consentIdentityCopy(verifiedDomain: string | null, redirectUri: string): ConsentIdentityCopy {
  if (isHttpLoopbackUri(redirectUri)) {
    const closing = "Continue only if you just started this yourself. Never copy the address of the next page into anything, even if it shows an error or someone asks you to.";
    if (verifiedDomain) {
      return {
        lead: "This sign-in finishes in an app on this computer.",
        detail: `The name above comes from a document on ${verifiedDomain}, but Soup.net can't confirm which app will receive this sign-in. ${NEXT_PAGE}`,
        closing,
      };
    }
    return {
      lead: "Unverified app.",
      detail: `The name above is self-reported by the connector, not verified by Soup.net. This sign-in finishes in an app on this computer, and Soup.net can't confirm which one. ${NEXT_PAGE}`,
      closing,
    };
  }
  const closing = "Only continue if you started this connection yourself from that app.";
  if (verifiedDomain) {
    return {
      lead: `Published by ${verifiedDomain}.`,
      detail: `The name above comes from a document on ${verifiedDomain}. ${NEXT_PAGE}`,
      closing,
    };
  }
  return {
    lead: "Unverified app.",
    detail: `The name above is self-reported by the connector, not verified by Soup.net. ${NEXT_PAGE}`,
    closing,
  };
}
