---
scenarios:
  - name: converge-a-foreign-repository
    description: >
      Run `spex flat new <public-repo-url>` against a repository nobody has specced, with a round budget and
      the default coverage floor, and read the driver's own output. The measurement is the command's final
      verdict block, not an inspection of the tree it produced.
    expected: >
      It reports `converged`, the round count is within budget, lint errors are 0, and coverage is at or above
      the floor. The governed-file count in the verdict is the same number lint's own report carries — a
      verdict whose denominator disagrees with the gate's is a failure even when it says converged.
    tags: [cli]
  - name: governed-set-is-confirmed-not-asserted
    description: >
      Flatten a repository whose file tree proposes a root that lint's source policy then rejects — a `tests/`
      directory holding enough files to clear the share threshold. Read the driver output and the
      `spexcode.json` the run committed into the clone.
    expected: >
      The run names the dropped root, the committed config lists only roots that actually govern something,
      and the reported file count equals the gate's governed count. A config naming a root the gate ignores,
      or a count the gate contradicts, is a failure.
    tags: [cli]
  - name: continue-an-initialized-local-repository
    description: >
      In a clean local Git repository already adopted with `spex init --harness codex`, run `spex flat new .`
      through its configured Codex launcher. Read the driver's verdict, the source repository's history and
      status, its existing configuration, and the sibling flat record.
    expected: >
      The run uses the local launcher, adds and commits only `.spec` in the source repository, preserves the
      existing `spexcode.json` byte-for-byte, creates no clone beneath the flat record, and converges only when
      the ordinary lint gate does. A runner that writes a source file fails before Flatcode commits it.
    tags: [cli]
  - name: refuse-a-launcher-that-cannot-run-a-turn
    description: >
      Invoke `spex flat new` with `--launcher` naming a launcher whose harness declares no non-interactive
      turn, and separately with a launcher name that does not exist.
    expected: >
      Both refuse before any network or disk work happens, naming the launcher and, for the harness case,
      listing the harnesses that can run a round. Cloning first and failing afterwards is a failure, and so is
      silently substituting a different harness.
    tags: [cli]
  - name: site-renders-under-a-subpath
    description: >
      Serve a flat's site under a path prefix the way a gallery host would — `/<owner>/<repo>/` — with every
      request outside that prefix answered 404, and drive a real browser at it. The 404 is the point: a host
      carrying many flats has no reason to serve one flat's assets from the domain root, so a run that allows
      root fallbacks cannot tell a relocatable site from one that only ever worked at `/`.
    expected: >
      The graph renders and a node's document loads with no request escaping the prefix. A flat is a directory
      whose contents are self-referential; a site that resolves its own assets from the domain root is not a
      directory anyone can move, and the same defect silently rules out every path-routed host.
    tags: [frontend-e2e, cli]
  - name: flat-site-renders-with-no-backend
    description: >
      Emit a flat's site with `spex flat site`, serve the directory over plain static HTTP, and drive a real
      browser against it. Verify the release manifest's SHA-256 for every file it names, then open the graph,
      open a node's document, and open the About panel.
    expected: >
      Every manifest hash matches the bytes on disk, the graph renders nodes, a node's spec prose loads, the
      About panel shows the flat's coverage, and the page issues zero requests to any `/api/` route.
    tags: [frontend-e2e, cli]
---

# measuring flat

Every scenario here runs the shipped command, from a shell, against a repository that is not this one — the
product claim is about foreign code, so measuring it on a fixture built to flatter the profiler proves
nothing. `converge-a-foreign-repository` uses a public repository off the internet for that reason.

The two `cli` convergence scenarios are read from the driver's **own** verdict rather than from the spec tree
it wrote. That is deliberate: the thing under measurement is whether Flatcode's report is true, and a
measurement that inspects the tree and forms its own opinion cannot catch a driver that reports a number its
gate disagrees with — which is exactly the defect `governed-set-is-confirmed-not-asserted` exists to hold
down. So the check is verdict against gate, both taken from the run.

`flat-site-renders-with-no-backend` drives a real headless browser over a real static server. Reading the
emitted JSON and concluding the page would render is not a measurement of this scenario: the whole claim is
that a plain directory is enough, and only a browser that got the bytes over HTTP can say so. The zero-`/api/`
assertion is part of the reading rather than a separate concern — a flat that quietly reached a backend would
render identically here and fail everywhere it was actually served.
