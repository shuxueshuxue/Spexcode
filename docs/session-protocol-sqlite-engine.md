# Session protocol SQLite engine contract

This freezes the M2 implementation details of the `session-protocol` SQLite engine: exact DDL, canonical
byte encodings, connection gates, open-path policy, migration mechanics, and the stable error-code
inventory. It closes the OPEN items that `docs/session-architecture-concept-map.md` deliberately left to
this milestone. It does not reopen any frozen decision above it, and it does not authorise production
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
| **Frozen** | Minimum SQLite version (§2), mandatory PRAGMAs and their order (§4), exact DDL (§5), canonical `payload_hash` preimage (§6), `message_id` authority and format (§6), `session_id` grammar and the flat global address space (§5.2), open-path policy (§7), migration mechanics (§8), error-code inventory (§9), consumer handler journal contract (§10) |
| **Pending human decision** | Which driver ships in v1 (§3). The *requirement* is frozen; the *binding* is not, because it moves the fleet's Node floor. |
| **Still open** | §11 |

---

## 2. Minimum SQLite version — frozen invariant

**`sqlite_version()` must be `3.51.3` or later. A lower version is refused at open with
`PROTOCOL_SQLITE_VERSION_UNSUPPORTED`; the protocol does not start.**

The architecture requires "at least a SQLite version that has fixed the WAL-reset race" and warns against
relying on a broad Node engine range. That requirement resolves to an exact number, from the primary
source (`spikes/sqlite-m2/evidence/sqlite-wal-reset-bug-source.txt`, retrieved from
`https://sqlite.org/wal.html#walresetbug`):

> The bug is likely present in all version of SQLite from 3.7.0 (2010-07-21) through 3.51.2 (2026-01-09).
> It is fixed in version 3.51.3 (2026-03-13) and later.
>
> The bug only affects databases in WAL mode when there are two or more database connections open on the
> same file, in separate threads or processes, and when those two connections attempt to write or
> checkpoint at the same instant.

The trigger condition is not a hypothetical for this protocol — it *is* the deployment model: CLI, shell
hook, backend, and adopter runtime each open the same file and write concurrently. The consequence is
silent database corruption, in the one authority that replaces every lock and journal the refactor
deletes. SQLite rates the occurrence as low and "not an emergency", which is why this is a startup gate
rather than a recall, but it is not negotiable downward.

**The gate is a numeric comparison, not a string comparison.** `"3.9.0" > "3.51.3"` lexicographically
while being sixteen years older; the comparator is component-wise on integers and is pinned by a vector.

Backports of the fix exist as Fossil check-ins for the 3.44 and 3.50 lines (`3.44.6`, `3.50.7`), linked
from the same page. Neither appears in the release history and no shipping binding produces them, so the
gate does not special-case them. An operator running such a build will be refused with an exact message
naming the required version; that is the intended outcome, not a bug to work around.

### Measured bundled versions

`spikes/sqlite-m2/evidence/probe-node-matrix.txt`, five interpreters, `node probe-driver.mjs`:

| Node | `node:sqlite` | bundled SQLite | passes the gate |
|---|---|---|---|
| 18.20.8 | absent (`--experimental-sqlite` is `bad option`) | — | n/a |
| 20.20.2 | absent (`ERR_UNKNOWN_BUILTIN_MODULE`) | — | n/a |
| 22.21.0 | present, `ExperimentalWarning` | 3.50.4 | **no** |
| 24.14.0 | present, `ExperimentalWarning` | 3.51.2 | **no** |
| 24.15.0 | present, no warning | 3.51.3 | **yes** |
| better-sqlite3 13.0.3 (on Node 22 and 24) | n/a | 3.53.4 | **yes** |

Node 24.15.0's `sqlite_source_id()` is
`2026-03-13 10:38:09 737ae4a34738ffa0c3ff7f9bb18df914dd1cad163f28fd6b6e114a344fe6d618`, byte-identical to
the 3.51.3 source id in the SQLite changelog — the bundled build is exactly the release that carries the
fix, not merely a version string that looks new enough.

**This collides with the repository as it stands.** Root `package.json` and
`packages/session-core/package.json` both declare `"node": ">=22"`, and `.nvmrc` pins `22`; macmini is
documented as requiring Node 22. With `node:sqlite`, the pinned interpreter fails this gate.

---

## 3. Driver — PENDING HUMAN DECISION

**Not frozen.** The choice changes the fleet's Node floor, which is above this document's scope. What is
frozen is that *the driver is a replaceable implementation of a fixed contract*: the schema, migration
registry, canonical encoding, error codes, and version gate are the protocol asset, exactly as the
architecture's "TypeScript first, Rust ready" section already says. **Neither candidate may change a byte
of the schema, and both must pass the identical conformance vectors.**

