import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { envSessionId, readAliasedRecordEntry, sessionRecordPath, sessionStoreDir, type RawRecord } from '@spexcode/spec-core'

// Reproduces the live codex interactive-attribution bug: design C runs ONE shared per-project codex
// app-server launched with the FIRST session's SPEXCODE_SESSION_ID baked in. The agent's shell tool (its
// `spex session done/park/ask`) runs inside that app-server, so SPEXCODE_SESSION_ID is contaminated with the
// FIRST session — not the acting thread. Codex DOES inject the acting thread's id as CODEX_THREAD_ID into
// every spawned command, and SpexCode stores that id on the record as `harness_session_id`, so `envSessionId`
// must prefer the alias-resolved CODEX_THREAD_ID over the shared SPEXCODE_SESSION_ID.

const ENV_KEYS = ['SPEXCODE_HOME', 'SPEXCODE_SESSION_ID', 'CODEX_THREAD_ID', 'CLAUDE_CODE_SESSION_ID'] as const
const saved: Record<string, string | undefined> = {}
let home: string

function writeRecord(id: string, harnessSessionId: string): void {
  const rec: RawRecord = {
    session_id: id, governed: true, worktree_path: `/tmp/wt/${id}`, branch: `node/${id}`,
    title: null, name: null, status: 'active', proposal: null, merges: 0, note: null,
    sortkey: null, createdAt: Date.now(), harness: 'codex', harness_session_id: harnessSessionId,
  }
  const p = sessionRecordPath(id)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(rec))
}

before(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  home = mkdtempSync(join(tmpdir(), 'spex-sid-'))
  process.env.SPEXCODE_HOME = home
  // A = the contaminating FIRST session; B = the acting thread's session.
  writeRecord('id_A', 'thread_A')
  writeRecord('id_B', 'thread_B')
})

after(() => {
  rmSync(home, { recursive: true, force: true })
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
})

beforeEach(() => {
  // SPEXCODE_HOME persists (set in before); clear the per-test session env on every run.
  delete process.env.SPEXCODE_SESSION_ID
  delete process.env.CODEX_THREAD_ID
  delete process.env.CLAUDE_CODE_SESSION_ID
})

test('CODEX_THREAD_ID wins over the contaminating shared SPEXCODE_SESSION_ID', () => {
  process.env.SPEXCODE_SESSION_ID = 'id_A'        // baked into the shared app-server by session A
  process.env.CODEX_THREAD_ID = 'thread_B'        // codex injects the ACTING thread (B) per-command
  assert.equal(envSessionId(), 'id_B')            // attribution lands on B, not the contaminating A
})

test('no CODEX_THREAD_ID → SPEXCODE_SESSION_ID is used (claude / non-shared path, unchanged)', () => {
  process.env.SPEXCODE_SESSION_ID = 'id_A'
  assert.equal(envSessionId(), 'id_A')
})

test('CODEX_THREAD_ID with no governed record → falls back to SPEXCODE_SESSION_ID', () => {
  process.env.SPEXCODE_SESSION_ID = 'id_A'
  process.env.CODEX_THREAD_ID = 'thread_unknown'  // a non-governed / unknown thread, no record to alias
  assert.equal(envSessionId(), 'id_A')
})

test('claude is unaffected: CLAUDE_CODE_SESSION_ID == its record id resolves to that same id', () => {
  // claude's session env var IS its record id (no shared app-server), so tier-1 resolves to the same value
  // SPEXCODE_SESSION_ID would have returned.
  process.env.SPEXCODE_SESSION_ID = 'id_A'
  process.env.CLAUDE_CODE_SESSION_ID = 'id_A'
  assert.equal(envSessionId(), 'id_A')
})

// Absence splits in two and only one half is an alias question. An id that OWNS a store directory is already
// one of ours — a sentinel-only self-launched agent has a store dir and no record — so its emptiness is a
// settled fact about THAT session. Resolution must stop there rather than search the store, both because
// another record could otherwise answer under a live session's own name and because the turn-failure
// supervisor reconciles every record once a second: one record-less store dir meant a whole-store re-read and
// re-parse per tick (measured on a live 339-session store with 176 record-less dirs: 60,003 reads/second).

test('a store dir with no record never resolves to another record that aliases its name', () => {
  // id_ghost owns a store dir and wrote no record; id_C's harness_session_id happens to equal that name.
  writeRecord('id_C', 'id_ghost')
  mkdirSync(sessionStoreDir('id_ghost'), { recursive: true })
  try {
    const entry = readAliasedRecordEntry('id_ghost')
    assert.equal(entry.kind, 'absent')   // the live session's own name is not answerable by id_C
  } finally {
    rmSync(sessionStoreDir('id_ghost'), { recursive: true, force: true })
    rmSync(sessionStoreDir('id_C'), { recursive: true, force: true })
  }
})

test('resolving a record-less store dir does not enumerate the store', { skip: process.getuid?.() === 0 && 'root bypasses directory permissions' }, () => {
  // `--x` on the sessions root still permits path traversal (so the store-dir check answers) but makes
  // readdirSync fail — and listSessionIds is fail-loud on any non-ENOENT readdir error. So a scan is
  // observable here as a throw, and its absence is the proof that resolution stopped at the store dir.
  mkdirSync(sessionStoreDir('id_quiet'), { recursive: true })
  const root = dirname(sessionStoreDir('id_quiet'))
  chmodSync(root, 0o111)
  try {
    assert.throws(() => readdirSync(root), 'the --x root must make enumeration fail for this proof to mean anything')
    assert.equal(readAliasedRecordEntry('id_quiet').kind, 'absent')
  } finally {
    chmodSync(root, 0o755)
    rmSync(sessionStoreDir('id_quiet'), { recursive: true, force: true })
  }
})
