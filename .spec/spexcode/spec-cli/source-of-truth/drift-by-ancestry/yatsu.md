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
---
# yatsu.md — drift-by-ancestry

Measured through the real `spex lint` CLI on a scratch branchy-history repo: the drift signal must
agree with `git rev-list V..HEAD -- <file>` (true DAG reachability), never with a commit-date-ordered
log position.