That is not an aspiration; it is measured. The same 40 vectors, unchanged, pass through both bindings:

```sh
cd spikes/sqlite-m2
node --test test/engine.test.mjs                              # node:sqlite     -> 40/40
npm install --no-save better-sqlite3
M2_DRIVER=better-sqlite3 node --test test/engine.test.mjs      # better-sqlite3  -> 40/40
```

Logs: `evidence/pass-node-sqlite.log`, `evidence/pass-better-sqlite3.log`.

### The two candidates, measured

| | `node:sqlite` (`DatabaseSync`) | `better-sqlite3` 13.0.3 |
|---|---|---|
| SQLite version | whatever the interpreter bundles; **cannot be pinned** | pinned by the dependency: 3.53.4 |
| Lowest interpreter passing §2 | Node **24.15.0** | Node 22 and 24 both work |
| Install | nothing; it is a builtin | 27 MB, 2.35 s, prebuilds for 8 platform triples |
| Native/ABI surface | none | N-API prebuilds; `node-gyp` fallback (python3 + C++ toolchain) off the 8 triples |
| API stability | `ExperimentalWarning` through 24.14.0; gone at 24.15.0 | stable |

### Thin-CLI cost, whole process

The shell-hook path spawns an interpreter per event, so the driver's open cost only matters relative to
interpreter startup. `evidence/probe-thin-cli.txt`, 20 runs each, whole process including startup, open,
WAL pragma, DDL, one insert, close:

| Node | bare startup | `node:sqlite` | `better-sqlite3` |
|---|---|---|---|
| 22.21.0 | 42.5 ms | 65.9 ms (+23.4, +55%) | 78.3 ms (+35.8, +84%) |
| 24.15.0 | 52.6 ms | 61.8 ms (+9.2, +18%) | 79.0 ms (+26.5, +50%) |

**Read this table before quoting the isolated open cost.** In isolation `node:sqlite` opens in ~1.4 ms
and `better-sqlite3` in ~13–21 ms, a 10× ratio that overstates the impact: measured end to end, the
difference is ~17 ms on a ~60 ms invocation, roughly 28%. Real, worth knowing, not an order of magnitude.
`better-sqlite3`'s heavier costs are the 27 MB install footprint and the native ABI dependency, which are
an adoption tax on exactly the external adopters (ZSwarm, self-launch) the protocol package exists to
serve.

### Frozen regardless of the outcome: the driver is a process-global commitment

**One process must never link two different SQLite builds against the same database file.** Measured
(`evidence/probe-bs3-semantics.txt`, `node probe-bs3-semantics.mjs`):

- Same process, `node:sqlite` holding `BEGIN IMMEDIATE`: better-sqlite3 **acquired the write lock in
  0 ms**. Single-writer is broken. POSIX advisory locks are per-process, so two builds cannot see each
  other's locks.
- Two processes, same pair of builds, holder confirmed holding before the attempt: better-sqlite3 was
  **correctly refused after 52 ms with `SQLITE_BUSY`**. Across processes they interoperate exactly as
  SQLite promises.
- Data written by either build is read correctly by the other. The hazard is locking, not format.

A published protocol package therefore cannot let a caller pass a binding per call, and an adopter that
already depends on a different SQLite binding must not load both in one process against one database.

### What would change the decision

- A required adopter cannot move off an interpreter whose bundled SQLite is below 3.51.3 → `better-sqlite3`.
- `node:sqlite` reintroduces an `ExperimentalWarning` or a breaking API change on the supported line → `better-sqlite3`.
- A non-Node adopter appears → a second implementation, at which point §5–§9 are the portable contract and
  the driver question is moot.

---

## 4. Connection gates

Every connection runs this sequence and **asserts each result by reading it back**. Setting a PRAGMA and
not checking it is how a database silently ends up in the wrong mode.

| Step | Statement | Required result | On failure |
|---|---|---|---|
| 1 | `PRAGMA busy_timeout=<n>` (default 5000) | read-back equals `n` | `PROTOCOL_PRAGMA_UNSUPPORTED` |
| 2 | `SELECT sqlite_version()` | ≥ `3.51.3` (§2) | `PROTOCOL_SQLITE_VERSION_UNSUPPORTED` |
| 3 | `PRAGMA foreign_keys=ON` | read-back is `1` | `PROTOCOL_PRAGMA_UNSUPPORTED` |
| 4 | `PRAGMA journal_mode=WAL` (writable only) | returned value is exactly `wal` | `PROTOCOL_JOURNAL_MODE_UNSUPPORTED` |
| 5 | `PRAGMA synchronous=FULL` (writable only) | read-back is `2` | `PROTOCOL_PRAGMA_UNSUPPORTED` |

### 4.1 The order is part of the contract

