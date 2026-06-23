# 12 — A Future Control Plane: The Build-Time Capability Manifest

> Today, the roster of capabilities — agents, tools — is derived at runtime from a
> registry. That's clean and dynamic, but it has one failure mode worth designing
> against: a capability you place in the tree but forget to *wire* is invisible until
> production. This chapter sketches an idea I'd reach for now — a build-time capability
> manifest with fail-fast codegen — that turns "silently missing in production" into
> "broken at build." It's a design note, offered on its own terms.

Grounded in (the runtime-derived roster this would complement):
- [`../src/agent/index.ts`](../src/agent/index.ts) — `AgentRegistry`, roster derived from `list()`
- [`../src/tools/registry.ts`](../src/tools/registry.ts) — `ToolRegistry`, `listTools()` as the derived roster

Related chapters: [10 — Engineering Discipline](10-engineering-discipline.md) (evidence before assertions) · [11 — Mechanism Over Form](11-mechanism-over-form.md)

---

## Where we are today: registry-derived rosters

The harness already avoids hand-maintaining its rosters. Adding an agent is *adding a
record*, and the roster falls out of the registry:

```ts
// src/agent/index.ts
export const agentRegistry = new AgentRegistry();
agentRegistry.register(VIN);            // adding an agent = one register call
// ...
list(): AgentDefinition[] {              // the roster — derived, not hand-maintained
  return Array.from(this.agents.values());
}
```

Tools work the same way ([`registry.ts`](../src/tools/registry.ts)): `register` puts a
tool under the shared `AgentTool` contract, and `listTools()` derives the LLM-facing
roster from whatever was registered. This is the default I wanted — there is no second
list to keep in sync, so the roster can never drift from reality at runtime.

## The gap this leaves

Runtime derivation answers "what is registered *right now*". It does **not** answer
"is everything that *should* be registered actually wired?" Consider the lifecycle of a
new capability:

1. You author `tools/new-thing.tool.ts` and place it in the tree.
2. You forget to add it to the barrel's `registerBuiltinTools()` (see
   [`../src/tools/index.ts`](../src/tools/index.ts)).
3. Everything compiles. Everything runs. The tool is simply *not there* — the registry
   never saw it.
4. You discover this when a user asks for it in production and the agent says it has no
   such tool.

The file exists, the code is correct, and nothing failed. The capability was placed in
the tree but not connected to the plane, and runtime discovery has no way to know that
something was *supposed* to be discoverable. The error surfaces at the worst possible
time — in production, as an absence rather than an exception.

## The proposal: a build-time capability manifest

Add a codegen step that runs at **build time** and:

1. **Scans** the capability directories (e.g. `tools/`, `agent/agents/`, `skills/entries/`)
   for the files that *declare* a capability.
2. **Cross-checks** them against what is actually registered/wired.
3. **Emits** a generated manifest (a plain TypeScript module listing the capabilities)
   that the runtime imports.
4. **Fails the build** if a capability is present in the tree but not wired — the
   fail-fast move.

The effect is to move the gap-check from *production runtime* to *build*. A
placed-but-unwired capability becomes a build error with a precise message, caught
before it ships — the same "evidence before assertions" posture from
[chapter 10](10-engineering-discipline.md), applied to the capability roster itself.
The generated manifest also gives you a single, reviewable artifact of "everything this
build can do," instead of a roster that only exists once the process is running.

## Design choices worth being explicit about

This is a *design note*, and the choices inside it matter:

- **Keep explicit names.** The manifest should reference each capability by an
  explicit, declared identifier — not by deriving the name from the filename. Coupling
  a capability's public name to its file path makes renames and reorganizations
  silently change behavior. The naming seam already lives in
  [`tool-name.ts`](../src/tools/tool-name.ts); the manifest should respect it, not
  reinvent a path-based naming scheme.

- **Complement, don't replace, runtime registration.** The registries stay the runtime
  source of truth. The manifest is a *build-time guard* over them, not a second
  authority that could itself drift. Generated code is checked into the build, the
  registry is what executes — and the build fails if they disagree.

- **Fail-fast, with a useful message.** The value is entirely in the failure: "tool
  `new-thing` found in `tools/` but not registered in `registerBuiltinTools()`" is
  actionable; a silent absence in production is not.

- **One step, no per-file bundler.** The codegen is a single scan-and-emit pass over a
  few known directories. Resist turning it into a heavyweight build system; its whole
  job is to catch the wiring gap and produce one manifest module.

## Why it would fit now rather than later

The failure it prevents is *form-independent* — a single-user local harness hits
"placed but unwired" exactly as readily as any larger deployment, because the cause is
human (forgot the barrel line), not scale. There's nothing to wait for: the runtime
rosters in [`agent/index.ts`](../src/agent/index.ts) and
[`tools/registry.ts`](../src/tools/registry.ts) are already the clean derivation this
manifest would guard. Adding the build-time check is additive — it changes nothing about
how capabilities are *written*, only about how confidently you can assert, at build
time, that all of them are *reachable*.

## Notes

A control plane's job is not only to run capabilities but to *know* its capabilities
with certainty. Runtime derivation gives you the dynamic roster; a build-time manifest
gives you the guarantee that the roster is complete. Pushing the "is it wired?" check as
early as possible — to build, not to a production user's request — lines up with the
rest of the harness: make the safe state cheap to verify, and make the unsafe state fail
loudly, early, and with a message you can act on.
