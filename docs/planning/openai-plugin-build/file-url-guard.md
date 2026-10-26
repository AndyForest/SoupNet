# F37 follow-up: the `file_url` fetch through the address guard

Follow-up to stream O of the OpenAI plugin directory round (`oauth.md` in this folder). `check_recipe`'s `file_url` is the one tool input the server fetches from the open internet, and the directory review probes it. Until now its guard was a list of hostname patterns checked on the URL the agent sent, and the fetch followed redirects. F37 (security audit of 2026-06-11, companion repo) asked for every hop to be re-checked against resolved addresses and for a running byte cap. Stream O's `lib/guarded-fetch.ts` does that for JSON documents; this change gives it a variant for evidence files and routes `file_url` through it. Branch `plugin/file-url-guard`, agent `a-plugin-oauth-2026-10-26`, Soup.net intent `int_DxY7CUXz00XWoKyLaz0dgDL5`.

## Decisions

- **Redirects are followed, three at most, and every hop is guarded again.** Evidence links an agent pastes are often share links and CDN URLs that answer with a redirect first, so refusing redirects (as the OAuth document fetch does) would break the tool's ordinary use. Each hop's URL passes the same static checks, and its connection goes through the same public-address lookup. A redirect from https to http is refused. Recipe `78731e77`.
- **http and non-default ports stay accepted on public hosts.** The tool's contract says "http(s) only, private hostnames rejected", and narrowing it would be a silent change for agents with no security gain: the resolved address is the gate. Credentials in the URL are now refused; nothing legitimate sends them to a public evidence host.
- **The MIME type is resolved as before:** the response's `Content-Type` when it is on the allowlist, else the URL's extension. Sniffing the bytes was considered and left out: the base64 and `/uploads` paths do not sniff either, and the address guard, not the type, is what this finding is about.
- **The stdio MCP server's `fetch(file)` is out of scope.** It runs on the person's own machine, so it reaches nothing the person cannot reach already.

## Rubric

"Unit" means `lib/guarded-fetch.test.ts` with an injected transport and resolver; no network.

- **F1** A URL that is not http or https, that carries credentials, or whose host is a non-public IP literal or `localhost` is refused before any request is sent. The literal check covers every spelling the URL parser normalizes to an IPv4 or IPv6 address: decimal, octal, hex, shortened, and IPv4-mapped IPv6. Unit, `it.each`.
- **F2** A host name whose resolution includes any non-public address is refused at connection time, in the socket's own lookup (shared with the OAuth fetch, already unit-tested there). Unit: the request carries the guarded lookup, and a refused lookup reports "non-public address".
- **F3** A redirect to a non-public address, to a non-http(s) scheme, or from https to http is refused, and its target is never requested. Unit.
- **F4** Up to three redirects are followed to a public 200, relative `Location` values resolve against the current URL, and the fourth redirect is refused. Unit.
- **F5** A body over the cap is refused whether it is declared in `Content-Length` or arrives chunked without one, and it is never buffered past the cap. Unit.
- **F6** One deadline covers the whole chain of hops. Unit.
- **F7** A non-200 final status is refused with the status in the reason. Unit.
- **F8** The OAuth document fetch behaves exactly as before: its tests pass unchanged. Unit.
- **F9** `imageFromUrl` takes the bytes, the content type and the final URL from the guarded fetch, keeps the MIME and filename rules, and turns a refusal into a client-safe "Could not fetch" error. A private resolution and a failed connection read the same ("not reachable at a public address"), so the tool cannot map which internal names exist (recipe `72737049`'s uniform-error precedent). Live (`mcp.test.ts`, four private spellings through `check_recipe`, each a file input error and no deposit) plus typecheck.

## Build notes

- Unit suites: `guarded-fetch.test.ts` 99 of 99 (57 before, all unchanged), `oauth-cimd.service.test.ts` and the tools/list size test pass; typecheck and lint clean. The live rows run in GitHub CI, the gate for this branch; no local stack was started (planning session, 2026-10-26).
- The shared fetch core was refactored so the OAuth document fetch and the file fetch make each request through one function (`getOnce`); the OAuth fetch keeps its no-redirect, https-only, JSON-only rules, and its tests are unchanged.
- A trailing dot on `localhost.` is now refused by the static check in both fetchers; before, the lookup guard refused it at connection time.
- `.internal` and `.local` names are no longer refused by name: they reach the lookup, which refuses them when they resolve to a private address, as they do inside a VPC.
