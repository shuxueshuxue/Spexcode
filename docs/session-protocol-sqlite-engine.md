# Session protocol SQLite engine contract

This freezes the M2 implementation details of the `session-protocol` SQLite engine: exact DDL, canonical
byte encodings, connection gates, open-path policy, migration mechanics, and the stable error-code
inventory. It closes the OPEN items that the protocol contract deliberately left to this milestone. It does not
reopen any frozen decision above it, and it does not authorise production
wiring: the protocol package, the adopters, and the legacy deletion all remain later milestones.

Every number, PRAGMA value, and constraint behaviour below was measured. Nothing here is written from
recollection. The executable form is `spikes/sqlite-m2/`, a disposable spike with no adopter, ORM,
daemon, outbox, or file observer; its raw output is in `spikes/sqlite-m2/evidence/`.

Terms keep their protocol meaning: `session`, `message`, `queue`, `producer`, `consumer`, `initialize`,
`enqueue`, `dequeue`, `listPending`, `readMessages`, `retire`.

---

## 1. What is frozen, what is pending, what stays open

| | Item |
|---|---|
| **Frozen** | Driver and journal mode (§3): `node:sqlite`, rollback journal, no WAL. Minimum SQLite version (§2), mandatory PRAGMAs and their order (§4), exact DDL (§5), canonical `payload_hash` preimage (§6), `message_id` authority and format (§6), `session_id` grammar and the flat global address space (§5.2), open-path policy and the storage-locality precondition (§7), migration mechanics (§8), error-code inventory (§9), consumer handler journal contract (§10) |
| **Deferred experiment** | WAL, as an independent upgrade behind SQLite ≥ 3.51.3 (§12). Not part of the v1 contract. |
| **Still open** | §13 |

> **Two eras of evidence.** An earlier revision of this contract specified WAL. The human ruling
> replaced it with a rollback journal, which invalidated every concurrency, throughput, and crash
> number measured under WAL. Those measurements are **kept** — they are what the ruling was decided
> on — but they are historical. Anything labelled *WAL era* below describes the superseded design;
> every v1 figure comes from `spikes/sqlite-m2/evidence/v1-delete/`.

---

## 2. Minimum SQLite version — derived from the features actually used

**`sqlite_version()` must be `3.38.0` or later.** Below it, open fails with
`PROTOCOL_SQLITE_VERSION_UNSUPPORTED`.

This floor is derived from the SQL this schema actually contains, not from a bug. Each feature with
the release that introduced it, quoted from `https://sqlite.org/changes.html`:

| Feature used | Introduced | Changelog wording |
|---|---|---|
| Partial indexes (`CREATE INDEX … WHERE`) | **3.8.0** (2013-08-26) | "Add support for partial indexes" |
| `STRICT` tables | **3.37.0** (2021-11-27) | "STRICT tables provide a prescriptive style of data type management" |
| `json_valid()` / `json_type()` as built-ins | **3.38.0** (2022-02-22) | "The JSON functions are now built-ins. It is no longer necessary to use the -DSQLITE_ENABLE_JSON1 compile-time option" |
| `INDEXED BY` | 3.6.4 (2008-10-15) | pre-dates every other requirement |
| `AUTOINCREMENT`, `CHECK`, `GLOB`, foreign keys, `BEGIN IMMEDIATE` | ≤ 3.6.19 | pre-date every other requirement |

**3.38.0 is the binding constraint**, and it is the JSON one: `STRICT` needs 3.37.0, but relying on
`json_valid` before 3.38.0 would mean relying on how somebody compiled their SQLite. Depending on a
compile-time flag is not a version floor.

`VACUUM INTO` (3.27.0) is named in the backup discussion but is not used by the engine, so it does
not constrain the floor.

### The floor is not the WAL-reset fix

An earlier revision froze `3.51.3`, the release that fixed the WAL-reset corruption bug. **That
reasoning no longer applies: v1 never enters WAL mode**, and the bug "only affects databases in WAL
mode". Keeping a 3.51.3 gate would have been actively wrong — it would reject Node 22's bundled
3.50.4 and break the fleet compatibility the ruling exists to preserve. 3.51.3 survives only as the
precondition for the deferred WAL experiment (§12).

The original WAL-bug source material is retained at
`spikes/sqlite-m2/evidence/sqlite-wal-reset-bug-source.txt`: it is the evidence the ruling was made
on, and it gates §13.

**The gate is a numeric comparison, not a string comparison.** `"3.9.0" > "3.38.0"` lexicographically
while being seven years older; the comparator is component-wise on integers, pinned by a vector.

### Measured: the fleet floor holds

`spikes/sqlite-m2/evidence/v1-delete/node22-fleet-compatibility.txt`:

```
node v22.21.0   sqlite 3.50.4
node --test test/engine.test.mjs test/concurrency.test.mjs
# tests 53   # pass 53   # fail 0
```

The whole suite — including the multi-process and crash vectors — passes on the interpreter the
fleet actually pins. A vector also exercises each feature the floor is derived from, so the floor is
a claim the suite tests rather than a number in prose.

The bundled-version matrix (`evidence/probe-node-matrix.txt`, WAL era but still accurate as a
measurement of the interpreters) records: Node 18.20.8 and 20.20.2 have no `node:sqlite` at all;
22.21.0 bundles 3.50.4; 24.14.0 bundles 3.51.2; 24.15.0 bundles 3.51.3. All of 22.21.0 and later
clear the 3.38.0 floor.

## 3. Driver and journal mode — frozen

**v1 uses `node:sqlite`'s `DatabaseSync`, on the existing Node ≥ 22 fleet, with
`journal_mode=DELETE`. WAL is forbidden.** `.nvmrc`, `engines`, and the fleet's interpreters are
unchanged.

The reasoning is subtractive rather than defensive. The WAL-reset corruption bug is the only thing
that forced a SQLite version floor above what the fleet ships, and it affects WAL mode only. Not
using WAL removes the bug, removes the version pressure, removes the need for a native binding to
pin a newer SQLite, and removes the fleet migration — in exchange for a slower journal mode that
this workload can afford (§4.5). Fewer moving parts, not more.

What that costs is real and is accounted for in §4.5 and §7.3, not waved away.

### The driver is still a replaceable implementation

Freezing a binding does not make the binding the contract. The contract is the schema, the migration
registry, the canonical encoding, the error codes, and the version gate. This is measured, not
asserted: the same single-process vectors pass through a second binding with only the binding
swapped, and the migration SQL hashes identically under both.