**`busy_timeout` must be the first statement on the connection.** It defaults to `0`, so any statement
issued before it runs with no busy handler at all and loses a contended lock immediately.

This is not theoretical. With the version probe placed first — the obvious ordering, since a version gate
"should" come before anything else — eight processes opening one fresh database concurrently lost the
race in **11 of 20 rounds**, with `SQLITE_BUSY` raised by `SELECT sqlite_version()`, the one statement
nobody suspects. Moving `busy_timeout` to the front: **0 failures in 25 rounds**. The scenario is
ordinary on this fleet — several shell hooks firing at once against a cold database.

- Counter-example: `spikes/sqlite-m2/stubs/busy-timeout-after-version-probe.mjs`, one edit, generated by
  `stubs/build.mjs`. It moves `db.exec('PRAGMA busy_timeout=...')` from before to after
  `db.prepare('SELECT sqlite_version() AS v')` in `spikes/sqlite-m2/engine.mjs:363-367`.
- Vectors it breaks: `repeated cold opens by eight processes never lose the first-open race`,
  `eight processes racing initialize on one address converge without duplication`,
  `concurrent consumers of one queue split it without a double dequeue`.
- Reproduce:
  ```sh
  cd spikes/sqlite-m2 && node stubs/build.mjs
  M2_ENGINE=../stubs/busy-timeout-after-version-probe.mjs \
    node --test test/engine.test.mjs test/concurrency.test.mjs   # fails
  node --test test/engine.test.mjs test/concurrency.test.mjs      # 46/46
  ```

### 4.2 `journal_mode=WAL` does not honour `busy_timeout`

Changing journal mode takes an exclusive lock and is the one statement the busy handler does not cover.
Measured: with `busy_timeout` already read back as `5000`, concurrent first-openers still got a bare
`database is locked` from `PRAGMA journal_mode=WAL`.

Two rules remove it, in this order:

1. **Read `PRAGMA journal_mode` first.** A database already in WAL never contends at all, which is the
   steady state for every open after the first.
2. **Bound-retry only the genuine first-open collision**, within the caller's `busy_timeout` budget.
   Measured convergence: 2 attempts, 21–40 ms, across eight racing processes.

Opening is not otherwise lock-free either: the first connection after the WAL is reset rebuilds the
`-shm` wal-index under a brief exclusive lock, and a concurrent opener can see `SQLITE_BUSY` from an
ordinary read. The whole open-time inspection is therefore retried within the same budget. **Runtime
operations are not retried** — `enqueue` and `dequeue` surface `PROTOCOL_DATABASE_BUSY` to the caller,
because only startup is transient in this way.

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

## 5. Exact DDL

This is the final, executable schema — migration version 1, component `session-protocol`. The draft in
`session-management-refactor.html` §3 is superseded where they differ; the differences are justified
below.

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
| pending index only | **0.0043 ms** | 11.59 ms (rowid scan across all sessions) |
| + history index, no `ANALYZE` | **0.0414 ms** ← 10× worse | 0.90 ms |
| + history index, after `ANALYZE` | 0.0043 ms | 0.87 ms |
| + history index, `INDEXED BY` pins, no `ANALYZE` | **0.0040 ms** | 1.02 ms |

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

### 7.3 Network filesystem rejection

WAL requires shared memory between processes and does not work over a network filesystem. Two guards, in
this order:

1. **The `journal_mode` assertion (§4), on every platform.** A filesystem that cannot host WAL cannot
   return `wal`. This is the portable guard.
