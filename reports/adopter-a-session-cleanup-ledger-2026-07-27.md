# adopter-a session fleet cleanup ledger

Snapshot time: 2026-07-27 05:50 UTC (13:50 Asia/Shanghai)

Scope: the live SpexCode project rooted at
`/Users/jeffryglm/Codebase/temp/adopter-a` on the MBP reached only through
`ssh -F ~/YellowPage/ssh_config mbp-tail`.

This is an execution ledger, not an authorization to mutate the fleet. No session was stopped, closed,
archived, merged, or resumed during the audit. The only writes to the MBP were the required status prompts
through the explicit adopter-a API. Those prompts caused normal lifecycle declarations and queue draining, which
are recorded below.

## Decision rules

- `KEEP`: a live external GitLab note still deep-links to the exact session, or the record owns unfinished
  non-ephemeral work that has no accepted handoff.
- `SALVAGE-THEN-CLOSE`: the current record is not a sound continuing owner, but it contains unique work or an
  unfinished external deliverable. A named successor must accept the handoff before close.
- `CLOSE-AFTER-P0`: there is no live external reference and no unique deliverable to preserve. For CR review
  sessions, a local report is diagnostic only; the governing CR contract says the current MR note is the sole
  external session reference.

The archive label was never used as evidence of safety. Branch ancestry, dirt, live reports, current GitLab
notes, runtime references, and task content were checked separately.

## Live snapshot

Repository:

- adopter-a main branch: `adopter-a-spec` at `04cec48ffefbd069612da7782c69f745f0b55dc3`, 148 commits ahead of
  `origin/main`.
- Main checkout had four pre-existing untracked items: `CLAUDE.local.md`,
  `docs/tencent-ags-sandbox-e2e.md`, `spexcode.local.json.bak-before-codex-default-20260715`, and `tools/`.
- The project store is
  `/Users/jeffryglm/.spexcode/projects/-Users-jeffryglm-Codebase-temp-adopter-a`.
- It contains 51 session directories: 45 `session.json` files plus 6 artifact-only thread directories. The
  public session API returns all 45 rows, projecting one unreadable file as `corrupt`.

Final post-probe counts:

| Dimension | Exact count |
| --- | ---: |
| API rows | 45 |
| Archived | 26 |
| Close-pending proposals | 2 |
| Lifecycle `active` / `asking` / `awaiting` / `parked` | 5 / 10 / 27 / 3 |
| Liveness `online` / `offline` / `unknown` | 15 / 29 / 1 |
| Display `working` / `asking` / `done` / `parked` / `close-pending` / `offline` / `corrupt` | 2 / 10 / 25 / 3 / 2 / 2 / 1 |
| Harness `codex` / `codex-headless` | 10 / 35 |
| Lifecycle `error` | 0 |

Before the required status probes there were 45 rows, including 3 queued, 6 active, 6 asking, and 4 working.
The replies from two existing workers freed launch slots; all three queued rows then started. Two replied and
waited, while the third exposed the corrupt-record incident below. The final fleet has no queued row.

## Runtime ownership

The resource probe was healthy, but Darwin host metrics were explicitly unavailable. RSS, PSS, host memory,
swap, and CPU totals are therefore unknown rather than zero.

Backend ownership at the snapshot:

- Project backend instance: `bb38602a-47c8-4193-b68f-e1154f64b588`.
- Registered generation: PID `84888`, start token `Mon Jul 27 13:13:37 2026`, project root exactly adopter-a.
- Process group: root `84862` (`spex serve`), TSX wrapper `84878`, registered supervisor `84888`, serving
  worker `84979`. `/api/instance` reported the same instance id/root and worker PID `84979`.
- Public endpoint: `http://127.0.0.1:8787`, listening on all interfaces.
- CR listener guardian: PID `47303`; exact child `47436`; `current=null`, `queue=[]`, WebSocket connected. Its
  05:43 reconcile failed because reviewer `GET /api/reviews` timed out after 15.9 seconds; the prior 05:23
  reconcile was `ok: 18 item(s), 0 enqueued`.

Codex shared control plane:

- Exact app-server PID `32946`, start `Fri Jul 24 02:46:54 2026`, PPID `1`, PGID `32924`.
- Adapter probe: healthy, refcount `10`, all turns idle.
- Four loaded references are unowned and therefore protective. Under `host-resource-budget`, this makes the
  stop/close guard fail closed; no session lifecycle verb may guess ownership around them.

