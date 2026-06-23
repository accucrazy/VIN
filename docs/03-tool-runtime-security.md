# 03 · Tool runtime + security

> Security is enforced in the runtime, never in the prompt. A fail-closed gate in the
> loop, a layered deny-over-allow policy, an SSRF guard on outbound requests, and an
> untrusted-content boundary on inbound data — all are code, not instructions.

## What this is

Telling a model "do not call tools you are not allowed to" or "ignore malicious
instructions in fetched pages" isn't a security control — it's a request the model is
free to ignore, be tricked out of, or simply get wrong. So every boundary that matters in
this harness is enforced in the runtime: it runs whether or not the model cooperates, and
it's identity-independent, so single-user needs it exactly as much as multi-tenant.

## The fail-closed tool gate

The run loop ([`../src/agent/react-loop.ts`](../src/agent/react-loop.ts)) is where a
model's *intent* to call a tool meets the runtime's decision about whether it *may*. The
model can emit a tool call two ways — native function calling, or, as a fallback, a
textual block parsed by regex. The textual path is the dangerous one: a model can be
coaxed into emitting a forged tool name in plain text. The gate handles both paths
identically:

```ts
for (const call of calls) {
  // (3) FAIL-CLOSED GATE: unknown (e.g. regex-forged) name never executes
  if (!registry.get(call.name)) {
    messages.push({ role: 'tool', content: `error: unknown tool ${call.name}` });
    continue;
  }
  // policy gate — deny over allow, layered (see policy/)
  const gate = checkToolPolicy({ toolName: call.name, policy: opts.policy });
  if (!gate.allowed) {
    messages.push({ role: 'tool', content: `error: tool ${call.name} denied by policy: ${gate.reason}` });
    continue;
  }
  const result = await registry.execute(call, { userId: opts.userId ?? 'local' });
  ...
}
```

"Fail-closed" is the key property: a call only executes if it passes *both* checks — the
tool exists in the registry, and the policy allows it. Anything else (an unknown name, a
denied name) is turned into an error result fed back to the model and never executed. The
default is denial; permission is the exception that must be earned. A regex-forged name
fails the existence check; a real-but-forbidden name fails the policy check. There's no
path to `execute` that skips the gate.

The registry's own `execute` ([`../src/tools/registry.ts`](../src/tools/registry.ts))
reinforces this: an unknown tool returns `{ success: false, error: 'Tool not found' }`
and deliberately does **not** leak the global tool list to the model.

## Layered, deny-over-allow policy

The policy module ([`../src/policy/`](../src/policy/)) resolves what "allowed" means. Its
mechanism, stated in [`tool-policy.ts`](../src/policy/tool-policy.ts):

> normalize → expand groups → compile patterns → resolve effective policy (profile +
> custom, deny over allow) → match.

A `ToolPolicy` ([`../src/types.ts`](../src/types.ts)) has `allow`, `alsoAllow`, `deny`,
and a `profile`. Three rules make it predictable:

**Deny always wins.** The matcher checks the deny list first and returns immediately on a
hit:

```ts
return (name: string): ToolPolicyResult => {
  const normalized = normalizeToolName(name);
  if (matchesAnyPattern(normalized, deny)) {
    return { allowed: false, reason: `Tool '${name}' is in deny list` };
  }
  if (allow.length === 0) return { allowed: true }; // no allowlist → default allow
  if (matchesAnyPattern(normalized, allow)) return { allowed: true };
  return { allowed: false, reason: `Tool '${name}' is not in allow list` };
};
```

**Patterns and groups expand to names.** A policy can reference `*` (all), an exact name,
a wildcard like `mcp__server__*`, or a `group:web`-style alias that expands to its member
tools ([`../src/policy/profiles.ts`](../src/policy/profiles.ts)). The `mcp__*` prefix
match is why the naming invariant in [chapter 02](02-naming-and-boundaries.md) matters: if
an MCP tool lacked its prefix, a `deny: ['mcp__*']` rule would silently miss it.

**Layers stack, first denial wins.** `checkToolPolicyWithContext` runs the checks in
order — global → provider → agent → group — and the first layer to deny stops the call:

```ts
const layers = [policies.global, policies.provider, policies.agent, policies.group]
  .filter((p): p is ToolPolicy => p !== undefined);
for (const policy of layers) {
  const result = createPolicyMatcher(policy)(toolName);
  if (!result.allowed) return result;
}
```

A broad global policy can be narrowed per agent, and no narrower layer can re-grant what a
broader one denied. There's also an owner-only mechanism
(`OWNER_ONLY_TOOLS`, `applyOwnerOnlyPolicy`) that gates side-effecting tools to the owner
caller — a runtime boundary, not a prompt instruction. In single-user the owner is
implicit, so it stays a forward-looking seam (see
[chapter 05](05-tenant-isolation-collapsed.md)).