2. **A `statfs` type deny-list, where the platform reports a recognisable filesystem identity.** Measured
   on Linux: `fs.statfsSync()` returns `{ type: 61267, ... }` for this host's ext4, and `61267 = 0xEF53 =
   EXT4_SUPER_MAGIC` in `/usr/include/linux/magic.h`. The mechanism is verified end to end; the values
   are copied from that header, not recalled (`evidence/filesystem-magic-source.txt`):
   NFS `0x6969`, SMB `0x517B`, CIFS `0xFF534D42`, SMB2 `0xFE534D42`, 9P `0x01021997`, CEPH `0x00C36400`,
   AFS `0x5346414F` and `0x6B414653`, CODA `0x73757245`, OCFS2 `0x7461636F`, NCP `0x564C`. A match is
   `PROTOCOL_PATH_UNSUPPORTED_FILESYSTEM`.

**FUSE (`0x65735546`) is deliberately not on the deny-list**: the magic identifies the driver, not
whether the backing store is local, so `sshfs` and a local overlay are indistinguishable by identity.
Guard 1 is the only protection there.

**Evidence gap, stated rather than papered over:** the deny-list values were verified against a real
mount for ext4 only, because no network mount exists on this host. The mechanism and the ext4 value are
measured; the network magic numbers are transcribed from the kernel header and are unexercised. macOS and
Windows report `statfs` types with different, unregistered meanings, so guard 2 is Linux-only. This
remains OPEN (§11).

---

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
| `PROTOCOL_PATH_UNSUPPORTED_FILESYSTEM` | deny-listed network filesystem |
| `PROTOCOL_SQLITE_VERSION_UNSUPPORTED` | `sqlite_version()` below §2 |
| `PROTOCOL_JOURNAL_MODE_UNSUPPORTED` | `journal_mode` is not `wal` |
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

### 10.1 Unresolved: does the same-database transaction seam admit `dequeue`?

For at-least-once *handling*, the journal row must be written **in the same transaction as the dequeue**.
Otherwise a crash between the dequeue commit and the journal write loses the record that handling was
owed, and the adopter gets at-most-once handling — the very thing the journal exists to avoid.

The frozen same-database seam is described as *topology mutation + required enqueue*. Whether it also
admits `dequeue` is **not settled**, and widening it is outside this document's scope. Recorded for M3
with both consequences stated:

- **Seam admits `dequeue`:** the adopter writes its journal row atomically with the dequeue and gets
  at-least-once handling with no outbox. This is the only shape that delivers the guarantee.
- **Seam does not admit `dequeue`:** the journal write is a separate transaction after the dequeue
  commits, and the adopter has at-most-once handling. That may be acceptable, but it must be a stated
  decision rather than an accident of the seam's shape.

The spike's transaction seam currently exposes `exec` and `enqueue` only, matching the frozen wording.

### 10.2 Transaction body purity is enforced, not documented

An `async` callback, or one returning a promise, is rejected with `PROTOCOL_TRANSACTION_INVALID` before
any write. Awaiting inside a write lock is the single failure mode that would invalidate every bounded
lock-hold claim in this document, so it is a runtime check rather than a review convention. A vector
asserts both forms are refused and that no state changed.

Measured lock-hold behaviour (`test/concurrency.test.mjs`): **3611 enqueues in 10.00 s = 361/s, p50
2.756 ms, p99 6.991 ms** with `synchronous=FULL` on this host — comfortably past the roadmap's M2 exit bar
of 500 short writes in 10 s, with a bounded p99.

---

## 11. Still OPEN

Named, with what is missing. None may be treated as an implementation requirement.

| Item | What is missing |
|---|---|
| **Driver** (§3) | A human decision on the fleet's Node floor. Both candidates' data is complete. |
| **Network-FS detection on macOS / Windows** (§7.3) | `fs.statfs` types there have different, unregistered meanings. Only the `journal_mode` guard applies. |
| **Network-FS magic numbers exercised** (§7.3) | Verified against a real mount for ext4 only; no network mount on this host. |
| **Sweep cadence** | An adopter runtime concern. `PRAGMA data_version` is available as a cheap change detector; nothing else is measured. |
| **Retention and purge** | Explicit maintenance policy, never in a hot transaction. No measurement of history growth or `VACUUM` cost over a real lifetime. |
| **Backup operational policy** | `VACUUM INTO` and the binding's backup API both work (measured). Cadence, retention, restore drill, and whether Litestream is warranted are unmeasured. |
| **`ANALYZE` / `PRAGMA optimize` maintenance** | The `INDEXED BY` pins remove it from correctness. Whether it is still worth running for other queries is unmeasured. |
| **WAL growth under sustained load** | `wal_autocheckpoint` is left at its default. Checkpoint starvation under a long-lived reader is not measured here. |
| **Same-DB seam and `dequeue`** (§10.1) | An M3 decision. |
| **Rust second implementation** | §5–§9 are the portable contract, but no second implementation exists to prove it. |

---

## 12. Reproducing everything

```sh
cd spikes/sqlite-m2

node --test test/engine.test.mjs test/concurrency.test.mjs   # 46/46, node:sqlite
node probe-driver.mjs                                        # driver/feature matrix for this Node
node probe-ddl.mjs                                           # STRICT, GLOB, statfs, symlink, plans, costs
node probe-index.mjs                                         # index plans and timings at 100k rows
node probe-thin-cli.mjs                                      # whole-process hook cost per driver
node stubs/build.mjs && node stubs/run.mjs                   # every frozen decision has a counter-example

npm install --no-save better-sqlite3                         # for the parity and semantics runs
M2_DRIVER=better-sqlite3 node --test test/engine.test.mjs     # 40/40, identical vectors
node probe-bs3-semantics.mjs                                 # two SQLite builds, one process vs two
```

The full Node matrix in `evidence/probe-node-matrix.txt` was produced by invoking `probe-driver.mjs`
under each interpreter in `~/.nvm/versions/node/` plus the one on `PATH`, with and without
`--experimental-sqlite`.

`spikes/sqlite-m2/fail-first-note.md` explains what each failure log does and does not prove; both logs
are kept verbatim.