```sh
cd spikes/sqlite-m2
node --test test/engine.test.mjs                              # node:sqlite    -> 45/45
npm install --no-save better-sqlite3
M2_DRIVER=better-sqlite3 node --test test/engine.test.mjs      # better-sqlite3 -> parity
```

`better-sqlite3` 13.0.3 bundles SQLite 3.53.4 and loads on Node 22 and 24 from prebuilds for eight
platform triples. It remains the pre-qualified alternate if the floor ever has to rise independently
of the interpreter — for instance to run the §12 WAL experiment on a fleet that cannot reach
3.51.3.

### Frozen regardless of binding: the driver is a process-global commitment

**One process must never link two different SQLite builds against the same database file.** Measured
(`evidence/probe-bs3-semantics.txt`):

- Same process, `node:sqlite` holding `BEGIN IMMEDIATE`: better-sqlite3 **acquired the write lock in
  0 ms**. Single-writer is broken. POSIX advisory locks are per-process, so two builds cannot see
  each other's locks.
- Two processes, same pair of builds, holder confirmed holding before the attempt: better-sqlite3 was
  **correctly refused after 52 ms with `SQLITE_BUSY`**. Across processes they interoperate exactly as
  SQLite promises.
- Data written by either build is read correctly by the other. The hazard is locking, not format.

This finding is independent of both the driver decision and the journal mode, and it survives the
ruling unchanged. An adopter that already depends on a different SQLite binding must not load both in
one process against one database.

### Thin-CLI cost (WAL era, still indicative)

Whole-process cost of one hook invocation, 20 runs each, measured under the WAL design. The startup
baseline and the relative shape carry over; the absolute open cost under DELETE is slightly higher.

| Node | bare startup | `node:sqlite` | `better-sqlite3` |
|---|---|---|---|
| 22.21.0 | 42.5 ms | 65.9 ms (+23.4, +55%) | 78.3 ms (+35.8, +84%) |
| 24.15.0 | 52.6 ms | 61.8 ms (+9.2, +18%) | 79.0 ms (+26.5, +50%) |

Read this before quoting an isolated open cost: in isolation the two bindings differ ~10×, but end
to end the difference is ~17 ms on a ~60 ms invocation. The decisive costs for `better-sqlite3` were
always the 27 MB install footprint and the native ABI dependency, which are an adoption tax on the
external adopters the protocol package exists to serve.

## 4. Connection gates

Every connection runs this sequence and **asserts each result by reading it back**. Setting a PRAGMA
and not checking it is how a database silently ends up in the wrong mode.

| Step | Statement | Required result | On failure |
|---|---|---|---|
| 1 | `PRAGMA busy_timeout=<n>` (default 5000) | read-back equals `n` | `PROTOCOL_PRAGMA_UNSUPPORTED` |
| 2 | `SELECT sqlite_version()` | ≥ `3.38.0` (§2) | `PROTOCOL_SQLITE_VERSION_UNSUPPORTED` |
| 3 | `PRAGMA foreign_keys=ON` | read-back is `1` | `PROTOCOL_PRAGMA_UNSUPPORTED` |
| 4 | `PRAGMA journal_mode` — **read, never set** | exactly `delete` | `PROTOCOL_JOURNAL_MODE_UNSUPPORTED` |
| 5 | `PRAGMA synchronous=FULL` (writable only) | read-back is `2` | `PROTOCOL_PRAGMA_UNSUPPORTED` |

### 4.1 The order is part of the contract

**`busy_timeout` must be the first statement on the connection.** It defaults to `0`, so any
statement issued before it runs with no busy handler at all and loses a contended lock immediately.

This is not theoretical. With the version probe placed first — the obvious ordering, since a version
gate "should" come before anything else — eight processes opening one fresh database concurrently
lost the race in **11 of 20 rounds** (WAL era), with `SQLITE_BUSY` raised by `SELECT
sqlite_version()`, the one statement nobody suspects. The scenario is ordinary on this fleet: several
shell hooks firing at once against a cold database.

#### The gate, and why the first one did not count

That evidence is real, but for two rounds the *gate* on it was not. The decision was pinned only by
`repeated cold opens by eight processes never lose the first-open race`, which is a probabilistic
race: measured across 12 runs, it caught a wrong-ordered engine **8 times out of 12**. Two honest
runs of identical code disagreed about whether the flip was gated, because sometimes it was and
sometimes it was not. **An intermittent catch is not a gate**, and reporting one as gated is how an
ungated hard invariant survived two review rounds.

The replacement holds the lock deterministically instead of racing for it
(`evidence/v1-delete/busy-timeout-gate-stability.txt`):

| | |
|---|---|
| Vector | `busy_timeout must be the connection's first statement, or the version probe has no budget` |
| Lock holder | a second OS process, `PRAGMA locking_mode=EXCLUSIVE`, which retains the file lock after `COMMIT` |
| Hold window | 1500 ms, released by the holder itself — not by a kill — and entered only after it prints its own readiness line |
| Control | open with a **200 ms** budget must fail `PROTOCOL_DATABASE_BUSY`, proving the lock is genuinely held so a later success cannot be a false pass |
| Assertion | open with an **8000 ms** budget must succeed, and must have taken ≥ 40% of the hold, proving it waited rather than slipping past an unlocked database |

Correct order sets `busy_timeout` before the first database-touching statement, so the probe blocks
and then succeeds. Wrong order runs that probe while `busy_timeout` is still its default `0`, so it
is refused immediately and open fails.

The mechanism rests on a measured detail: **setting `busy_timeout` does not itself need the lock**
(`evidence/v1-delete/probe-lock-holder.txt`). If it did, both orderings would fail and the vector
could not separate them at all.

Stability, 20 repeats each: **canonical passes 20/20; the wrong-order stub is caught 20/20, missed
0.**

### 4.2 The journal mode is asserted, never set

**v1 reads `PRAGMA journal_mode` and requires exactly `delete`. It never issues a mode change, and
it never converts a database.**

Three measurements make this the simplest correct rule
(`evidence/v1-delete/probe-delete-mode.txt`):

- A brand-new database already reports `delete` — before any write, after DDL, and on reopen. There
  is nothing to set.
- A database somebody left in WAL reports `wal`, so the assertion catches it. It is **refused**, not
  converted: there is no runtime dual path, and no silent rewrite of somebody else's database.
- **A journal-mode change is not protected by `busy_timeout` in either direction.** Measured:
  `PRAGMA journal_mode=DELETE` under contention was refused after **0 ms with a 1500 ms budget** —
  the same behaviour previously measured for `journal_mode=WAL`. Never issuing a mode change deletes
  that entire hazard class from the open path.