| Thread id | Governed session | Runtime state |
| --- | --- | --- |
| `019f9f5d-f778-7f02-8632-6035fc3f41eb` | none | unowned, loaded, idle |
| `019fa032-6e98-7e30-a32f-ee1132724e50` | `565db111` | governed, loaded, idle, asking |
| `019fa04d-c5c6-7260-97f5-9d8028005204` | `f96d58e8` | governed, loaded, idle, awaiting |
| `019fa06b-dfa2-7103-9335-b5a59f95c568` | `0536a237` | governed, loaded, idle, awaiting |
| `019fa0ab-087d-78c3-ae45-82dd1a69ae71` | none | unowned, loaded, idle |
| `019fa144-b3b5-7021-a532-dce38982394d` | `7fed9321` | governed, loaded, idle, asking |
| `019fa16c-4e53-7672-b3f7-a2a0401eb494` | none | unowned, loaded, idle |
| `019fa209-159d-7f11-89af-7b18ff334993` | corrupt `950f0edd` | unowned projection, loaded, idle |
| `019fa210-bdf9-7551-bbd4-e2dc029c8809` | `421f64db` | governed, loaded, idle, asking |
| `019fa215-1fe4-7a53-8610-280c63273aec` | `fae99f6e` | governed, loaded, idle, asking |

The four archive-online records are `3cbbfb34`, `031007d2`, `8ac6114d`, and `27ea681a`. None currently has a
loaded thread, but all remain headless-addressable by record semantics. Existing archive did not give their
runtime back. The archive=>offline P0 must be deployed, then these already-archived rows must be reconciled
explicitly because a new archive implementation cannot retroactively replay an old write.

## Status probes

Every row that was online and appeared to be autonomously working or parked was sent a unique status-only
prompt through:

`spex session send <id> "<probe>" --api http://127.0.0.1:8787`

No pane keystrokes or inferred transport was used.

| Session | Delivery | Reply proof |
| --- | --- | --- |
| `565db111` | accepted | Real Codex pane and timeline replied `FLEET-PROBE-565D-0727`; canonical-writer integration is mid-edit, no external blocker, now asking. |
| `7fed9321` | accepted | Headless timeline replied `FLEET-PROBE-7FED-0727`; exact WDIO mapping is committed, full-SHA AGS 3/3 rerun still required, now asking. |
| `421f64db` | accepted after queue drain | Timeline replied `FLEET-PROBE-421F-0727`; MR !1640 planning had reached read-only scenario enumeration, now asking. |
| `fae99f6e` | accepted after queue drain | Timeline replied `FLEET-PROBE-FAE9-0727`; attempt-lease rollout compatibility inheritance has not begun, now asking. |
| `a857a4ae` | rejected | Recorded Codex thread was not loaded; prompt explicitly not delivered. This is stale parked/addressability state. |
| `8ac6114d` | rejected | Recorded Codex thread was not loaded; prompt explicitly not delivered. This is fake-working state. |
| `57746a6f` | rejected | Recorded Codex thread was not loaded; prompt explicitly not delivered. This is fake-working state. |
| `950f0edd` | accepted after queue drain | No real reply was observed. Its record became unreadable while the loaded thread remained; accepted send is not counted as success. |

The two lifecycle-active but liveness-offline rows were not sent: `01be2e59` is the deliberately inert CR
umbrella and `49e72925` is an offline attempt-lease salvage lane. They are stale lifecycle labels, not online
workers.

## Error and link hazards

1. `950f0edd` is the sole corrupt record. `session.json` fails at line 13, column 13 because arbitrary output
   entered `note` without valid JSON escaping. The API truthfully exposes `status=corrupt`, `liveness=unknown`,
   no proven branch/path/harness owner, and says close can only quarantine bytes then fail while preserving all
   residue. Its loaded thread is now the fourth unowned app-server reference. Owner: SpexCode sessions-core /
   structured-writer repair, not fleet cleanup.
2. `8ac6114d` and `57746a6f` display `working` but their explicit Codex dispatches failed `thread not loaded`.
   `a857a4ae` is the same defect under `parked`. There are zero authored lifecycle-error rows.
3. The MBP's live LAN address is `10.253.204.205`; both it and tailnet `100.99.97.58` returned HTTP 200 for the
   adopter-a dashboard. `10.253.209.97` did not answer. Four retained GitLab notes still use that stale hostname.
4. GitLab MR !1659 note `297179` points to missing session `c159b897-07e2-4430-a07f-090ae25fbad7`.
   `c36135b9` contains related unique measurement/evidence work but is not the note target. The note is already
   broken and must be repaired deliberately; it does not authorize silently substituting a session id.
5. The adopter-a-base current-head commit is now merged: main `dc5c25bd` contains `6c0003ff`. However the checkout
   remains on `cr-current-head-0536`, and the exact service PID `30238` listens on `*:8088` but timed out after
   five seconds. Deployment/health remains unfinished and belongs to `27ea681a`'s salvage handoff.
6. The listener is running and its WebSocket is connected, but the latest reviewer reconcile timed out. Cleanup
   must wait for a later successful reconcile; an empty queue after a failed source read is not proof of
   quiescence.

