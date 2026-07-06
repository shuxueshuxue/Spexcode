---
scenarios:
  - name: merged-read
    tags: [cli]
    code: spec-cli/src/issues.ts
    related: [spec-cli/src/localIssues.ts, spec-forge/src/links.ts]
    description: >-
      In a repo with BOTH stores populated — real forge issues (some carrying `Spec:` markers) and a local
      local thread — run `spex issues` / `spex issues --all --json` through the real CLI.
    expected: >-
      ONE list carries both stores, each issue store-tagged (`local` / the forge host) with the same shape:
      a forge issue arrives with by=forge author, created=forge timestamp, its permalink url, and its
      `Spec:` markers already translated into nodes[] (no downstream consumer ever sees a marker); the
      local thread arrives with its signers/replies/evidence. The list is ONE time line — stores
      interleaved by created, newest first, never store-grouped blocks. --store and --node filter;
      default hides non-open.
  - name: promote
    tags: [cli]
    code: spec-cli/src/issues.ts
    related: [spec-forge/src/port.ts, spec-forge/src/drivers/github.ts]
    description: >-
      Open a local thread (with nodes + evidence), then `spex issues promote <id>` against the REAL forge.
      Also try promoting an unknown id and the just-landed thread again.
    expected: >-
      One recorded action: a real forge issue is created whose title is the concern and whose body carries
      the thread body, the `Spec: <nodes>` marker, the evidence hashes, and a provenance footer; the merged
      read then shows that forge issue linked to the SAME nodes through the existing tracer (no new linking
      code). The local thread ends `landed` with a permalink reply as its trail. An unknown id and a
      non-open thread both refuse loudly; a failed create leaves the local thread untouched (create-first
      ordering).
  - name: forge-reply
    tags: [cli]
    code: spec-cli/src/issues.ts
    related: [spec-forge/src/drivers/github.ts, spec-cli/src/mentions.ts]
    description: >-
      Against the REAL forge, reply to a `github#N` issue through the one store-routed verb (`spex issues
      reply github#N --body …` / `POST /api/issues/:id/reply`), then read the merged list back.
    expected: >-
      A REAL comment lands on the GitHub issue (visible via `gh issue view`), and the next merged read
      carries it in that issue's replies[] in the SAME Reply shape a local thread has (by = the forge
      commenter, at, body) — the read-back, never a local echo. An @new/@session in the reply text
      dispatches exactly as a local reply's would (the mention fires on the words, not the store). An
      unreachable forge fails loud with nothing queued; the local store is untouched throughout.
  - name: cli-store-parity
    tags: [cli]
    code: spec-cli/src/issues.ts
    related: [spec-cli/src/localIssues.ts, spec-forge/src/drivers/github.ts]
    description: >-
      The CLI drives the SAME store-routed verbs the dashboard clicks: `spex issues open "<concern>"
      --store github --node <id>` against the REAL forge, then `spex issues close github#N`; also the
      local legs (`open` default / `--store local`, `close <local-id>` twice) and the loud errors
      (`--store bogus`, close an unknown id, bare close).
    expected: >-
      `open --store github` creates a REAL forge issue through the driver (visible via `gh issue view`),
      its body carrying the `Spec: <nodes>` marker so the next merged read shows it linked to the same
      nodes (re: <id>) with no promote round-trip; default/--store local commits to the trunk store
      unchanged. `close` routes by id — a local id resolves the thread `landed` (idempotent on repeat),
      `close github#N` REALLY closes the remote issue (gh reads state CLOSED) — one verb, the same
      closeIssue/createIssue routing as POST /api/issues[/:id/close]. Unknown store/id fail loud with the
      known-stores list / the store hint; bare close prints usage and exits 2.
  - name: degrade
    tags: [cli]
    code: spec-cli/src/issues.ts
    description: >-
      Run `spex issues` in a repo with local threads but NO reachable forge (no gh/repo/auth).
    expected: >-
      The local list still prints in full, and exactly one loud stderr note reports the forge is
      unreachable ("listing local only") — local reading never hostages on a network, and the degrade is
      never silent.
---

# measuring issues

YATU through the real `spex issues` against a real forge (`gh`) and the real trunk store — never a mocked
driver. The merged-read is measured in the live repo itself (its GitHub issues + a genuine local concern);
the degrade leg in a throwaway repo with no forge. The loss is the gap between the one-object claim and
the reading: same shape both stores — threads included — markers invisible downstream, a forge reply a
real round-tripped comment, loud local-only degrade.