### 4.3 No integrity check on open

`PRAGMA quick_check` is **not** run at open. Measured cost against a plain open
(`evidence/probe-ddl.txt`):

| rows | `quick_check` | plain open |
|---|---|---|
| 1 000 | 0.2 ms | 0.14 ms |
| 10 000 | 2.3 ms | 0.58 ms |
| 100 000 | **27.5 ms** | 0.14 ms |

It scales with database size while open does not, and the thin CLI opens once per hook event. Corruption
surfaces loudly from SQLite itself during normal operation (§9); a full scan is a maintenance operation,
not an open-path cost. This corrects the M1 spike, which ran `quick_check` on every open
(`spikes/sqlite-m1/protocol.mjs:104`).

### 4.4 `PRAGMA data_version`

Available and measured. It lets an adopter's sweep detect "nothing changed since last check" without a
full query. It is **adopter latency policy, not protocol state**, and no correctness path may depend on
it.

---

### 4.5 What a rollback journal costs, measured

WAL gave readers and writers concurrency for free. DELETE does not, and the difference is measured
rather than assumed (`evidence/v1-delete/probe-delete-mode.txt`):

| Behaviour | Result under DELETE |
|---|---|
| Read during an open write transaction | **allowed**, and sees only committed state |
| Write while a read transaction is open | **blocked** — `database is locked` |
| Sidecar files at rest | none |
| Sidecar during a write transaction | `<db>-journal`, removed on commit |
| Sidecar `-wal` / `-shm` | **never created** |

The regression that matters is the second row: **a reader blocks a writer.** The protocol's own reads
are single-statement and therefore brief, but an adopter that holds a long read transaction open will
stall every writer on that database. That is a real constraint on adopter code, not a footnote.

Throughput, same host, same vector, both eras:

| | writes / 10 s | p50 | p99 |
|---|---|---|---|
| WAL (historical) | 3556 | 2.93 ms | 6.14 ms |
| **DELETE (v1)** | **1266** | **7.09 ms** | **14.01 ms** |
| Node 22 / SQLite 3.50.4, DELETE | 1246 | 7.25 ms | 13.74 ms |

Roughly 2.8× slower, as expected from the extra fsyncs. The roadmap's M2 exit bar is 500 short writes
in 10 seconds; **v1 clears it with 2.5× headroom**, on both interpreters. The bar is met by the mode
we actually ship, not by the mode we measured first.

## 5. Exact DDL

This is the final, executable schema — migration version 1, component `session-protocol`. Earlier review material
is superseded where it differs; the differences are justified below.

```sql
CREATE TABLE protocol_sessions (
  session_id     TEXT    NOT NULL PRIMARY KEY,
  created_at_ms  INTEGER NOT NULL,
  retired_at_ms  INTEGER,
  CHECK (length(session_id) BETWEEN 1 AND 256),
  CHECK (session_id NOT GLOB '*[^0-9A-Za-z_-]*'),
  CHECK (session_id NOT GLOB '-*'),
  CHECK (created_at_ms >= 0),
  CHECK (retired_at_ms IS NULL OR retired_at_ms >= 0)
) STRICT;

CREATE TABLE protocol_messages (
  enqueue_seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id         TEXT    NOT NULL UNIQUE,
  target_session_id  TEXT    NOT NULL REFERENCES protocol_sessions(session_id),
  sender_session_id  TEXT,
  protocol_version   INTEGER NOT NULL,
  kind               TEXT    NOT NULL,
  body               BLOB    NOT NULL,
  headers_json       TEXT    NOT NULL,
  idempotency_key    TEXT,
  payload_hash       BLOB    NOT NULL,
  enqueued_at_ms     INTEGER NOT NULL,
  dequeued_at_ms     INTEGER,
  CHECK (message_id GLOB '[0-9a-f]*' AND length(message_id) = 32),
  CHECK (protocol_version >= 1),
  CHECK (length(kind) BETWEEN 1 AND 64),
  CHECK (kind NOT GLOB '*[^0-9A-Za-z._-]*'),
  CHECK (length(body) <= 1048576),
  CHECK (json_valid(headers_json) AND json_type(headers_json) = 'object'),
  CHECK (length(CAST(headers_json AS BLOB)) <= 65536),
  CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 256),
  CHECK (length(payload_hash) = 32),
  CHECK (enqueued_at_ms >= 0),
  CHECK (dequeued_at_ms IS NULL OR dequeued_at_ms >= 0),
  CHECK (sender_session_id IS NULL OR length(sender_session_id) BETWEEN 1 AND 256)
) STRICT;

CREATE UNIQUE INDEX protocol_messages_idempotency
  ON protocol_messages (target_session_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX protocol_messages_pending_fifo
  ON protocol_messages (target_session_id, enqueue_seq)
  WHERE dequeued_at_ms IS NULL;

CREATE INDEX protocol_messages_history
  ON protocol_messages (target_session_id, enqueue_seq);
```

