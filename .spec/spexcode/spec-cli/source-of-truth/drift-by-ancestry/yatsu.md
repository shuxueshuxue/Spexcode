---
scenarios:
  - name: branchy-drift-counted
    tags: [cli]
    description: >-
      On a repo whose governed file changed on a side branch with a commit date OLDER than the
      spec's latest version commit (back-dated / long-lived branch), merged into HEAD after the
      version: run `spex lint` and read the drift report for that file. The change lies in
      `V..HEAD` by true git ancestry (it is not an ancestor of the version), so it is real drift —
      regardless of where a date-ordered `git log` walk happens to place it. Reproducible fixture:
      base commit -> side branch edits the governed file (back-dated) -> main re-versions the
      spec.md (dated later) -> merge side.
    expected: >-
      `spex lint` warns `<file> is 1 commit(s) ahead of spec '<node>'` — the branch commit counts
      as drift because it is NOT an ancestor of the version commit, exactly matching
      `git rev-list V..HEAD -- <file>`. A linear-position/date compare that reads it as
      "older than the spec" and stays silent is the failure this scenario pins.
  - name: off-history-probe-repeat-cost
    tags: [cli]
    test: .spec/spexcode/spec-cli/source-of-truth/drift-by-ancestry/repro-39.ts
    description: >-
      On a corpus whose readings' codeSha anchors are ALL off-history (readings filed on a branch
      whose commits were then orphaned — the adopter history-rewrite shape; commit objects still
      present), run evalTimeline over the node TWICE in one process and count the git children each
      pass spawns (GIT_TRACE). The co-located repro-39.ts builds the corpus (30 orphaned anchors ×
      10 scenarios = 300 readings) and prints the per-pass spawn counts.
    expected: >-
      The second pass — identical (sha, path) inputs, HEAD unmoved — spawns ZERO git children: the
      content fallback's rev→oid resolutions are memoized over immutable git objects exactly like
      the code axis's diff/behind probes, so a board rebuild pays in-memory lookups only. The
      failure this pins is a per-reading re-spawn of `git rev-parse` (anchor side AND head side) on
      every rebuild — hundreds of sync forks per build at an adopter whose anchors all went
      off-history (spexcode#39: ~10s /api/board rebuilds).
---
# yatsu.md — drift-by-ancestry

Measured through the real `spex lint` CLI on a scratch branchy-history repo: the drift signal must
agree with `git rev-list V..HEAD -- <file>` (true DAG reachability), never with a commit-date-ordered
log position. The off-history probe's COST is measured the same scratch-repo way (repro-39.ts): count
actual git children per evalTimeline pass via GIT_TRACE — the mechanism, not just wall time.