## Per-id decisions

### KEEP (9)

| Session | Evidence | Owner and release condition |
| --- | --- | --- |
| `0090292f` | Clean MR !1610 overlay `eca9894851`; current GitLab note `295081` deep-links exactly to this session. Link host is stale `10.253.209.97`. | GitLab MR !1610 / CR delivery owner. Keep until the note is replaced or deleted and the replacement link is verified. |
| `3a0a6975` | Clean MR !1484 overlay `be77a8557f`; current note `295705` points exactly here. Stale link host. | GitLab MR !1484 / CR delivery owner. Same release gate. |
| `6dc9eb5c` | Clean MR !1632 overlay `dc8e06e398`; current note `295963` points exactly here. Stale link host. | GitLab MR !1632 / CR delivery owner. Same release gate. |
| `d02dc34f` | Clean MR !1631 overlay/eval head `013feab26a`; current note `296448` has four exact eval links to this session despite pipeline exit 1. Stale link host. | GitLab MR !1631 / CR delivery owner. Same release gate. |
| `b7c15095` | Clean MR !1662 overlay/eval head `bf1c699c6b`; current note `296795` points only here. | GitLab MR !1662 / CR delivery owner. |
| `77a05a55` | Clean MR !1668 overlay `66670c93d9`; current note `296674` points only here. | GitLab MR !1668 / CR delivery owner. |
| `ad7433f6` | Clean MR !1466 overlay `f3e2b905e2`; current note `294657` points only here. | GitLab MR !1466 / CR delivery owner. |
| `fa42f0a6` | Clean MR !1687 measurement branch `fb852a420f`; current note `297235` points only here and reports the AGS infrastructure gap. | GitLab MR !1687 / CR delivery owner. |
| `3cbbfb34` | Archived-online attempt-lease integration at `b44853c69b`; 9 branch-only commits, 5 carrying this Session trailer, plus a dirty eval sidecar and generated settings. No accepted successor owns all audit fixes yet. | Attempt-lease integrator. Keep offline after P0 until a clean successor proves every unique commit/dirty delta consumed and explicitly acknowledges ownership. |

### SALVAGE-THEN-CLOSE (4)

| Session | Evidence to salvage | Owner and close gate |
| --- | --- | --- |
| `c36135b9` | Clean MR !1659 measurement/evidence branch `53ef448796`; note names unique asset commits `a859599a28`, `1f703fb0a2`, `81ad3c89f4`, `b0eb409419`, followed by overlay/eval commits. Current MR note points to missing `c159b897`, not this row. | CR pipeline maintainer. Preserve the exact commit/evidence lineage in a durable accepted owner and repair/adjudicate MR !1659's broken link before closing. |
| `5d303800` | Clean branch with sole unique commit `53ee34a040` (`docs(cr): plan MR !1689 measurement`). Backend failure happened before report, eval, or note creation, so the branch is the only full plan copy. | CR pipeline maintainer. Copy or intentionally supersede the plan in a named durable owner, obtain acknowledgment, then close. |
| `8ac6114d` | Fake-working/unloaded thread; one unique spec commit `0678799782` plus 10 real dirty spec/code/test files (and generated settings) from the 3cbb transplant. | Attempt-lease integrator. Compare file-by-file against current `adopter-a-spec`, `3cbb`, `49e`, and landed `f96`; commit only unique valid work with correct provenance on a live successor, then close. |
| `27ea681a` | adopter-a branch is fully landed and only generated settings is dirty, but its actual task was the adopter-a-base production rollout. adopter-a-base main contains `6c0003ff`, while PID `30238` on `8088` is unhealthy. | CR review-board rollout operator. Adopt the exact service/runbook task, restore health and prove API/browser current-head behavior, acknowledge handoff, then close. |

### CLOSE-AFTER-P0 (15)