The registry table is created by the migration runner, not by a migration (§8):

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  component      TEXT    NOT NULL,
  version        INTEGER NOT NULL,
  checksum       TEXT    NOT NULL,
  applied_at_ms  INTEGER NOT NULL,
  PRIMARY KEY (component, version)
) STRICT;
```

### 5.1 STRICT is not input validation

Measured, and it is the opposite of what the keyword suggests
(`evidence/probe-ddl.txt`, probe 1):

```
strict.text_column_given_js_number: accepted; stored="7.0" typeof=text
strict.int_column_given_text:       rejected: cannot store TEXT value in INTEGER column t.n
strict.int_column_given_numeric_text: accepted stored=42 typeof=integer
```

Binding the number `7` to a `TEXT NOT NULL` column in a `STRICT` table does not fail. Column affinity
converts it first, and it lands as the string **`"7.0"`** — a mangled, unrecoverable protocol address.
`STRICT` protects the INTEGER direction and not the TEXT direction.

**Therefore every value is type-validated in memory before binding.** The DDL `CHECK` constraints are a
backstop against a second writer touching the tables directly, not the primary gate.

- Counter-example: `stubs/unvalidated-session-id.mjs` (2 edits — replaces `requireSessionId` in
  `engine.mjs:179-190` with a truthiness check, and drops the three `session_id` CHECKs from the DDL).
- Vectors it breaks: `session ids: accepted and rejected character sets`,
  `session ids: a non-string id is rejected in memory, never coerced by SQLite affinity`,
  `the address space is flat and global within one database path`.

Related measured trap: SQLite's `length()` on a `TEXT` value counts **characters**, not bytes
(`length('nä me')` = 5 while the BLOB cast is 6). Every length-limited TEXT column here is restricted to
ASCII, so the two coincide; `headers_json`, whose values are arbitrary UTF-8, is limited via
`length(CAST(headers_json AS BLOB))` so the ceiling is unambiguously bytes.

### 5.2 `session_id` — a flat, global address space

**A protocol address is one opaque `session_id`, globally unique within one `databasePath`.** The primary
key is a single column. The protocol has no project dimension and does not accept a
`(project_id, session_id)` composite; `project_id` is adopter metadata that never enters protocol
identity. An adopter sharing one database across projects **must guarantee whole-database uniqueness
itself**, by encoding its namespace into the id or by using globally opaque ids. A human-friendly short
id is an adopter-maintained project-local alias, not a protocol concept.

This is stated positively here because the architecture's §7 ("all backends under one state root share
one database, distinguishing projects by `project_id`") and the refactor's §6 adopter example (an
extension table carrying `project_id`) together invite the wrong reading. Two projects reusing one id in
one database share one inbox, silently. A vector pins the behaviour rather than leaving it to prose.

Grammar, frozen:

```
session_id := [0-9A-Za-z_] [0-9A-Za-z_-]*        length 1..256 (ASCII, so characters == bytes)
```

- **No `/`, `\`, or NUL** — path traversal and separator injection are structurally impossible.
- **No `.` at all** — `.` and `..` and hidden-file names cannot be expressed, so no rule about them is
  needed.
- **No leading `-`** — the frozen adoption story has shell hooks calling a thin CLI with the id as
  `argv`, where a leading dash is parsed as a flag by essentially every argument parser.
- **256, not 128 or 255** — sized against real namespacing, not guessed.

**Named collision for the SpexCode adopter.** `packages/spec-core/src/project-store.ts:11`'s
`encodeProject()` replaces `/` and `.` with `-`. Because every project root is an absolute path, **every
encoded namespace begins with `-`** and is therefore rejected by the leading-dash rule. Measured over
four real fleet roots:

| project root | encoded | leading `-` | with `__<uuid>` |
|---|---|---|---|
| `/home/jeffry/spexcode` | 21 chars | yes | 59 |
| `/home/jeffry/spexcode/.worktrees/session-protocol-de57` | 54 | yes | 92 |
| `/Users/lexicalmathical/Codebase/gugu-bloome-acp` | 47 | yes | 85 |
| `/home/jeffry/rocket-delta-workspace` | 35 | yes | 73 |

A SpexCode adopter that namespaces ids must prefix the encoded value (`p` + encoded, giving 93 characters
for the deepest case). 256 leaves real headroom for a deeper worktree path; 128 would not have. This is
called out by name so it is not discovered during the M6 cutover.

### 5.3 Retirement tombstone

`retired_at_ms IS NULL` means active; non-`NULL` means retired and is the tombstone. **One field, one
fact.** The M1 spike carried both a `state` enum and a `retired_at` column
(`spikes/sqlite-m1/protocol.mjs:14` and `:16`), which is two encodings of one truth and can disagree.

No `CHECK (retired_at_ms >= created_at_ms)` — the draft had one, and it is a hazard rather than a
safeguard. Wall-clock time is not monotonic; an NTP step backwards would make `retire` fail with a
constraint violation on a perfectly valid address. Ordering authority is `enqueue_seq`, never a
timestamp. The same reasoning removes `dequeued_at_ms >= enqueued_at_ms`. Both keep only `>= 0`.

### 5.4 Idempotency index — why partial, not the inline `UNIQUE`

The draft's inline `UNIQUE (target_session_id, idempotency_key)` is not wrong, but it does not say what it
means. Measured (`evidence/probe-ddl.txt`, `unique_null_coexists`):

```
nullRowsAccepted=3 duplicateNonNullRejected=true
```

Three rows with a `NULL` key coexist under that constraint, because NULLs are not equal to each other in
SQL. That is the behaviour the protocol wants — unkeyed messages are unlimited — but stating it as a
partial unique index with `WHERE idempotency_key IS NOT NULL` makes the intent explicit and stops the
index from carrying every non-idempotent row for nothing.

### 5.5 `enqueue_seq` scope

One global `AUTOINCREMENT` rowid across the whole table, not a per-session counter.
`readMessages(sessionId, afterSequence)` filters `target_session_id = ? AND enqueue_seq > ?`, so
per-session order is a subsequence of a globally monotonic sequence and is therefore total and stable.
The cursor value is opaque and only meaningful within one session; values are sparse across sessions.

`AUTOINCREMENT` (rather than a bare `INTEGER PRIMARY KEY`) is required so a deleted row's sequence is
never reused. Measured: inserting, deleting sequence 2, then inserting again yields `1,3`.

**Why per-session ordering is safe at all** is `BEGIN IMMEDIATE`, and this is the reason it is mandatory
rather than stylistic. SQLite admits one writer at a time, so with every write transaction taking its
reservation up front, sequence assignment order equals commit order — a cursor can never step past a
sequence that has not committed yet. Measured across processes: six writer processes committing 120
messages each while a seventh advanced a cursor concurrently observed all 720 messages, each exactly
once, with no duplicates (`test/concurrency.test.mjs`, `a cursor following concurrent writers never skips
a committed message`).

### 5.6 Indexes, each with its proof

Three indexes, plus the implicit one behind `message_id UNIQUE` (a backstop against a broken CSPRNG).

Measured at realistic shape — 200 sessions × 500 messages = 100 000 rows, 3 pending per session
(`evidence/probe-index.txt`, `node probe-index.mjs`):

| configuration | dequeue head | `readMessages` |
|---|---|---|
| pending index only | **0.0064 ms** | 11.13 ms (rowid scan across all sessions) |
| + history index, no `ANALYZE` | **0.0448 ms** ← 7× worse | 0.79 ms |
| + history index, after `ANALYZE` | 0.0062 ms | 0.76 ms |
| + history index, `INDEXED BY` pins, no `ANALYZE` | **0.0064 ms** | 0.87 ms |

Measured under DELETE (`evidence/v1-delete/probe-index.txt`). The conclusion is unchanged from the
WAL-era run, which is itself worth knowing: index selection is a planner question, not a journal-mode
question.

The history index earns its place: without it, history reads cost 11.6 ms and grow with the *whole
table*, not with the session. But adding it **degrades the hottest protocol operation tenfold** unless
`ANALYZE` statistics happen to exist — the planner switches the pending-head query to the full index.

**Therefore the hot statements pin their index with `INDEXED BY`.** This is contract, not tuning: the
protocol's bounded-lock-hold claim should be a property of the schema, not a property of whether somebody
remembered to run `ANALYZE`. It also fails loudly if an index is ever dropped, and it removes `ANALYZE`
freshness from the correctness story entirely.

```sql
SELECT ... FROM protocol_messages INDEXED BY protocol_messages_pending_fifo
 WHERE target_session_id=? AND dequeued_at_ms IS NULL ORDER BY enqueue_seq LIMIT 1;
