# Security Model

> In this harness, agent security lives in the **runtime**, not in the prompt. A prompt
> rule ("don't fetch internal URLs", "ignore injected instructions") is a request the
> model may or may not honor; a runtime boundary is enforced in code regardless of what
> the model intends. There are three such boundaries here: an **SSRF guard** on
> outbound requests, an **untrusted-content boundary** around external data, and
> **injection scanning at the points where content becomes persistent**. Each is
> identity-independent — a single-user local harness needs them as much as a
> multi-tenant one.

Grounded in:
- [`../src/lib/net/ssrf.ts`](../src/lib/net/ssrf.ts) — SSRF validation, DNS pinning ([`fetch-guard.ts`](../src/lib/net/fetch-guard.ts) for redirect handling, [`ip-utils.ts`](../src/lib/net/ip-utils.ts) for private ranges)
- [`../src/security/external-content.ts`](../src/security/external-content.ts) — the untrusted-content boundary
- [`../src/security/content-scan.ts`](../src/security/content-scan.ts) — injection scanning at write points
- [`../src/tools/web-fetch.tool.ts`](../src/tools/web-fetch.tool.ts) — both boundaries applied in one tool

Related chapters: [10 — Engineering Discipline](10-engineering-discipline.md) · [11 — Mechanism Over Form](11-mechanism-over-form.md) · [08 — Memory Lifecycle](08-memory-lifecycle.md)

---

## Why these stay on, even single-user

SSRF and injection defenses can read as "enterprise" concerns, but the threat doesn't
need more than one user. If a local agent can `web_fetch` a URL an attacker influenced —
a link in a page it summarized, a redirect, a poisoned memory — then it can be pointed
at the LAN, a router admin panel, or a cloud metadata endpoint, and it can be fed
instructions disguised as content. There is exactly one user to attack: the operator.
These boundaries are runtime-enforced and identity-independent because the threat does
not depend on how many users there are.

---

## 1. SSRF guard (outbound request safety)

[`ssrf.ts`](../src/lib/net/ssrf.ts) validates a URL *before* any request is made, and
again on every redirect hop. Five layers:

### Allowed schemes

Only `http:` and `https:` pass. Anything else (`file:`, `ftp:`, `gopher:`, etc.) throws
`SsrfBlockedError("invalid_protocol")`:

```ts
if (protocol !== "http:" && protocol !== "https:") {
  throw new SsrfBlockedError("Only HTTP and HTTPS protocols are allowed", "invalid_protocol");
}
```

### Blocked hosts (including cloud-metadata)

`BLOCKED_HOSTNAMES` blocks `localhost`, `localhost.localdomain`, `metadata`,
`metadata.google.internal`, and the link-local metadata IP `169.254.169.254`.
`BLOCKED_HOSTNAME_SUFFIXES` blocks `.localhost`, `.local`, `.internal`, `.localdomain`.
On top of that, `ip-utils.ts` (`isPrivateIpAddress`) rejects the full set of private /
loopback / link-local / reserved ranges — `10/8`, `172.16/12`, `192.168/16`, `127/8`,
`169.254/16` (link-local), `100.64/10` (CGNAT), `0/8`, multicast, reserved — for both
IPv4 and IPv6 (`::1`, `fe80::`, `fc00::/fd00::`, `::ffff:` mapped, etc.). The
`169.254.169.254` metadata address is blocked both by hostname and by being inside the
link-local range, so it cannot be reached even by raw IP.

### DNS pinning (rebinding defense)

A hostname that passes the name check could still *resolve* to a private address — the
classic DNS-rebinding attack. `resolvePinnedHostnameWithPolicy` resolves the hostname
with `dns.lookup(..., { all: true })` and rejects if **any** resolved address is private:

```ts
const results = await dnsLookup(normalized, { all: true });
if (!skipPrivateNetworkChecks) {
  assertAllowedResolvedAddressesOrThrow(results); // throws if any address is private
}
return { hostname: normalized, addresses };       // the pinned set
```

It returns the *pinned* address set, so the request targets what was actually validated,
not a value that could change between check and connect.

### Redirect re-validation

A safe URL can 302 to an unsafe one. [`fetch-guard.ts → fetchWithSsrfGuard`](../src/lib/net/fetch-guard.ts)
uses `redirect: "manual"` and re-runs `resolvePinnedHostnameWithPolicy` on **every**
hop, bounds redirects (`DEFAULT_MAX_REDIRECTS = 3`), and detects redirect loops. The
validation is not a one-time gate at the front door; it is applied to each URL the
chain actually visits.

### Cross-origin credential stripping

On a redirect that crosses origins, sensitive headers — `authorization`,
`proxy-authorization`, `cookie`, `cookie2` — are stripped
(`stripSensitiveHeadersForCrossOriginRedirect`), so credentials meant for origin A are
never leaked to origin B.