## The SSRF guard on outbound requests

Any tool that fetches a URL is an attack surface: a model — or attacker-controlled content
steering it — can point a fetch at internal infrastructure. The guard in
[`../src/lib/net/`](../src/lib/net/) closes this off and is identity-independent: a
single-user machine's `web_fetch` can still be aimed at your LAN or router.

`validateUrlForSsrf` in [`ssrf.ts`](../src/lib/net/ssrf.ts) enforces, in order:

- **Protocol allowlist** — only `http:` and `https:`; everything else (`file:`,
  `gopher:`, etc.) is rejected.
- **Hostname blocklist** — `localhost`, `metadata.google.internal`, `metadata`,
  `169.254.169.254` (the cloud metadata IP), plus suffixes `.local`, `.internal`,
  `.localhost`, `.localdomain`.
- **Private-range rejection** — both the literal hostname and every resolved address are
  checked against private IP ranges (`isPrivateIpAddress`).

Critically, the check is on the **resolved** address, not just the hostname:

```ts
const results = await dnsLookup(normalized, { all: true });
...
if (!skipPrivateNetworkChecks) {
  assertAllowedResolvedAddressesOrThrow(results);
}
return { hostname: normalized, addresses };  // pinned
```

This defeats DNS rebinding: a hostname that resolves to a private address is blocked even
though the name itself looks public. The fetch wrapper
[`fetch-guard.ts`](../src/lib/net/fetch-guard.ts) carries the discipline through
redirects — it follows redirects manually, **re-validates every hop**, caps the redirect
count, detects redirect loops, and **strips `Authorization` / `Cookie` headers on a
cross-origin redirect** so credentials never leak to an unexpected origin:

```ts
if (nextParsedUrl.origin !== parsedUrl.origin) {
  currentInit = stripSensitiveHeadersForCrossOriginRedirect(currentInit);
}
```

A blocked request raises `SsrfBlockedError`, which the retry logic explicitly refuses to
retry — a blocked host is a policy decision, not a transient failure.

## The untrusted-content boundary on inbound data

Outbound requests are guarded; so is what comes back. Content from the web, search
results, or external MCP tools is untrusted by nature — it may contain prompt-injection
payloads. [`../src/security/external-content.ts`](../src/security/external-content.ts)
wraps such content in explicit boundary markers before it ever reaches the model:

```ts
export const BOUNDARY_START = '<<<EXTERNAL_UNTRUSTED_CONTENT>>>';
export const BOUNDARY_END   = '<<<END_EXTERNAL_UNTRUSTED_CONTENT>>>';
```

`wrapExternalContent` does three things: it sanitizes any boundary markers *inside* the
content (so a payload can't forge an end-marker and "escape" the wrapper), it folds
fullwidth-Unicode lookalikes back to ASCII (a common obfuscation vector), and it
optionally prepends a warning telling the model to treat the block as data, not
instructions. MCP results are wrapped at the moment of materialization
([`../src/mcp/materialize.ts`](../src/mcp/materialize.ts) calls `wrapExternalContent`
with `source: 'mcp'`), so untrusted external data is marked at the boundary, not later.

A second, stricter layer guards *persistent* writes.
[`../src/security/content-scan.ts`](../src/security/content-scan.ts) scans content bound
for long-term memory or user skills and **blocks** the write on a high-precision injection
match. The reasoning is in the file header: poisoned long-term memory gets pulled back
into the system prompt on every future session, which is worse than a one-shot injection.
Write-point scanning (`scanMemoryWrite`) plus read-point sanitization (`stripFenceTags`)
form a defense-in-depth pair: even if a bad write slips through, the read side strips
forged fence tags so it can't masquerade as authoritative.

## Why runtime, not prompt

A prompt instruction is advisory; a runtime check is a wall. Here the model is treated as
an untrusted planner whose *suggestions* (which tool to call, which URL to fetch) are
always re-validated by code before they take effect. It's the same spine as everywhere
else: enforce the boundary in one place, in code, so every capability inherits it (see
[chapter 01](01-capability-map.md)) — instead of hoping each tool, and each model turn,
remembers to behave.

See also [`docs/SECURITY.md`](SECURITY.md) for the consolidated threat model (SSRF,
untrusted content, persistent injection).

## Where to go next

- [04 · Resilience and data discipline](04-resilience-and-data-discipline.md) — how external data is stored-then-referenced, and how errors are classified and recovered.
- [05 · Tenant isolation, collapsed](05-tenant-isolation-collapsed.md) — the owner-only and ownership seams kept live.