SELECT ... FROM protocol_messages INDEXED BY protocol_messages_history
 WHERE target_session_id=? AND enqueue_seq>? ORDER BY enqueue_seq;
SELECT ... FROM protocol_messages INDEXED BY protocol_messages_idempotency
 WHERE target_session_id=? AND idempotency_key=?;
```

A vector asserts the actual `EXPLAIN QUERY PLAN` output names each index and shows no `TEMP B-TREE`.

- Counter-example: `stubs/unpinned-indexes.mjs` (3 edits, removing the `INDEXED BY` clauses).
- Vector it breaks: `every declared index is the one the planner actually uses`.

### 5.7 Facts that stay out of this schema

Unchanged from the refactor draft §3.4: parent/child/watch/subscription, lifecycle/proposal/worktree/
branch, native thread and PID and socket, reader position, artifacts. Adopter tables may live in the same
database and may be mutated in the same transaction (§10), but they never extend a protocol row.

---

## 6. Message identity and canonical bytes

### 6.1 `message_id` is generated by the protocol

**Format: 32 lowercase hex characters — 16 bytes from a CSPRNG.** A producer-supplied `messageId` is
rejected with `PROTOCOL_MESSAGE_INVALID`.

Not a UUID and not a ULID: ordering is `enqueue_seq`'s job, so the id needs only uniqueness, and neither
version/variant semantics nor time-sortability would be used.

The M1 spike required the producer to mint it *and folded it into the immutable hash*
(`spikes/sqlite-m1/protocol.mjs:69`). That combination breaks honest retry: a producer that crashes
mid-`enqueue` and retries naturally mints a fresh id, the hash differs, and the replay is rejected as
`IDEMPOTENCY_CONFLICT` even though the message is semantically identical. It also creates a second
idempotency mechanism (a unique constraint) alongside `idempotencyKey`, with different semantics and its
own error code and race — two authorities for one concern, which is the pattern this refactor exists to
remove.

- Counter-example: `stubs/producer-minted-message-id.mjs` (3 edits, restoring the M1 design).
- Vectors it breaks: `message_id is protocol-generated; a producer-supplied one is refused`,
  `an honest retry must not be punished for minting a fresh message id`,
  `exact idempotent replay returns the first row; changed bytes conflict`,
  `payload_hash preimage is reproducible from the written specification alone`,
  `header order on input never changes the hash; header keys are ASCII-only`.

### 6.2 `payload_hash` — algorithm and canonical preimage

**`payload_hash = SHA-256(preimage)`, stored as 32 raw bytes in a `BLOB` column.**

The preimage is length-prefixed binary framing, **not JSON**. JSON forces every implementation to agree
on escaping, key ordering, and Unicode normalisation; length-prefixed framing is trivially reproducible
in any language. All integers are unsigned big-endian.

```
field(s)      := u32be(byteLength(utf8(s))) || utf8(s)
optField(s)   := 0x00                        if absent
               | 0x01 || field(s)            otherwise

preimage :=
    u32be(protocol_version)
 || field(target_session_id)
 || optField(sender_session_id)
 || field(kind)
 || u32be(header_count)
 || for each header, ascending by UTF-8 byte sequence of the key:
        field(key) || field(value)
 || u64be(byteLength(body)) || body
```

Deliberately **excluded** from the preimage:

- `message_id` — §6.1; including it breaks retry.
- `idempotency_key` — it is the lookup key, constant across the only comparison performed; including it
  would be a no-op field.
- `enqueued_at_ms`, `dequeued_at_ms`, `enqueue_seq` — assigned by the protocol, not producer-supplied
  immutable content.

**Header ordering is defined on UTF-8 bytes, not on the host language's default string order.** Measured
(`evidence/probe-ddl.txt`, probe 5): JavaScript's default `Array.prototype.sort()` compares UTF-16 code
units and **diverges** from UTF-8 byte order — `U+10000` sorts before `U+FF3A` in UTF-16 and after it in
UTF-8. Header keys are additionally restricted to `[0-9A-Za-z._-]`, which removes the divergence
entirely; the rule is still written in byte terms so a future widening cannot silently change every hash.

A vector builds the expected preimage by hand from the rules above, independently of the implementation's
encoder, and asserts both constructions agree — two independent readings of the same specification.

### 6.3 Body and headers

- **`body` is opaque bytes.** A string is rejected. Accepting one would make the protocol choose an
  encoding on the producer's behalf — a hidden authority, and a cross-language divergence over lone
  surrogates. Ceiling 1 MiB.
  - Counter-example: `stubs/string-body-accepted.mjs` (1 edit); vector:
    `body must be explicit bytes; a string is not an encoding the protocol guesses`.
- **`headers`** — at most 64 entries; keys `[0-9A-Za-z._-]{1,64}`; values UTF-8 strings ≤ 4096 bytes;
  serialised form ≤ 65536 bytes. Stored key-sorted so the row is byte-reproducible.
- **`kind`** — `[0-9A-Za-z._-]{1,64}`.

Ceilings exist so a write transaction's work is bounded, which is what makes the lock-hold claim
meaningful. Every ceiling is enforced in memory before the transaction opens.

---

## 7. Open-path policy

`openProtocol(databasePath, options)` accepts an explicit absolute path and consults nothing else — no
`cwd`, no `.spexcode`, no environment, no product config.

| Rule | Behaviour |
|---|---|
| Must be a non-empty absolute string | else `PROTOCOL_PATH_NOT_ABSOLUTE` |
| A relative path is rejected **without resolving it** | `path.resolve` is never called, so `cwd` is never read |
| A `file:` prefix is rejected | it would become a URI if URI mode were ever enabled; URI mode is never enabled |
| No NUL byte; no trailing separator | else `PROTOCOL_PATH_INVALID` |
| Spaces are ordinary | macOS state roots contain them |
| **No canonicalisation; `realpath` is not called** | see below |
| **The parent directory must already exist** | else `PROTOCOL_PATH_PARENT_MISSING` |
| The database file itself is created if absent | that is SQLite's job and is expected |
| `-wal` / `-shm` belong to SQLite | never created, deleted, copied, or inspected |
| Read-only open is supported | writes fail with `PROTOCOL_DATABASE_READONLY` |
| **Storage locality is the caller's precondition** | protocol core does not probe the filesystem — §7.3 |

### 7.1 No `realpath`

Canonicalisation buys nothing here: **SQLite keys its locks on the inode, not the path.** Measured — a
writer opening a symlink and a writer opening the real path observe one committed state in both
directions (`evidence/probe-ddl.txt`, probe 4; and a vector). Canonicalising would also require the file
to exist, which is a chicken-and-egg problem on create. Whether two paths are one namespace is the
adopter's decision, and the kernel already resolves it correctly.

### 7.2 The parent directory is not created

The protocol creates the database file, never a directory tree. This is the spec's own principle applied
to paths: *"Enqueue never silently initializes an unknown target, so a misspelled id cannot create a
plausible inbox."* A misspelled **directory** must likewise not create a plausible database. The M1 spike
did `mkdirSync(dirname(databasePath), { recursive: true })` (`spikes/sqlite-m1/protocol.mjs:98`), which
turns a typo into a working-looking empty protocol at the wrong location.

- Counter-example: `stubs/recursive-parent-mkdir.mjs` (2 edits, restoring the M1 behaviour).
- Vector it breaks: `open path: a missing parent directory fails loudly and creates nothing`.

### 7.3 Storage locality is an explicit precondition, established upstream

**`databasePath` must be on a local filesystem with reliable advisory locking. The adopter's path
resolver establishes that before calling `openProtocol`, and fails closed when it cannot.** Protocol
core does not probe the filesystem: it neither makes that determination nor pretends to.

This is a safety regression the ruling introduced knowingly, and it must be read as one rather than
buried:

- **WAL used to fail loud on a network filesystem for free.** From `https://sqlite.org/wal.html`:
  "All processes using a database must be on the same host computer; WAL does not work over a network
  filesystem", because "WAL requires all processes to share a small amount of memory". A database on
  NFS simply could not enter WAL mode, so the journal-mode assertion doubled as a portable locality
  probe.