> Adjusting policy: `SsrfPolicy` allows an explicit `hostnameAllowlist` /
> `allowedHostnames` and an `allowPrivateNetwork` escape hatch — used deliberately
> (e.g. to reach a local Ollama endpoint), never as a default. The cloud-metadata
> blocks stay on even on a local machine: they cost nothing and protect against the day
> this runs somewhere with a metadata service.

---

## 2. The untrusted-content boundary

Anything fetched, searched, or read from outside the system is **untrusted input that
may contain instructions**. [`external-content.ts → wrapExternalContent`](../src/security/external-content.ts)
wraps it so the model treats it as data, not commands:

- **Explicit boundary markers.** Content is fenced between
  `<<<EXTERNAL_UNTRUSTED_CONTENT>>>` and `<<<END_EXTERNAL_UNTRUSTED_CONTENT>>>`, with a
  `Source:` label and (for `web_fetch`) a safety warning that tells the model not to
  treat anything inside as instructions.

- **Marker sanitization.** Malicious content could try to *close* the boundary early by
  embedding the markers itself. `sanitizeMarkers` replaces any literal or
  marker-shaped sequence (`<<<EXTERNAL…>>>`, `<<<END…>>>`) with `[[MARKER_SANITIZED]]`,
  so injected content cannot break out of its fence.

- **Fullwidth-Unicode de-obfuscation.** An attacker could write the markers with
  fullwidth look-alikes (`＜`, `Ａ-Ｚ`) to dodge the literal match. The sanitizer folds
  fullwidth ranges back to ASCII before matching, closing that bypass.

- **Suspicious-pattern detection (logged, not blocked).** `detectSuspiciousPatterns`
  flags classic injection shapes — "ignore previous instructions", "you are now a…",
  format tokens like `[INST]` / `<|im_start|>`. These are **logged**, not blocked,
  because the boundary + warning is the real defense; the detection is observability,
  and over-blocking legitimate content would be worse than logging.

The web-fetch tool ([`web-fetch.tool.ts`](../src/tools/web-fetch.tool.ts)) applies both
boundaries together: validate for SSRF, then wrap the body as untrusted content — two
runtime boundaries, neither dependent on the model's cooperation.

---

## 3. Injection scanning at persistence points

A one-shot injection in a single turn is bad. A **persistent** injection — poisoned
content written into long-term memory or a user skill — is worse, because that content
is pulled back into the system prompt automatically on every future session. So the
harness scans at the **write point**, where content becomes durable
([`content-scan.ts → scanMemoryWrite`](../src/security/content-scan.ts)):

```ts
export function scanMemoryWrite(content: string): ContentScanResult {
  // BLOCK_PATTERNS: instruction overrides (en + zh), system-prompt manipulation,
  // role reassignment, format tokens, and forgery of our own fence tags.
  // Returns { blocked, matches }. A match means the caller must reject the write.
}
```

The block set is high-precision *by design* — it targets instruction overrides (English
and Chinese), system-prompt manipulation, role reassignment, format-token injection,
and forgery of the harness's own fence/boundary tags. It **deliberately excludes**
patterns with high false-positive rates (e.g. `[[...]]` marketing templates, bare
secret/config keywords) because blocking legitimate content is itself a failure. This
matches [chapter 08](08-memory-lifecycle.md): memory is content the user genuinely wants
to keep, so the write gate has to be precise.

It's paired with **read-side sanitization**: `stripFenceTags` removes the harness's own
fence tags from content as it is read back out, so legacy/poisoned data cannot
masquerade as an authoritative injected block. Write-point scanning + read-point
sanitization is defense-in-depth: even if something slips into storage, it cannot pose
as a trusted prompt section on the way back in.

---

## Threat model summary

| Threat | Boundary | Where |
|---|---|---|
| Agent fetches internal/metadata targets | SSRF scheme/host/IP block + DNS pinning + redirect re-validation | [`ssrf.ts`](../src/lib/net/ssrf.ts), [`fetch-guard.ts`](../src/lib/net/fetch-guard.ts) |
| Credentials leaked across a redirect | cross-origin sensitive-header stripping | [`fetch-guard.ts`](../src/lib/net/fetch-guard.ts) |
| Injected instructions inside fetched/searched content | untrusted-content boundary + marker sanitization + fullwidth de-obfuscation | [`external-content.ts`](../src/security/external-content.ts) |
| Persistent injection via memory/skill writes | high-precision write-point scan | [`content-scan.ts`](../src/security/content-scan.ts) |
| Poisoned stored data posing as a trusted block | read-side fence-tag stripping | [`content-scan.ts`](../src/security/content-scan.ts) |
| A secret committed to a public repo | secret-scan gate | [`../scripts/secret-scan.sh`](../scripts/secret-scan.sh) |

Every row is enforced in code, applies regardless of how many users exist, and survives
unchanged when the deployment form changes — the [mechanism-over-form](11-mechanism-over-form.md)
boundaries applied to security.
