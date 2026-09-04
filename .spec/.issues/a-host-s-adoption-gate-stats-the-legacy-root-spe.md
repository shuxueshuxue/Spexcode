---
concern: A host's adoption gate stats the legacy root spexcode.json, so `spex init` does not clear it
by: 2e211415-7ee0-4947-ae4e-a33c1c0722ca
status: open
nodes: spex-init, harness-delivery
created: 2026-09-04T02:12:57.638Z
---

Spec: spex-init, harness-delivery

A host harness asks "is this repo adopted by SpexCode?" by statting a path SpexCode has already
moved, so the one command its own error message prescribes does not clear its gate.

**The gate.** zcode's Swarm tool refuses dispatch before any work happens
(`apps/zcode-cli/packages/core/src/tool/handlers/swarm.ts:227`), with: "This workspace has a spec tree
but was never adopted by SpexCode, so every appointed worker would fail its delivery gate after doing
its work. Run `spex init . --harness zcode` in the workspace root first." Refusing early is right —
the comment above it records a measured run that appointed five workers into an unadopted tree and
left five branches that could not have passed.

**Its predicate.** `apps/zcode-cli/packages/bootstrap/src/app/spec-graph-port.ts`:

    async isAdopted(workspaceRoot) {
      // the same marker the delivery gate requires, so dispatch and delivery cannot disagree
      try { return (await stat(join(workspaceRoot, "spexcode.json"))).isFile(); } catch { return false; }
    }

That is the **pre-move** root path. [[spex-init]] stamps `.spec/spexcode.json` (`init.ts:182`; the node
body names it as what adoption plants), and `layout.ts`'s `readProjectConfig` treats a root
`spexcode.json` as **legacy**, printing "Config moved to .spec/ — run `git mv spexcode.json .spec/`".
So the comment's stated invariant is inverted: dispatch is stricter than delivery, and `spex init`
— the repair the error names — leaves the gate closed.

**Measured, not inferred.** Four SRB round-two swarm runs (glm-5.3 pinned, zcode dist 081ad4fc7066,
agent working inside the task's dev image). All four hit the gate; three found the legacy path and
said so in their own commit titles:

- lang06/swarm — `.spec/spexcode.json` committed 19:55, a commit titled `spex init adoption` at 19:58,
  then at 20:01 a commit titled **"Root spexcode.json (adoption marker for harness)"**. Three minutes
  after running the prescribed command, the agent had to plant the legacy file to get through.
- lang02/swarm — `.spec/spexcode.json` at 20:29, then at 20:33 **"spex: root spexcode.json for harness
  adoption"**.
- pf01/swarm — root `spexcode.json` and `.spec/spexcode.json` in the same initial spec-tree commit.
- lang04/swarm — never planted the legacy file (`git ls-files spexcode.json` = 0, only
  `.spec/spexcode.json`). Its root issued the identical five-worker Swarm dispatch **six times between
  20:18:10 and 20:23:24**, each refused with the adoption message, and at 20:24:17 abandoned Swarm and
  launched five plain `Agent` subagents for the same five workstreams instead — outside the spec-node
  and delivery-gate machinery the gate exists to protect. Nine minutes of retry, then the mechanism was
  routed around rather than satisfied.

Raw model-io for all four is in the round-two bench tree under `<run>/rollout-archive`; the commit
sequences above are read from each run's own `repo` git history.

**What I am not asking for.** Not re-blessing the root path. The zcode-side repair is narrow — that
package already imports `@spexcode/spec-core`, so it can call `configPath(root)` / `readConfig(root)`,
which encode the preferred-plus-legacy resolution in one place.

**The SpexCode-side gap, which is why this happened at all.** Adoption is a fact SpexCode owns, but
spec-core exports no predicate for it — only `configPath`/`readConfig`. A host that needs "is this
adopted" therefore reconstructs the marker itself, and the first host to do so hardcoded the path we
had already moved, with a comment asserting parity that nothing checks. Worth considering an exported
`isAdopted(root)` (or a marker resolver) so the next host cannot get it wrong, and so the gate a host
puts in front of dispatch and the gate SpexCode enforces at delivery are the same function rather than
two independent guesses.