- **A rollback journal has no such property.** DELETE works over a network filesystem without
  complaint, while POSIX advisory locking there is unreliable. The failure mode therefore changes
  from *loud refusal* to *silent corruption under concurrency*.

**Nothing in this document may be read as evidence that DELETE makes network filesystems safe. The
opposite is true**, and that is precisely why the guarantee has to be made explicitly, upstream, and
fail-closed.

#### What the adopter resolver must do

1. Determine the filesystem hosting the database's parent directory.
2. Proceed **only** on a positively identified local filesystem.
3. **Refuse** on a network filesystem, on an unidentified filesystem, on a platform with no usable
   detector, and when the probe itself fails. Refusal is the default; optimistic acceptance is not an
   option.

`spikes/sqlite-m2/adopter-path-resolver.mjs` is a reference implementation of that shape, not a
protocol asset. It uses an **allow-list**, which is what makes it fail closed: an unrecognised
filesystem is refused rather than admitted. FUSE (`0x65735546`) lands in the undetermined bucket on
purpose — its magic identifies the driver, not whether the backing store is local, so `sshfs` and a
local overlay are indistinguishable by identity. Its distinct refusal codes are
`LOCALITY_NETWORK_FILESYSTEM`, `LOCALITY_UNDETERMINED`, `LOCALITY_DETECTOR_UNAVAILABLE`, and
`LOCALITY_PROBE_FAILED`.

#### What is measured, and what is not

Measured: the mechanism end to end on this host — `fs.statfsSync()` reports `type: 61267`, which is
`0xEF53 = EXT4_SUPER_MAGIC` in `/usr/include/linux/magic.h`
(`evidence/filesystem-magic-source.txt`); the classifier's local, network, and undetermined verdicts;
and that a probe which cannot answer refuses.

**Not measured, and not claimed:** the network filesystem magic numbers are transcribed from the
kernel header and have **never been executed against a real network mount**, because no such mount
exists on this host. macOS and Windows report `statfs` types with different, unregistered meanings,
so there is **no detector for them at all** — and per the rule above, a missing detector means
refusal, never admission. Both gaps are OPEN (§13).

## 8. Migration mechanics

- **Component-scoped.** This protocol owns component `session-protocol`. Adopters use their own component
  names in the same `schema_migrations` table and never collide (pinned by a vector). No global
  `PRAGMA user_version`.
- **Forward-only**, integer versions from 1, contiguous.
- **Checksum: SHA-256 over the exact UTF-8 bytes of that one migration's SQL text, as lowercase hex.**
  Not over the concatenation of all migrations. The M1 spike hashed the whole schema blob
  (`spikes/sqlite-m1/protocol.mjs:35`), so appending migration 2 would change migration 1's stored
  checksum and report false drift on every existing database.
  - Counter-example: `stubs/whole-schema-checksum.mjs` (1 edit); vector:
    `each migration checksums only its own bytes`.
- **All pending migrations for a component apply in one `BEGIN IMMEDIATE` transaction**, with their
  `schema_migrations` rows inserted in the same transaction. SQLite DDL is transactional, so a
  partially-migrated database is a state nobody has to reason about.
- **Verification at open**, before any protocol read or write: a stored checksum that does not match the
  known migration is `PROTOCOL_SCHEMA_CHECKSUM_MISMATCH`; an applied version above the highest known one,
  or a gap in the sequence, is `PROTOCOL_SCHEMA_GENERATION_UNSUPPORTED`.
- **Registry/schema disagreement is its own condition.** Protocol tables present while
  `schema_migrations` accounts for none of them is `PROTOCOL_SCHEMA_REGISTRY_INCONSISTENT`. Replaying DDL
  over live tables, or half-migrating, would both be worse than refusing.
- **Read-only handles never migrate.** An unmigrated database opened read-only is
  `PROTOCOL_SCHEMA_GENERATION_UNSUPPORTED`, not an empty protocol.

### 8.1 The two-process first-open race

**The existence check and the migration application happen inside the same `BEGIN IMMEDIATE`
transaction.** The naive shape — check outside, create inside — has the loser of the race re-running DDL
and failing with `table already exists`. Inside one transaction the loser re-reads and finds the work
committed.