| Session | Explicit closure evidence | Owner |
| --- | --- | --- |
| `e84da90a` | Clean failed MR !1595 overlay `89a5c05748`; local report exists, current GitLab owned note does not. | CR cleanup operator |
| `474edeb4` | Clean MR !1668 overlay/eval `0d4e6111ee`; superseded by current note owner `77a05a55`. | CR cleanup operator |
| `d3d4cd07` | Clean failed MR !1674 overlay `16c498fc1f`; no current owned note. | CR cleanup operator |
| `bfa63de5` | Clean failed MR !1676 overlay `8521e2bcaf`; current note points to `8bbbfba5`, not this row. | CR cleanup operator |
| `5e34233d` | Clean failed MR !1662 overlay `78753d3d55`; current note points to `b7c15095`. | CR cleanup operator |
| `d3f1846e` | Clean failed MR !1674 overlay `e9cce3f560`; no current owned note. | CR cleanup operator |
| `4789d5d4` | Clean failed MR !1662 overlay `256d09a1ae`; current note points to `b7c15095`. | CR cleanup operator |
| `75030f65` | Clean failed MR !1662 overlay `ad4959e71f`; current note points to `b7c15095`. | CR cleanup operator |
| `64b8315a` | Archived/offline no-op isolated-B waiter; branch is an ancestor of main, no unique commit, only generated settings dirt. | CR cleanup operator |
| `6dea8e44` | Archived/offline isolated-B MR !1674 overlay; clean, no current note, no external owner. Content-addressed evidence survives retirement. | CR cleanup operator |
| `cbe35786` | Incomplete `locked initializing` worktree, branch ancestor of main, no unique commit/report. The 12,399 index changes are partial-checkout artifacts, not authored work. | Sessions cleanup operator |
| `a1b37a1d` | Same incomplete-init failure: branch ancestor of main, no unique commit/report; prompt commands never ran. The 16,029 index changes are checkout artifacts. | Sessions cleanup operator |
| `031007d2` | Archive hygiene session itself; branch ancestor of main, clean, no unique commit, task complete. It remains archive-online only because archive did not stop it. | Sessions cleanup operator |
| `0536a237` | Close-pending, clean, branch fully landed in adopter-a; adopter-a-base main now contains its external commit. Its loaded Codex ref must be drained by the exact control-plane owner first. | Sessions cleanup operator |
| `851247bc` | Close-pending, clean, branch fully landed in adopter-a as `04cec48f`; post-merge checks passed. | Sessions cleanup operator |

## Ordered post-P0 execution

1. Deploy archive=>offline P0 and record its exact SpexCode source/install commit. Re-read the store, API rows,
   `/api/instance`, CR guardian status, and `spex session resources --json`; do not act from this snapshot if any
   identity changed.
2. Gate on CR quiescence: guardian `current=null`, `queue=[]`, no active turn, and a fresh successful reviewer
   reconcile. If not, wait. Do not stop the guardian or listener as a shortcut.
3. Clear the shared-runtime blocker through the Codex control-plane owner, not a session verb. Today there are
   four unowned loaded threads, so stop/close must fail closed. Use only the supported exact-generation
   teardown/restart path against PID plus start token; never `pkill`, command matching, port ownership, or a
   guessed ancestor. Re-probe until `unowned-loaded-thread` is absent.
4. Reconcile the four pre-P0 archive-online rows (`3cbbfb34`, `031007d2`, `8ac6114d`, `27ea681a`) through the new
   archive/offline behavior or the explicit exact-owner stop path. Verify each reads offline and preserves its
   worktree/branch before any close.
5. Protect all nine `KEEP` ids in the operator checklist. Repair the four stale-host note links separately;
   link repair must update the existing owned note, never create a second note. Do not close a KEEP row merely
   because the linked MR is old.
6. Execute each salvage lane one at a time. The receiving owner must acknowledge the exact commit/files and
   proof artifacts. Re-run ancestry and dirt checks after acknowledgment; only then move that id into the close
   batch.
7. Stop the two online close-pending rows (`0536a237`, `851247bc`) through the explicit API, then verify offline.
   A failed/unknown probe or a reappearing unowned ref aborts the batch.
8. Close the low-risk landed/no-op rows first: `64b8315a`, `cbe35786`, `a1b37a1d`, `031007d2`, `0536a237`,
   `851247bc`. After every close, verify the exact record/worktree is gone, the shared app-server PID/start token
   is unchanged, and no new unowned reference appeared.
9. Close superseded/no-note CR overlays one at a time:
   `e84da90a`, `474edeb4`, `d3d4cd07`, `bfa63de5`, `5e34233d`, `d3f1846e`, `4789d5d4`, `75030f65`,
   `6dea8e44`. Re-read the relevant GitLab owned note immediately before each close.
10. Close the four salvage rows only after their handoffs satisfy step 6.
11. Leave corrupt `950f0edd` untouched by ordinary cleanup. Its close route is intentionally quarantine-and-fail
    because no exact readable owner exists. Sessions-core must repair or add a governed recovery path; only
    that owner can authorize later cleanup of its store/worktree/branch/thread residue.
12. Finish with a fresh count, `git worktree list --porcelain`, branch containment, all current owned GitLab
    links, the resource report, exact backend/app-server identities, and CR guardian health. Closure is false if
    any KEEP link 404s, any unowned loaded thread remains, the corrupt record is hidden, or a shared PID changed
    without an explicit control-plane event.

All lifecycle mutations in the execution phase must use the explicit project API on the MBP, for example:

```text
/Users/jeffryglm/.local/bin/spex session stop <full-id> --api http://127.0.0.1:8787
/Users/jeffryglm/.local/bin/spex session close <full-id> --api http://127.0.0.1:8787
```

Run them one id at a time and re-read the row and resource report after each command.
