---
scenarios:
  - name: host-reconcile-and-proxy
    tags: [backend-api, cli]
    test:
      path: spec-cli/src/host.test.ts
      name: full host gateway integration suite
    description: >-
      Run `tsx --test spec-cli/src/host.test.ts`: real HTTP/SSE/WS/TLS gateway sockets, instance-validated
      endpoint records, durable/offline catalog, a spawned real `spex serve` from a linked worktree,
      gateway/project structured icon writes, raw project config, host-directory browsing, explicit
      Git/SpexCode setup, registration and host operations.
    expected: >-
      A versioned record claims the actual served git toplevel and resolved identity; a linked worktree gets
      its own slot and cannot replace main. Instance/root mismatches, dead/recycled URLs, mis-slotted and old
      records never proxy, and a cataloged or record-claimed root whose directory no longer exists is absent
      from the reconciled list. Live identity changes and restarted generations refresh the catalog. Two project
      projections plus the gateway projection remain distinct. Gateway icon writes are admin-only and touch
      only `SPEXCODE_HOME/config.json`; project writes are admin-only, revision-checked, atomic, preserve
      other JSON fields, work offline, accept featured ids and well-formed Iconify names, and return canonical
      bytes/projection. Existing emoji/Iconify config remains resolved. The admin-only directory browser
      returns directory metadata without file contents. A plain folder enters only after explicit Git
      initialization; requested setup runs the real `spex init`, and a failed init returns its transcript
      without writing the catalog. `/projects`, stream, scoped HTTP/WS, TLS, registration, raw config, and
      shell routing retain their auth and transport contracts.
    related: [spec-cli/src/supervise.ts, spec-cli/src/gateway-hub.ts, spec-cli/src/host.test.ts]
  - name: post-init-harness-target-addition
    tags: [backend-api, cli]
    test:
      path: spec-cli/src/host-harness-target.test.ts
      name: harness target addition persists targets, materializes, and is exposed through the admin route
    code: [spec-cli/src/host.ts, spec-cli/src/index.ts]
    description: >-
      In isolated throwaway Git repositories, initialize one project with a native target and add another
      through the host operation and its admin HTTP route. Repeat with an explicit plugin target and with a
      missing persisted selection; inspect `spexcode.json`, generated launchers, materialize output, and the
      revision-guard response.
    expected: >-
      The operation appends exactly the requested native or plugin target, preserves existing defaults, and
      runs the real materialize before reporting success. Native targets with a safe template gain one
      matching launcher while existing launchers remain intact; plugin targets do not get an invented
      launcher. Plugin/native mixtures, stale revisions, malformed input, and a missing `harnesses` field
      fail loudly without silently selecting or partially replacing a target set. The admin route returns
      the new revision and materialize transcript, and a failed materialize retains enough metadata for a
      safe retry.
  - name: new-project-setup-publishes-a-branchable-base
    tags: [backend-api, cli]
    test:
      path: spec-cli/src/host.test.ts
      name: newly created projects have a committed source-of-truth before session creation
    code: [spec-cli/src/host.ts, spec-cli/src/sessions.ts]
    description: >-
      Through the real host add transaction, create an absent project path with Git and SpexCode setup,
      inspect its source-of-truth branch and HEAD, then start its real backend and POST one session using
      the configured launcher. Repeat the path-only new-project action and inspect its initial ref.
    expected: >-
      Every project created by the host has a real initial commit before it is cataloged. A SpexCode setup
      commit contains the seed `.spec`, portable config, and ignore policy, and its `mainBranch` names the
      checked-out source-of-truth branch. The backend can create a session worktree immediately, so no
      `git worktree add failed: fatal: invalid reference` is returned. A path-only project receives the
      real `spex init --harness none` foundation and an initial commit on the conventional `main` branch;
      its empty harness selection remains addable from the scoped New Session `+` action.
---
# measuring host-gateway

YATU is the integration suite's real processes, files, and sockets under an isolated `SPEXCODE_HOME`; file
its transcript. Library-only resolver assertions are auxiliary.