Measured: eight processes released against a shared wall-clock barrier onto one fresh database, repeated
10 rounds per vector run, plus 25 standalone rounds — **zero failures, exactly one
`schema_migrations` row** (`test/concurrency.test.mjs`,
`eight processes opening one fresh database migrate it exactly once` and
`repeated cold opens by eight processes never lose the first-open race`). Before the §4.1 PRAGMA-ordering
fix the same race failed in 11 of 20 rounds.

---

## 9. Stable error codes

Machine-readable, stable across implementations. An implementation may name its classes differently but
must carry these code strings.

| Code | Condition |
|---|---|
| `PROTOCOL_PATH_NOT_ABSOLUTE` | not a non-empty absolute path string; `file:` prefix |
| `PROTOCOL_PATH_INVALID` | NUL byte, trailing separator |
| `PROTOCOL_PATH_PARENT_MISSING` | parent directory absent or not a directory |
| `PROTOCOL_SQLITE_VERSION_UNSUPPORTED` | `sqlite_version()` below §2 |
| `PROTOCOL_JOURNAL_MODE_UNSUPPORTED` | `journal_mode` is not `delete` — including a database left in WAL |
| `PROTOCOL_PRAGMA_UNSUPPORTED` | a mandatory PRAGMA did not read back its required value |
| `PROTOCOL_SCHEMA_CHECKSUM_MISMATCH` | an applied migration was rewritten |
| `PROTOCOL_SCHEMA_GENERATION_UNSUPPORTED` | future generation, gap, or unmigrated read-only database |
| `PROTOCOL_SCHEMA_REGISTRY_INCONSISTENT` | protocol tables the registry does not account for |
| `PROTOCOL_SESSION_ID_INVALID` | id fails §5.2 |
| `PROTOCOL_SESSION_UNKNOWN` | no such address |
| `PROTOCOL_SESSION_RETIRED` | address retired |
| `PROTOCOL_RETIRE_NON_EMPTY` | retire attempted with pending messages |
| `PROTOCOL_IDEMPOTENCY_CONFLICT` | key reused with different message bytes |
| `PROTOCOL_MESSAGE_INVALID` | envelope fails §6 |
| `PROTOCOL_CURSOR_INVALID` | `afterSequence` not a non-negative integer |
| `PROTOCOL_TRANSACTION_INVALID` | transaction body is async or returns a promise |
| `PROTOCOL_DATABASE_BUSY` | write contention exhausted the busy budget |
| `PROTOCOL_DATABASE_READONLY` | write on a read-only handle or file |
| `PROTOCOL_DATABASE_UNAVAILABLE` | `SQLITE_CANTOPEN` — permissions, or the file cannot be opened |
| `PROTOCOL_DATABASE_CORRUPT` | `SQLITE_CORRUPT` / `SQLITE_NOTADB` |
| `PROTOCOL_SQLITE_ERROR` | an unclassified SQLite failure, never swallowed |

Storage locality has **no protocol-core code**, by design (§7.3). The adopter resolver raises its own
`LOCALITY_*` refusals before `openProtocol` is ever called.

### 9.1 What may never be degraded

**None of these may be reported as `null`, an empty list, an implicit initialize, or a silent retry with
changed bytes.** Specifically:

- `PROTOCOL_DATABASE_CORRUPT` must never surface as an empty queue. A vector corrupts a real database and
  asserts that `listPending` raises rather than answering `[]`.
- `PROTOCOL_DATABASE_BUSY` must never surface as an empty queue. Readers are not blocked in WAL mode, so
  a busy writer and an empty queue are genuinely different states and a vector asserts both.
- `PROTOCOL_SESSION_UNKNOWN` and `PROTOCOL_SESSION_RETIRED` must never surface as `null` or as an
  implicit initialize.
- `PROTOCOL_IDEMPOTENCY_CONFLICT` must never be resolved by writing the new bytes.
- `PROTOCOL_SCHEMA_*` must fail before any protocol read or write.

**`dequeue` returns `null` for exactly one condition: an empty queue on a known, active address.** Nothing
else in the protocol returns `null`.

Reads are the deliberate exception to retirement being terminal: `listPending` and `readMessages` succeed
on a retired address, because the contract requires the tombstone and history to stay auditable.
`listPending` then returns `[]` because `retire` *required* an empty queue — a measured fact, not a
short-circuit. The M1 spike returned `[]` for a retired session without querying
(`spikes/sqlite-m1/protocol.mjs:180`), which would also mask a genuine bug.

---

## 10. Consumer handler journal — contract only

`dequeue`'s commit is the protocol's at-most-once delivery boundary. A consumer needing a stronger
downstream guarantee owns a handler journal. This defines its contract; it is not implemented here.

- **Owned by the consumer, in adopter tables.** It is not in the protocol schema, the protocol never
  reads or writes it, and no protocol lock protects it.
- **Keyed by `messageId`** — the protocol-generated id returned by `dequeue` (§6.1).
- **Minimum shape:** `(message_id PRIMARY KEY, state, attempt_count, updated_at_ms)` plus adopter fields.
  State transitions are entirely adopter policy.
- **The protocol offers no post-dequeue hook.** Nothing runs inside the protocol's write transaction on
  the consumer's behalf, because a transaction body may contain only SQL and pure in-memory validation.
- **It never becomes an adapter-aware acknowledgment state on the queue**, and it is not an outbox: it
  records handling, never pending delivery.

### 10.1 Settled: the seam does not admit `dequeue`

**M3 ruling.** v1 does **not** require the journal row and the `dequeue` to share a transaction, and the
handler journal is **not** part of the session protocol. The same-database atomic seam covers exactly
*topology mutation + required enqueue*; `dequeue` stays outside it and remains the at-most-once protocol
delivery boundary.

The consequence is stated rather than softened: an adapter needing downstream retry keeps its own
`messageId`-keyed journal — it may live in the same adopter database — but that journal is adopter
property, and **no adopter may describe it as protocol-level at-least-once**. Its crash and retry
semantics are the adopter's to prove, not the protocol's to guarantee. A crash between the dequeue commit
and the journal write loses the record that handling was owed; that is an accepted, named cost of v1, not
an oversight.

This is enforced by a vector rather than left to prose: *a handler that dies after dequeue never makes the
message reappear* (`test/concurrency.test.mjs`) SIGKILLs a consumer after its dequeue commits and before
any downstream effect, then asserts `listPending` is empty, the next `dequeue` returns `null`, and history
still records the message as dequeued. The `at-least-once-redelivery` stub — whose `dequeue` skips the
state transition — makes that vector fire, so the guarantee's absence is measured, not assumed.

The spike's transaction seam exposes `exec` and `enqueue` only, matching the frozen wording.

### 10.2 Transaction body purity is enforced, not documented

An `async` callback, or one returning a promise, is rejected with `PROTOCOL_TRANSACTION_INVALID` before
any write. Awaiting inside a write lock is the single failure mode that would invalidate every bounded
lock-hold claim in this document, so it is a runtime check rather than a review convention. A vector
asserts both forms are refused and that no state changed.

Measured lock-hold behaviour under v1's rollback journal (`test/concurrency.test.mjs`): **1266
enqueues in 10.00 s, p50 7.09 ms, p99 14.01 ms** with `synchronous=FULL`, and **1246 on Node 22 /
SQLite 3.50.4** — past the roadmap's M2 exit bar of 500 short writes in 10 s with 2.5× headroom, with
a bounded tail. (The WAL-era figure was 3611 at p99 6.99 ms; see §4.5 for the comparison.)

---

## 11. Crash and recovery under a rollback journal

WAL's crash story does not transfer, so it is re-measured
(`evidence/v1-delete/probe-journal-recovery.txt`, and two standing vectors).

- **SIGKILL before commit**: the staged enqueue is never visible to any later reader, read-only or
  writable. The killed process leaves a `<db>-journal` behind; that file *is* the recovery record.
- **SIGKILL after commit**: the message survives, is dequeued exactly once, and never requeues.
- **When the hot journal is consumed**: measured step by step — an open does not consume it, and
  neither does a read; **the first write does.** Every read in between returns correct, rolled-back
  state.

The operational consequence is worth stating plainly, because the opposite assumption is natural: **a
lingering `<db>-journal` is not an error, not corruption, and not pending danger.** Correctness is
already restored for readers; the file is cleaned up by the next write. Nothing may treat it as data,
and no adopter may delete it manually — it belongs to SQLite exactly as `-wal`/`-shm` did.

---

## 12. Deferred: WAL as an independent experiment

WAL is **not part of the v1 contract** and must not be enabled by configuration, environment, or a
runtime branch. It is a separate future upgrade with its own preconditions:

1. `sqlite_version()` ≥ **3.51.3** on every process that will touch the database — the release that
   fixed the WAL-reset corruption bug, whose trigger condition ("two or more database connections
   open on the same file, in separate threads or processes, and … attempt to write or checkpoint at
   the same instant") is exactly this protocol's deployment shape. Source material retained at
   `evidence/sqlite-wal-reset-bug-source.txt`.
2. A locality guarantee at least as strong as §7.3's. WAL would restore the automatic network-
   filesystem refusal, but the explicit precondition should stay regardless.
3. A migration story for existing DELETE-mode databases, since v1 refuses rather than converts.

What WAL would buy is visible in §4.5: roughly 2.8× write throughput and, more importantly, readers
that no longer block writers. What it costs is a fleet-wide SQLite floor the current interpreters do
not all meet. That trade is a separate decision with its own evidence, not a flag on this one.

---

## 13. Still OPEN

Named, with what is missing. None may be treated as an implementation requirement.

| Item | What is missing |
|---|---|
| **Network-FS locality verified against a real mount** (§7.3) | The magic numbers are transcribed from `/usr/include/linux/magic.h` and have never been executed against a real NFS/SMB mount; this host has none. The mechanism and the local (ext4) verdict are measured; the network verdicts are not. |
| **A locality detector for macOS and Windows** (§7.3) | `fs.statfs` reports types with different, unregistered meanings there. Until a detector exists, those platforms must be refused — which is the fail-closed default, not a silent gap. |
| **Reader-blocks-writer under real adopter load** (§4.5) | Measured as a property; not measured against a realistic adopter that holds read transactions across a dashboard query or a long history read. |
| **Sweep cadence** | An adopter runtime concern. `PRAGMA data_version` is available as a cheap change detector; nothing else is measured. |
| **Retention and purge** | Explicit maintenance policy, never in a hot transaction. History growth and `VACUUM` cost over a real lifetime are unmeasured. |
| **Backup operational policy** | `VACUUM INTO` and the binding's backup API both work (measured). Cadence, retention, restore drill, and whether Litestream is warranted are unmeasured. A rollback journal makes a plain file copy safer than WAL did, but that is not a measured claim here. |
| **`ANALYZE` / `PRAGMA optimize` maintenance** | The `INDEXED BY` pins remove it from correctness. Whether it is still worth running for other queries is unmeasured. |
| **Same-DB seam and `dequeue`** (§10.1) | An M3 decision. |
| **WAL experiment** (§12) | Deferred by ruling; its preconditions are stated but none are met or measured. |
| **Rust second implementation** | §5–§9 are the portable contract, but no second implementation exists to prove it. |

## 14. Reproducing everything

```sh
cd spikes/sqlite-m2

node --test test/engine.test.mjs test/concurrency.test.mjs   # v1 vectors, incl. crash + multi-process
node stubs/build.mjs && node stubs/run.mjs                   # every frozen decision has a counter-example (10/10 gated)
node --test --test-name-pattern 'busy_timeout must be' test/concurrency.test.mjs   # the ordering gate alone
node probe-delete-mode.mjs                                   # journal mode, concurrency, sidecar files
node probe-journal-recovery.mjs                              # when the hot journal is consumed
node probe-index.mjs                                         # index plans and timings at 100k rows
node probe-ddl.mjs                                           # STRICT, GLOB, symlink, plans, costs
node probe-driver.mjs                                        # driver/feature matrix for this interpreter

# the fleet floor the ruling depends on
~/.nvm/versions/node/v22.21.0/bin/node --test test/engine.test.mjs test/concurrency.test.mjs

npm install --no-save better-sqlite3                         # for the parity and semantics runs
M2_DRIVER=better-sqlite3 node --test test/engine.test.mjs
node probe-bs3-semantics.mjs                                 # two SQLite builds, one process vs two
```

Evidence layout:

- `evidence/v1-delete/` — every figure this contract states as current. Two files there are a
  matched pair: `counterexamples.txt` is the superseded `9/9` record whose gate turned out to be a
  race, and `counterexamples-gated.txt` is the current `10/10` one. Both are kept.
- `evidence/` (top level) — WAL-era measurements, kept verbatim as the record the ruling was made on.
- `fail-first.log`, `fail-first-note.md` — the original first failure and an honest account of what
  each log does and does not prove.
